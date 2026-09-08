//! Opt-in, local-only MLX-Audio dual-session benchmark.
//!
//! It never starts, configures, or stops MLX-Audio. The server must already be
//! listening on loopback before this binary starts.

#[path = "../transcription/mlx_protocol.rs"]
mod mlx_protocol;

use anyhow::{anyhow, bail, Context, Result};
use futures_util::{future::try_join, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    net::TcpStream,
    sync::oneshot,
    time::{interval, sleep_until, timeout, Instant, MissedTickBehavior},
};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

const SERVER_ADDR: &str = "127.0.0.1:18080";
const FRAME_BYTES: usize = 640; // 20 ms × 16 kHz × mono i16.
const FRAME_INTERVAL: Duration = Duration::from_millis(20);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_MINUTES: u64 = 60;
const MAX_TURNS_PER_SESSION: usize = 1_000;
const MAX_FIXTURE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

type ClientWebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsWrite = futures_util::stream::SplitSink<ClientWebSocket, Message>;
type WsRead = futures_util::stream::SplitStream<ClientWebSocket>;

#[derive(Debug, Deserialize)]
struct FixtureManifest {
    version: u32,
    format: FixtureFormat,
    fixtures: Vec<FixtureEntry>,
}

#[derive(Debug, Deserialize)]
struct FixtureFormat {
    sample_rate_hz: u32,
    channels: u8,
    encoding: String,
}

#[derive(Debug, Deserialize)]
struct FixtureEntry {
    label: String,
    file: String,
    expected_normalized_text: String,
    duration_ms: u64,
    sha256: String,
}

#[derive(Clone, Debug)]
struct Fixture {
    label: String,
    expected_normalized_text: String,
    pcm: Vec<u8>,
}

#[derive(Debug, Deserialize, Default)]
struct MlxEvent {
    #[serde(default)]
    text: String,
    #[serde(default)]
    is_partial: bool,
    #[serde(default)]
    error: String,
    #[serde(default)]
    status: String,
}

#[derive(Debug, Serialize)]
struct RunReport {
    schema_version: u32,
    status: &'static str,
    started_unix_ms: u128,
    requested_duration_seconds: u64,
    endpoint: &'static str,
    gpu_status: &'static str,
    server_process: ProcessMetrics,
    client_process: ProcessMetrics,
    sessions: Vec<SessionReport>,
    aggregate: AggregateReport,
}

#[derive(Debug, Serialize)]
struct SessionReport {
    label: String,
    connected_ms: u128,
    first_server_message_ms: Option<u128>,
    turns: Vec<TurnReport>,
}

#[derive(Debug, Serialize)]
struct TurnReport {
    number: usize,
    started_ms: u128,
    first_server_message_ms: Option<u128>,
    done_ms: u128,
    final_server_message_ms: Option<u128>,
    completed_ms: Option<u128>,
    transcript: String,
    normalized_transcript: String,
    expected_normalized_text: String,
    matches_expected: bool,
    expected_phrase_on_other_session: bool,
    result_before_done: bool,
}

#[derive(Debug, Serialize)]
struct AggregateReport {
    first_latency_ms: LatencySummary,
    final_latency_ms: LatencySummary,
    match_rate: f64,
}

#[derive(Debug, Serialize)]
struct LatencySummary {
    p50: Option<u128>,
    p95: Option<u128>,
}

#[derive(Debug, Serialize)]
struct ProcessMetrics {
    status: String,
    pid: Option<i32>,
    samples: Vec<ProcessSample>,
}

#[derive(Debug, Serialize)]
struct ProcessSample {
    elapsed_ms: u128,
    rss_bytes: u64,
    cpu_percent: Option<f64>,
}

struct ProcessSampler {
    pid: i32,
    status: String,
    previous: Option<(Instant, u64)>,
    samples: Vec<ProcessSample>,
}

struct ConnectedSession {
    write: WsWrite,
    read: WsRead,
    connected_ms: u128,
}

struct ReceivedText {
    text: String,
    is_final: bool,
    received: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let minutes = parse_minutes(std::env::args().skip(1))?;
    if timeout(CONNECT_TIMEOUT, TcpStream::connect(SERVER_ADDR))
        .await
        .is_err()
    {
        println!("{{\"status\":\"server_unavailable\",\"endpoint\":\"127.0.0.1:18080\"}}");
        return Ok(());
    }

    let fixtures = load_fixtures(&fixture_dir())?;
    let server_pid = verified_server_pid()?;
    let started_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock precedes Unix epoch")?
        .as_millis();
    let started = Instant::now();
    let (stop_sampling, sampling_stopped) = oneshot::channel();
    let sampler = tokio::spawn(sample_processes(server_pid, started, sampling_stopped));
    let report = run_dual_session(
        mlx_protocol::URL,
        fixtures,
        Duration::from_secs(minutes * 60),
        started,
        started_unix_ms,
    )
    .await;
    let _ = stop_sampling.send(());
    let (server_process, client_process) = sampler.await.context("process sampler failed")?;
    let mut report = report?;
    report.server_process = server_process;
    report.client_process = client_process;
    let output = write_results(&report)?;
    println!("{}", output.display());

    if report.aggregate.match_rate < 1.0
        || report
            .sessions
            .iter()
            .flat_map(|session| &session.turns)
            .any(|turn| turn.expected_phrase_on_other_session)
    {
        bail!(
            "transcript isolation or expected-text check failed; see {}",
            output.display()
        );
    }
    Ok(())
}

fn parse_minutes(mut args: impl Iterator<Item = String>) -> Result<u64> {
    let flag = args
        .next()
        .ok_or_else(|| anyhow!("usage: --minutes <1..={MAX_MINUTES}>"))?;
    let raw = args
        .next()
        .ok_or_else(|| anyhow!("usage: --minutes <1..={MAX_MINUTES}>"))?;
    if flag != "--minutes" || args.next().is_some() {
        bail!("usage: --minutes <1..={MAX_MINUTES}>");
    }
    let minutes: u64 = raw.parse().context("--minutes must be a whole number")?;
    if !(1..=MAX_MINUTES).contains(&minutes) {
        bail!("--minutes must be between 1 and {MAX_MINUTES}");
    }
    Ok(minutes)
}

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/lotlift-parakeet")
}

fn load_fixtures(root: &Path) -> Result<[Fixture; 2]> {
    let manifest_path = root.join("manifest.json");
    let manifest_bytes = read_bounded(&manifest_path, MAX_MANIFEST_BYTES)?;
    let manifest: FixtureManifest = serde_json::from_slice(&manifest_bytes)
        .with_context(|| format!("invalid fixture manifest {}", manifest_path.display()))?;
    if manifest.version != 1
        || manifest.format.sample_rate_hz != mlx_protocol::SAMPLE_RATE
        || manifest.format.channels != 1
        || manifest.format.encoding != "pcm_s16le"
        || manifest.fixtures.len() != 2
    {
        bail!("unsupported fixture manifest format");
    }

    let mut fixtures = BTreeMap::new();
    for entry in manifest.fixtures {
        if !matches!(entry.label.as_str(), "me" | "them")
            || entry.file != format!("{}.pcm", entry.label)
            || entry.expected_normalized_text != normalize(&entry.expected_normalized_text)
            || entry.duration_ms == 0
            || entry.sha256.len() != 64
            || fixtures.contains_key(&entry.label)
        {
            bail!(
                "fixture manifest contains invalid entry for {}",
                entry.label
            );
        }
        let pcm = read_bounded(&root.join(&entry.file), MAX_FIXTURE_BYTES)?;
        if pcm.is_empty() || pcm.len() % FRAME_BYTES != 0 && pcm.len() % 2 != 0 {
            bail!("fixture {} is not 16-bit PCM", entry.file);
        }
        let calculated_duration_ms = (pcm.len() as u64).div_ceil(32);
        if calculated_duration_ms != entry.duration_ms {
            bail!("fixture duration mismatch for {}", entry.file);
        }
        let checksum = format!("{:x}", Sha256::digest(&pcm));
        if checksum != entry.sha256 {
            bail!("fixture checksum mismatch for {}", entry.file);
        }
        fixtures.insert(
            entry.label.clone(),
            Fixture {
                label: entry.label,
                expected_normalized_text: entry.expected_normalized_text,
                pcm,
            },
        );
    }

    Ok([
        fixtures
            .remove("me")
            .ok_or_else(|| anyhow!("missing me fixture"))?,
        fixtures
            .remove("them")
            .ok_or_else(|| anyhow!("missing them fixture"))?,
    ])
}

fn read_bounded(path: &Path, max_bytes: u64) -> Result<Vec<u8>> {
    let metadata = fs::metadata(path).with_context(|| format!("cannot read {}", path.display()))?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        bail!("refusing oversized or non-file input {}", path.display());
    }
    fs::read(path).with_context(|| format!("cannot read {}", path.display()))
}

async fn run_dual_session(
    url: &str,
    fixtures: [Fixture; 2],
    duration: Duration,
    started: Instant,
    started_unix_ms: u128,
) -> Result<RunReport> {
    let (me, them) = try_join(connect_session(url, started), connect_session(url, started)).await?;
    let schedule_start = Instant::now() + FRAME_INTERVAL;
    let deadline = schedule_start + duration;
    let (me, them) = tokio::try_join!(
        run_session(me, fixtures[0].clone(), schedule_start, deadline, started),
        run_session(them, fixtures[1].clone(), schedule_start, deadline, started)
    )?;
    let mut sessions = vec![me, them];
    mark_crossed_transcripts(
        &mut sessions,
        &fixtures[0].expected_normalized_text,
        &fixtures[1].expected_normalized_text,
    );
    Ok(RunReport {
        schema_version: 1,
        status: "complete",
        started_unix_ms,
        requested_duration_seconds: duration.as_secs(),
        endpoint: mlx_protocol::URL,
        gpu_status: "unavailable",
        server_process: ProcessMetrics {
            status: "pending".into(),
            pid: None,
            samples: Vec::new(),
        },
        client_process: ProcessMetrics {
            status: "pending".into(),
            pid: None,
            samples: Vec::new(),
        },
        aggregate: aggregate(&sessions),
        sessions,
    })
}

async fn connect_session(url: &str, started: Instant) -> Result<ConnectedSession> {
    let (socket, _) = timeout(CONNECT_TIMEOUT, connect_async(url))
        .await
        .context("WebSocket connect timed out")??;
    let (mut write, read) = socket.split();
    write
        .send(Message::Text(mlx_protocol::setup_frame(
            mlx_protocol::DEFAULT_MODEL,
        )))
        .await
        .context("sending MLX-Audio setup frame failed")?;
    Ok(ConnectedSession {
        write,
        read,
        connected_ms: started.elapsed().as_millis(),
    })
}

async fn run_session(
    session: ConnectedSession,
    fixture: Fixture,
    schedule_start: Instant,
    deadline: Instant,
    started: Instant,
) -> Result<SessionReport> {
    let mut session = session;
    let mut turns = Vec::new();
    let mut first_server_message_ms = None;
    let mut next_turn_start = schedule_start;
    let report = async {
        while next_turn_start < deadline && turns.len() < MAX_TURNS_PER_SESSION {
            let turn_audio_duration =
                Duration::from_millis((pcm_frames(&fixture.pcm)?.len() as u64) * 20);
            if next_turn_start + turn_audio_duration > deadline {
                break;
            }
            let number = turns.len() + 1;
            let turn = run_turn(
                &mut session,
                &fixture,
                number,
                next_turn_start,
                started,
                &mut first_server_message_ms,
            )
            .await?;
            next_turn_start = Instant::now();
            turns.push(turn);
        }
        if turns.len() == MAX_TURNS_PER_SESSION && Instant::now() < deadline {
            bail!("turn cap reached for {}", fixture.label);
        }
        Ok(SessionReport {
            label: fixture.label,
            connected_ms: session.connected_ms,
            first_server_message_ms,
            turns,
        })
    }
    .await;
    let _ = session.write.send(Message::Close(None)).await;
    report
}

async fn run_turn(
    session: &mut ConnectedSession,
    fixture: &Fixture,
    number: usize,
    start_at: Instant,
    started: Instant,
    session_first_message_ms: &mut Option<u128>,
) -> Result<TurnReport> {
    let frames = pcm_frames(&fixture.pcm)?;
    let started_ms = started.elapsed().as_millis();
    let mut next_frame_at = start_at;
    let mut frame_index = 0;
    let mut first_server_message_ms = None;
    let mut transcript = String::new();
    let mut result_before_done = false;

    while frame_index < frames.len() {
        tokio::select! {
            _ = sleep_until(next_frame_at) => {
                session.write.send(Message::Binary(frames[frame_index].clone())).await?;
                frame_index += 1;
                next_frame_at += FRAME_INTERVAL;
            }
            message = session.read.next() => {
                let received = parse_message(message)?;
                record_message(&received, started, &mut first_server_message_ms, session_first_message_ms, &mut transcript);
                result_before_done |= !received.text.is_empty();
            }
        }
    }

    session
        .write
        .send(Message::Text(r#"{"type":"done"}"#.into()))
        .await?;
    let done_ms = started.elapsed().as_millis();
    let response_deadline = Instant::now() + RESPONSE_TIMEOUT;
    let mut final_server_message_ms = None;
    let mut completed_ms = None;
    while Instant::now() < response_deadline {
        let remaining = response_deadline.saturating_duration_since(Instant::now());
        let message = timeout(remaining, session.read.next())
            .await
            .context("MLX-Audio final response timed out")?;
        let received = parse_message(message)?;
        record_message(
            &received,
            started,
            &mut first_server_message_ms,
            session_first_message_ms,
            &mut transcript,
        );
        if received.is_final {
            final_server_message_ms = Some(started.elapsed().as_millis());
            completed_ms = final_server_message_ms;
            break;
        }
    }
    if completed_ms.is_none() {
        bail!(
            "MLX-Audio returned no final transcript for {} turn {number}",
            fixture.label
        );
    }

    let normalized_transcript = normalize(&transcript);
    Ok(TurnReport {
        number,
        started_ms,
        first_server_message_ms,
        done_ms,
        final_server_message_ms,
        completed_ms,
        matches_expected: normalized_transcript == fixture.expected_normalized_text,
        expected_phrase_on_other_session: false,
        normalized_transcript,
        transcript,
        expected_normalized_text: fixture.expected_normalized_text.clone(),
        result_before_done,
    })
}

fn pcm_frames(pcm: &[u8]) -> Result<Vec<Vec<u8>>> {
    if pcm.is_empty() || !pcm.len().is_multiple_of(2) {
        bail!("PCM must contain complete i16 samples");
    }
    Ok(pcm
        .chunks(FRAME_BYTES)
        .map(|chunk| {
            let mut frame = chunk.to_vec();
            frame.resize(FRAME_BYTES, 0);
            frame
        })
        .collect())
}

fn parse_message(
    message: Option<Result<Message, tokio_tungstenite::tungstenite::Error>>,
) -> Result<ReceivedText> {
    let message = message.ok_or_else(|| anyhow!("MLX-Audio closed the WebSocket"))??;
    let Message::Text(payload) = message else {
        return Ok(ReceivedText {
            text: String::new(),
            is_final: false,
            received: false,
        });
    };
    let event: MlxEvent = serde_json::from_str(&payload).context("invalid MLX-Audio response")?;
    if !event.error.trim().is_empty() || event.status == "error" {
        bail!(
            "{}",
            if event.error.is_empty() {
                "MLX-Audio transcription error"
            } else {
                &event.error
            }
        );
    }
    Ok(ReceivedText {
        is_final: !event.is_partial && !event.text.trim().is_empty(),
        text: event.text.trim().to_owned(),
        received: true,
    })
}

fn record_message(
    received: &ReceivedText,
    started: Instant,
    turn_first_message_ms: &mut Option<u128>,
    session_first_message_ms: &mut Option<u128>,
    transcript: &mut String,
) {
    if !received.received {
        return;
    }
    let now = started.elapsed().as_millis();
    if turn_first_message_ms.is_none() {
        *turn_first_message_ms = Some(now);
    }
    if session_first_message_ms.is_none() {
        *session_first_message_ms = Some(now);
    }
    if received.is_final {
        *transcript = received.text.clone();
    }
}

fn aggregate(sessions: &[SessionReport]) -> AggregateReport {
    let turns: Vec<&TurnReport> = sessions.iter().flat_map(|session| &session.turns).collect();
    let first_latency = turns
        .iter()
        .filter_map(|turn| {
            turn.first_server_message_ms
                .map(|first| first.saturating_sub(turn.started_ms))
        })
        .collect();
    let final_latency = turns
        .iter()
        .filter_map(|turn| {
            turn.completed_ms
                .map(|complete| complete.saturating_sub(turn.done_ms))
        })
        .collect();
    let matches = turns.iter().filter(|turn| turn.matches_expected).count();
    AggregateReport {
        first_latency_ms: latency_summary(first_latency),
        final_latency_ms: latency_summary(final_latency),
        match_rate: if turns.is_empty() {
            0.0
        } else {
            matches as f64 / turns.len() as f64
        },
    }
}

fn mark_crossed_transcripts(
    sessions: &mut [SessionReport],
    me_expected: &str,
    them_expected: &str,
) {
    if sessions.len() != 2 {
        return;
    }
    for turn in &mut sessions[0].turns {
        turn.expected_phrase_on_other_session = turn.normalized_transcript.contains(them_expected);
    }
    for turn in &mut sessions[1].turns {
        turn.expected_phrase_on_other_session = turn.normalized_transcript.contains(me_expected);
    }
}

fn latency_summary(mut values: Vec<u128>) -> LatencySummary {
    values.sort_unstable();
    let percentile = |percent: usize| {
        values
            .get((values.len() * percent).div_ceil(100).saturating_sub(1))
            .copied()
    };
    LatencySummary {
        p50: percentile(50),
        p95: percentile(95),
    }
}

fn normalize(text: &str) -> String {
    text.chars()
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_os = "macos")]
fn verified_server_pid() -> Result<Option<i32>> {
    let output = Command::new("/usr/sbin/lsof")
        .args(["-nP", "-iTCP:18080", "-sTCP:LISTEN", "-t"])
        .output()
        .context("could not inspect the loopback listener")?;
    if !output.status.success() {
        return Ok(None);
    }
    let pids: Vec<i32> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect();
    let [pid] = pids.as_slice() else {
        return Ok(None);
    };
    let command = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .context("could not verify the loopback listener identity")?;
    let identity = String::from_utf8_lossy(&command.stdout).to_lowercase();
    Ok(identity.contains("mlx_audio").then_some(*pid))
}

#[cfg(not(target_os = "macos"))]
fn verified_server_pid() -> Result<Option<i32>> {
    Ok(None)
}

async fn sample_processes(
    server_pid: Option<i32>,
    started: Instant,
    mut stopped: oneshot::Receiver<()>,
) -> (ProcessMetrics, ProcessMetrics) {
    let mut server = server_pid.map(|pid| ProcessSampler::new(pid, "available"));
    let mut client = ProcessSampler::new(std::process::id() as i32, "available");
    let mut ticker = interval(Duration::from_secs(1));
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if let Some(server) = &mut server {
                    server.sample(started);
                }
                client.sample(started);
            }
            _ = &mut stopped => break,
        }
    }
    (
        server.map_or_else(
            || ProcessMetrics {
                status: "unavailable: loopback listener did not identify as mlx_audio".into(),
                pid: None,
                samples: Vec::new(),
            },
            ProcessSampler::finish,
        ),
        client.finish(),
    )
}

impl ProcessSampler {
    fn new(pid: i32, status: &str) -> Self {
        Self {
            pid,
            status: status.into(),
            previous: None,
            samples: Vec::new(),
        }
    }

    fn sample(&mut self, started: Instant) {
        match process_task_info(self.pid) {
            Ok((rss_bytes, cpu_time_ns)) => {
                let now = Instant::now();
                let cpu_percent = self.previous.map(|(then, previous_cpu_time_ns)| {
                    let wall_seconds = now.duration_since(then).as_secs_f64();
                    if wall_seconds == 0.0 {
                        0.0
                    } else {
                        (cpu_time_ns.saturating_sub(previous_cpu_time_ns) as f64
                            / wall_seconds
                            / 1_000_000_000.0)
                            * 100.0
                    }
                });
                self.previous = Some((now, cpu_time_ns));
                self.samples.push(ProcessSample {
                    elapsed_ms: started.elapsed().as_millis(),
                    rss_bytes,
                    cpu_percent,
                });
            }
            Err(error) => self.status = format!("unavailable: {error}"),
        }
    }

    fn finish(self) -> ProcessMetrics {
        ProcessMetrics {
            status: self.status,
            pid: Some(self.pid),
            samples: self.samples,
        }
    }
}

#[cfg(target_os = "macos")]
fn process_task_info(pid: i32) -> Result<(u64, u64)> {
    let mut info = std::mem::MaybeUninit::<libc::proc_taskinfo>::zeroed();
    let expected = std::mem::size_of::<libc::proc_taskinfo>() as i32;
    // SAFETY: `info` has the exact Darwin `PROC_PIDTASKINFO` layout and size.
    let received = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTASKINFO,
            0,
            info.as_mut_ptr().cast(),
            expected,
        )
    };
    if received != expected {
        bail!("proc_pidinfo failed for pid {pid}");
    }
    // SAFETY: Darwin filled all bytes after reporting the exact struct size.
    let info = unsafe { info.assume_init() };
    Ok((
        info.pti_resident_size,
        info.pti_total_user.saturating_add(info.pti_total_system),
    ))
}

#[cfg(not(target_os = "macos"))]
fn process_task_info(_pid: i32) -> Result<(u64, u64)> {
    bail!("process sampling is only implemented on macOS")
}

fn write_results(report: &RunReport) -> Result<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tmp/lotlift-parakeet-bench");
    fs::create_dir_all(&root)?;
    let run_dir = root.join(report.started_unix_ms.to_string());
    fs::create_dir(&run_dir)?;
    fs::write(
        run_dir.join("results.json"),
        serde_json::to_vec_pretty(report)?,
    )?;
    let mut csv = String::from("label,turn,connected_ms,started_ms,first_server_message_ms,done_ms,final_server_message_ms,completed_ms,matches_expected,expected_phrase_on_other_session,result_before_done,normalized_transcript\n");
    for session in &report.sessions {
        for turn in &session.turns {
            csv.push_str(&format!(
                "{},{},{},{},{},{},{},{},{},{},{},{}\n",
                session.label,
                turn.number,
                session.connected_ms,
                turn.started_ms,
                optional_number(turn.first_server_message_ms),
                turn.done_ms,
                optional_number(turn.final_server_message_ms),
                optional_number(turn.completed_ms),
                turn.matches_expected,
                turn.expected_phrase_on_other_session,
                turn.result_before_done,
                csv_field(&turn.normalized_transcript),
            ));
        }
    }
    fs::write(run_dir.join("results.csv"), csv)?;
    retain_latest_runs(&root, 5)?;
    Ok(run_dir)
}

fn optional_number(number: Option<u128>) -> String {
    number.map_or_else(String::new, |number| number.to_string())
}

fn csv_field(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn retain_latest_runs(root: &Path, keep: usize) -> Result<()> {
    let mut runs: Vec<_> = fs::read_dir(root)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .collect();
    runs.sort_by_key(|entry| entry.file_name());
    for entry in runs.into_iter().rev().skip(keep) {
        fs::remove_dir_all(entry.path())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    #[test]
    fn normalizes_and_frames_pcm() {
        assert_eq!(normalize(" Price—too   HIGH! "), "price too high");
        let frames = pcm_frames(&[1, 0, 2, 0]).expect("valid PCM");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].len(), FRAME_BYTES);
        assert_eq!(&frames[0][..4], &[1, 0, 2, 0]);
        assert!(frames[0][4..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn validates_committed_manifest_and_rejects_wrong_version() {
        let fixtures = load_fixtures(&fixture_dir()).expect("committed fixtures validate");
        assert_eq!(fixtures[0].label, "me");
        assert_eq!(fixtures[1].label, "them");
        let root =
            std::env::temp_dir().join(format!("lotlift-invalid-manifest-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("temporary fixture root");
        fs::write(
            root.join("manifest.json"),
            r#"{"version":2,"format":{"sample_rate_hz":16000,"channels":1,"encoding":"pcm_s16le"},"fixtures":[]}"#,
        )
        .expect("temporary manifest");
        assert!(load_fixtures(&root).is_err());
        fs::remove_dir_all(root).expect("remove temporary fixture root");
    }

    #[test]
    fn aggregates_latency_and_marks_crossed_transcripts() {
        let summary = latency_summary(vec![10, 20, 30, 40, 50]);
        assert_eq!(summary.p50, Some(30));
        assert_eq!(summary.p95, Some(50));
        let mut sessions = vec![
            SessionReport {
                label: "me".into(),
                connected_ms: 0,
                first_server_message_ms: None,
                turns: vec![test_turn("that price is too high for me")],
            },
            SessionReport {
                label: "them".into(),
                connected_ms: 0,
                first_server_message_ms: None,
                turns: vec![test_turn("i would like to schedule a test drive tomorrow")],
            },
        ];
        mark_crossed_transcripts(
            &mut sessions,
            "i would like to schedule a test drive tomorrow",
            "that price is too high for me",
        );
        assert!(sessions
            .iter()
            .all(|session| session.turns[0].expected_phrase_on_other_session));
    }

    #[tokio::test]
    async fn completes_two_isolated_sessions_without_real_mlx_audio() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("listener address");
        let configured = Arc::new(AtomicUsize::new(0));
        let fake = tokio::spawn(fake_server(listener, configured.clone()));
        let started = Instant::now();
        let report = timeout(
            Duration::from_secs(10),
            run_dual_session(
                &format!("ws://{address}"),
                [
                    test_fixture("me", "me fixture", 1),
                    test_fixture("them", "them fixture", 2),
                ],
                Duration::from_secs(1),
                started,
                0,
            ),
        )
        .await
        .expect("benchmark timeout")
        .expect("benchmark report");
        assert_eq!(configured.load(Ordering::SeqCst), 2);
        assert_eq!(report.sessions.len(), 2);
        assert!(report.sessions.iter().all(|session| {
            !session.turns.is_empty()
                && session.turns.iter().all(|turn| {
                    turn.matches_expected
                        && !turn.expected_phrase_on_other_session
                        && !turn.result_before_done
                })
        }));
        timeout(Duration::from_secs(10), fake)
            .await
            .expect("fake server timeout")
            .expect("fake server task")
            .expect("fake server result");
    }

    fn test_fixture(label: &str, expected: &str, marker: u8) -> Fixture {
        let mut pcm = Vec::with_capacity(50 * FRAME_BYTES);
        for index in 0_u8..50 {
            let mut frame = vec![0; FRAME_BYTES];
            frame[0] = index;
            frame[1] = marker;
            pcm.extend(frame);
        }
        Fixture {
            label: label.into(),
            expected_normalized_text: expected.into(),
            pcm,
        }
    }

    fn test_turn(transcript: &str) -> TurnReport {
        TurnReport {
            number: 1,
            started_ms: 0,
            first_server_message_ms: None,
            done_ms: 0,
            final_server_message_ms: None,
            completed_ms: None,
            transcript: transcript.into(),
            normalized_transcript: transcript.into(),
            expected_normalized_text: String::new(),
            matches_expected: false,
            expected_phrase_on_other_session: false,
            result_before_done: false,
        }
    }

    async fn fake_server(listener: TcpListener, configured: Arc<AtomicUsize>) -> Result<()> {
        let (first, _) = listener.accept().await?;
        let (second, _) = listener.accept().await?;
        tokio::try_join!(
            fake_session(first, configured.clone()),
            fake_session(second, configured),
        )?;
        Ok(())
    }

    async fn fake_session(stream: TcpStream, configured: Arc<AtomicUsize>) -> Result<()> {
        let socket = accept_async(stream).await?;
        let (mut write, mut read) = socket.split();
        let setup = read
            .next()
            .await
            .ok_or_else(|| anyhow!("missing setup"))??;
        assert_eq!(
            setup.into_text()?,
            mlx_protocol::setup_frame(mlx_protocol::DEFAULT_MODEL),
        );
        configured.fetch_add(1, Ordering::SeqCst);
        let mut marker = None;
        let mut expected_index = 0_u8;
        while let Some(message) = read.next().await {
            match message? {
                Message::Binary(frame) => {
                    assert_eq!(configured.load(Ordering::SeqCst), 2);
                    assert_eq!(frame.len(), FRAME_BYTES);
                    assert_eq!(frame[0], expected_index);
                    let source = frame[1];
                    assert!(matches!(source, 1 | 2));
                    assert!(marker.map_or(true, |current| current == source));
                    marker = Some(source);
                    expected_index = expected_index.wrapping_add(1);
                }
                Message::Text(done) => {
                    assert_eq!(done, r#"{"type":"done"}"#);
                    assert_eq!(expected_index, 50);
                    let text = if marker == Some(1) {
                        "me fixture"
                    } else {
                        "them fixture"
                    };
                    write
                        .send(Message::Text(
                            serde_json::json!({"text": text, "is_partial": false}).to_string(),
                        ))
                        .await?;
                    expected_index = 0;
                    marker = None;
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        Ok(())
    }
}
