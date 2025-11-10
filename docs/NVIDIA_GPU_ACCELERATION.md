# NVIDIA GPU Acceleration for FFmpeg

This document explains how to enable and configure NVIDIA GPU acceleration for video encoding operations using FFmpeg with CUDA/NVENC.

## Overview

The application supports hardware-accelerated video encoding using NVIDIA GPUs through FFmpeg's NVENC (NVIDIA Encoder) and CUDA acceleration. This can significantly speed up video transcoding operations while reducing CPU load.

## Prerequisites

### Hardware Requirements
- NVIDIA GPU with Kepler architecture or newer (GTX 600 series and above)
- GPU must support NVENC (check [NVIDIA Video Encode and Decode GPU Support Matrix](https://developer.nvidia.com/video-encode-and-decode-gpu-support-matrix))

### Software Requirements
1. **NVIDIA Driver**: Install the latest NVIDIA drivers for your GPU
   ```bash
   # Check if NVIDIA driver is installed
   nvidia-smi
   ```

2. **FFmpeg with NVIDIA Support**: FFmpeg must be compiled with NVENC support
   ```bash
   # Check if FFmpeg has NVIDIA encoder support
   ffmpeg -encoders | grep nvenc

   # You should see output like:
   # V..... h264_nvenc           NVIDIA NVENC H.264 encoder
   # V..... hevc_nvenc           NVIDIA NVENC hevc encoder
   # V..... av1_nvenc            NVIDIA NVENC AV1 encoder
   ```

3. **CUDA Toolkit** (optional, but recommended): Install CUDA toolkit for optimal performance
   ```bash
   # Check CUDA installation
   nvcc --version
   ```

### Installing FFmpeg with NVIDIA Support

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install ffmpeg nvidia-cuda-toolkit
```

#### Using Static Builds
Download a pre-compiled FFmpeg build with NVIDIA support from:
- https://github.com/BtbN/FFmpeg-Builds/releases (recommended)
- https://www.gyan.dev/ffmpeg/builds/ (Windows)

## Configuration

### Environment Variables

Add the following variables to your `.env` file:

```bash
# Enable NVIDIA GPU acceleration
FFMPEG_GPU_ACCELERATION=true

# Encoder codec selection
# Options: h264_nvenc, hevc_nvenc, av1_nvenc
FFMPEG_GPU_ENCODER=h264_nvenc

# Encoding preset (speed vs quality tradeoff)
# Options: p1 (fastest) through p7 (slowest/best quality)
# Recommended: p4 for balanced performance
FFMPEG_GPU_PRESET=p4

# Target bitrate for encoded video
# Examples: 5M, 10M, 20M (higher = better quality, larger file)
FFMPEG_GPU_BITRATE=5M

# Spatial Adaptive Quantization (improves quality)
# Set to true for better quality at the same bitrate
FFMPEG_GPU_SPATIAL_AQ=true

# Temporal Adaptive Quantization (improves quality)
# Set to true for better quality in motion scenes
FFMPEG_GPU_TEMPORAL_AQ=true

# Rate Control Lookahead (frames to analyze ahead)
# Range: 0-32, recommended: 10-20
# Higher values improve quality but increase latency
FFMPEG_GPU_RC_LOOKAHEAD=20
```

### Configuration Options Explained

#### FFMPEG_GPU_ENCODER
Choose the encoder based on your needs:
- **h264_nvenc**: Best compatibility, widely supported, good for streaming
- **hevc_nvenc** (H.265): Better compression, smaller files, requires HEVC support
- **av1_nvenc**: Best compression, cutting-edge, limited device support

#### FFMPEG_GPU_PRESET
Encoding presets control speed vs quality:
- **p1**: Fastest encoding, lowest quality
- **p2-p3**: Fast encoding, good for real-time applications
- **p4**: Balanced (recommended for most use cases)
- **p5-p6**: Slower encoding, better quality
- **p7**: Slowest encoding, best quality

#### FFMPEG_GPU_BITRATE
Target bitrate affects quality and file size:
- **2M-5M**: Good for 720p content
- **5M-10M**: Good for 1080p content
- **10M-20M**: Good for 1440p content
- **20M+**: Good for 4K content

#### Adaptive Quantization
- **Spatial AQ**: Allocates more bits to complex areas of the frame
- **Temporal AQ**: Allocates more bits to fast-moving scenes
- Both improve quality with minimal performance impact

#### Rate Control Lookahead
Analyzes upcoming frames to optimize bit allocation:
- **0**: Disabled (fastest)
- **10-15**: Good balance
- **16-20**: Better quality (recommended)
- **21-32**: Best quality, higher latency

## Usage

### Default Behavior (Stream Copy)
By default, the `trimClip` function uses stream copy (`-c copy`), which:
- Does **not** re-encode the video
- Is extremely fast (no GPU needed)
- Preserves original quality
- Keeps original codec and format

```typescript
await trimClip({
  inputPath: "/path/to/input.mp4",
  outputPath: "/path/to/output.mp4",
  startSeconds: 0,
  endSeconds: 10,
  // transcode: false (default)
});
```

### GPU-Accelerated Transcoding
To enable GPU acceleration, set `transcode: true`:

```typescript
await trimClip({
  inputPath: "/path/to/input.mp4",
  outputPath: "/path/to/output.mp4",
  startSeconds: 0,
  endSeconds: 10,
  transcode: true, // Enables GPU acceleration (if configured)
});
```

When `transcode: true`:
- If `FFMPEG_GPU_ACCELERATION=true`: Uses NVIDIA GPU encoding
- If `FFMPEG_GPU_ACCELERATION=false`: Falls back to CPU encoding (libx264)

### When to Use Transcoding

Use `transcode: true` when you need to:
1. **Change codec**: Convert H.264 to HEVC, etc.
2. **Reduce file size**: Re-encode with lower bitrate
3. **Normalize quality**: Standardize bitrate across clips
4. **Fix compatibility**: Re-encode problematic videos
5. **Apply filters**: (requires additional code modifications)

Use `transcode: false` (default) when:
1. **Trimming only**: Just extracting segments without quality changes
2. **Speed is critical**: Need fastest possible processing
3. **Preserving quality**: Want bit-perfect copy of original

## Performance Considerations

### GPU vs CPU Encoding Speed
NVIDIA GPU encoding is typically **5-20x faster** than CPU encoding, depending on:
- GPU model (newer = faster)
- Video resolution (higher = more benefit)
- Preset used (faster presets = more benefit)
- System CPU (slower CPUs benefit more from GPU)

### Quality Comparison
- **Stream copy** (`-c copy`): Perfect quality, original bitrate
- **GPU encoding**: Very good quality, configurable bitrate
- **CPU encoding** (libx264): Slightly better quality than GPU at same bitrate, but much slower

### Memory Requirements
GPU acceleration keeps video frames in GPU memory:
- Reduces CPU-GPU data transfer
- Requires sufficient GPU VRAM
- Typically 2-4GB VRAM is adequate for 1080p

### Parallel Processing
For maximum throughput, the NVIDIA documentation recommends:
- Running multiple encode/decode sessions in parallel
- This amortizes initialization overhead
- Current implementation processes clips in parallel via `Promise.all()`

## Troubleshooting

### Error: "No NVENC capable devices found"
**Solution**: Your GPU doesn't support NVENC, or drivers are outdated
```bash
# Check GPU and driver
nvidia-smi

# Update drivers (Ubuntu)
sudo ubuntu-drivers autoinstall
```

### Error: "Unknown encoder 'h264_nvenc'"
**Solution**: FFmpeg wasn't compiled with NVENC support
```bash
# Verify FFmpeg has NVENC
ffmpeg -encoders | grep nvenc

# If empty, install FFmpeg build with NVIDIA support
```

### Error: "Cannot load nvcuda.dll" (Windows) or "cuda not found"
**Solution**: CUDA toolkit or drivers not installed properly
```bash
# Install CUDA toolkit
# https://developer.nvidia.com/cuda-downloads
```

### Poor Quality Output
**Solutions**:
1. Increase `FFMPEG_GPU_BITRATE` (e.g., from 5M to 10M)
2. Use slower preset (e.g., p6 or p7 instead of p4)
3. Enable both Adaptive Quantization options
4. Increase `FFMPEG_GPU_RC_LOOKAHEAD` to 20

### Slow Performance
**Solutions**:
1. Use faster preset (e.g., p2 or p3)
2. Reduce `FFMPEG_GPU_RC_LOOKAHEAD` to 10 or 0
3. Check GPU utilization with `nvidia-smi`
4. Ensure no other applications are using the GPU

## Verification

Test GPU acceleration is working:

```bash
# Monitor GPU usage while encoding
watch -n 1 nvidia-smi

# Look for:
# - Encoder utilization percentage
# - Memory usage
# - Process name (ffmpeg)
```

## References

- [NVIDIA FFmpeg Documentation](https://docs.nvidia.com/video-technologies/video-codec-sdk/12.0/ffmpeg-with-nvidia-gpu/index.html)
- [NVIDIA Video Codec SDK](https://developer.nvidia.com/nvidia-video-codec-sdk)
- [FFmpeg NVENC Guide](https://trac.ffmpeg.org/wiki/HWAccelIntro)
- [GPU Support Matrix](https://developer.nvidia.com/video-encode-and-decode-gpu-support-matrix)

## Example .env Configuration

```bash
# Optimal settings for 1080p content
FFMPEG_GPU_ACCELERATION=true
FFMPEG_GPU_ENCODER=h264_nvenc
FFMPEG_GPU_PRESET=p4
FFMPEG_GPU_BITRATE=8M
FFMPEG_GPU_SPATIAL_AQ=true
FFMPEG_GPU_TEMPORAL_AQ=true
FFMPEG_GPU_RC_LOOKAHEAD=20
```

```bash
# High-speed settings for real-time processing
FFMPEG_GPU_ACCELERATION=true
FFMPEG_GPU_ENCODER=h264_nvenc
FFMPEG_GPU_PRESET=p2
FFMPEG_GPU_BITRATE=5M
FFMPEG_GPU_SPATIAL_AQ=false
FFMPEG_GPU_TEMPORAL_AQ=false
FFMPEG_GPU_RC_LOOKAHEAD=0
```

```bash
# High-quality settings for archival
FFMPEG_GPU_ACCELERATION=true
FFMPEG_GPU_ENCODER=hevc_nvenc
FFMPEG_GPU_PRESET=p7
FFMPEG_GPU_BITRATE=15M
FFMPEG_GPU_SPATIAL_AQ=true
FFMPEG_GPU_TEMPORAL_AQ=true
FFMPEG_GPU_RC_LOOKAHEAD=20
```
