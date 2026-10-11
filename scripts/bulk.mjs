import { optimize, kindOf } from "./convert.mjs";
import { t, fmtSize, config } from "./shared.mjs";

const FP = () => CONFIG.ux.FilePicker;
const COLLECTIONS = ["scenes", "actors", "items", "journal", "playlists", "tables", "macros", "cards"];
const baseName = p => p.split("/").pop();
const dirName = p => p.split("/").slice(0, -1).join("/");
const stem = n => n.replace(/\.[^.]+$/, "");

const OUT_EXT = { image: "webp", audio: "ogg", video: "webm" };
const PROTECTED = /^(modules|systems)(\/|$)/;   // package folders are never touched

async function collect(source, dir, recursive, out = []) {
  const r = await FP().browse(source, dir);
  out.push(...r.files);
  if (recursive) for (const d of r.dirs) if (!PROTECTED.test(d)) await collect(source, d, true, out);
  return out;
}

/** Open the bulk optimizer for a FilePicker instance. */
export async function openBulk(picker) {
  const source = picker.activeSource ?? "data";
  if (source !== "data") return ui.notifications.warn(t("Bulk.OnlyData"));
  const folder = picker.target ?? "";
  if (PROTECTED.test(folder)) return ui.notifications.warn(t("Bulk.Protected"));
  const esc = foundry.utils.escapeHTML;
  const choice = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("Bulk.Title"), icon: "fa-solid fa-compress" },
    content: `
      <div class="form-group"><label>${t("Bulk.Folder")}</label><div class="form-fields"><input type="text" value="${esc(folder || "/")}" disabled></div></div>
      <div class="form-group"><label>${t("Bulk.Recursive")}</label><div class="form-fields"><input type="checkbox" name="recursive" checked></div></div>
      <div class="form-group"><label>${t("Bulk.Refs")}</label><div class="form-fields"><input type="checkbox" name="refs" checked></div><p class="hint">${t("Bulk.RefsHint")}</p></div>`,
    ok: { label: t("Bulk.Start"), icon: "fa-solid fa-play", callback: (ev, btn) => ({ recursive: btn.form.elements.recursive.checked, refs: btn.form.elements.refs.checked }) },
    rejectClose: false
  });
  if (!choice) return;
  await run(source, folder, choice);
}

async function run(source, folder, { recursive, refs }) {
  const cfg = config();
  const note = ui.notifications.info(t("Bulk.Scanning", { folder: folder || "/" }), { progress: true });
  const stats = { n: 0, ok: 0, failed: 0, skipped: 0, saved: 0 };
  const log = [];
  const moved = new Map();
  try {
    const all = await collect(source, folder, recursive);
    const existing = new Set(all);
    const todo = all.filter(p => {
      const k = kindOf(p);
      const ext = p.split(".").pop().toLowerCase();
      return k && cfg[k].on && !(k === "image" && ext === "webp");   // webp only matters if oversized; skipped in bulk for speed
    });
    stats.n = todo.length;
    if (!todo.length) { ui.notifications.info(t("Bulk.Nothing")); return; }

    for (let i = 0; i < todo.length; i++) {
      const path = todo[i];
      note?.update?.({ message: t("Bulk.Progress", { i: i + 1, n: todo.length, name: baseName(path) }), pct: i / todo.length });
      try {
        const dir = dirName(path);
        const target = `${dir ? `${dir}/` : ""}${stem(baseName(path))}.${OUT_EXT[kindOf(path)]}`;
        if (existing.has(target)) { stats.skipped++; continue; }   // converted copy already there: don't redo the work
        const res = await fetch(foundry.utils.getRoute(encodeURI(path)));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const file = new File([await res.blob()], baseName(path));
        const r = await optimize(file, cfg);
        if (!r) { stats.skipped++; continue; }
        const up = await FP().upload(source, dir, r.file, {}, { notify: false, skipOptimize: true });
        if (!up?.path) throw new Error("upload failed");
        existing.add(target);
        moved.set(path, up.path);
        stats.ok++;
        stats.saved += r.before - r.after;
        log.push(`${path} → ${baseName(up.path)} (${fmtSize(r.before)} → ${fmtSize(r.after)})`);
      } catch (err) {
        stats.failed++;
        log.push(`FAILED ${path}: ${err.message}`);
      }
    }
  } finally {
    note?.update?.({ pct: 1 });
    setTimeout(() => ui.notifications.remove?.(note), 300);
  }

  ui.notifications.info(t("Bulk.Done", { ...stats, saved: fmtSize(Math.max(0, stats.saved)) }));
  if (refs && moved.size) {
    const dry = await rewriteReferences(moved, true);
    if (dry.count) {
      const yes = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("Bulk.Refs"), icon: "fa-solid fa-link" },
        content: `<p>${t("Bulk.RefsConfirm", dry)}</p>`, rejectClose: false
      });
      if (yes) {
        const done = await rewriteReferences(moved, false);
        ui.notifications.info(t("Bulk.RefsDone", done));
      }
    }
  }
  await foundry.applications.api.DialogV2.prompt({
    window: { title: t("Bulk.Report"), icon: "fa-solid fa-clipboard-list" },
    content: `<p>${t("Bulk.Done", { ...stats, saved: fmtSize(Math.max(0, stats.saved)) })}</p><pre style="max-height:300px;overflow:auto;font-size:11px;white-space:pre-wrap">${foundry.utils.escapeHTML(log.join("\n"))}</pre>`,
    ok: { label: t("Close") }, rejectClose: false
  });
}

// ---------- reference rewriting ----------
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildPairs(map) {
  const pairs = [];
  for (const [from, to] of map) {
    for (const [a, b] of [[from, to], [encodeURI(from), encodeURI(to)]]) {
      pairs.push([new RegExp(`(?<![\\w/.%-])${escapeRe(a)}(?![\\w%-]|\\.\\w)`, "g"), b]);
    }
  }
  return pairs;
}

export function replaceDeep(value, pairs, stats) {
  if (typeof value === "string") {
    let out = value;
    for (const [re, to] of pairs) out = out.replace(re, () => { stats.count++; return to; });
    return out === value ? { value, changed: false } : { value: out, changed: true };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const arr = value.map(v => { const r = replaceDeep(v, pairs, stats); changed ||= r.changed; return r.value; });
    return { value: changed ? arr : value, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const o = {};
    for (const [k, v] of Object.entries(value)) { const r = replaceDeep(v, pairs, stats); changed ||= r.changed; o[k] = r.value; }
    return { value: changed ? o : value, changed };
  }
  return { value, changed: false };
}

async function walkDoc(doc, pairs, dry, stats) {
  const embedded = Object.keys(doc.constructor.hierarchy ?? {});
  const changes = {};
  for (const [k, v] of Object.entries(doc.toObject())) {
    if (embedded.includes(k) || k === "_id" || k === "_stats") continue;
    const r = replaceDeep(v, pairs, stats);
    if (r.changed) changes[k] = r.value;
  }
  if (Object.keys(changes).length) {
    stats.docs++;
    if (!dry) await doc.update(changes);
  }
  for (const name of embedded) for (const child of doc.getEmbeddedCollection(name)) await walkDoc(child, pairs, dry, stats);
}

/** Replace old paths with new ones across world documents. dry=true only counts. */
export async function rewriteReferences(map, dry) {
  const pairs = buildPairs(map);
  const stats = { count: 0, docs: 0 };
  for (const name of COLLECTIONS) {
    const col = game[name];
    if (!col) continue;
    for (const doc of col.contents) await walkDoc(doc, pairs, dry, stats);
  }
  return stats;
}
