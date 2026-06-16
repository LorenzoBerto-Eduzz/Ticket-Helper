# Project Brief

## Identity

- Project name: `TicketHelper`
- Project kind: Chrome Manifest V3 extension
- Main project folder: `project/`
- Primary language/stack: plain JavaScript, HTML, CSS, Chrome extension APIs
- Manifest: `project/manifest.json`
- Public preview image: root `image.png`, intentionally duplicated from `project/image.png` for repository/portfolio tooling.

## Purpose

TicketHelper helps support agents gather and copy current ticket/chat data and keep Eduzz BackOffice searches synchronized with the current HubSpot ticket or Hyperflow chat.

## Audience Or Users

The primary user is the support operator working across HubSpot Help Desk, Hyperflow conversations, and Eduzz BackOffice.

## Current Scope

- Floating popup on HubSpot and Hyperflow pages.
- Detect latest/current ticket or chat.
- Extract/copy ticket ID, contact/name, email, doc, and account summary.
- Automate BO1 account lookup.
- Automate defined BackOffice action tabs for Faturas, Nutror, and Contratos.
- Keep action results synchronized with the current ticket/chat while avoiding stale data from prior tickets.

## Run And Test Commands

There is no build command.

Local Chrome testing:

```text
Load unpacked: C:\C.Nvme\Projects\TicketHelper\project
```

Syntax checks:

```powershell
node --check project/background.js
node --check project/content.js
node --check project/popup_ui.js
```

Diff hygiene:

```powershell
git diff --check
```

## Important Constraints

- Keep the same repo folder and remote unless the owner explicitly asks otherwise.
- Do not force-push or rewrite history unless explicitly requested and approved.
- Source lives in `project/`; repo root is the AI project frame.
- Release/test zips should include only extension files, folder-wrapped as `TicketHelper/...`.
- Keep root `image.png` committed for external portfolio preview tooling. Chrome testing and release packaging still use `project/image.png`.
- `TicketHelper.zip` is generated and ignored.
- `local_assets/` is local-only and should not be inspected unless explicitly requested.
- BO automation must avoid showing or copying data from the wrong ticket/chat.
- Action button behavior should be deterministic and should not depend on manually focusing the BO tab first.

## Current Priorities

- Keep BO action buttons reliable.
- Keep current ticket/chat detection and BO tab synchronization correct.
- Preserve release packaging behavior while source now lives in `project/`.
- Keep durable AI docs accurate as the project evolves.

## Glossary

- BO: Eduzz BackOffice at `bo.eduzz.com/dashboard`.
- BO1: primary BackOffice tab used for account/doc lookup.
- BO2: default BackOffice tab used for action searches if an action has no dedicated tab.
- Action tab: a dedicated BO tab assigned to Faturas, Nutror, or Contratos.
- Current item: latest focused/opened/detected HubSpot ticket or Hyperflow chat.
- Autorun: automatic BO action search triggered after usable doc/email data is gathered.

## Known Pitfalls

- After source migration, load `project/` in Chrome, not the repo root.
- The configured remote may print a GitHub moved-repository message, but do not change it without owner approval.
- Local `dev` and remote `main` may not track the same branch state; inspect before pushing.
- Chrome extension release zips are custom-built, not GitHub source archives.
- BackOffice pages are dynamic and can be slow; avoid relying on a single focus/change event as proof of final result.
