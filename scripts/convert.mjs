// In-browser media conversion: images -> WebP (canvas), audio -> Ogg/Opus, video -> WebM (WebCodecs via mediabunny).
// mediabunny (~700 KB) is loaded lazily, only when something is actually converted.
let _mb;
const mb = () => (_mb ??= import("../vendor/mediabunny.min.mjs"));

const extOf = name => (String(name).split(".").pop() ?? "").toLowerCase();
const stem = name => String(name).replace(/\.[^.]+$/, "");

export const KINDS = {
  image: new Set(["png", "jpg", "jpeg", "bmp", "avif", "webp", "tif", "tiff"]),   // gif/svg left alone (animation / vector)
  audio: new Set(["mp3", "wav", "flac", "m4a", "aac"]),                           // ogg is already the target
  video: new Set(["mp4", "m4v", "mov", "mkv"])                                    // webm is already the target
};

export function kindOf(name) {
  const e = extOf(name);
  return Object.keys(KINDS).find(k => KINDS[k].has(e)) ?? null;
}


async function runConversion(MB, file, format, options, onProgress) {
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  const target = new MB.BufferTarget();
  const output = new MB.Output({ format, target });
  const conv = await MB.Conversion.init({ input, output, ...options });
  if (!conv.isValid) throw new Error(`Unsupported media (${conv.discardedTracks.map(d => d.reason).join(", ") || "no usable track"})`);
  conv.onProgress = p => onProgress?.(p);
  await conv.execute();
  return target.buffer;
}

async function isAnimatedPng(file) {
  const head = new Uint8Array(await file.slice(0, 16384).arrayBuffer());
  const needle = [0x61, 0x63, 0x54, 0x4c]; // "acTL" chunk = APNG
  for (let i = 0; i < head.length - 4; i++) if (needle.every((b, k) => head[i + k] === b)) return true;
  return false;
}

export async function convertImage(file, { quality = 0.75, maxDim = 8192 } = {}) {
  const ext = extOf(file.name);
  if (ext === "png" && await isAnimatedPng(file)) return null;          // canvas would keep only the first frame
  const bmp = await createImageBitmap(file);
  try {
    const scale = maxDim ? Math.min(1, maxDim / Math.max(bmp.width, bmp.height)) : 1;
    if (ext === "webp" && scale === 1) return null;                      // already WebP and not too big
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality });
    if (blob.type !== "image/webp") return null;                         // browser cannot encode WebP
    return { blob, name: `${stem(file.name)}.webp`, scaled: scale < 1 };
  } finally { bmp.close?.(); }
}

export async function convertAudio(file, { bitrate = 128 } = {}, onProgress) {
  const MB = await mb();
  if (!(await MB.canEncodeAudio("opus"))) throw new Error("This browser cannot encode Opus audio");
  const buf = await runConversion(MB, file, new MB.OggOutputFormat(), {
    video: { discard: true }, audio: { codec: "opus", bitrate: bitrate * 1000 }
  }, onProgress);
  return { blob: new Blob([buf], { type: "audio/ogg" }), name: `${stem(file.name)}.ogg` };
}

export async function convertVideo(file, { maxHeight = 1080, quality = "medium" } = {}, onProgress) {
  const MB = await mb();
  const QUALITY = { low: MB.QUALITY_LOW, medium: MB.QUALITY_MEDIUM, high: MB.QUALITY_HIGH };
  const codec = (await MB.canEncodeVideo("vp9")) ? "vp9" : (await MB.canEncodeVideo("vp8")) ? "vp8" : null;
  if (!codec) throw new Error("This browser cannot encode WebM video");
  const probe = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  const vt = await probe.getPrimaryVideoTrack();
  const video = { codec, quality: QUALITY[quality] ?? MB.QUALITY_MEDIUM };
  if (maxHeight && vt && vt.displayHeight > maxHeight) video.height = maxHeight;
  const buf = await runConversion(MB, file, new MB.WebMOutputFormat(), { video, audio: { codec: "opus", bitrate: 128000 } }, onProgress);
  return { blob: new Blob([buf], { type: "video/webm" }), name: `${stem(file.name)}.webm` };
}

/**
 * Optimize one File according to cfg. Resolves to {file, before, after, kind} or null when the file should stay as is.
 * cfg: { image:{on,quality,maxDim}, audio:{on,bitrate}, video:{on,maxHeight,quality}, minSize, keepIfLarger }
 */
export async function optimize(file, cfg, onProgress) {
  const kind = kindOf(file.name);
  if (!kind || !cfg[kind]?.on) return null;
  if (file.size < (cfg.minSize ?? 0)) return null;
  let out;
  if (kind === "image") out = await convertImage(file, cfg.image);
  else if (kind === "audio") out = await convertAudio(file, cfg.audio, onProgress);
  else out = await convertVideo(file, cfg.video, onProgress);
  if (!out) return null;
  if (cfg.keepIfLarger && !out.scaled && out.blob.size >= file.size) return null;   // a downscaled image is kept even if not smaller
  return { file: new File([out.blob], out.name, { type: out.blob.type }), before: file.size, after: out.blob.size, kind };
}
