# LotLift Parakeet dual-session benchmark

This opt-in benchmark measures whether one already-running MLX-Audio server can
handle two independent 16 kHz PCM WebSocket sessions: `me` and `them`.

It never starts, installs, configures, or stops MLX-Audio. It only connects to
`127.0.0.1:18080`; if that TCP probe fails, it prints `server_unavailable` and
creates no report.

## Run the 10-minute acceptance benchmark

Start MLX-Audio yourself, then run:

```sh
cargo run --manifest-path src-tauri/Cargo.toml --bin lotlift_parakeet_bench -- --minutes 10
```

The committed fixtures live in `src-tauri/fixtures/lotlift-parakeet/`. Their
manifest records the source text, normalized expected text, duration, checksum,
and generation provenance. The benchmark validates all of that before opening a
WebSocket; it never generates audio at runtime.

## Results

Each run writes bounded JSON and CSV under
`tmp/lotlift-parakeet-bench/<timestamp>/`. Only the newest five runs remain.
Reports contain transcripts and timing, never PCM audio.

The report includes per-turn connection, first-message, `done`, final-message,
and completion timestamps; normalized per-source matches; opposite-session
phrase detection; p50/p95 first and final latency; server RSS/CPU; benchmark
client CPU; and `gpu_status: "unavailable"`.

On macOS, server sampling runs only when the listener's command identifies as
`mlx_audio`; otherwise no arbitrary listener is sampled. CPU is sampled once per
second. GPU has no local sampler, so it is intentionally reported unavailable.

## Acceptance interpretation

After a live run, confirm each fixture phrase appears only on its own session,
no text arrives before that session sends `done`, and the report has p50/p95
first/final latency, match rate, RSS, CPU, and GPU status.

Parakeet's non-streaming mode is **not viable for interrupting live coaching**
when no result arrives before `done`. It may still support post-utterance
coaching if its measured final p95 fits the product response budget; this
benchmark does not choose that budget.

## Automated coverage

The benchmark binary's fake-server tests validate fixture manifests, PCM
framing, normalization, latency aggregation, crossed transcripts, two setup
frames, and two concurrent one-second sessions without contacting port 18080:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --bin lotlift_parakeet_bench
```
