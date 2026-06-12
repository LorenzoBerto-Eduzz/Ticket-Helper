# AI Handoff

This file is the portable continuity note for AI coding sessions working on TicketHelper. Keep it short and current; do not turn it into a changelog.

## Current State

- Project name: `TicketHelper`.
- Project kind: Chrome Manifest V3 extension.
- Main source folder: `project/`.
- Manifest: `project/manifest.json`.
- Current version at template migration: `1.8.16`.
- Primary language/stack: plain JavaScript, HTML, CSS, Chrome extension APIs.
- Run command: none. Load unpacked extension from `project/` in Chrome.
- Test commands:

```powershell
node --check project/background.js
node --check project/content.js
node --check project/popup_ui.js
```

- Configured remote: `https://github.com/LorenzoBerto-Eduzz/TicketHelper.git`.
- Keep the same repo path, `.git`, and remote unless the owner explicitly asks for a change.
- The repo uses an AI-ready frame. Source code is in `project/`; durable memory and workflow docs are in `docs/`.

## Product Summary

TicketHelper assists support work across HubSpot Help Desk tickets, Hyperflow chats, and Eduzz BackOffice. It displays a floating popup with ticket/chat data, copy shortcuts, BO tab assignment buttons, and action buttons for searches such as Faturas, Nutror, and Contratos.

## Important Behavior To Preserve

- The current work item is the latest focused/opened ticket or chat detected by the extension.
- BO1 is the primary account lookup tab.
- BO2 is the default action tab unless an action has its own dedicated tab.
- Faturas defaults to BO2 unless it has its own dedicated action tab.
- Nutror and Contratos can have dedicated action tabs.
- Autoruns happen when the extension gathers a usable CPF/CNPJ/doc value, or email when the account has no doc / invalid-foreign doc cases require email.
- Action button clicks should either focus an already verified result for the current item/value or run the action. They should not be blocked by stale `SEARCH_STARTED` or stale in-flight autorun state.
- Triangle/corner action-tab buttons are focus controls only. Focusing a defined tab should not start a search.
- See `docs/BO_ACTION_MODEL.md` before changing BO action behavior.

## Packaging And Loading

Local development install:

```text
C:\C.Nvme\Projects\TicketHelper\project
```

Release/test zip shape should stay user-friendly even though source moved into `project/`:

```text
TicketHelper/manifest.json
TicketHelper/background.js
TicketHelper/content.js
...
```

That means packaging should zip the contents of `project/` under a top-level `TicketHelper/` folder. Do not include root docs, `.git`, notes, or local assets in release zips.

## Recent Structural Change

The AI project template frame was migrated into the existing TicketHelper repo without changing the repo folder, `.git`, or remote. Extension source files were moved from repo root into `project/`.

## Future Session Procedure

1. Read root `AGENTS.md` first.
2. Read this file next.
3. Read `docs/AI_MEMORY_PROTOCOL.md` and `docs/WORKFLOW_AND_STYLE.md`.
4. Read `docs/PROJECT_BRIEF.md` and any focused doc relevant to the task.
5. Check `git status --short --branch` and recent history.
6. Inspect `project/` files before editing.
7. Ask before major structure, release, branch, or workflow changes.
