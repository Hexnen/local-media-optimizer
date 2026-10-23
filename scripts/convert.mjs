// In-browser media conversion: images -> WebP (canvas), audio -> Ogg/Opus, video -> WebM (WebCodecs via mediabunny).
// mediabunny (~700 KB) is loaded lazily, only when something is actually converted.
let _mb;
const mb = () => (_mb ??= import("../vendor/mediabunny.min.mjs").catch(e => { _mb = undefined; throw e; }));

const extOf = name => (String(name).split(".").pop() ?? "").toLowerCase();
export const stem = name => String(name).replace(/\.[^.]+$/, "");

export const KINDS = {
  image: new Set(["png", "jpg", "jpeg", "bmp", "avif", "webp"]),   // gif/svg left alone (animation / vector); TIFF cannot be decoded by Chromium
  audio: new Set(["mp3", "wav", "flac", "m4a", "aac"]),            // ogg is already the target
  video: new Set(["mp4", "m4v", "mov", "mkv"])                     // webm is already the target
};

/** Extension each kind is converted to. */
export const OUT_EXT = { image: "webp", audio: "ogg", video: "webm" };

export function kindOf(name) {
  const e = extOf(name);
  return Object.keys(KINDS).find(k => KINDS[k].has(e)) ?? null;
}

async function runConversion(MB, file, format, options, onProgress) {
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  try {
    const target = new MB.BufferTarget();
    const output = new MB.Output({ format, target });
    const conv = await MB.Conversion.init({ input, output, ...options });
    // A track we cannot decode is dropped by mediabunny while the conversion stays "valid" -> never accept lost audio/video.
    const lost = conv.discardedTracks.filter(d => d.reason !== "discarded_by_user" && (d.track.isVideoTrack?.() || d.track.isAudioTrack?.()));
    if (!conv.isValid || lost.length) {
      throw new Error(`Unsupported media (${lost.map(d => `${d.track.type}: ${d.reason}`).join(", ") || "no usable track"})`);
    }
    conv.onProgress = p => onProgress?.(p);
    await conv.execute();
    return target.buffer;
  } finally { input.dispose?.(); }
}

const bytes = async (file, from, to) => new Uint8Array(await file.slice(from, to).arrayBuffer());
const ascii = (u8, from, to) => String.fromCharCode(...u8.subarray(from, to));

/** Animated PNG (acTL before the first IDAT), animated WebP (VP8X animation flag), animated AVIF (avis brand). */
async function isAnimated(file, ext) {
  if (ext === "png") {
    let off = 8;
    for (let n = 0; n < 64 && off + 8 <= file.size; n++) {          // walk the chunk list until the image data starts
      const h = await bytes(file, off, off + 8);
      const len = new DataView(h.buffer).getUint32(0);
      const type = ascii(h, 4, 8);
      if (type === "acTL") return true;
      if (type === "IDAT" || type === "IEND") return false;
      off += 12 + len;
    }
    return false;
  }
  if (ext === "webp") {
    const h = await bytes(file, 0, 32);
    return ascii(h, 12, 16) === "VP8X" && (h[20] & 0x02) !== 0;
  }
  if (ext === "avif") {
    const h = await bytes(file, 0, 32);
    return ascii(h, 8, 12) === "avis";
  }
  return false;
}

const MAX_SIDE = 16384, MAX_AREA = 268e6;   // canvas limits in Chromium

const IMAGE_FORMATS = {
  webp: { mime: "image/webp", ext: "webp", name: "webp" },
  jpeg: { mime: "image/jpeg", ext: "jpg", name: "jpeg" },   // no alpha: transparent areas turn black
  png: { mime: "image/png", ext: "png", name: "png" }
};
/** Output image format description for "webp" | "jpeg" | "jpg" | "png" (anything else -> webp). */
export const imageFormat = f => IMAGE_FORMATS[String(f ?? "webp").toLowerCase().replace("jpg", "jpeg")] ?? IMAGE_FORMATS.webp;

export async function convertImage(file, { quality = 0.75, maxDim = 8192, maxPixels = 0, format = "webp" } = {}) {
  const ext = extOf(file.name);
  const fmt = imageFormat(format);
  if (await isAnimated(file, ext)) return null;                          // canvas would keep only the first frame
  const bmp = await createImageBitmap(file);
  try {
    const limit = Math.min(maxDim || MAX_SIDE, MAX_SIDE);
    let scale = Math.min(1, limit / Math.max(bmp.width, bmp.height), Math.sqrt(MAX_AREA / (bmp.width * bmp.height)));
    if (maxPixels > 0) scale = Math.min(scale, Math.sqrt(maxPixels / (bmp.width * bmp.height)));
    const sameFormat = ext === fmt.ext || (fmt.ext === "jpg" && ext === "jpeg");
    if (sameFormat && scale === 1) return null;                          // already in the target format and not too big
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: fmt.mime, quality });
    if (blob.type !== fmt.mime) return null;                             // browser cannot encode this format
    return { blob, name: `${stem(file.name)}.${fmt.ext}`, scaled: scale < 1, width: w, height: h };
  } finally { bmp.close?.(); }
}

const MIME_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif", "image/bmp": "bmp" };

/**
 * Optimize an image Blob/File (public API). Never enlarges; a downscaled result is always kept.
 * Resolves to { blob, changed, width, height, bytesBefore, bytesAfter, format }; when nothing worthwhile came out
 * (already small enough, not smaller, animated, undecodable format) `blob` is the input and `changed` is false.
 */
export async function optimizeImageBlob(blob, { maxEdge = 8192, maxPixels = 0, quality = 0.75, format = "webp", minGain = 0, keepIfLarger = true } = {}) {
  const before = blob.size;
  const ext = MIME_EXT[blob.type] ?? (blob.name ? extOf(blob.name) : "png");
  const file = new File([blob], `image.${ext}`, { type: blob.type });
  const unchanged = async () => {
    let width = null, height = null;
    try { const b = await createImageBitmap(blob); width = b.width; height = b.height; b.close?.(); } catch { /* unknown size */ }
    return { blob, changed: false, width, height, bytesBefore: before, bytesAfter: before, format: ext === "jpg" ? "jpeg" : ext };
  };
  const out = await convertImage(file, { quality, maxDim: maxEdge, maxPixels, format });
  if (!out) return unchanged();
  const gain = 1 - out.blob.size / before;
  if (!out.scaled && ((keepIfLarger && out.blob.size >= before) || (minGain > 0 && gain < minGain))) return unchanged();
  return {
    blob: out.blob, changed: true, width: out.width, height: out.height,
    bytesBefore: before, bytesAfter: out.blob.size, format: imageFormat(format).name
  };
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
  let height = null;
  try { height = (await probe.getPrimaryVideoTrack())?.displayHeight ?? null; } finally { probe.dispose?.(); }
  const video = { codec, quality: QUALITY[quality] ?? MB.QUALITY_MEDIUM };
  if (maxHeight && height && height > maxHeight) video.height = maxHeight;
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
