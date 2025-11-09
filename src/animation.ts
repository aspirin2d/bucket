export interface Vector3 {
  x: number;
  y: number;
  z: number;
}
export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}
export interface AnimationFrame {
  frameId: number;
  trans: Vector3[];
  rots: Quaternion[];
}
export interface Animation {
  frames: AnimationFrame[];
}

type BinaryLike = ArrayBuffer | Uint8Array; // Node Buffer is a Uint8Array

export function parseAnimationBin(input: BinaryLike): Animation {
  const u8 =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input as ArrayBuffer);

  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 0;
  const le = true; // format is little-endian

  const ensure = (n: number) => {
    if (off + n > view.byteLength) {
      throw new Error(`Unexpected EOF at ${off}, need ${n} more bytes`);
    }
  };
  const i32 = () => {
    ensure(4);
    const v = view.getInt32(off, le);
    off += 4;
    return v;
  };
  const f32 = () => {
    ensure(4);
    const v = view.getFloat32(off, le);
    off += 4;
    return v;
  };

  const totalFrames = i32();
  const frames: AnimationFrame[] = [];

  for (let t = 0; t < totalFrames; t++) {
    const frameId = i32();
    const Jt = i32();
    const Jr = i32();

    const trans: Vector3[] = new Array(Jt);
    for (let j = 0; j < Jt; j++) {
      trans[j] = { x: f32(), y: f32(), z: f32() };
    }

    const rots: Quaternion[] = new Array(Jr);
    for (let j = 0; j < Jr; j++) {
      rots[j] = { x: f32(), y: f32(), z: f32(), w: f32() };
    }

    frames.push({ frameId, trans, rots });
  }

  return { frames };
}

// Example (Node):
// import { promises as fs } from 'fs';
// const buf = await fs.readFile('input.bin');
// const anim = parseAnimationBin(buf);

// --- Encoding and edit operations matching the C++ implementation ---

/**
 * Compute required byte size for encoding the animation in the C++ layout.
 * Layout (little-endian):
 * int32 totalFrames;
 * for each frame:
 *   int32 frameId; int32 Jt; int32 Jr;
 *   Jt * 3 * float32; Jr * 4 * float32;
 */
export function calcEncodedSize(anim: Animation): number {
  let size = 4; // totalFrames
  for (const f of anim.frames) {
    size += 4 * 3; // frameId, Jt, Jr
    size += f.trans.length * 3 * 4;
    size += f.rots.length * 4 * 4;
  }
  return size;
}

/**
 * Encode an Animation to a binary buffer compatible with the C++ writer.
 * Note: frameId is rewritten to sequential indices (0..n-1) like the C++ Serialize() writer.
 */
export function encodeAnimationBin(anim: Animation): Uint8Array {
  const bytes = calcEncodedSize(anim);
  const u8 = new Uint8Array(bytes);
  const view = new DataView(u8.buffer);
  let off = 0;
  const le = true;

  const ensure = (n: number) => {
    if (off + n > view.byteLength)
      throw new Error("Buffer overflow while encoding");
  };
  const wI32 = (v: number) => {
    ensure(4);
    view.setInt32(off, v | 0, le);
    off += 4;
  };
  const wF32 = (v: number) => {
    ensure(4);
    view.setFloat32(off, v, le);
    off += 4;
  };

  wI32(anim.frames.length);
  for (let t = 0; t < anim.frames.length; t++) {
    const f = anim.frames[t];
    const Jt = f.trans.length;
    const Jr = f.rots.length;
    // C++ writer uses t for frameId when serializing back out
    wI32(t);
    wI32(Jt);
    wI32(Jr);
    for (let j = 0; j < Jt; j++) {
      const v = f.trans[j];
      wF32(v.x);
      wF32(v.y);
      wF32(v.z);
    }
    for (let j = 0; j < Jr; j++) {
      const q = f.rots[j];
      wF32(q.x);
      wF32(q.y);
      wF32(q.z);
      wF32(q.w);
    }
  }

  return u8;
}

/**
 * Slice (split) an animation binary keeping frames in inclusive range [start, end],
 * matching the C++ `Slice` behavior (end is clamped to the last frame, and start <= end required).
 * Returns new encoded Uint8Array.
 */
export function sliceAnimationBin(
  input: BinaryLike,
  start: number,
  end: number,
): Uint8Array {
  const anim = parseAnimationBin(input);
  const n = anim.frames.length;
  if (n === 0) return encodeAnimationBin(anim);
  if (start >= n || start > end) {
    throw new Error(
      `Invalid slice range: start=${start}, end=${end}, totalFrames=${n}`,
    );
  }
  const last = Math.min(end, n - 1);
  const frames = anim.frames.slice(start, last + 1);
  return encodeAnimationBin({ frames });
}

/**
 * Merge (concatenate) multiple animation binaries in order, matching C++ `operator+=` logic.
 * Returns a new encoded Uint8Array.
 */
export function mergeAnimationBins(inputs: BinaryLike[]): Uint8Array {
  const allFrames: AnimationFrame[] = [];
  for (const bin of inputs) {
    const { frames } = parseAnimationBin(bin);
    allFrames.push(...frames);
  }
  return encodeAnimationBin({ frames: allFrames });
}

// Example Node usage:
// import { promises as fs } from 'fs';
// const a = await fs.readFile('anim1.bin');
// const b = await fs.readFile('anim2.bin');
// const merged = mergeAnimationBins([a, b]);
// await fs.writeFile('combined.bin', merged);
// const sliced = sliceAnimationBin(a, 10, 50);
// await fs.writeFile('clip.bin', sliced);
