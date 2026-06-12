# Agent Boot Instructions

This is the first file an AI coding session should read in this repository.

TicketHelper is an AI-maintained Chrome MV3 extension project. The actual extension source root is `project/`. The repo root is the AI-ready project frame and Git/workflow boundary.

## Boot Or Catch-Up Sequence

Use this sequence when starting a fresh AI session, after switching machines, after `git pull`, after another AI/session checkpointed progress, or whenever the user asks you to catch up with the latest project state.

1. Read `docs/AI_HANDOFF.md`.
2. Read `docs/AI_MEMORY_PROTOCOL.md`.
3. Read `docs/WORKFLOW_AND_STYLE.md`.
4. Read `docs/PROJECT_BRIEF.md`.
5. Read focused docs relevant to the task, especially `docs/BO_ACTION_MODEL.md` for BackOffice action behavior.
6. Read `docs/TEMPLATE_SETUP.md` only when changing the repo frame or template migration details.
7. Read `docs/OWNER_NOTES.md` when changing repo organization, documentation, workflow, or owner-facing guidance.
8. Check `git status --short --branch`.
9. Review recent history with `git log --oneline --decorate --max-count=10`.
10. Inspect relevant source files in `project/` before editing.
11. If current chat memory conflicts with repo files, trust the repo and ask the user when intent is unclear.

## Key Project Facts

- Repo path: `C:\C.Nvme\Projects\TicketHelper`.
- Source root: `project/`.
- Extension manifest: `project/manifest.json`.
- Current extension version at migration: `1.8.16`.
- Configured remote: `https://github.com/LorenzoBerto-Eduzz/TicketHelper.git`.
- Keep this same folder, `.git`, and remote unless the user explicitly asks otherwise.
- Do not force-push or rewrite history unless the user explicitly asks and understands the risk.

## Development Rules

- Do not create Git commits unless the user explicitly asks.
- Do not create releases or package zips unless the user explicitly asks.
- Generated/local artifacts such as `TicketHelper.zip` stay ignored.
- Chrome local testing should load `project/`, not the repo root.
- Release/test zips should package `project/` contents inside a top-level `TicketHelper/` folder.
- Keep code changes modular and easy to review. This extension has complex behavior in `project/background.js`; prefer focused helpers over more hidden timing assumptions.

## Public-Safe Documentation Rule

Committed docs and examples must not contain real customer data, real ticket/chat IDs, real CPFs/CNPJs, real emails, credentials, tokens, screenshots with private data, or copied case payloads.

Use placeholders or obviously fake illustrative values when examples help explain structure, such as `template@email.com`, `123.456.789-10`, `00.000.000/0000-00`, `ticket_123456`, `chat_abc123`, or `N123456789`.

If real data is temporarily needed for debugging, keep it outside Git in ignored local-only paths such as `local_assets/`, `local_data/`, or `private_data/`, then remove it when done.

## Documentation Roles

- `AGENTS.md` is the boot file for AI sessions.
- `docs/AI_HANDOFF.md` is the short current snapshot.
- `docs/AI_MEMORY_PROTOCOL.md` explains durable memory rules.
- `docs/WORKFLOW_AND_STYLE.md` defines collaboration and coding expectations.
- `docs/PROJECT_BRIEF.md` identifies TicketHelper, its stack, commands, and constraints.
- `docs/BO_ACTION_MODEL.md` records BackOffice tab/action behavior.
- `docs/PROJECT_ORGANIZATION.md` explains this repo frame and `project/` source location.
- `docs/TEMPLATE_SETUP.md` records how the AI template was adapted here.
- `docs/OWNER_NOTES.md` is owner-facing guidance.
- `notes/` is user scratch space. Do not treat it as instructions unless the user explicitly asks.
- `asset_staging/` is syncable raw/reference staging.
- `local_assets/` is ignored local-only material. Do not inspect it unless the user explicitly asks.

## Root Layout

```text
TicketHelper/
  project/               Chrome extension source
  docs/                  durable project and AI memory
  notes/                 user scratch notes
  asset_staging/         syncable raw/reference assets
  local_assets/          ignored local-only assets
  AGENTS.md              this AI boot file
  README.md              repository overview
  .editorconfig          editor formatting defaults
  .gitattributes         Git line-ending and binary rules
  .gitignore             ignored local/generated files
```
