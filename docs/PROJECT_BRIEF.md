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
- Move through rendered HubSpot list-view tickets with the manual `Abrir Próximo Ticket` command in the focused tab.

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
node --check project/faturas_age_badge.js
node --check project/producer_notes_options.js
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

## Version 2.0.8

Version 2.0.8 adds a fifth, optional BO2 Contact Center tab for manual `Verificar Bounce`, placed next to Orbita and identified by a query marker so the sent-emails pagination fragment survives. It is outside the four required launcher slots. Faturas now sets the page's private pagination state to 100 before the first search and checks the request when observable; an inability to confirm 100 shows a `4!` badge and a short red notice. All first 100 visible invoice rows have clickable selection markers, with shortcuts on rows 1–4. An Order Bump selection colors adjacent rows with the same invoice ID.

Selected-invoice actions add refund-receipt download and sequential manual content delivery. Manual delivery uses the active ticket's cached email, verifies each selected product row, and reports the completed count. A four-second notice queue follows the focused supported tab; errors also produce coded extension diagnostics without customer data. Nutror's explicit client-search error after five seconds triggers one refresh of the two required BO2 tabs, an Orbita rerun that keeps completed popup data visible, and one Nutror retry. Normal empty Nutror results do not refresh BO2. See `docs/BO_ACTION_MODEL.md` for selectors, guards, and retry behavior. These third-party page flows require live Chrome verification after BackOffice changes.

The key source locations are `project/background.js` for BO orchestration, result checks, notices, and Chrome commands; `project/faturas_age_badge.js` and `.css` for invoice markers, age badges, exclusion dates, and producer notices; `project/options.html`/`.js` for shortcut suggestions and configuration; and `project/content.js`/`popup_ui.js` for ticket detection and the HubSpot popup. `docs/TICKET_AND_DATA_MODEL.md` records ticket ownership and session snapshots. Test with `node --test tests/*.test.js`, the syntax checks above, and `git diff --check`. Load `project/` for development; export its contents into root `TicketHelper/` and zip that folder for GitHub releases. Release descriptions contain only the version tag.

## Version 2.0.7

Version 2.0.7 retained the HubSpot Contas Eduzz and Requerente/Solicitante data paths and four assigned BackOffice tabs. Faturas uses `/dashboard/reembolso`, including its date badge, and can reuse a matching visible result after the input clears. The manual `Abrir Próximo Ticket` action clicks the next preview in the same HubSpot list-view tab. When the open preview is outside the rendered list, it starts at the first row; at the end of the list it does nothing. Ticket data status does not block the action. BackOffice tab recovery on activation adopts marked tabs; the launcher opens only missing slots according to the saved window grouping. The detailed data and action rules are in `docs/TICKET_AND_DATA_MODEL.md`, `docs/BO_ACTION_MODEL.md`, and `docs/AI_HANDOFF.md`.

The Faturas popup retains four invoice-selection shortcuts, highlighted-ID selection, producer/product/support clipboard actions, invoice detail menu actions, and the multi-installment exclusion-date button. Version 2.0.6 adds producer notices saved by normalized full producer name in the Chrome profile. Notices appear on matching invoices and can be created, edited, or removed in the live options-page list below Version. An empty note keeps the producer entry and shows `+ Aviso`; clearing its name deletes the entry. The purchase-age badge has green, warm yellow, and red ranges. Shortcut planning remains documented without assigning default keys.

Version 2.0.7 adds a live shortcut key map and suggestion labels without assigning default keys. The options tab identifies pressed shortcuts by outlining and scrolling to their rows; only the work toggle also runs. Chrome and config action order now match, with five renamed invoice command IDs requiring reassignment. Faturas content scripts stop after their extension context is invalidated during reload.

The amended 2.0.7 source keeps a separate session snapshot for every still-open ticket tab. Returning to a tab restores its completed values, selected invoice, and invoice-search mode; closing or leaving the ticket page removes that snapshot, including while work is paused. Only the last-focused ticket controls shortcuts and BO searches. Invoice and content detail shortcuts use Alt+1 and Alt+2 recommendations respectively, and invoice detail closes a visible content detail panel before opening. Selected-invoice support email copies in lowercase, while producer and product names retain title case. `tests/ticket_session_ownership.test.js` checks A-B-A ownership, restoration, and cleanup.

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
