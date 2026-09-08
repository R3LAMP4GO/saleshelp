//! Shared MLX-Audio wire constants used by the production adapter and dev benchmark.

use serde_json::json;

pub const URL: &str = "ws://127.0.0.1:18080/v1/audio/transcriptions/realtime";
pub const DEFAULT_MODEL: &str = "mlx-community/parakeet-tdt-0.6b-v2";
pub const SAMPLE_RATE: u32 = 16_000;

/// Production MLX-Audio setup frame. Keep this byte-for-byte protocol shape shared.
pub fn setup_frame(model: &str) -> String {
    json!({
        "model": model,
        "language": "en",
        "sample_rate": SAMPLE_RATE,
        "streaming": false,
    })
    .to_string()
}
