//! Durable, local-only LotLift Call State snapshots.

use std::{fs, io::Write, sync::Mutex};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const SCHEMA_VERSION: u16 = 7;

fn default_phase() -> String {
    "GATEKEEPER".into()
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub segment_id: String,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FactStatus {
    Verified,
    Inferred,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FieldValue {
    pub value: Option<String>,
    pub status: FactStatus,
    pub evidence: Option<Evidence>,
}

impl FieldValue {
    fn unknown() -> Self {
        Self {
            value: None,
            status: FactStatus::Unknown,
            evidence: None,
        }
    }

    fn unknown_from(value: String) -> Self {
        Self {
            value: Some(value),
            status: FactStatus::Unknown,
            evidence: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RecurringObjection {
    pub value: Option<String>,
    pub status: FactStatus,
    pub evidence: Option<Evidence>,
    pub count: u32,
    pub resolved: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CallState {
    pub schema_version: u16,
    pub call_id: String,
    pub revision: u64,
    #[serde(default = "default_phase")]
    pub phase: String,
    pub dealership: FieldValue,
    pub contact_name: FieldValue,
    pub role: FieldValue,
    pub phone: FieldValue,
    pub email: FieldValue,
    pub lead_sources: Vec<FieldValue>,
    pub current_solution: FieldValue,
    pub lead_arrival_point: FieldValue,
    pub workflow_owner: FieldValue,
    pub after_hours_process: FieldValue,
    pub visibility_process: FieldValue,
    pub pain_points: Vec<FieldValue>,
    pub quantified_pain: Vec<FieldValue>,
    pub authority: FieldValue,
    pub stakeholders: Vec<FieldValue>,
    pub urgency: FieldValue,
    pub renewal_date: FieldValue,
    pub recurring_objections: Vec<RecurringObjection>,
    #[serde(default = "FieldValue::unknown")]
    pub stated_readiness: FieldValue,
    #[serde(default)]
    pub decision_blockers: Vec<FieldValue>,
    #[serde(default)]
    pub decision_stakeholders: Vec<FieldValue>,
    pub prior_answers: Vec<FieldValue>,
    pub buying_signals: Vec<FieldValue>,
    pub commitments: Vec<FieldValue>,
    pub open_questions: Vec<FieldValue>,
    pub close_opportunity: FieldValue,
    pub fit_status: FieldValue,
    pub disqualification_reason: FieldValue,
    pub do_not_contact: bool,
    pub dnc_at: Option<String>,
    pub dnc_evidence: Option<Evidence>,
    pub next_action: FieldValue,
    pub next_action_at: FieldValue,
    #[serde(default = "FieldValue::unknown")]
    pub selected_objection_route: FieldValue,
    #[serde(default)]
    pub last_discovery_dimension: Option<String>,
    #[serde(default)]
    pub last_move_id: Option<String>,
    #[serde(default)]
    pub substantive_refusal_count: u8,
    #[serde(default)]
    pub pending_answer: Option<PendingAnswer>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PendingAnswer {
    pub rep_segment_id: String,
    pub profile_id: String,
    pub profile_snapshot_version: String,
    pub move_id: String,
    pub kind: String,
    pub target_field: String,
    pub created_revision: u64,
}

pub(crate) fn valid_call_id(call_id: &str) -> bool {
    !call_id.is_empty()
        && call_id.len() <= 64
        && call_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub(crate) fn state_path(app: &AppHandle, call_id: &str) -> Result<std::path::PathBuf> {
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

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RecurringObjectionV2 {
    kind: String,
    count: u32,
    resolved: bool,
    evidence: Vec<Evidence>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CallStateV2 {
    #[serde(rename = "schema_version")]
    _schema_version: u16,
    call_id: String,
    revision: u64,
    do_not_contact: bool,
    dnc_at: Option<String>,
    dnc_evidence: Option<Evidence>,
    current_solution: Option<String>,
    quantified_pain: Vec<String>,
    authority: Option<String>,
    urgency: Option<String>,
    recurring_objections: Vec<RecurringObjectionV2>,
    prior_answers: Vec<String>,
    commitments: Vec<String>,
    open_questions: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CallStateV1 {
    #[serde(rename = "schema_version")]
    _schema_version: u16,
    call_id: String,
    revision: u64,
    current_solution: Option<String>,
    quantified_pain: Vec<String>,
    authority: Option<String>,
    urgency: Option<String>,
    recurring_objections: Vec<RecurringObjectionV2>,
    prior_answers: Vec<String>,
    commitments: Vec<String>,
    open_questions: Vec<String>,
}

fn unknown_or_value(value: Option<String>) -> FieldValue {
    value
        .map(FieldValue::unknown_from)
        .unwrap_or_else(FieldValue::unknown)
}

fn unknown_list(values: Vec<String>) -> Vec<FieldValue> {
    values.into_iter().map(FieldValue::unknown_from).collect()
}

fn migrate_v2(state: CallStateV2) -> CallState {
    CallState {
        schema_version: SCHEMA_VERSION,
        call_id: state.call_id,
        revision: state.revision,
        phase: default_phase(),
        dealership: FieldValue::unknown(),
        contact_name: FieldValue::unknown(),
        role: FieldValue::unknown(),
        phone: FieldValue::unknown(),
        email: FieldValue::unknown(),
        lead_sources: vec![],
        current_solution: unknown_or_value(state.current_solution),
        lead_arrival_point: FieldValue::unknown(),
        workflow_owner: FieldValue::unknown(),
        after_hours_process: FieldValue::unknown(),
        visibility_process: FieldValue::unknown(),
        pain_points: vec![],
        quantified_pain: unknown_list(state.quantified_pain),
        authority: unknown_or_value(state.authority),
        stakeholders: vec![],
        urgency: unknown_or_value(state.urgency),
        renewal_date: FieldValue::unknown(),
        recurring_objections: state
            .recurring_objections
            .into_iter()
            .map(|objection| RecurringObjection {
                value: Some(objection.kind),
                status: FactStatus::Unknown,
                evidence: objection.evidence.last().cloned(),
                count: objection.count,
                resolved: objection.resolved,
            })
            .collect(),
        stated_readiness: FieldValue::unknown(),
        decision_blockers: vec![],
        decision_stakeholders: vec![],
        prior_answers: unknown_list(state.prior_answers),
        buying_signals: vec![],
        commitments: unknown_list(state.commitments),
        open_questions: unknown_list(state.open_questions),
        close_opportunity: FieldValue::unknown(),
        fit_status: FieldValue::unknown(),
        disqualification_reason: FieldValue::unknown(),
        do_not_contact: state.do_not_contact,
        dnc_at: state.dnc_at,
        dnc_evidence: state.dnc_evidence,
        next_action: FieldValue::unknown(),
        next_action_at: FieldValue::unknown(),
        selected_objection_route: FieldValue::unknown(),
        last_discovery_dimension: None,
        last_move_id: None,
        substantive_refusal_count: 0,
        pending_answer: None,
    }
}

fn migrate_call_state(value: serde_json::Value) -> Result<CallState> {
    match value
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
    {
        Some(1) => {
            let state: CallStateV1 =
                serde_json::from_value(value).context("parse Call State v1")?;
            Ok(migrate_v2(CallStateV2 {
                _schema_version: 2,
                call_id: state.call_id,
                revision: state.revision,
                do_not_contact: false,
                dnc_at: None,
                dnc_evidence: None,
                current_solution: state.current_solution,
                quantified_pain: state.quantified_pain,
                authority: state.authority,
                urgency: state.urgency,
                recurring_objections: state.recurring_objections,
                prior_answers: state.prior_answers,
                commitments: state.commitments,
                open_questions: state.open_questions,
            }))
        }
        Some(2) => {
            let state: CallStateV2 =
                serde_json::from_value(value).context("parse Call State v2")?;
            Ok(migrate_v2(state))
        }
        Some(3..=6) => {
            let mut state: CallState =
                serde_json::from_value(value).context("parse legacy Call State")?;
            state.schema_version = SCHEMA_VERSION;
            Ok(state)
        }
        Some(version) if version == u64::from(SCHEMA_VERSION) => {
            serde_json::from_value(value).context("parse Call State")
        }
        _ => Err(anyhow!("unsupported Call State schema version")),
    }
}

pub(crate) fn load_at(path: &std::path::Path) -> Result<Option<CallState>> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).context("read Call State")?;
    let value = serde_json::from_slice(&bytes).context("parse Call State")?;
    Ok(Some(migrate_call_state(value)?))
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

pub(crate) fn valid_fact(fact: &FieldValue) -> bool {
    match fact.status {
        // Legacy migrations preserve an unproven value as unknown without inventing transcript evidence.
        FactStatus::Unknown => fact.evidence.is_none(),
        FactStatus::Verified | FactStatus::Inferred => {
            fact.value.is_some() && fact.evidence.is_some()
        }
    }
}

pub(crate) fn valid_state_evidence(state: &CallState) -> bool {
    let scalar_facts = [
        &state.dealership,
        &state.contact_name,
        &state.role,
        &state.phone,
        &state.email,
        &state.current_solution,
        &state.lead_arrival_point,
        &state.workflow_owner,
        &state.after_hours_process,
        &state.visibility_process,
        &state.authority,
        &state.urgency,
        &state.renewal_date,
        &state.stated_readiness,
        &state.close_opportunity,
        &state.fit_status,
        &state.disqualification_reason,
        &state.next_action,
        &state.next_action_at,
    ];
    scalar_facts.into_iter().all(valid_fact)
        && [
            &state.lead_sources,
            &state.pain_points,
            &state.quantified_pain,
            &state.stakeholders,
            &state.decision_blockers,
            &state.decision_stakeholders,
            &state.prior_answers,
            &state.buying_signals,
            &state.commitments,
            &state.open_questions,
        ]
        .into_iter()
        .flatten()
        .all(valid_fact)
        && state.recurring_objections.iter().all(|objection| {
            valid_fact(&FieldValue {
                value: objection.value.clone(),
                status: objection.status.clone(),
                evidence: objection.evidence.clone(),
            })
        })
}

pub(crate) fn save_at(path: &std::path::Path, state: &CallState) -> Result<()> {
    if state.schema_version != SCHEMA_VERSION {
        return Err(anyhow!("unsupported Call State schema version"));
    }
    if state.do_not_contact != (state.dnc_at.is_some() && state.dnc_evidence.is_some()) {
        return Err(anyhow!(
            "DNC state must include both timestamp and evidence"
        ));
    }
    if !valid_state_evidence(state) {
        return Err(anyhow!(
            "captured fields must have matching status, value, and evidence"
        ));
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
        if previous.do_not_contact
            && (!state.do_not_contact
                || state.dnc_at != previous.dnc_at
                || state.dnc_evidence != previous.dnc_evidence)
        {
            return Err(anyhow!("DNC suppression cannot be cleared or changed"));
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
            phase: default_phase(),
            dealership: FieldValue::unknown(),
            contact_name: FieldValue::unknown(),
            role: FieldValue::unknown(),
            phone: FieldValue::unknown(),
            email: FieldValue::unknown(),
            lead_sources: vec![],
            current_solution: FieldValue::unknown(),
            lead_arrival_point: FieldValue::unknown(),
            workflow_owner: FieldValue::unknown(),
            after_hours_process: FieldValue::unknown(),
            visibility_process: FieldValue::unknown(),
            pain_points: vec![],
            quantified_pain: vec![],
            authority: FieldValue::unknown(),
            stakeholders: vec![],
            urgency: FieldValue::unknown(),
            renewal_date: FieldValue::unknown(),
            recurring_objections: vec![],
            stated_readiness: FieldValue::unknown(),
            decision_blockers: vec![],
            decision_stakeholders: vec![],
            prior_answers: vec![],
            buying_signals: vec![],
            commitments: vec![],
            open_questions: vec![],
            close_opportunity: FieldValue::unknown(),
            fit_status: FieldValue::unknown(),
            disqualification_reason: FieldValue::unknown(),
            do_not_contact: false,
            dnc_at: None,
            dnc_evidence: None,
            next_action: FieldValue::unknown(),
            next_action_at: FieldValue::unknown(),
            selected_objection_route: FieldValue::unknown(),
            last_discovery_dimension: None,
            last_move_id: None,
            substantive_refusal_count: 0,
            pending_answer: None,
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
    fn migrates_v1_and_v2_state_to_evidence_aware_v3() {
        for (version, payload) in [
            (
                1,
                r#"{"schema_version":1,"call_id":"call-a","revision":1,"current_solution":"VinSolutions","quantified_pain":["Leads wait"],"authority":"GM","urgency":null,"recurring_objections":[],"prior_answers":[],"commitments":[],"open_questions":[]}"#,
            ),
            (
                2,
                r#"{"schema_version":2,"call_id":"call-a","revision":1,"do_not_contact":false,"dnc_at":null,"dnc_evidence":null,"current_solution":"VinSolutions","quantified_pain":["Leads wait"],"authority":"GM","urgency":null,"recurring_objections":[],"prior_answers":[],"commitments":[],"open_questions":[]}"#,
            ),
        ] {
            let path = temporary_path();
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, payload).unwrap();
            let migrated = load_at(&path).unwrap().unwrap();
            assert_eq!(migrated.schema_version, SCHEMA_VERSION, "v{version}");
            assert_eq!(
                migrated.current_solution.value.as_deref(),
                Some("VinSolutions")
            );
            assert_eq!(migrated.current_solution.status, FactStatus::Unknown);
            assert!(migrated.current_solution.evidence.is_none());
            save_at(
                &path,
                &CallState {
                    revision: migrated.revision + 1,
                    ..migrated
                },
            )
            .unwrap();
            assert_eq!(
                load_at(&path).unwrap().unwrap().schema_version,
                SCHEMA_VERSION
            );
            fs::remove_dir_all(path.parent().unwrap()).unwrap();
        }
    }
    #[test]
    fn migrates_v3_state_without_decision_context_to_v4() {
        let mut legacy = serde_json::to_value(state(1)).unwrap();
        let object = legacy.as_object_mut().unwrap();
        object.insert("schema_version".into(), serde_json::json!(3));
        object.remove("stated_readiness");
        object.remove("decision_blockers");
        object.remove("decision_stakeholders");

        let migrated = migrate_call_state(legacy).unwrap();
        assert_eq!(migrated.schema_version, SCHEMA_VERSION);
        assert_eq!(migrated.stated_readiness.status, FactStatus::Unknown);
        assert!(migrated.decision_blockers.is_empty());
        assert!(migrated.decision_stakeholders.is_empty());
    }

    #[test]
    fn rejects_clearing_dnc_suppression() {
        let path = temporary_path();
        let mut suppressed = state(1);
        suppressed.do_not_contact = true;
        suppressed.dnc_at = Some("2026-09-07T12:00:00.000Z".into());
        suppressed.dnc_evidence = Some(Evidence {
            segment_id: "dnc-1".into(),
            text: "Don't call again.".into(),
        });
        save_at(&path, &suppressed).unwrap();
        assert!(save_at(&path, &state(2))
            .unwrap_err()
            .to_string()
            .contains("DNC suppression cannot be cleared"));
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn rejects_claimed_verified_facts_without_evidence() {
        let path = temporary_path();
        let mut invalid = state(1);
        invalid.dealership = FieldValue {
            value: Some("Acme Motors".into()),
            status: FactStatus::Verified,
            evidence: None,
        };
        assert!(save_at(&path, &invalid)
            .unwrap_err()
            .to_string()
            .contains("captured fields"));
    }
}
