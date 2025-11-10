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

## API Reference

### POST /api/clips

Upload and process video clips with optional animation data. This endpoint accepts either multipart form data (for file uploads) or JSON (for URL-based processing).

#### Request Formats

**Option 1: Multipart Form Upload**

Use `multipart/form-data` to upload files directly:

```bash
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
  -F 'video=@/absolute/path/to/source.mp4;type=video/mp4' \
  -F 'animation=@/absolute/path/to/source.bin;type=application/octet-stream'
```

**Option 2: JSON with Remote URLs**

Use `application/json` to process videos from URLs:

```bash
curl -X POST http://localhost:3000/api/clips \
  -H "Content-Type: application/json" \
  -d '{
    "origin_id": "demo-video",
    "origin_url": "https://example.com/source.mp4",
    "anim_url": "https://example.com/source.bin",
    "fps": 30,
    "clips": [
      {
        "start_frame": 0,
        "end_frame": 90,
        "description": "Opening title card"
      }
    ]
  }'
```

#### Request Parameters

##### Form Fields (Multipart)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payload` | JSON string | Yes | Clip metadata (see Payload Schema below) |
| `video` | File | Yes* | Video file to process (required when not using `origin_url`) |
| `animation` | File | No | Optional animation binary file (.bin) |

##### Payload Schema

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `origin_id` | string | Yes | - | Unique identifier for the source video. Re-uploading with the same `origin_id` will **replace all existing clips** for that ID |
| `fps` | integer | No | 30 | Frame rate of the source video (1-240) |
| `clips` | array | Yes | - | Array of clip definitions (1-100 clips per request) |
| `origin_url` | URL | No | - | Remote video URL (required when not uploading a file) |
| `anim_url` | URL | No | - | Remote animation URL (alternative to uploading animation file) |

##### Clip Object

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `start_frame` | integer | Yes | ≥ 0 | Starting frame number (inclusive) |
| `end_frame` | integer | Yes | > `start_frame` | Ending frame number (exclusive) |
| `description` | string | Yes | 1-1024 chars | Text description used for semantic search and embeddings |

#### Response

**Success (200 OK)**

```json
{
  "clips": [
    {
      "id": 42,
      "origin_id": "demo-video",
      "start_frame": 0,
      "end_frame": 90,
      "description": "Opening title card",
      "video_url": "https://bucket.oss-region.aliyuncs.com/clips/demo-video/uuid.mp4",
      "animation_url": "https://bucket.oss-region.aliyuncs.com/animations/demo-video/uuid.bin",
      "embedding": [0.123, -0.456, ...],
      "created_at": "2025-11-10T12:34:56.789Z",
      "updated_at": "2025-11-10T12:34:56.789Z"
    }
  ]
}
```

**Error Responses**

| Status | Description |
|--------|-------------|
| 400 | Invalid request format, missing required fields, or validation errors |
| 500 | Server error during clip processing or database operations |
| 502 | Failed to download or process source video/animation |

#### Processing Behavior

1. **Automatic Embeddings**: Descriptions are automatically converted to vector embeddings for semantic search
2. **Parallel Processing**: Multiple clips from the same source are processed concurrently
3. **Animation Trimming**: Animation binaries are automatically sliced to match clip frame ranges
4. **Origin ID Replacement**: Uploading clips with an existing `origin_id` deletes all previous clips and files for that ID
5. **Atomic Rollback**: If any clip fails to process, all uploaded files are automatically cleaned up

#### Examples

**Minimal Example (No Animation)**

```bash
curl -X POST http://localhost:3000/api/clips \
  -F 'payload={"origin_id":"simple-001","fps":24,"clips":[{"start_frame":0,"end_frame":120,"description":"Intro scene"}]};type=application/json' \
  -F 'video=@video.mp4'
```

**Using Remote URLs**

```bash
curl -X POST http://localhost:3000/api/clips \
  -H "Content-Type: application/json" \
  -d '{
    "origin_id": "remote-video",
    "origin_url": "https://example.com/video.mp4",
    "anim_url": "https://example.com/animation.bin",
    "fps": 60,
    "clips": [{"start_frame": 0, "end_frame": 1800, "description": "Full clip"}]
  }'
```

**Mixed Animation Sources**

You can upload a video file while referencing a remote animation:

```bash
curl -X POST http://localhost:3000/api/clips \
  -F 'payload={"origin_id":"mixed","anim_url":"https://example.com/anim.bin","fps":30,"clips":[{"start_frame":0,"end_frame":60,"description":"Opening"}]};type=application/json' \
  -F 'video=@local-video.mp4'
```

### GET /api/clips

Retrieve all uploaded clips with pagination.

#### Query Parameters

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | integer | 10 | 100 | Number of clips to return |
| `offset` | integer | 0 | - | Number of clips to skip |

#### Response

```json
{
  "clips": [ /* array of clip objects */ ],
  "pagination": {
    "total": 156,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

#### Example

```bash
curl "http://localhost:3000/api/clips?limit=20&offset=40"
```
