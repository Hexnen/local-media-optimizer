# Media Optimizer (Local) - Foundry VTT v13/v14

Converts everything you upload to Foundry, in the browser, with no external program:

| Input | Output |
| --- | --- |
| PNG, JPG, BMP, AVIF, TIFF (and oversized WebP) | WebP (quality + max size configurable, never enlarged) |
| MP3, WAV, FLAC, M4A, AAC | Ogg (Opus) |
| MP4, M4V, MOV, MKV | WebM (VP9/VP8 + Opus, max height configurable) |

GIF and SVG are left alone. Files that are already WebP/Ogg/WebM are not touched. If the converted file is not smaller, the original is kept (setting).

- **Automatic**: hooks Foundry's upload (`FilePicker.upload`), so everything uploaded in the file picker window is optimized (other modules' uploads too, if you turn off *file picker only*). A converted file never replaces a different existing file: `map-1.webp` is used when `map.webp` is taken.
- **Optimize folder**: button in the file picker (GM). Converts every file in the current folder (optionally with subfolders), keeps the originals, and can switch references in scenes, actors, items, journals, playlists, tables, macros and cards to the new files. Compendiums are not touched.
- Conversion uses WebCodecs / canvas through the bundled [mediabunny](https://mediabunny.dev) (MPL-2.0, `vendor/`). It needs a Chromium-based browser (Foundry desktop app, Chrome, Edge). Video conversion runs on your CPU/GPU and can take a while.

## API for other modules

`game.modules.get("local-media-optimizer").api` is available from `init` on (use `?.` - the module may not be installed).

| Call | What it does |
| --- | --- |
| `optimizeImage(blob, opts)` | Shrinks/re-encodes an image Blob/File. `opts`: `maxEdge` (px, default = the user's setting), `maxPixels`, `quality` (0.1-1), `format` (`"webp"` default, `"jpeg"`, `"png"`), `minGain` (0-1, minimum saving, default 0), `keepIfLarger` (default true). Resolves to `{ blob, changed, width, height, bytesBefore, bytesAfter, format }`. Never enlarges; a downscaled result is always kept; when nothing worthwhile comes out, `blob` is your input and `changed` is false. |
| `registerProfile(id, def)` | Declares how images under your folder are optimized: `{ label, prefix: "my-module/" \| match: path => boolean, maxEdge, maxPixels, quality, format }`. In memory only - register on every start. The longest matching prefix wins; function matchers come after prefixes. |
| `unregisterProfile(id)`, `listProfiles()`, `getProfile(path)` | Manage / inspect profiles. |
| `optimize(file)`, `optimizeFolder(picker)` | Existing helpers (full conversion with the user's settings; bulk dialog). |

A matching profile replaces the user's global image settings (largest side, quality, format) for that file, both for uploads and in *Optimize folder*, and it lets the upload through even when *file picker only* is on, because registering a profile is your module opting in. The user can turn this off with *Respect other modules' optimization profiles*. Excluded folders, *Optimize uploads automatically = off* and the minimum size still win.

```js
// my-module: keep generated art at <= 1536 px, WebP q0.8
Hooks.once("setup", () => {
  game.modules.get("local-media-optimizer")?.api?.registerProfile("my-module", {
    label: "My Module", prefix: "my-module/", maxEdge: 1536, quality: 0.8, format: "webp"
  });
});

// or optimize yourself and tell the optimizer not to encode it again
const api = game.modules.get("local-media-optimizer")?.api;
const r = api ? await api.optimizeImage(blob, { maxEdge: 1536, quality: 0.8 }) : { blob };
const file = new File([r.blob], `art.${r.format === "jpeg" ? "jpg" : r.format}`, { type: r.blob.type });
const res = await foundry.applications.apps.FilePicker.implementation.upload("data", "my-module/art", file, {}, { optimized: true });
// always use res.path: the extension may differ from the name you sent
```

Upload options, strongest first: `skipOptimize: true` (never touch this upload) and `optimized: true` (already optimized, do not encode twice) both beat any profile. JPEG output has no transparency.

## Compatibility
Converting changes the file extension. Foundry itself uses the path returned by the upload, but another module that builds the path from the original file name would point to a missing file. Options: *Only optimize uploads made in Foundry's file picker window* (on by default; turn it off to optimize every upload), *Never optimize uploads into these folders*, or have the other module pass `{ skipOptimize: true }` in the upload options.

## Install

In Foundry: **Add-on Modules -> Install Module**, paste the manifest URL
`https://github.com/Hexnen/local-media-optimizer/releases/latest/download/module.json`, then enable the module in your world.

Notes: re-encoding already lossy audio/video is lossy twice; the originals are always kept by *Optimize folder*. Back up your world before letting it rewrite references. Animated PNG, GIF and SVG are left untouched.

## License
MIT (see `LICENSE`). Bundled mediabunny is MPL-2.0 (`vendor/mediabunny.LICENSE`).
