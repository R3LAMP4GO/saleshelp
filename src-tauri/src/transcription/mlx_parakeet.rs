//! Local MLX-Audio / Parakeet adapter. It sends Parley's 16 kHz PCM directly to
//! MLX-Audio's loopback WebSocket; no call audio leaves the machine.

use anyhow::{anyhow, Result};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tauri::AppHandle;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio_tungstenite::tungstenite::Message;

use super::common::{
    connect_with_headers, drive_session, LevelMeter, SegmentBuilder, TranscribeConfig, LEVEL_EVENT,
    TRANSCRIPT_EVENT,
};
use super::mlx_protocol;
use super::ws::{self, Next, OnClose, WsRead, WsWrite};
use crate::audio::resample::pcm_to_le_bytes;

const VAD_FRAME_SAMPLES: usize = 480; // 30 ms at Parley's fixed 16 kHz rate.

#[derive(Deserialize, Default)]
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

async fn forward_audio(
    mut write: WsWrite,
    mut meter: LevelMeter,
    mut pcm_rx: UnboundedReceiver<Vec<i16>>,
) -> bool {
    let mut pending = Vec::with_capacity(VAD_FRAME_SAMPLES * 2);
    while let Some(chunk) = pcm_rx.recv().await {
        meter.push(&chunk);
        pending.extend(chunk);
        while pending.len() >= VAD_FRAME_SAMPLES {
            let frame: Vec<i16> = pending.drain(..VAD_FRAME_SAMPLES).collect();
            if write
                .send(Message::Binary(pcm_to_le_bytes(&frame)))
                .await
                .is_err()
            {
                return false;
            }
        }
    }
    // MLX-Audio's VAD deliberately accepts only whole 30 ms frames. Padding the
    // final short tail preserves it instead of silently dropping speech.
    if !pending.is_empty() {
        pending.resize(VAD_FRAME_SAMPLES, 0);
        if write
            .send(Message::Binary(pcm_to_le_bytes(&pending)))
            .await
            .is_err()
        {
            return false;
        }
    }
    let _ = write.send(Message::Close(None)).await;
    true
}

async fn read_transcripts(app: AppHandle, source: &'static str, read: WsRead) -> Result<()> {
    let mut builder = SegmentBuilder::new(app, source, TRANSCRIPT_EVENT);
    ws::read_frames("mlx-parakeet", source, read, OnClose::Stop, |payload| {
        let Ok(event) = serde_json::from_str::<MlxEvent>(payload) else {
            return Ok(Next::Continue);
        };
        if !event.error.trim().is_empty() || event.status == "error" {
            return Err(anyhow!(
                "{}",
                if event.error.is_empty() {
                    "MLX-Audio transcription error"
                } else {
                    &event.error
                }
            ));
        }
        if event.text.trim().is_empty() {
            return Ok(Next::Continue); // e.g. MLX-Audio's initial {status: ready} frame.
        }
        if event.is_partial {
            builder.emit_tail(event.text.trim(), 0, 0);
        } else {
            builder.push_final(event.text.trim(), 0, 0, 0);
            builder.emit_committed();
            builder.endpoint();
            builder.emit_tail("", 0, 0);
        }
        Ok(Next::Continue)
    })
    .await
}

pub async fn run_session(
    app: AppHandle,
    config: TranscribeConfig,
    source: &'static str,
    pcm_rx: UnboundedReceiver<Vec<i16>>,
) -> Result<()> {
    let ws = connect_with_headers(mlx_protocol::URL, &[]).await?;
    let (mut write, read) = ws.split();
    let model = if config.model.trim().is_empty() {
        mlx_protocol::DEFAULT_MODEL
    } else {
        config.model.as_str()
    };
    write
        .send(Message::Text(mlx_protocol::setup_frame(model)))
        .await?;
    eprintln!("[mlx-parakeet:{source}] connected to loopback MLX-Audio, model={model} (speaker labels unavailable)");
    drive_session(
        "mlx-parakeet",
        forward_audio(
            write,
            LevelMeter::new(app.clone(), source, LEVEL_EVENT),
            pcm_rx,
        ),
        read_transcripts(app, source, read),
    )
    .await
}
