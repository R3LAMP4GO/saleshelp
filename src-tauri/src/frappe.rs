//! Explicit, durable, local-first Frappe CRM delivery.
//!
//! The outbox contains no credential. A caller must durably enqueue after final
//! analysis has committed; delivery is separately triggered and never touches live calls.

use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, Context, Result};
use keyring::Entry as KeyringEntry;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    call_state::{self, CallState, FactStatus},
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
    pub lead_doctype: String,
    pub identity_field: String,
    pub identity_source: String,
    #[serde(default)]
    pub field_mapping: BTreeMap<String, String>,
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
    let local = matches!(
        url.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("::1")
    );
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
    if !valid_identifier(&config.credential_reference, 80)
        || !valid_identifier(&config.lead_doctype, 80)
        || !valid_identifier(&config.identity_field, 80)
        || !matches!(
            config.identity_source.as_str(),
            "phone" | "email" | "dealership" | "contact_name"
        )
        || config.field_mapping.len() > 32
        || config
            .field_mapping
            .iter()
            .any(|(source, target)| !valid_identifier(source, 80) || !valid_identifier(target, 80))
    {
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

fn field(config: &FrappeConfig, canonical: &str) -> String {
    config
        .field_mapping
        .get(canonical)
        .cloned()
        .unwrap_or_else(|| canonical.to_owned())
}

fn schedule_fields(
    config: &FrappeConfig,
    call_id: &str,
    revision: u64,
    dnc: bool,
    action: Option<String>,
) -> BTreeMap<String, serde_json::Value> {
    let text = action.unwrap_or_default().to_lowercase();
    let (kind, reason, source) = if dnc {
        ("none", "Do-not-contact suppression", "dnc")
    } else if text.contains("demo") || text.contains("meeting") {
        ("meeting", "Prospect booked a meeting", "explicit_prospect")
    } else if text.contains("not interested") {
        ("none", "Prospect is not interested", "explicit_prospect")
    } else if text.contains("send") || text.contains("information") {
        (
            "manual_review",
            "Information requested",
            "explicit_prospect",
        )
    } else {
        (
            "manual_review",
            "No answer or no explicit next step",
            "policy",
        )
    };
    BTreeMap::from([
        (field(config, "next_action_type"), kind.into()),
        (field(config, "next_action_reason"), reason.into()),
        (field(config, "next_action_source"), source.into()),
        (
            field(config, "lotlift_action_id"),
            format!("{call_id}:{revision}:{kind}").into(),
        ),
    ])
}

fn map_analysis(
    config: &FrappeConfig,
    analysis: &FinalCallAnalysis,
) -> Result<BTreeMap<String, serde_json::Value>> {
    validate_config(config)?;
    let mut body = BTreeMap::new();
    for (canonical, value) in [
        ("lead_name", verified(&analysis.dealership)),
        ("contact_name", verified(&analysis.contact_name)),
        ("phone", verified(&analysis.phone)),
        ("email", verified(&analysis.email)),
        ("role", verified(&analysis.role)),
        ("current_solution", verified(&analysis.current_solution)),
        ("call_outcome", verified(&analysis.call_outcome)),
        ("next_action", verified(&analysis.next_action)),
        ("next_action_at", verified(&analysis.next_action_at)),
        ("final_summary", verified(&analysis.summary)),
    ] {
        if let Some(value) = value {
            body.insert(field(config, canonical), value.into());
        }
    }
    let qualifications = [
        ("authority", verified(&analysis.authority)),
        ("urgency", verified(&analysis.urgency)),
        ("fit_status", verified(&analysis.fit_status)),
        ("close_opportunity", verified(&analysis.close_opportunity)),
        ("lead_arrival_point", verified(&analysis.lead_arrival_point)),
    ]
    .into_iter()
    .filter_map(|(name, value)| value.map(|value| format!("{name}: {value}")))
    .collect::<Vec<_>>();
    if !qualifications.is_empty() {
        body.insert(
            field(config, "qualification_facts"),
            qualifications.join("; ").into(),
        );
    }
    body.insert(
        field(config, "do_not_contact"),
        analysis.do_not_contact.into(),
    );
    body.extend(schedule_fields(
        config,
        &analysis.call_id,
        analysis.revision,
        analysis.do_not_contact,
        verified(&analysis.next_action),
    ));
    body.insert(
        field(config, "lotlift_call_id"),
        analysis.call_id.clone().into(),
    );
    Ok(body)
}

fn map_contact_state(
    config: &FrappeConfig,
    state: &CallState,
) -> Result<BTreeMap<String, serde_json::Value>> {
    validate_config(config)?;
    let mut body = BTreeMap::new();
    for (canonical, value) in [
        ("contact_name", verified(&state.contact_name)),
        ("phone", verified(&state.phone)),
        ("email", verified(&state.email)),
        ("role", verified(&state.role)),
        ("next_action", verified(&state.next_action)),
        ("next_action_at", verified(&state.next_action_at)),
    ] {
        if let Some(value) = value {
            body.insert(field(config, canonical), value.into());
        }
    }
    body.extend(schedule_fields(
        config,
        &state.call_id,
        state.revision,
        state.do_not_contact,
        verified(&state.next_action),
    ));
    body.insert(
        field(config, "lotlift_call_id"),
        state.call_id.clone().into(),
    );
    Ok(body)
}

fn endpoint(config: &FrappeConfig) -> Result<Url> {
    let mut url = validated_base_url(&config.base_url)?;
    let base = url.path().trim_end_matches('/');
    url.set_path(&format!(
        "{base}/api/resource/{}",
        config.lead_doctype.replace(' ', "%20")
    ));
    Ok(url)
}

fn identity_value(entry: &FrappeOutboxEntry) -> Result<String> {
    let canonical = entry.config.identity_source.as_str();
    let target = field(&entry.config, canonical);
    entry
        .payload
        .get(&target)
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("no verified Frappe identity field is available"))
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
    let mut lookup = endpoint(&entry.config)?;
    let filters =
        serde_json::json!([[entry.config.identity_field, "=", identity_value(entry)?]]).to_string();
    lookup
        .query_pairs_mut()
        .append_pair("fields", "[\"name\"]")
        .append_pair("filters", &filters)
        .append_pair("limit_page_length", "1");
    let auth = authorization(&entry.config, secret);
    let response = client
        .get(lookup)
        .header("Authorization", &auth)
        .header("Accept", "application/json")
        .send()
        .await
        .context("Frappe lookup request")?;
    if response.status() == StatusCode::UNAUTHORIZED || response.status() == StatusCode::FORBIDDEN {
        return Err(anyhow!("Frappe authentication rejected"));
    }
    if !response.status().is_success() {
        return Err(anyhow!("Frappe lookup returned HTTP {}", response.status()));
    }
    let existing = response
        .json::<serde_json::Value>()
        .await
        .context("parse Frappe lookup")?
        .get("data")
        .and_then(serde_json::Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("name"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let base = endpoint(&entry.config)?;
    let request = if let Some(name) = existing {
        if !valid_identifier(&name, 140) {
            return Err(anyhow!("Frappe returned an invalid document name"));
        }
        let mut update_url = base.clone();
        update_url.set_path(&format!("{}/{}", base.path(), name.replace(' ', "%20")));
        client.put(update_url)
    } else {
        client.post(base)
    };
    let response = request
        .header("Authorization", auth)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("Idempotency-Key", &entry.idempotency_key)
        .json(&entry.payload)
        .send()
        .await
        .context("Frappe write request")?;
    if response.status() == StatusCode::UNAUTHORIZED || response.status() == StatusCode::FORBIDDEN {
        return Err(anyhow!("Frappe authentication rejected"));
    }
    if !response.status().is_success() {
        return Err(anyhow!("Frappe write returned HTTP {}", response.status()));
    }
    response
        .json::<serde_json::Value>()
        .await
        .context("parse Frappe write")?
        .get("data")
        .and_then(|data| data.get("name"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("Frappe write response lacks document name"))
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
    let contact_update = event_type.as_deref() == Some("contact_update");
    if event_type.is_some() && !contact_update {
        return Err("invalid Frappe event type".into());
    }
    let contact = || {
        let state = call_state::load_at(
            &call_state::state_path(&app, &call_id).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Call State must be saved before CRM sync".to_string())?;
        Ok::<_, String>((
            state.call_id.clone(),
            state.revision,
            "contact_update",
            map_contact_state(&config, &state).map_err(|error| error.to_string())?,
        ))
    };
    let (saved_call_id, revision, event_type, payload) = if contact_update {
        contact()?
    } else {
        match final_analysis::load_at(&final_path).map_err(|error| error.to_string())? {
            Some(analysis) => {
                let event_type = if analysis.do_not_contact {
                    "dnc"
                } else {
                    "final_analysis"
                };
                (
                    analysis.call_id.clone(),
                    analysis.revision,
                    event_type,
                    map_analysis(&config, &analysis).map_err(|error| error.to_string())?,
                )
            }
            None => contact()?,
        }
    };
    let entry = FrappeOutboxEntry {
        idempotency_key: format!("{}:{}:{event_type}", saved_call_id, revision),
        call_id: saved_call_id.clone(),
        revision,
        event_type: event_type.into(),
        state: OutboxState::Pending,
        attempts: 0,
        next_attempt_at: now_secs(),
        config,
        scheduled_action: Some(ScheduledAction {
            id: format!("{}:{}:{}", saved_call_id, revision, event_type),
            action_type: event_type.into(),
            state: OutboxState::Pending,
            reason: "CRM action state; Frappe/n8n must execute only approved workflows".into(),
            source: "frappe_outbox".into(),
        }),
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
        routing::{get, put},
        Json, Router,
    };

    use super::*;

    #[derive(Clone)]
    struct FakeFrappe {
        lead: Arc<StdMutex<Option<String>>>,
        status: AxumStatus,
        delay: bool,
        writes: Arc<StdMutex<u8>>,
    }

    async fn list(State(fake): State<FakeFrappe>) -> Response {
        if fake.delay {
            tokio::time::sleep(Duration::from_secs(6)).await;
        }
        if fake.status != AxumStatus::OK {
            return fake.status.into_response();
        }
        let data = fake
            .lead
            .lock()
            .unwrap()
            .clone()
            .map(|name| vec![serde_json::json!({ "name": name })])
            .unwrap_or_default();
        Json(serde_json::json!({ "data": data })).into_response()
    }

    async fn create(State(fake): State<FakeFrappe>) -> Response {
        if fake.status != AxumStatus::OK {
            return fake.status.into_response();
        }
        *fake.lead.lock().unwrap() = Some("LEAD-1".into());
        *fake.writes.lock().unwrap() += 1;
        Json(serde_json::json!({ "data": { "name": "LEAD-1" } })).into_response()
    }

    async fn update(State(fake): State<FakeFrappe>) -> Response {
        if fake.status != AxumStatus::OK {
            return fake.status.into_response();
        }
        *fake.writes.lock().unwrap() += 1;
        Json(serde_json::json!({ "data": { "name": "LEAD-1" } })).into_response()
    }

    async fn fake(status: AxumStatus, existing: bool, delay: bool) -> (String, FakeFrappe) {
        let state = FakeFrappe {
            lead: Arc::new(StdMutex::new(existing.then(|| "LEAD-1".into()))),
            status,
            delay,
            writes: Arc::new(StdMutex::new(0)),
        };
        let app = Router::new()
            .route("/api/resource/Lead", get(list).post(create))
            .route("/api/resource/Lead/LEAD-1", put(update))
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
            event_type: "final_analysis".into(),
            state: OutboxState::Pending,
            attempts: 0,
            next_attempt_at: 0,
            config: FrappeConfig {
                base_url,
                auth_method: FrappeAuthMethod::Token,
                credential_reference: "test".into(),
                lead_doctype: "Lead".into(),
                identity_field: "mobile_no".into(),
                identity_source: "phone".into(),
                field_mapping: BTreeMap::from([("phone".into(), "mobile_no".into())]),
            },
            payload: BTreeMap::from([("mobile_no".into(), "+15551234567".into())]),
            scheduled_action: None,
            remote_name: None,
            last_error: None,
        }
    }

    #[tokio::test]
    async fn fake_frappe_creates_then_updates_the_same_lead_for_a_duplicate_event() {
        let (base, fake) = fake(AxumStatus::OK, false, false).await;
        let item = entry(base);
        assert_eq!(send_entry(&item, "key:secret").await.unwrap(), "LEAD-1");
        assert_eq!(send_entry(&item, "key:secret").await.unwrap(), "LEAD-1");
        assert_eq!(*fake.writes.lock().unwrap(), 2);
    }

    #[tokio::test]
    async fn fake_frappe_updates_an_existing_lead() {
        let (base, fake) = fake(AxumStatus::OK, true, false).await;
        assert_eq!(
            send_entry(&entry(base), "key:secret").await.unwrap(),
            "LEAD-1"
        );
        assert_eq!(*fake.writes.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn fake_frappe_rejects_auth_and_retries_server_errors_and_timeouts() {
        let (auth, _) = fake(AxumStatus::UNAUTHORIZED, false, false).await;
        assert_eq!(
            send_entry(&entry(auth), "key:secret")
                .await
                .unwrap_err()
                .to_string(),
            "Frappe authentication rejected"
        );
        let (failure, _) = fake(AxumStatus::INTERNAL_SERVER_ERROR, false, false).await;
        assert!(send_entry(&entry(failure), "key:secret")
            .await
            .unwrap_err()
            .to_string()
            .contains("HTTP 500"));
        let (slow, _) = fake(AxumStatus::OK, false, true).await;
        assert!(send_entry(&entry(slow), "key:secret").await.is_err());
    }
}
