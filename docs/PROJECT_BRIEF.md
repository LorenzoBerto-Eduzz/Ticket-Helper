# Project Brief

## Identity

- Project name: `TicketHelper`
- Project kind: Chrome Manifest V3 extension
- Main project folder: `project/`
- Primary language/stack: plain JavaScript, HTML, CSS, Chrome extension APIs
- Manifest: `project/manifest.json`
- Extension icon assets: `project/icons/` (16, 32, 48, 128px Chrome icons and a 512px master)
- Public preview image: root `image.png`, intentionally duplicated from `project/image.png` for repository/portfolio tooling.
- Git identity guard: `.git-identity` plus `.githooks/` restrict commits/pushes to the configured repo email. `user.name` may vary by device.

## Purpose

TicketHelper helps support agents gather and copy current ticket/chat data and keep Eduzz BackOffice searches synchronized with the current HubSpot ticket or Hyperflow chat.

## Audience Or Users

The primary user is the support operator working across HubSpot Help Desk, Hyperflow conversations, and Eduzz BackOffice.

## Current Scope

- Floating popup on `app.hubspot.com` pages; Hyperflow ticket/chat detection and background work remain supported without an overlay there.
- Detect latest/current ticket or chat.
- Extract/copy ticket ID, contact/name, email, doc, and account summary.
- Preserve the legacy BO1 account lookup and action code for reassessment. The current remaster uses dedicated flows for BO2-host Orbita/Nutror and BO1-host Faturas/Contratos.
- Launch two assigned `bo.eduzz.com` work tabs in the upper-right window and two assigned `bo2.eduzz.com` work tabs in the lower-right window. The BO1-host tabs run Faturas and Contratos; the BO2-host tabs run Orbita customer and Nutror searches.
- Keep external search results synchronized with the current ticket/chat and reject stale data from prior tickets.

## Run And Test Commands

There is no build command.

Local Chrome testing:

```text
Load unpacked: C:\C.Nvme\Projects\Ticket-Helper\project
```

Syntax checks:

```powershell
node --check project/background.js
node --check project/content.js
node --check project/popup_ui.js
node --check project/options.js
```

Diff hygiene:

```powershell
git diff --check
```

Git identity guard checks:

```powershell
Get-Content .git-identity
git config user.email
git config core.hooksPath
```

## Important Constraints

- Keep the same repo folder and remote unless the owner explicitly asks otherwise.
- Do not force-push or rewrite history unless explicitly requested and approved.
- Source lives in `project/`; repo root is the AI project frame.
- Release/test zips should include only extension files, folder-wrapped as `TicketHelper/...`.
- Keep root `image.png` committed for external portfolio preview tooling. Chrome testing and release packaging still use `project/image.png`.
- Before committing or pushing, local Git email must match `.git-identity`, and `git config core.hooksPath` must be `.githooks`.
- On each other clone/computer, run once: `git config core.hooksPath .githooks`.
- `TicketHelper.zip` is generated and ignored.
- `local_assets/` is local-only and should not be inspected unless explicitly requested.
- BO automation must avoid showing or copying data from the wrong ticket/chat.
- Action button behavior should be deterministic and should not depend on manually focusing the BO tab first.

## Current Priorities

- Keep BO action buttons reliable.
- Keep current ticket/chat detection and BO tab synchronization correct.
- Preserve release packaging behavior while source now lives in `project/`.
- Keep durable AI docs accurate as the project evolves. Chrome's `_execute_action`, toolbar button, and overlay close button share the TicketHelper work pause/resume action. A fresh install starts paused/off, while a saved preference survives extension updates. The options shortcut rows open Chrome shortcut settings and refresh their displayed values when the config tab returns to view.

## Version 2.0.2

Version 2.0.2 is the current GitHub release. The remaster uses HubSpot Contas Eduzz data when exactly one matching account is available, with a Requerente/Solicitante fallback and BO2 email lookup when needed to recover a document. It keeps four assigned BackOffice tabs across BO1 and BO2: the first BO2-host tab runs Orbita customer search and valid-document counting; the second runs Nutror; the first BO1-host tab runs Faturas; the second runs Contratos. Closing one assigned tab clears only its slot. The launcher recreates only missing slots in their remembered window when it still exists. It also saves a small local preference for the four tabs' window grouping, including tabs placed with the active ticket, and restores that arrangement across Chrome restarts. An assigned tab on another page returns to an action's exact required page when that action is requested. The detailed rules are in `docs/TICKET_AND_DATA_MODEL.md` and `docs/BO_ACTION_MODEL.md`.

## Glossary

- BO: Eduzz BackOffice at `bo.eduzz.com/dashboard`.
- BO1/legacy BO2: first and second `bo.eduzz.com` tab slots from the older action model; currently assigned to Faturas and Contratos.
- BO2 host: the separate `bo2.eduzz.com` service with two assigned tabs, not the legacy BO2 action slot.
- Action tab: a dedicated BO tab assigned to Orbita, Faturas, Nutror, or Contratos.
- BO setup launcher: popup/config control that opens and assigns two BO1-host tabs and two BO2-host tabs in separate right-side windows.
- Current item: latest focused/opened/detected HubSpot ticket or Hyperflow chat.
- Autorun: automatic BO action search triggered after usable doc/email data is gathered.

## Known Pitfalls

- After source migration, load `project/` in Chrome, not the repo root.
- The configured remote may print a GitHub moved-repository message, but do not change it without owner approval.
- Local `dev` and remote `main` may not track the same branch state; inspect before pushing.
- Chrome extension release zips are custom-built, not GitHub source archives.
- BackOffice pages are dynamic and can be slow; avoid relying on a single focus/change event as proof of final result.
