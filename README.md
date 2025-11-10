## Setup

```bash
npm install

# Copy environment template and configure
cp .env.example .env
# Edit .env with your database credentials and API keys

npm run dev
```

```
open http://localhost:3000
```

## GPU Acceleration

This application supports NVIDIA GPU acceleration for video encoding operations. See [NVIDIA GPU Acceleration Documentation](docs/NVIDIA_GPU_ACCELERATION.md) for:
- Prerequisites and installation
- Configuration options
- Performance optimization
- Troubleshooting

Quick setup:
```bash
# Enable GPU acceleration in .env
FFMPEG_GPU_ACCELERATION=true
FFMPEG_GPU_ENCODER=h264_nvenc
```

Visiting `/` now serves the harness defined in `public/index.html`, making it
easy to test uploads without reaching for `curl`.

### Browser Harness Tips

- The form supports any number of clips—use **Add Another Clip** to append
  ranges and remove blocks you no longer need. Each block enforces numeric
  validation before submission.
- The payload preview under **Response** shows the raw JSON returned by the
  API so you can quickly verify the stored URLs.
- Upload a local file *or* paste a Video URL; the harness automatically sets
  `origin_url` when no file is present. Swap the default FPS/origin ID fields
  to match your source material before POSTing to `/api/clips`.
- Attach an optional **Animation File (.bin)** to send a companion rig/pose
  binary. When present, each clip stores a trimmed `animation_url` that shares
  the same asset ID as the clip video for easy correlation.
- Prefer the **Animation URL** field when the `.bin` already lives elsewhere;
  the backend downloads it automatically whenever no animation file is sent.

## POST /api/clips example

Use `multipart/form-data` to upload the source video directly. Send the clip
metadata as JSON in a `payload` field and attach the file with the `video`
field. Frame numbers still describe the start/end of the clip ranges.

```
curl -X POST http://localhost:3000/api/clips \
  -F 'payload={
    "origin_id": "demo-video",
    "fps": 30,
    "clips": [
      {
        "start_frame": 0,
        "end_frame": 90,
        "description": "Opening title card"
      },
      {
        "start_frame": 300,
        "end_frame": 450,
        "description": "Product hero moment"
      }
    ]
  };type=application/json' \
-F 'video=@/absolute/path/to/source.mp4;type=video/mp4'
-F 'animation=@/absolute/path/to/source.bin;type=application/octet-stream'
```

If the animation lives behind a URL instead, skip the `animation` form field
and include `"anim_url": "https://example.com/source.bin"` inside the JSON
payload. The server responds with `{ "clips": [...] }` where each entry contains
the persisted metadata, the clip `url`, and (when applicable) an
`animation_url` referencing the trimmed binary.
When hosting both assets remotely, provide both `origin_url` and `anim_url`
inside the payload to let the ingest workflow download and trim them on demand.
