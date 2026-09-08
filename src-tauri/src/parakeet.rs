//! Loopback-only Local Parakeet operational probes. No audio is sent by these commands.
use serde::Serialize;
use std::{
    net::{SocketAddr, TcpStream},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

const LOOPBACK: &str = "127.0.0.1:18080";
// simplification: one app-owned local service; a future supervisor can preserve it across app restarts.
static PARAKEET_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ParakeetStatus {
    NotInstalled,
    Stopped,
    Ready,
    Starting,
}

#[derive(Serialize)]
pub struct ParakeetHealth {
    pub status: ParakeetStatus,
    pub endpoint: String,
    pub model: String,
    pub version: Option<String>,
    pub detail: String,
}

fn app_managed_server_running() -> bool {
    PARAKEET_PROCESS
        .lock()
        .ok()
        .and_then(|mut process| {
            process
                .as_mut()
                .and_then(|child| child.try_wait().ok())
                .map(|exit| exit.is_none())
        })
        .unwrap_or(false)
}

#[tauri::command]
pub fn local_parakeet_health() -> ParakeetHealth {
    let ready = LOOPBACK
        .parse::<SocketAddr>()
        .ok()
        .and_then(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(250)).ok())
        .is_some();
    let version = Command::new("mlx_audio.server")
        .arg("--help")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|_| "installed".to_owned());
    let status = if ready {
        ParakeetStatus::Ready
    } else if app_managed_server_running() {
        ParakeetStatus::Starting
    } else if version.is_some() {
        ParakeetStatus::Stopped
    } else {
        ParakeetStatus::NotInstalled
    };
    let detail = match &status {
        ParakeetStatus::Ready => "Local Parakeet is ready on loopback.",
        ParakeetStatus::Starting => "Starting app-managed MLX-Audio on loopback.",
        ParakeetStatus::Stopped => "MLX-Audio is installed but stopped. Start it from this setting; Parley will only connect to 127.0.0.1.",
        ParakeetStatus::NotInstalled => "MLX-Audio is not installed. Install the supported local service, then start it on 127.0.0.1:18080.",
    }.into();
    ParakeetHealth {
        status,
        endpoint: LOOPBACK.into(),
        model: "mlx-community/parakeet-tdt-0.6b-v2".into(),
        version,
        detail,
    }
}

#[tauri::command]
pub fn start_local_parakeet() -> Result<ParakeetHealth, String> {
    if matches!(
        local_parakeet_health().status,
        ParakeetStatus::Ready | ParakeetStatus::Starting
    ) {
        return Ok(local_parakeet_health());
    }
    let mut process = PARAKEET_PROCESS
        .lock()
        .map_err(|_| "Parakeet process lock poisoned")?;
    if process
        .as_mut()
        .and_then(|child| child.try_wait().ok())
        .is_some_and(|exit| exit.is_none())
    {
        drop(process);
        return Ok(local_parakeet_health());
    }
    *process = Some(
        Command::new("mlx_audio.server")
            .args(["--host", "127.0.0.1", "--port", "18080"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Could not start MLX-Audio. Install it first, then retry.")?,
    );
    drop(process);
    Ok(local_parakeet_health())
}

#[tauri::command]
pub fn stop_local_parakeet() -> Result<ParakeetHealth, String> {
    let mut process = PARAKEET_PROCESS
        .lock()
        .map_err(|_| "Parakeet process lock poisoned")?;
    let Some(mut child) = process.take() else {
        return Err("This app did not start the local Parakeet service.".into());
    };
    let _ = child.kill();
    let _ = child.wait();
    drop(process);
    Ok(local_parakeet_health())
}
