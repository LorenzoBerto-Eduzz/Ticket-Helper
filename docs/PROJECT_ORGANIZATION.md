# Project Organization Direction

TicketHelper uses an AI-ready repo frame with the Chrome extension source in `project/`.

## Root Frame

```text
TicketHelper/
  project/               actual Chrome extension source
  docs/                  durable project and AI memory
  notes/                 user scratch notes
  asset_staging/         raw/reference assets safe to sync
  local_assets/          ignored private/local assets
  image.png              public repo/portfolio preview image
  AGENTS.md              AI boot instructions
  README.md              repo overview and install guide
```

## Source Folder

`project/` is the Chrome extension root. It contains `manifest.json` and every file Chrome needs for local load-unpacked testing.

Current source shape is intentionally flat because this is a no-build MV3 extension:

```text
project/
  manifest.json
  background.js
  content.js
  popup_ui.js
  options.html
  options.js
  offscreen.html
  offscreen.js
  image.png
```

Do not add source files at repo root. Root is for repo frame docs/config only, with one intentional exception: root `image.png` is tracked for public repo/portfolio preview tooling.

## Modularity Direction

The codebase currently has large files, especially `background.js`, because the extension grew iteratively. Future changes should prefer extracting clear helpers or adding focused files only when it reduces risk and keeps Chrome MV3 loading simple.

Useful responsibility boundaries:

- Popup markup/style helpers: `popup_ui.js`.
- Page/content detection and popup UI binding: `content.js`.
- Background orchestration, BO tab state, release/options integration: `background.js`.
- Options UI: `options.html` and `options.js`.
- Clipboard/offscreen helper: `offscreen.*`.

Before major refactors, confirm with the owner. Avoid large moves that risk breaking Chrome extension paths.

## Assets

- `project/image.png` is the extension image asset.
- Root `image.png` intentionally duplicates `project/image.png` so external portfolio tooling can find a repository-level preview image. Keep it tracked and in sync with the extension image unless the owner asks for a different preview.
- `asset_staging/` is for raw/reference assets that are okay to sync but not part of the extension yet.
- `local_assets/` is ignored and local-only. Do not inspect it unless explicitly asked.

## Docs

Use focused docs under `docs/` when a behavior is complex enough that future AI sessions should not reconstruct it from chat or source alone. `docs/BO_ACTION_MODEL.md` is the current example.
