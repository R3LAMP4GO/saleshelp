//! Durable, local-only LotLift Call State snapshots.

use std::{fs, io::Write, sync::Mutex};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const SCHEMA_VERSION: u16 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub segment_id: String,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RecurringObjection {
    pub kind: String,
    pub count: u32,
    pub resolved: bool,
    pub evidence: Vec<Evidence>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CallState {
    pub schema_version: u16,
    pub call_id: String,
    pub revision: u64,
    pub current_solution: Option<String>,
    pub quantified_pain: Vec<String>,
    pub authority: Option<String>,
    pub urgency: Option<String>,
    pub recurring_objections: Vec<RecurringObjection>,
    pub prior_answers: Vec<String>,
    pub commitments: Vec<String>,
    pub open_questions: Vec<String>,
}

fn valid_call_id(call_id: &str) -> bool {
    !call_id.is_empty()
        && call_id.len() <= 64
        && call_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn state_path(app: &AppHandle, call_id: &str) -> Result<std::path::PathBuf> {
    if !valid_call_id(call_id) {
        return Err(anyhow!("invalid call id"));
    }
    let root = app
        .path()
        .app_data_dir()
        .context("resolve app-data directory")?;
    Ok(root
        .join("lotlift")
        .join("calls")
        .join(call_id)
        .join("state.json"))
}

fn load_at(path: &std::path::Path) -> Result<Option<CallState>> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).context("read Call State")?;
    let state = serde_json::from_slice(&bytes).context("parse Call State")?;
    Ok(Some(state))
}

#[tauri::command]
pub fn load_lotlift_call_state(
    app: AppHandle,
    call_id: String,
) -> Result<Option<CallState>, String> {
    load_at(&state_path(&app, &call_id).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

// simplification: serialize all local Call State writes; use per-call locks if concurrent calls are added.
static CALL_STATE_WRITE_LOCK: Mutex<()> = Mutex::new(());

fn save_at(path: &std::path::Path, state: &CallState) -> Result<()> {
    if state.schema_version != SCHEMA_VERSION {
        return Err(anyhow!("unsupported Call State schema version"));
    }
    let _lock = CALL_STATE_WRITE_LOCK
        .lock()
        .map_err(|_| anyhow!("Call State write lock poisoned"))?;
    let directory = path.parent().context("missing Call State directory")?;
    fs::create_dir_all(directory).context("create Call State directory")?;

    if let Some(previous) = load_at(path)? {
        if state.revision != previous.revision.saturating_add(1) {
            return Err(anyhow!(
                "Call State revision conflict; reload before saving"
            ));
        }
    } else if state.revision != 1 {
        return Err(anyhow!("first Call State revision must be 1"));
    }

    let bytes = serde_json::to_vec_pretty(state).context("serialize Call State")?;
    let temporary = directory.join(format!(".state-{}.tmp", state.revision));
    {
        let mut file = fs::File::create(&temporary).context("create temporary Call State")?;
        file.write_all(&bytes)
            .context("write temporary Call State")?;
        file.sync_all().context("sync temporary Call State")?;
    }
    fs::rename(&temporary, path).context("replace Call State atomically")?;
    if let Ok(directory_file) = fs::File::open(directory) {
        let _ = directory_file.sync_all();
    }
    Ok(())
}

#[tauri::command]
pub fn save_lotlift_call_state(app: AppHandle, state: CallState) -> Result<(), String> {
    let path = state_path(&app, &state.call_id).map_err(|error| error.to_string())?;
    save_at(&path, &state).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static NEXT_TEST_PATH: AtomicU64 = AtomicU64::new(0);
    fn state(revision: u64) -> CallState {
        CallState {
            schema_version: SCHEMA_VERSION,
            call_id: "call-a".into(),
            revision,
            current_solution: None,
            quantified_pain: vec![],
            authority: None,
            urgency: None,
            recurring_objections: vec![],
            prior_answers: vec![],
            commitments: vec![],
            open_questions: vec![],
        }
    }

    fn temporary_path() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = NEXT_TEST_PATH.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir()
            .join(format!(
                "lotlift-call-state-{}-{nonce}-{sequence}",
                std::process::id()
            ))
            .join("state.json")
    }

    #[test]
    fn reads_existing_v1_state() {
        let path = temporary_path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"schema_version":1,"call_id":"call-a","revision":1,"current_solution":null,"quantified_pain":[],"authority":null,"urgency":null,"recurring_objections":[],"prior_answers":[],"commitments":[],"open_questions":[]}"#).unwrap();
        assert_eq!(load_at(&path).unwrap().unwrap().revision, 1);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn rejects_duplicate_revisions_without_replacing_the_snapshot() {
        let path = temporary_path();
        save_at(&path, &state(1)).unwrap();
        assert!(save_at(&path, &state(1))
            .unwrap_err()
            .to_string()
            .contains("revision conflict"));
        assert_eq!(load_at(&path).unwrap().unwrap().revision, 1);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
