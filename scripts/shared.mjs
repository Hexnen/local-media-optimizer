export const ID = "local-media-optimizer";
export const t = (k, d) => (d ? game.i18n.format(`LMO.${k}`, d) : game.i18n.localize(`LMO.${k}`));
export const fmtSize = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const get = k => game.settings.get(ID, k);

/** Current settings as a conversion config. */
export const config = () => ({
  image: { on: get("image"), quality: get("imageQuality"), maxDim: get("imageMaxDim") },
  audio: { on: get("audio"), bitrate: get("audioBitrate") },
  video: { on: get("video"), maxHeight: get("videoMaxHeight"), quality: get("videoQuality") },
  minSize: get("minKB") * 1024,
  keepIfLarger: get("keepIfLarger")
});
