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
  .git-identity
  .githooks/
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

## Local Release/Test Export Rule

Even though source is in `project/`, local release-style exports should be a generated root folder named:

```text
TicketHelper/manifest.json
TicketHelper/background.js
...
```

That folder is a clone of `project/`, renamed to `TicketHelper`. You can load it unpacked in Chrome for manual release-style testing, or zip it manually when needed.

GitHub release zips should zip that `TicketHelper/` folder. The zip should not include `docs/`, `.git/`, `notes/`, `asset_staging/`, or `local_assets/`.

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

Git identity guard:

```powershell
Get-Content .git-identity
git config user.email
git config core.hooksPath
```

The configured local Git email must match `.git-identity`. `user.name` can vary by device. On each other clone/computer, run once:

```powershell
git config core.hooksPath .githooks
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
- Keep generated release folders/zips out of Git.
- Ask explicitly before local release export or GitHub release packaging.
- Ask explicitly before Git commit/push unless you already said to checkpoint.
- Before Git commit/push, confirm local Git email matches `.git-identity`.
- `local_assets/` is local/private and should not be inspected by AI unless you ask.
- For BO automation behavior, `docs/BO_ACTION_MODEL.md` is the main durable reference.
