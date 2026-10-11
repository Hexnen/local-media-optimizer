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

## Compatibility
Converting changes the file extension. Foundry itself uses the path returned by the upload, but another module that builds the path from the original file name would point to a missing file. Options: *Only optimize uploads made in Foundry's file picker window* (on by default; turn it off to optimize every upload), *Never optimize uploads into these folders*, or have the other module pass `{ skipOptimize: true }` in the upload options.

## Install

In Foundry: **Add-on Modules -> Install Module**, paste the manifest URL
`https://github.com/Hexnen/local-media-optimizer/releases/latest/download/module.json`, then enable the module in your world.

Notes: re-encoding already lossy audio/video is lossy twice; the originals are always kept by *Optimize folder*. Back up your world before letting it rewrite references. Animated PNG, GIF and SVG are left untouched.

## License
MIT (see `LICENSE`). Bundled mediabunny is MPL-2.0 (`vendor/mediabunny.LICENSE`).
