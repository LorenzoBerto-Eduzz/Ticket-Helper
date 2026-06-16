# AI Handoff

This file is the portable continuity note for AI coding sessions working on TicketHelper. Keep it short and current; do not turn it into a changelog.

## Current State

- Project name: `TicketHelper`.
- Project kind: Chrome Manifest V3 extension.
- Main source folder: `project/`.
- Manifest: `project/manifest.json`.
- Current extension version: `1.9`.
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
- Root `image.png` is intentionally tracked as the public repo/portfolio preview image. It duplicates `project/image.png`; keep both unless the owner asks otherwise.

## Product Summary

TicketHelper assists support work across HubSpot Help Desk tickets, Hyperflow chats, and Eduzz BackOffice. It displays a floating popup with ticket/chat data, copy shortcuts, BO tab assignment buttons, and action buttons for searches such as Faturas, Nutror, and Contratos.

## Important Behavior To Preserve

- Version `1.9` is the stabilization release for fast ticket/chat extraction, BO1 doc lookup, and deterministic BO action routing.
- The current work item is the latest focused/opened ticket or chat detected by the extension.
- BO1 is the primary account lookup tab.
- BO2 is the default action tab unless an action has its own dedicated tab.
- Faturas defaults to BO2 unless it has its own dedicated action tab.
- Nutror and Contratos can have dedicated action tabs.
- Autoruns happen when the extension gathers a usable CPF/CNPJ/doc value, or email when the account has no doc / invalid-foreign doc cases require email.
- Action button clicks should either focus an already verified result for the current item/value or run the action. They should not be blocked by stale `SEARCH_STARTED` or stale in-flight autorun state.
- Repeated clicks for the same current item/action/value should reuse the in-flight action instead of queueing duplicate searches.
- Triangle/corner action-tab buttons are focus controls only. Focusing a defined tab should not start a search.
- BO action result proof must be value-aware. Rows/popups from a previous manual search or previous ticket/chat are stale unless they visibly match the current item's search value. Text-only no-result states are not reusable button-click proof.
- Faturas empty popup is not a trusted final state. `Nenhum registro encontrado` is not reusable button-click proof because the visible text does not identify the search value; clicking the action should rerun in that case.
- BO1 doc lookup is owned by the injected doc-search script: it runs the first doc search, immediately runs the definitive second doc search after the first row return, and then updates `contas`. Background code should not start another doc-search pair before applying that definitive result.
- Nutror/Contratos action tabs must continue inside the same injected action after switching the BO product tab to Nutror/Next whenever the search UI remains available. After section selection, they must ensure Clientes, set `#searchField`, submit, and run the definitive second search.
- Nutror action reuse is value-proofed from visible result rows. Its Clientes dropdown button may not have `id="menuSearch"`, so checks must locate the visible `button[aria-haspopup="true"]` near `#searchField`.
- Contratos should rerun on click because its visible result cannot reliably prove the current search value.
- Faturas reuse requires a visible faturas popup with matching rows. If the popup was closed, clicking Faturas must rerun.
- When actions share BO2, the latest manual/auto action for that BO tab must preempt stale queued work and stale injected scripts. Do not let old Faturas/Nutror/Contratos clicks replay later as a chain.
- BO action scripts use a tiny per-page submit gate (`50ms`) before real BO search submissions. This is intentionally small: it prevents near-simultaneous submits that can blank/overload BO while keeping action clicks feeling immediate.
- Hyperflow chat detection covers `/chats/<chat_id>`, `/all-chats/<chat_id>`, and `/all-chats/all` right-side drawer previews. Direct routes should use the protocol from the URL first; drawer previews should use the active visible drawer's `span.chat-protocol` and `E-mail:` value.
- HubSpot email extraction is optimized to check the header contact value first, then match loaded composer contact labels by name for hover tooltip email, then fall back to the requester card email.
- BO1 email lookup must update `email`/`doc` in the popup as soon as values are known. If a valid doc is found, do not finalize `contas` from the email-search row; proceed to the two-pass doc search and use that definitive result.
- BO1 email/doc searches should dismiss any lingering Faturas result popup before selecting Orbita/MyEduzz Clientes and submitting.
- Default copy shortcuts are inverted for speed: `Alt+1` doc, `Alt+2` email, `Alt+3` first/name, `Alt+4` ticket/chat ID.
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

Root `image.png` is not part of Chrome load-unpacked testing, but it should remain committed at repo root for external portfolio/repository preview tooling.

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
