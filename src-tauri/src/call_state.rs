//! Durable, local-only LotLift Call State snapshots.

use std::{fs, io::Write};

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
        && call_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn state_path(app: &AppHandle, call_id: &str) -> Result<std::path::PathBuf> {
    if !valid_call_id(call_id) {
        return Err(anyhow!("invalid call id"));
    }
    let root = app.path().app_data_dir().context("resolve app-data directory")?;
    Ok(root.join("lotlift").join("calls").join(call_id).join("state.json"))
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
pub fn load_lotlift_call_state(app: AppHandle, call_id: String) -> Result<Option<CallState>, String> {
    load_at(&state_path(&app, &call_id).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_lotlift_call_state(app: AppHandle, state: CallState) -> Result<(), String> {
    if state.schema_version != SCHEMA_VERSION {
        return Err("unsupported Call State schema version".into());
    }
    let path = state_path(&app, &state.call_id).map_err(|error| error.to_string())?;
    let directory = path.parent().ok_or("missing Call State directory")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;

    if let Some(previous) = load_at(&path).map_err(|error| error.to_string())? {
        if state.revision != previous.revision.saturating_add(1) {
            return Err("Call State revision conflict; reload before saving".into());
        }
    } else if state.revision != 1 {
        return Err("first Call State revision must be 1".into());
    }

    let bytes = serde_json::to_vec_pretty(&state).map_err(|error| error.to_string())?;
    let temporary = directory.join(format!(".state-{}.tmp", state.revision));
    {
        let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
    if let Ok(directory_file) = fs::File::open(directory) {
        let _ = directory_file.sync_all();
    }
    Ok(())
}
