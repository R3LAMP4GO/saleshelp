# Local Parakeet v2 service

Installed locally at `~/.local/share/lotlift-parakeet`; it is intentionally outside the repository and uses no cloud STT key.

```bash
~/.local/share/lotlift-parakeet/bin/mlx_audio.server \
  --host 127.0.0.1 --port 18080
```

Parley’s **Local Parakeet v2** STT option connects only to `ws://127.0.0.1:18080/v1/audio/transcriptions/realtime`, uses `mlx-community/parakeet-tdt-0.6b-v2`, and sends 16 kHz PCM in VAD-safe 30 ms frames.

MLX-Audio also exposes `POST http://127.0.0.1:18080/v1/audio/transcriptions`, an OpenAI-compatible batch endpoint. It was verified with synthetic English speech on this Mac. Do not bind the service to a network interface: it processes call audio.

To recreate the environment:

```bash
uv venv ~/.local/share/lotlift-parakeet --python /opt/homebrew/opt/python@3.12/bin/python3.12
uv pip install --python ~/.local/share/lotlift-parakeet/bin/python 'mlx-audio[stt,server]==0.5.1' --strict
```
