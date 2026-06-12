# Owner Notes

This file explains the current repo organization and why it exists.

## What This Repo Is

TicketHelper is a Chrome MV3 extension for support workflows involving HubSpot Help Desk, Hyperflow chats, and Eduzz BackOffice.

The repo now uses an AI-ready project frame. The actual extension source lives inside:

```text
project/
```

Files outside `project/` are intentional. They hold AI memory, owner guidance, workflow rules, scratch notes, and staging folders.

## Current Outer Structure

```text
TicketHelper/
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
  docs/
  notes/
  asset_staging/
  local_assets/
  AGENTS.md
  README.md
  .editorconfig
  .gitattributes
  .gitignore
```

## How To Load Locally

In Chrome, use **Load unpacked** and select:

```text
C:\C.Nvme\Projects\TicketHelper\project
```

Do not select the repo root.

## Release/Test Zip Rule

Even though source is in `project/`, generated zips should still look like the old release package:

```text
TicketHelper/manifest.json
TicketHelper/background.js
...
```

The zip should not include `docs/`, `.git/`, `notes/`, `asset_staging/`, or `local_assets/`.

## Important Commands

Syntax checks:

```powershell
node --check project/background.js
node --check project/content.js
node --check project/popup_ui.js
```

Git status:

```powershell
git status --short --branch
```

## AI Commands

Use:

```text
memcheck
```

when you want AI to save an important decision into durable docs only.

Use:

```text
gitcheckpoint
```

when you want AI to update docs if needed, commit, and push so another machine/session can continue.

## Ground Rules

- Keep the same repo folder and remote unless you explicitly decide otherwise.
- Keep extension source in `project/`.
- Keep generated zips out of Git.
- Ask explicitly before release packaging if you want a zip.
- Ask explicitly before Git commit/push unless you already said to checkpoint.
- `local_assets/` is local/private and should not be inspected by AI unless you ask.
- For BO automation behavior, `docs/BO_ACTION_MODEL.md` is the main durable reference.
