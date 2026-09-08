//! Explicit, durable, local-first Frappe CRM delivery.
//!
//! The outbox contains no credential. A caller must durably enqueue after final
//! analysis has committed; delivery is separately triggered and never touches live calls.

use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    net::IpAddr,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, Context, Result};
use keyring::Entry as KeyringEntry;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    call_state::FactStatus,
    final_analysis::{self, FinalCallAnalysis},
};

const OUTBOX_SCHEMA_VERSION: u16 = 1;
const MAX_ATTEMPTS: u8 = 5;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const SECRET_SERVICE: &str = "com.parley.lotlift.frappe";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FrappeAuthMethod {
    Token,
    Bearer,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FrappeConfig {
    pub base_url: String,
    pub auth_method: FrappeAuthMethod,
    /// Keychain account name. The secret is never persisted in settings or the outbox.
    pub credential_reference: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OutboxState {
    Pending,
    Sending,
    Delivered,
    Retry,
    DeadLetter,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduledAction {
    pub id: String,
    pub action_type: String,
    pub state: OutboxState,
    pub reason: String,
    pub source: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FrappeOutboxEntry {
    pub idempotency_key: String,
    pub call_id: String,
    pub revision: u64,
    pub event_type: String,
    pub state: OutboxState,
    pub attempts: u8,
    pub next_attempt_at: u64,
    pub config: FrappeConfig,
    pub payload: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub scheduled_action: Option<ScheduledAction>,
    pub remote_name: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FrappeOutbox {
    schema_version: u16,
    entries: Vec<FrappeOutboxEntry>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn valid_identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b' '))
}

fn validated_base_url(value: &str) -> Result<Url> {
    let url = Url::parse(value.trim()).context("invalid Frappe base URL")?;
    let local = url.host_str().is_some_and(|host| {
        host == "localhost"
            || host.ends_with(".localhost")
            || host
                .trim_matches(['[', ']'])
                .parse::<IpAddr>()
                .is_ok_and(|address| address.is_loopback())
    });
    if !(url.scheme() == "https" || (url.scheme() == "http" && local))
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(anyhow!(
            "Frappe URL must use HTTPS (except explicit localhost development)"
        ));
    }
    Ok(url)
}

fn validate_config(config: &FrappeConfig) -> Result<()> {
    validated_base_url(&config.base_url)?;
    if !valid_identifier(&config.credential_reference, 80) {
        return Err(anyhow!("invalid Frappe configuration"));
    }
    Ok(())
}

fn outbox_path(app: &AppHandle) -> Result<std::path::PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .context("resolve app-data directory")?
        .join("lotlift")
        .join("frappe-outbox.json"))
}

fn load_outbox(path: &std::path::Path) -> Result<FrappeOutbox> {
    if !path.exists() {
        return Ok(FrappeOutbox {
            schema_version: OUTBOX_SCHEMA_VERSION,
            entries: vec![],
        });
    }
    let outbox: FrappeOutbox =
        serde_json::from_slice(&fs::read(path).context("read Frappe outbox")?)
            .context("parse Frappe outbox")?;
    if outbox.schema_version != OUTBOX_SCHEMA_VERSION {
        return Err(anyhow!("unsupported Frappe outbox schema version"));
    }
    Ok(outbox)
}

fn save_outbox(path: &std::path::Path, outbox: &FrappeOutbox) -> Result<()> {
    let directory = path.parent().context("missing Frappe outbox directory")?;
    fs::create_dir_all(directory).context("create Frappe outbox directory")?;
    let temporary = directory.join(".frappe-outbox.tmp");
    let bytes = serde_json::to_vec_pretty(outbox).context("serialize Frappe outbox")?;
    let mut file = fs::File::create(&temporary).context("create temporary Frappe outbox")?;
    file.write_all(&bytes)
        .context("write temporary Frappe outbox")?;
    file.sync_all().context("sync temporary Frappe outbox")?;
    fs::rename(&temporary, path).context("replace Frappe outbox atomically")?;
    Ok(())
}

// simplification: one global queue lock; upgrade to per-account locks if CRM sends become concurrent.
static OUTBOX_LOCK: Mutex<()> = Mutex::new(());

fn verified(fact: &crate::call_state::FieldValue) -> Option<String> {
    (fact.status == FactStatus::Verified)
        .then(|| fact.value.clone())
        .flatten()
}

fn required(value: Option<String>, field: &str) -> Result<String> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("no verified {field} is available for Frappe sync"))
}

fn outcome(analysis: &FinalCallAnalysis) -> &'static str {
    if analysis.do_not_contact {
        return "do_not_contact";
    }
    let context = [
        verified(&analysis.call_outcome),
        verified(&analysis.next_action),
        verified(&analysis.fit_status),
        verified(&analysis.close_opportunity),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ")
    .to_lowercase();
    if context.contains("not interested") || context.contains("no follow") {
        "no_follow_up"
    } else if ["demo", "meeting", "follow", "information", "send"]
        .iter()
        .any(|phrase| context.contains(phrase))
    {
        "qualified"
    } else {
        "no_follow_up"
    }
}

fn map_analysis(
    config: &FrappeConfig,
    analysis: &FinalCallAnalysis,
) -> Result<BTreeMap<String, serde_json::Value>> {
    validate_config(config)?;
    Ok(BTreeMap::from([
        (
            "idempotency_key".into(),
            format!("{}:{}:final_analysis", analysis.call_id, analysis.revision).into(),
        ),
        ("outcome".into(), outcome(analysis).into()),
        (
            "first_name".into(),
            required(verified(&analysis.contact_name), "contact name")?.into(),
        ),
        (
            "email".into(),
            required(verified(&analysis.email), "email")?.into(),
        ),
        (
            "summary".into(),
            required(verified(&analysis.summary), "summary")?.into(),
        ),
        (
            "organization".into(),
            verified(&analysis.dealership).unwrap_or_default().into(),
        ),
        (
            "mobile_no".into(),
            verified(&analysis.phone).unwrap_or_default().into(),
        ),
        (
            "job_title".into(),
            verified(&analysis.role).unwrap_or_default().into(),
        ),
    ]))
}

fn endpoint(config: &FrappeConfig) -> Result<Url> {
    let mut url = validated_base_url(&config.base_url)?;
    let base = url.path().trim_end_matches('/');
    url.set_path(&format!(
        "{base}/api/method/shared_crm.api.sync_lotlift_cold_call"
    ));
    Ok(url)
}

fn authorization(config: &FrappeConfig, secret: &str) -> String {
    match config.auth_method {
        FrappeAuthMethod::Token => format!("token {secret}"),
        FrappeAuthMethod::Bearer => format!("Bearer {secret}"),
    }
}

async fn send_entry(entry: &FrappeOutboxEntry, secret: &str) -> Result<String> {
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .context("create Frappe client")?;
    let response = client
        .post(endpoint(&entry.config)?)
        .header("Authorization", authorization(&entry.config, secret))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("Idempotency-Key", &entry.idempotency_key)
        .json(&serde_json::json!({ "payload": entry.payload }))
        .send()
        .await
        .context("Frappe cold-call sync request")?;
    if response.status() == StatusCode::UNAUTHORIZED || response.status() == StatusCode::FORBIDDEN {
        return Err(anyhow!("Frappe authentication rejected"));
    }
    if !response.status().is_success() {
        return Err(anyhow!(
            "Frappe cold-call sync returned HTTP {}",
            response.status()
        ));
    }
    response
        .json::<serde_json::Value>()
        .await
        .context("parse Frappe cold-call sync response")?
        .get("message")
        .and_then(|message| message.get("lead_name"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .filter(|name| valid_identifier(name, 140))
        .ok_or_else(|| anyhow!("Frappe cold-call sync response lacks lead name"))
}

fn retry_delay(attempts: u8) -> u64 {
    2_u64
        .saturating_pow(u32::from(attempts.saturating_sub(1)))
        .min(300)
}

fn secret_for(reference: &str) -> Result<String> {
    KeyringEntry::new(SECRET_SERVICE, reference)
        .context("open Frappe credential")?
        .get_password()
        .context("read Frappe credential")
}

#[tauri::command]
pub fn save_lotlift_frappe_credential(reference: String, secret: String) -> Result<(), String> {
    if !valid_identifier(&reference, 80) || secret.trim().is_empty() || secret.len() > 2_000 {
        return Err("invalid Frappe credential".into());
    }
    KeyringEntry::new(SECRET_SERVICE, &reference)
        .and_then(|entry| entry.set_password(&secret))
        .map_err(|_| "could not store Frappe credential in the OS keychain".to_string())
}

#[tauri::command]
pub fn enqueue_lotlift_frappe_sync(
    app: AppHandle,
    call_id: String,
    config: FrappeConfig,
    event_type: Option<String>,
) -> Result<FrappeOutboxEntry, String> {
    validate_config(&config).map_err(|error| error.to_string())?;
    let final_path =
        final_analysis::analysis_path(&app, &call_id).map_err(|error| error.to_string())?;
    if event_type.is_some() {
        return Err("Frappe sync accepts final cold-call analysis only".into());
    }
    let analysis = final_analysis::load_at(&final_path)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Final Call Analysis must be saved before CRM sync".to_string())?;
    let saved_call_id = analysis.call_id.clone();
    let revision = analysis.revision;
    let event_type = "cold_call";
    let payload = map_analysis(&config, &analysis).map_err(|error| error.to_string())?;
    let entry = FrappeOutboxEntry {
        idempotency_key: format!("{}:{}:final_analysis", saved_call_id, revision),
        call_id: saved_call_id.clone(),
        revision,
        event_type: event_type.into(),
        state: OutboxState::Pending,
        attempts: 0,
        next_attempt_at: now_secs(),
        config,
        scheduled_action: None,
        payload,
        remote_name: None,
        last_error: None,
    };
    let _lock = OUTBOX_LOCK
        .lock()
        .map_err(|_| "Frappe outbox lock poisoned".to_string())?;
    let path = outbox_path(&app).map_err(|error| error.to_string())?;
    let mut outbox = load_outbox(&path).map_err(|error| error.to_string())?;
    for older in &mut outbox.entries {
        if older.call_id == entry.call_id
            && older.revision < entry.revision
            && older.state != OutboxState::Delivered
        {
            older.state = OutboxState::DeadLetter;
            if let Some(action) = &mut older.scheduled_action {
                action.state = OutboxState::DeadLetter;
            }
            older.last_error = Some("superseded by newer conversation revision".into());
        }
    }
    if !outbox
        .entries
        .iter()
        .any(|item| item.idempotency_key == entry.idempotency_key)
    {
        outbox.entries.push(entry.clone());
        save_outbox(&path, &outbox).map_err(|error| error.to_string())?;
    }
    Ok(entry)
}

#[tauri::command]
pub async fn deliver_lotlift_frappe_outbox(
    app: AppHandle,
) -> Result<Vec<FrappeOutboxEntry>, String> {
    let path = outbox_path(&app).map_err(|error| error.to_string())?;
    let candidates = {
        let _lock = OUTBOX_LOCK
            .lock()
            .map_err(|_| "Frappe outbox lock poisoned".to_string())?;
        let mut outbox = load_outbox(&path).map_err(|error| error.to_string())?;
        let now = now_secs();
        // A process may have died after the durable `sending` transition. Replaying is safe because
        // the same event key is retained and the lead is looked up before any create/update.
        for entry in &mut outbox.entries {
            if entry.state == OutboxState::Sending {
                entry.state = OutboxState::Retry;
                entry.next_attempt_at = now;
            }
        }
        let pending = outbox
            .entries
            .iter_mut()
            .filter(|entry| {
                matches!(entry.state, OutboxState::Pending | OutboxState::Retry)
                    && entry.next_attempt_at <= now
            })
            .map(|entry| {
                entry.state = OutboxState::Sending;
                entry.clone()
            })
            .collect::<Vec<_>>();
        save_outbox(&path, &outbox).map_err(|error| error.to_string())?;
        pending
    };
    for candidate in candidates {
        let outcome = match secret_for(&candidate.config.credential_reference) {
            Ok(secret) => send_entry(&candidate, &secret).await,
            Err(error) => Err(error),
        };
        let _lock = OUTBOX_LOCK
            .lock()
            .map_err(|_| "Frappe outbox lock poisoned".to_string())?;
        let mut outbox = load_outbox(&path).map_err(|error| error.to_string())?;
        let newer_exists = outbox.entries.iter().any(|entry| {
            entry.call_id == candidate.call_id
                && entry.revision > candidate.revision
                && entry.state != OutboxState::DeadLetter
        });
        if let Some(entry) = outbox
            .entries
            .iter_mut()
            .find(|entry| entry.idempotency_key == candidate.idempotency_key)
        {
            if newer_exists {
                entry.state = OutboxState::DeadLetter;
                entry.last_error = Some("superseded by newer analysis revision".into());
            } else {
                match outcome {
                    Ok(name) => {
                        entry.state = OutboxState::Delivered;
                        entry.remote_name = Some(name);
                        entry.last_error = None;
                    }
                    Err(error) => {
                        entry.attempts = entry.attempts.saturating_add(1);
                        entry.last_error = Some(error.to_string().chars().take(160).collect());
                        if entry.attempts >= MAX_ATTEMPTS
                            || entry.last_error.as_deref() == Some("Frappe authentication rejected")
                        {
                            entry.state = OutboxState::DeadLetter;
                        } else {
                            entry.state = OutboxState::Retry;
                            entry.next_attempt_at =
                                now_secs().saturating_add(retry_delay(entry.attempts));
                        }
                    }
                }
            }
        }
        save_outbox(&path, &outbox).map_err(|error| error.to_string())?;
    }
    load_outbox(&path)
        .map(|outbox| outbox.entries)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex as StdMutex};

    use axum::{
        extract::State,
        http::StatusCode as AxumStatus,
        response::{IntoResponse, Response},
        routing::post,
        Json, Router,
    };

    use super::*;

    #[derive(Clone)]
    struct FakeFrappe {
        status: AxumStatus,
        delay: bool,
        writes: Arc<StdMutex<u8>>,
        payload: Arc<StdMutex<Option<serde_json::Value>>>,
    }

    async fn sync(State(fake): State<FakeFrappe>, Json(body): Json<serde_json::Value>) -> Response {
        if fake.delay {
            tokio::time::sleep(Duration::from_secs(6)).await;
        }
        if fake.status != AxumStatus::OK {
            return fake.status.into_response();
        }
        *fake.writes.lock().unwrap() += 1;
        *fake.payload.lock().unwrap() = Some(body);
        Json(serde_json::json!({
            "message": {
                "lead_name": "CRM-LEAD-1",
                "task_name": "1",
                "action_state": "follow_up_queued"
            }
        }))
        .into_response()
    }

    async fn fake(status: AxumStatus, delay: bool) -> (String, FakeFrappe) {
        let state = FakeFrappe {
            status,
            delay,
            writes: Arc::new(StdMutex::new(0)),
            payload: Arc::new(StdMutex::new(None)),
        };
        let app = Router::new()
            .route(
                "/api/method/shared_crm.api.sync_lotlift_cold_call",
                post(sync),
            )
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}"), state)
    }

    fn entry(base_url: String) -> FrappeOutboxEntry {
        FrappeOutboxEntry {
            idempotency_key: "call-1:1:final_analysis".into(),
            call_id: "call-1".into(),
            revision: 1,
            event_type: "cold_call".into(),
            state: OutboxState::Pending,
            attempts: 0,
            next_attempt_at: 0,
            config: FrappeConfig {
                base_url,
                auth_method: FrappeAuthMethod::Token,
                credential_reference: "test".into(),
            },
            payload: BTreeMap::from([
                ("idempotency_key".into(), "call-1:1:final_analysis".into()),
                ("outcome".into(), "qualified".into()),
                ("first_name".into(), "Fictional".into()),
                ("email".into(), "fictional@example.com".into()),
                ("summary".into(), "Fictional summary".into()),
                ("organization".into(), "Fictional Motors".into()),
                ("mobile_no".into(), "+15550100".into()),
                ("job_title".into(), "Tester".into()),
            ]),
            scheduled_action: None,
            remote_name: None,
            last_error: None,
        }
    }

    #[tokio::test]
    async fn fake_frappe_uses_the_explicit_idempotent_cold_call_method() {
        let (base, fake) = fake(AxumStatus::OK, false).await;
        let item = entry(base);
        assert_eq!(send_entry(&item, "key:secret").await.unwrap(), "CRM-LEAD-1");
        assert_eq!(send_entry(&item, "key:secret").await.unwrap(), "CRM-LEAD-1");
        assert_eq!(*fake.writes.lock().unwrap(), 2);
        let body = fake.payload.lock().unwrap().clone().unwrap();
        assert_eq!(
            body["payload"]["idempotency_key"],
            serde_json::json!("call-1:1:final_analysis")
        );
        assert_eq!(body["payload"]["outcome"], serde_json::json!("qualified"));
    }

    #[tokio::test]
    async fn fake_frappe_rejects_auth_and_retries_server_errors_and_timeouts() {
        let (auth, _) = fake(AxumStatus::UNAUTHORIZED, false).await;
        assert_eq!(
            send_entry(&entry(auth), "key:secret")
                .await
                .unwrap_err()
                .to_string(),
            "Frappe authentication rejected"
        );
        let (failure, _) = fake(AxumStatus::INTERNAL_SERVER_ERROR, false).await;
        assert!(send_entry(&entry(failure), "key:secret")
            .await
            .unwrap_err()
            .to_string()
            .contains("HTTP 500"));
        let (slow, _) = fake(AxumStatus::OK, true).await;
        assert!(send_entry(&entry(slow), "key:secret").await.is_err());
    }

    #[test]
    fn accepts_loopback_http_urls_and_rejects_every_other_http_host() {
        for url in [
            "http://localhost:8000",
            "http://crm.localhost:8000",
            "http://127.0.0.2:8000",
            "http://[::1]:8000",
        ] {
            assert!(validated_base_url(url).is_ok(), "{url}");
        }
        for url in [
            "http://example.com",
            "http://example.localhost.evil",
            "http://0.0.0.0:8000",
            "http://10.0.0.1:8000",
            "http://192.168.1.1:8000",
            "http://[fd00::1]:8000",
        ] {
            assert!(validated_base_url(url).is_err(), "{url}");
        }
    }
}
