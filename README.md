# TicketHelper

TicketHelper is a Chrome Manifest V3 extension for support workflows around HubSpot Help Desk, Hyperflow chats, and Eduzz BackOffice searches.

This repository now uses an AI-ready project frame. The actual extension source lives in:

```text
project/
```

Files beside `project/` are intentional. They carry AI handoff notes, workflow rules, owner notes, scratch notes, and raw/reference assets that should not be mixed into the extension source.

## Layout

```text
TicketHelper/
  project/               Chrome extension source root
  docs/                  durable project and AI memory
  notes/                 user scratch notes
  asset_staging/         syncable raw/reference assets
  local_assets/          local-only ignored assets
  AGENTS.md              AI boot instructions
  README.md              repository overview
```

## Install From Release

1. Go to GitHub Releases and download `TicketHelper.zip`.
2. Unzip it. The archive should contain a `TicketHelper/` folder with `manifest.json` directly inside it.
3. Open `chrome://extensions/`.
4. Enable Developer Mode.
5. Click **Load unpacked** and select the unzipped `TicketHelper/` folder.
6. Reload any HubSpot/Hyperflow tabs already open.

Guide: [Ticket Helper - Guia](https://docs.google.com/document/d/18xjNcs9Eif6fTGiz5TuAANvABk1Q4bpVm276VCMMErA/edit?usp=sharing)

## Local Development Install

When testing directly from this repo, load this folder in Chrome:

```text
C:\C.Nvme\Projects\TicketHelper\project
```

Do not load the repo root, because `manifest.json` now lives inside `project/`.

## Quick Checks

```powershell
node --check project/background.js
node --check project/content.js
node --check project/popup_ui.js
```

There is no build step. Packaging is a manual zip step when requested.

## Packaging Rule

The source lives in `project/`, but release/test zips should keep the old user-facing shape:

```text
TicketHelper/manifest.json
TicketHelper/background.js
TicketHelper/content.js
...
```

In other words, package the contents of `project/` into a top-level `TicketHelper/` folder. Do not zip the repo root and do not include `.git`, `docs/`, `notes/`, `asset_staging/`, or local/private files.

## AI Workflow

For AI sessions, read `AGENTS.md` first. The durable project memory is in `docs/`.

Use:

- `memcheck` to update durable memory docs only.
- `gitcheckpoint` to update docs if needed, commit, and push for cross-machine continuity.
