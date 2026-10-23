// Path profiles: other modules register how images stored under THEIR folders should be optimized (max size, quality, format).
// Pure logic, no Foundry globals, so it can be unit tested. Profiles live in memory only (registered by the other module on every start).
const FORMATS = new Set(["webp", "jpeg", "png"]);
const profiles = new Map();

/** Decoded path without leading slashes, the form profiles are matched against. */
export function normPath(p) {
  let s = String(p ?? "");
  try { s = decodeURIComponent(s); } catch { /* keep as is */ }
  return s.replace(/^\/+/, "");
}

const num = (v, min, max) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.min(max, Math.max(min, Number(v))) : null);

const view = p => ({
  id: p.id, label: p.label, prefix: p.prefix, hasMatcher: !!p.match,
  maxEdge: p.maxEdge, maxPixels: p.maxPixels, quality: p.quality, format: p.format
});

/**
 * Register (or replace) a profile. Give either `prefix` (folder prefix such as "ai-image-gen/") or `match(path) => boolean`.
 * Unset numeric fields fall back to the user's global settings.
 */
export function registerProfile(id, def = {}) {
  if (typeof id !== "string" || !id.trim()) throw new Error("registerProfile: id must be a non-empty string");
  const hasPrefix = typeof def.prefix === "string" && def.prefix.trim() !== "";
  const hasMatch = typeof def.match === "function";
  if (!hasPrefix && !hasMatch) throw new Error("registerProfile: provide `prefix` (string) or `match` (function)");
  const format = def.format == null ? null : String(def.format).toLowerCase().replace("jpg", "jpeg");
  if (format && !FORMATS.has(format)) throw new Error(`registerProfile: format must be one of ${[...FORMATS].join(", ")}`);
  const p = {
    id,
    label: String(def.label ?? id),
    prefix: hasPrefix ? normPath(def.prefix) : null,
    match: hasMatch ? def.match : null,
    maxEdge: num(def.maxEdge, 64, 16384),
    maxPixels: num(def.maxPixels, 4096, 268e6),
    quality: num(def.quality, 0.1, 1),
    format
  };
  profiles.set(id, p);
  return view(p);
}

export const unregisterProfile = id => profiles.delete(id);
export const listProfiles = () => [...profiles.values()].map(view);
export const clearProfiles = () => profiles.clear();

/** The profile for a file path, or null. The longest matching prefix wins; function matchers come after prefixes, in registration order. */
export function getProfile(path) {
  const p = normPath(path);
  const hits = [];
  for (const prof of profiles.values()) {
    if (prof.prefix && p.startsWith(prof.prefix)) hits.push({ prof, rank: prof.prefix.length });
    else if (prof.match) {
      let ok = false;
      try { ok = !!prof.match(p); } catch (e) { console.warn(`local-media-optimizer | profile "${prof.id}" matcher threw`, e); }
      if (ok) hits.push({ prof, rank: -1 });
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.rank - a.rank);   // stable: ties keep registration order
  return view(hits[0].prof);
}

/** A copy of the conversion config with the profile's image settings applied (other kinds are untouched). */
export function applyProfile(cfg, profile) {
  if (!profile) return cfg;
  const image = { ...cfg.image };
  if (profile.maxEdge != null) image.maxDim = profile.maxEdge;
  if (profile.maxPixels != null) image.maxPixels = profile.maxPixels;
  if (profile.quality != null) image.quality = profile.quality;
  if (profile.format) image.format = profile.format;
  return { ...cfg, image };
}
