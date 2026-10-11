import { optimize, kindOf } from "./convert.mjs";
import { openBulk } from "./bulk.mjs";
import { ID, t, fmtSize, config } from "./shared.mjs";

const { NumberField, StringField, BooleanField } = foundry.data.fields;

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
  reg("minKB", { name: "LMO.Set.MinKB", type: new NumberField({ initial: 20, min: 0, integer: true, nullable: false }) });
  reg("keepIfLarger", { name: "LMO.Set.KeepIfLarger", type: new BooleanField({ initial: true }) });
});

/** Optimize with a progress notification. Never throws: returns the File to upload (the original on failure). */
async function optimizeForUpload(file) {
  if (!kindOf(file.name)) return file;
  const note = ui.notifications.info(t("Optimizing", { name: file.name }), { progress: true });
  try {
    const r = await optimize(file, config(), p => note?.update?.({ pct: p }));
    if (!r) return file;
    const pct = `-${Math.round((1 - r.after / r.before) * 100)}%`;
    ui.notifications.info(t("Saved", { name: file.name, before: fmtSize(r.before), after: fmtSize(r.after), pct }));
    return r.file;
  } catch (err) {
    console.warn(`${ID} |`, err);
    ui.notifications.warn(t("Failed", { name: file.name, msg: err.message }));
    return file;
  } finally {
    note?.update?.({ pct: 1 });
    setTimeout(() => ui.notifications.remove?.(note), 300);
  }
}

Hooks.once("ready", () => {
  const FP = CONFIG.ux.FilePicker;
  const original = FP.upload;
  FP.upload = async function (source, path, file, body = {}, options = {}) {
    if (game.settings.get(ID, "enabled") && !options.skipOptimize && file instanceof File) file = await optimizeForUpload(file);
    return original.call(this, source, path, file, body, options);
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
