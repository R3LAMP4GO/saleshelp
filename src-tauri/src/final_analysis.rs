//! Durable, local-only LotLift final-analysis snapshots.

use std::{fs, io::Write, sync::Mutex};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::call_state::{self, CallState, Evidence, FactStatus, FieldValue, RecurringObjection};

pub const SCHEMA_VERSION: u16 = 1;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisStatus {
    Complete,
    InsufficientEvidence,
    Dnc,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Contradiction {
    pub field: String,
    pub call_state: FieldValue,
    pub final_analysis: FieldValue,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FinalCallAnalysis {
    pub analysis_schema_version: u16,
    pub call_id: String,
    pub revision: u64,
    pub created_at: String,
    pub source_call_state_revision: u64,
    pub summary: FieldValue,
    pub call_outcome: FieldValue,
    pub recommended_follow_up: FieldValue,
    pub crm_note: FieldValue,
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
    pub contradictions: Vec<Contradiction>,
    pub analysis_status: AnalysisStatus,
    pub validation_failures: Vec<String>,
}

pub(crate) fn analysis_path(app: &AppHandle, call_id: &str) -> Result<std::path::PathBuf> {
    Ok(call_state::state_path(app, call_id)?.with_file_name("final-analysis.json"))
}

fn migrate_final_analysis(value: serde_json::Value) -> Result<FinalCallAnalysis> {
    match value
        .get("analysis_schema_version")
        .and_then(serde_json::Value::as_u64)
    {
        Some(version) if version == u64::from(SCHEMA_VERSION) => {
            serde_json::from_value(value).context("parse final analysis")
        }
        _ => Err(anyhow!("unsupported final analysis schema version")),
    }
}

pub(crate) fn load_at(path: &std::path::Path) -> Result<Option<FinalCallAnalysis>> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).context("read final analysis")?;
    let value = serde_json::from_slice(&bytes).context("parse final analysis")?;
    Ok(Some(migrate_final_analysis(value)?))
}

#[tauri::command]
pub fn load_lotlift_final_analysis(
    app: AppHandle,
    call_id: String,
) -> Result<Option<FinalCallAnalysis>, String> {
    load_at(&analysis_path(&app, &call_id).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

// simplification: serialize all local final-analysis writes; use per-call locks if concurrent calls are added.
static FINAL_ANALYSIS_WRITE_LOCK: Mutex<()> = Mutex::new(());

fn state_from_analysis(analysis: &FinalCallAnalysis) -> CallState {
    CallState {
        schema_version: call_state::SCHEMA_VERSION,
        call_id: analysis.call_id.clone(),
        revision: analysis.source_call_state_revision,
        phase: "GATEKEEPER".into(),
        dealership: analysis.dealership.clone(),
        contact_name: analysis.contact_name.clone(),
        role: analysis.role.clone(),
        phone: analysis.phone.clone(),
        email: analysis.email.clone(),
        lead_sources: analysis.lead_sources.clone(),
        current_solution: analysis.current_solution.clone(),
        lead_arrival_point: analysis.lead_arrival_point.clone(),
        workflow_owner: analysis.workflow_owner.clone(),
        after_hours_process: analysis.after_hours_process.clone(),
        visibility_process: analysis.visibility_process.clone(),
        pain_points: analysis.pain_points.clone(),
        quantified_pain: analysis.quantified_pain.clone(),
        authority: analysis.authority.clone(),
        stakeholders: analysis.stakeholders.clone(),
        urgency: analysis.urgency.clone(),
        renewal_date: analysis.renewal_date.clone(),
        recurring_objections: analysis.recurring_objections.clone(),
        stated_readiness: FieldValue {
            value: None,
            status: FactStatus::Unknown,
            evidence: None,
        },
        decision_blockers: vec![],
        decision_stakeholders: vec![],
        prior_answers: analysis.prior_answers.clone(),
        buying_signals: analysis.buying_signals.clone(),
        commitments: analysis.commitments.clone(),
        open_questions: analysis.open_questions.clone(),
        close_opportunity: analysis.close_opportunity.clone(),
        fit_status: analysis.fit_status.clone(),
        disqualification_reason: analysis.disqualification_reason.clone(),
        do_not_contact: analysis.do_not_contact,
        dnc_at: analysis.dnc_at.clone(),
        dnc_evidence: analysis.dnc_evidence.clone(),
        next_action: analysis.next_action.clone(),
        next_action_at: analysis.next_action_at.clone(),
        selected_objection_route: FieldValue {
            value: None,
            status: FactStatus::Unknown,
            evidence: None,
        },
        last_discovery_dimension: None,
        last_move_id: None,
        substantive_refusal_count: 0,
        pending_answer: None,
    }
}

const SCALAR_FIELDS: [&str; 18] = [
    "dealership",
    "contact_name",
    "role",
    "phone",
    "email",
    "current_solution",
    "lead_arrival_point",
    "workflow_owner",
    "after_hours_process",
    "visibility_process",
    "authority",
    "urgency",
    "renewal_date",
    "close_opportunity",
    "fit_status",
    "disqualification_reason",
    "next_action",
    "next_action_at",
];

fn preserves_verified_call_state(source: &CallState, analysis: &FinalCallAnalysis) -> bool {
    let result = state_from_analysis(analysis);
    [
        (&source.dealership, &result.dealership),
        (&source.contact_name, &result.contact_name),
        (&source.role, &result.role),
        (&source.phone, &result.phone),
        (&source.email, &result.email),
        (&source.current_solution, &result.current_solution),
        (&source.lead_arrival_point, &result.lead_arrival_point),
        (&source.workflow_owner, &result.workflow_owner),
        (&source.after_hours_process, &result.after_hours_process),
        (&source.visibility_process, &result.visibility_process),
        (&source.authority, &result.authority),
        (&source.urgency, &result.urgency),
        (&source.renewal_date, &result.renewal_date),
        (&source.close_opportunity, &result.close_opportunity),
        (&source.fit_status, &result.fit_status),
        (
            &source.disqualification_reason,
            &result.disqualification_reason,
        ),
        (&source.next_action, &result.next_action),
        (&source.next_action_at, &result.next_action_at),
    ]
    .into_iter()
    .all(|(saved, final_value)| saved.status != FactStatus::Verified || saved == final_value)
        && [
            (&source.lead_sources, &result.lead_sources),
            (&source.pain_points, &result.pain_points),
            (&source.quantified_pain, &result.quantified_pain),
            (&source.stakeholders, &result.stakeholders),
            (&source.prior_answers, &result.prior_answers),
            (&source.buying_signals, &result.buying_signals),
            (&source.commitments, &result.commitments),
            (&source.open_questions, &result.open_questions),
        ]
        .into_iter()
        .all(|(saved, final_values)| {
            saved
                .iter()
                .filter(|fact| fact.status == FactStatus::Verified)
                .all(|fact| final_values.contains(fact))
        })
        && source
            .recurring_objections
            .iter()
            .filter(|fact| fact.status == FactStatus::Verified)
            .all(|fact| result.recurring_objections.contains(fact))
}

fn valid_evidence(evidence: &Evidence) -> bool {
    !evidence.segment_id.is_empty()
        && evidence.segment_id.len() <= 80
        && !evidence.text.is_empty()
        && evidence.text.len() <= 300
}

fn valid_bounded_fact(fact: &FieldValue) -> bool {
    call_state::valid_fact(fact)
        && fact.value.as_deref().is_none_or(|value| value.len() <= 300)
        && fact.evidence.as_ref().is_none_or(valid_evidence)
}

fn valid_contradictions(source: &CallState, analysis: &FinalCallAnalysis) -> bool {
    analysis.contradictions.iter().all(|contradiction| {
        let source_value = match contradiction.field.as_str() {
            "dealership" => &source.dealership,
            "contact_name" => &source.contact_name,
            "role" => &source.role,
            "phone" => &source.phone,
            "email" => &source.email,
            "current_solution" => &source.current_solution,
            "lead_arrival_point" => &source.lead_arrival_point,
            "workflow_owner" => &source.workflow_owner,
            "after_hours_process" => &source.after_hours_process,
            "visibility_process" => &source.visibility_process,
            "authority" => &source.authority,
            "urgency" => &source.urgency,
            "renewal_date" => &source.renewal_date,
            "close_opportunity" => &source.close_opportunity,
            "fit_status" => &source.fit_status,
            "disqualification_reason" => &source.disqualification_reason,
            "next_action" => &source.next_action,
            "next_action_at" => &source.next_action_at,
            _ => return false,
        };
        source_value.status == FactStatus::Verified
            && contradiction.call_state == *source_value
            && contradiction.final_analysis.status == FactStatus::Verified
            && contradiction.call_state.value != contradiction.final_analysis.value
            && valid_bounded_fact(&contradiction.call_state)
            && valid_bounded_fact(&contradiction.final_analysis)
    })
}

fn valid_analysis(analysis: &FinalCallAnalysis) -> bool {
    let state = state_from_analysis(analysis);
    let reports = [
        &analysis.summary,
        &analysis.call_outcome,
        &analysis.recommended_follow_up,
        &analysis.crm_note,
    ];
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
        &state.close_opportunity,
        &state.fit_status,
        &state.disqualification_reason,
        &state.next_action,
        &state.next_action_at,
    ];
    call_state::valid_state_evidence(&state)
        && state.dnc_evidence.as_ref().is_none_or(valid_evidence)
        && analysis.created_at.len() <= 80
        && analysis.validation_failures.len() <= 100
        && analysis
            .validation_failures
            .iter()
            .all(|failure| !failure.is_empty() && failure.len() <= 300)
        && reports.into_iter().all(valid_bounded_fact)
        && scalar_facts.into_iter().all(valid_bounded_fact)
        && [
            &state.lead_sources,
            &state.pain_points,
            &state.quantified_pain,
            &state.stakeholders,
            &state.prior_answers,
            &state.buying_signals,
            &state.commitments,
            &state.open_questions,
        ]
        .into_iter()
        .all(|facts| facts.len() <= 12 && facts.iter().all(valid_bounded_fact))
        && state.recurring_objections.len() <= 12
        && state.recurring_objections.iter().all(|objection| {
            objection.count > 0
                && valid_bounded_fact(&FieldValue {
                    value: objection.value.clone(),
                    status: objection.status.clone(),
                    evidence: objection.evidence.clone(),
                })
        })
        && analysis.contradictions.len() <= SCALAR_FIELDS.len()
        && analysis
            .contradictions
            .iter()
            .all(|contradiction| SCALAR_FIELDS.contains(&contradiction.field.as_str()))
}

fn save_at(
    path: &std::path::Path,
    state_path: &std::path::Path,
    analysis: &FinalCallAnalysis,
) -> Result<()> {
    if analysis.analysis_schema_version != SCHEMA_VERSION {
        return Err(anyhow!("unsupported final analysis schema version"));
    }
    if !call_state::valid_call_id(&analysis.call_id) || analysis.created_at.is_empty() {
        return Err(anyhow!("invalid final analysis identity"));
    }
    if !valid_analysis(analysis) {
        return Err(anyhow!("final analysis has invalid evidence"));
    }
    let call_state = call_state::load_at(state_path)?
        .ok_or_else(|| anyhow!("Call State must exist before final analysis"))?;
    if analysis.call_id != call_state.call_id
        || analysis.source_call_state_revision != call_state.revision
        || analysis.do_not_contact != call_state.do_not_contact
        || analysis.dnc_at != call_state.dnc_at
        || analysis.dnc_evidence != call_state.dnc_evidence
        || (analysis.do_not_contact && analysis.analysis_status != AnalysisStatus::Dnc)
        || (!analysis.do_not_contact && analysis.analysis_status == AnalysisStatus::Dnc)
        || !preserves_verified_call_state(&call_state, analysis)
        || !valid_contradictions(&call_state, analysis)
    {
        return Err(anyhow!(
            "final analysis must preserve the saved Call State and DNC suppression"
        ));
    }
    let _lock = FINAL_ANALYSIS_WRITE_LOCK
        .lock()
        .map_err(|_| anyhow!("final analysis write lock poisoned"))?;
    let directory = path.parent().context("missing final analysis directory")?;
    fs::create_dir_all(directory).context("create final analysis directory")?;
    if let Some(previous) = load_at(path)? {
        if analysis.revision != previous.revision.saturating_add(1) {
            return Err(anyhow!(
                "final analysis revision conflict; reload before saving"
            ));
        }
        if previous.do_not_contact
            && (!analysis.do_not_contact
                || analysis.dnc_at != previous.dnc_at
                || analysis.dnc_evidence != previous.dnc_evidence)
        {
            return Err(anyhow!("DNC suppression cannot be cleared or changed"));
        }
    } else if analysis.revision != 1 {
        return Err(anyhow!("first final analysis revision must be 1"));
    }
    let bytes = serde_json::to_vec_pretty(analysis).context("serialize final analysis")?;
    let temporary = directory.join(format!(".final-analysis-{}.tmp", analysis.revision));
    {
        let mut file = fs::File::create(&temporary).context("create temporary final analysis")?;
        file.write_all(&bytes)
            .context("write temporary final analysis")?;
        file.sync_all().context("sync temporary final analysis")?;
    }
    fs::rename(&temporary, path).context("replace final analysis atomically")?;
    if let Ok(directory_file) = fs::File::open(directory) {
        let _ = directory_file.sync_all();
    }
    Ok(())
}

#[tauri::command]
pub fn save_lotlift_final_analysis(
    app: AppHandle,
    analysis: FinalCallAnalysis,
) -> Result<(), String> {
    let path = analysis_path(&app, &analysis.call_id).map_err(|error| error.to_string())?;
    let state_path =
        call_state::state_path(&app, &analysis.call_id).map_err(|error| error.to_string())?;
    save_at(&path, &state_path, &analysis).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::call_state::FactStatus;
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static NEXT_TEST_PATH: AtomicU64 = AtomicU64::new(0);

    fn unknown() -> FieldValue {
        FieldValue {
            value: None,
            status: FactStatus::Unknown,
            evidence: None,
        }
    }

    fn analysis(revision: u64) -> FinalCallAnalysis {
        FinalCallAnalysis {
            analysis_schema_version: SCHEMA_VERSION,
            call_id: "call-a".into(),
            revision,
            created_at: "2026-09-07T12:00:00.000Z".into(),
            source_call_state_revision: 1,
            summary: unknown(),
            call_outcome: unknown(),
            recommended_follow_up: unknown(),
            crm_note: unknown(),
            dealership: unknown(),
            contact_name: unknown(),
            role: unknown(),
            phone: unknown(),
            email: unknown(),
            lead_sources: vec![],
            current_solution: unknown(),
            lead_arrival_point: unknown(),
            workflow_owner: unknown(),
            after_hours_process: unknown(),
            visibility_process: unknown(),
            pain_points: vec![],
            quantified_pain: vec![],
            authority: unknown(),
            stakeholders: vec![],
            urgency: unknown(),
            renewal_date: unknown(),
            recurring_objections: vec![],
            prior_answers: vec![],
            buying_signals: vec![],
            commitments: vec![],
            open_questions: vec![],
            close_opportunity: unknown(),
            fit_status: unknown(),
            disqualification_reason: unknown(),
            do_not_contact: false,
            dnc_at: None,
            dnc_evidence: None,
            next_action: unknown(),
            next_action_at: unknown(),
            contradictions: vec![],
            analysis_status: AnalysisStatus::InsufficientEvidence,
            validation_failures: vec![],
        }
    }

    fn temporary_path() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = NEXT_TEST_PATH.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "lotlift-final-analysis-{}-{nonce}-{sequence}",
            std::process::id()
        ))
    }

    #[test]
    fn persists_and_loads_a_final_analysis_snapshot() {
        let root = temporary_path();
        let state_path = root.join("state.json");
        let analysis_path = root.join("final-analysis.json");
        let call_state = state_from_analysis(&analysis(1));
        crate::call_state::save_at(
            &state_path,
            &CallState {
                revision: 1,
                ..call_state
            },
        )
        .unwrap();
        save_at(&analysis_path, &state_path, &analysis(1)).unwrap();
        assert_eq!(load_at(&analysis_path).unwrap().unwrap().revision, 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_dnc_that_differs_from_saved_call_state() {
        let root = temporary_path();
        let state_path = root.join("state.json");
        let analysis_path = root.join("final-analysis.json");
        let call_state = state_from_analysis(&analysis(1));
        crate::call_state::save_at(
            &state_path,
            &CallState {
                revision: 1,
                ..call_state
            },
        )
        .unwrap();
        let mut changed = analysis(1);
        changed.do_not_contact = true;
        assert!(save_at(&analysis_path, &state_path, &changed)
            .unwrap_err()
            .to_string()
            .contains("preserve"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unknown_future_schema_versions() {
        let root = temporary_path();
        fs::create_dir_all(&root).unwrap();
        let path = root.join("final-analysis.json");
        fs::write(&path, r#"{"analysis_schema_version":2}"#).unwrap();
        assert!(load_at(&path)
            .unwrap_err()
            .to_string()
            .contains("unsupported"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_stale_final_analysis_revisions() {
        let root = temporary_path();
        let state_path = root.join("state.json");
        let analysis_path = root.join("final-analysis.json");
        let call_state = state_from_analysis(&analysis(1));
        crate::call_state::save_at(
            &state_path,
            &CallState {
                revision: 1,
                ..call_state
            },
        )
        .unwrap();
        save_at(&analysis_path, &state_path, &analysis(1)).unwrap();
        assert!(save_at(&analysis_path, &state_path, &analysis(1))
            .unwrap_err()
            .to_string()
            .contains("revision conflict"));
        fs::remove_dir_all(root).unwrap();
    }
}
