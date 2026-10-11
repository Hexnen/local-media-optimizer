import { optimize, kindOf } from "./convert.mjs";
import { openBulk } from "./bulk.mjs";
import { ID, t, fmtSize, config } from "./shared.mjs";

const { NumberField, StringField, BooleanField } = foundry.data.fields;
const get = k => game.settings.get(ID, k);

Hooks.once("init", () => {
  const reg = (key, data) => game.settings.register(ID, key, { scope: "world", config: true, ...data });
  reg("enabled", { name: "LMO.Set.Enabled", hint: "LMO.Set.EnabledHint", type: new BooleanField({ initial: true }) });
  reg("image", { name: "LMO.Set.Image", type: new BooleanField({ initial: true }) });
  reg("imageQuality", { name: "LMO.Set.ImageQuality", type: new NumberField({ initial: 0.75, min: 0.1, max: 1, step: 0.05, nullable: false }) });
  reg("imageMaxDim", { name: "LMO.Set.ImageMaxDim", hint: "LMO.Set.ImageMaxDimHint", type: new NumberField({ initial: 8192, min: 0, integer: true, nullable: false }) });
  reg("audio", { name: "LMO.Set.Audio", type: new BooleanField({ initial: true }) });
  reg("audioBitrate", { name: "LMO.Set.AudioBitrate", type: new NumberField({ initial: 128, nullable: false, choices: { 64: "64", 96: "96", 128: "128", 160: "160", 192: "192", 256: "256" } }) });
  reg("video", { name: "LMO.Set.Video", type: new BooleanField({ initial: true }) });
  reg("videoMaxHeight", { name: "LMO.Set.VideoMaxHeight", hint: "LMO.Set.VideoMaxHeightHint", type: new NumberField({ initial: 1080, min: 0, integer: true, nullable: false }) });
  reg("videoQuality", { name: "LMO.Set.VideoQuality", type: new StringField({ initial: "medium", choices: { low: "Low (smallest)", medium: "Medium", high: "High" } }) });
  reg("pickerOnly", { name: "LMO.Set.PickerOnly", hint: "LMO.Set.PickerOnlyHint", type: new BooleanField({ initial: true }) });
  reg("excludePaths", { name: "LMO.Set.ExcludePaths", hint: "LMO.Set.ExcludePathsHint", type: new StringField({ initial: "modules/, systems/" }) });
  reg("minKB", { name: "LMO.Set.MinKB", type: new NumberField({ initial: 20, min: 0, integer: true, nullable: false }) });
  reg("keepIfLarger", { name: "LMO.Set.KeepIfLarger", type: new BooleanField({ initial: true }) });
});

/** Optimize with a progress notification. Never throws: resolves to the optimize() result, or null to upload the original. */
async function optimizeForUpload(file) {
  if (!kindOf(file.name)) return null;
  const note = ui.notifications.info(t("Optimizing", { name: file.name }), { progress: true });
  try {
    return await optimize(file, config(), p => note?.update?.({ pct: p }));
  } catch (err) {
    console.warn(`${ID} |`, err);
    ui.notifications.warn(t("Failed", { name: file.name, msg: err.message }));
    return null;
  } finally {
    note?.update?.({ pct: 1 });
    setTimeout(() => ui.notifications.remove?.(note), 300);
  }
}

/**
 * Other code that builds the stored path from the ORIGINAL file name (instead of using the path Foundry returns)
 * breaks when the extension changes. Escape hatches: options.skipOptimize = true on the upload call, excluded folders,
 * or "file picker only" (default; Foundry's own picker window always sends a `bucket` field).
 */
function shouldOptimize(path, body, options, file) {
  if (!(file instanceof File) || options?.skipOptimize || !get("enabled")) return false;
  const target = String(path ?? "").replace(/^\/+/, "");
  const excluded = get("excludePaths").split(",").map(s => s.trim().replace(/^\/+/, "")).filter(Boolean);
  if (excluded.some(p => target.startsWith(p))) return false;
  if (get("pickerOnly") && !(body && "bucket" in body)) return false;
  return true;
}

const decName = f => { const n = f.split("/").pop(); try { return decodeURIComponent(n).toLowerCase(); } catch { return n.toLowerCase(); } };

/** The converted name (e.g. map.webp) must not replace a different existing file: add -1, -2... when it is taken. */
async function uniqueFile(FP, source, path, file, body) {
  let listing;
  try { listing = await FP.browse(source, path, { bucket: body?.bucket ?? null }); } catch { return file; }
  const taken = new Set((listing.files ?? []).map(decName));
  if (!taken.has(file.name.toLowerCase())) return file;
  const dot = file.name.lastIndexOf(".");
  for (let i = 1; i < 1000; i++) {
    const name = `${file.name.slice(0, dot)}-${i}${file.name.slice(dot)}`;
    if (!taken.has(name.toLowerCase())) return new File([file], name, { type: file.type });
  }
  return file;
}

Hooks.once("ready", () => {
  const FP = CONFIG.ux.FilePicker;
  const original = FP.upload;
  FP.upload = async function (source, path, file, body = {}, options = {}) {
    let notice = null;
    try {
      if (shouldOptimize(path, body, options, file)) {
        const r = await optimizeForUpload(file);
        if (r) {
          let out = r.file;
          if (out.name !== file.name) out = await uniqueFile(FP, source, path, out, body);
          const delta = Math.round((1 - r.after / r.before) * 100);
          notice = t("Saved", { name: file.name, before: fmtSize(r.before), after: fmtSize(r.after), pct: delta >= 0 ? `-${delta}%` : `+${-delta}%` });
          file = out;
        }
      }
    } catch (err) {
      console.warn(`${ID} | optimization skipped`, err);   // never let this module block an upload
    }
    const result = await original.call(this, source, path, file, body, options);
    if (notice && result?.path) ui.notifications.info(notice);   // only after the server accepted the file
    return result;
  };
  game.modules.get(ID).api = { optimize: f => optimize(f, config()), optimizeFolder: openBulk };
});

Hooks.on("renderFilePicker", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : app.element;
  if (!root || root.querySelector(".lmo-bulk")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "lmo-bulk";
  btn.innerHTML = `<i class="fa-solid fa-compress"></i> ${t("Bulk.Button")}`;
  btn.addEventListener("click", () => openBulk(app));
  (root.querySelector("footer") ?? root.querySelector(".window-content") ?? root).append(btn);
});
