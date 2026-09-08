# Agent guide

See `CLAUDE.md` for project behavior details.

- Install: `bun install --frozen-lockfile`
- Build: `bun run build`
- Test: `bun run test`
- Rust check: `cargo check --manifest-path src-tauri/Cargo.toml`
- Lint: no dedicated lint script is configured.
- Open the app: always run `bun run tauri dev`; never open the Vite site directly.

CI lives in `.github/workflows/ci.yml` and must stay green. Never commit with `--no-verify`.
