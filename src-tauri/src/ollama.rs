use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
pub struct OllamaModels {
    pub installed: Vec<String>,
}
#[tauri::command]
pub fn local_ollama_models() -> OllamaModels {
    let output = Command::new("ollama").arg("list").output().ok();
    let installed = output
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| {
            s.lines()
                .skip(1)
                .filter_map(|line| line.split_whitespace().next().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    OllamaModels { installed }
}
