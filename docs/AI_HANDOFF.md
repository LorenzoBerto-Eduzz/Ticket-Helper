# AI Handoff

This file is the portable continuity note for AI coding sessions working on TicketHelper. Keep it short and current; do not turn it into a changelog.

## Current State

- Project name: `TicketHelper`.
- Project kind: Chrome Manifest V3 extension.
- Main source folder: `project/`.
- Manifest: `project/manifest.json`.
- Current extension version: `1.9.7`.
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
- Git identity guard is enabled through `.git-identity` and `.githooks/`. It is email-based: before commit/push, local `git config user.email` must match `.git-identity`, and `git config core.hooksPath` must be `.githooks`. `user.name` may vary by device and is not checked.

## Product Summary

TicketHelper assists support work across HubSpot Help Desk tickets, Hyperflow chats, and Eduzz BackOffice. It displays a floating popup with ticket/chat data, copy shortcuts, BO tab assignment buttons, and action buttons for searches such as Orbita, Faturas, Nutror, and Contratos.

## Important Behavior To Preserve

- Version `1.9.7` builds on the `1.9` stabilization model, the `1.9.1` HubSpot email-gather reliability work, the `1.9.2` producer warnings, the `1.9.4`/`1.9.5` internal shortcut/config UI work, the session-only Historico popup/history navigation UI, the masked BO1 email internal shortcut, and the Orbita action button/action-tab behavior.
- The current work item is the latest focused/opened ticket or chat detected by the extension.
- BO1 is the primary account lookup tab.
- BO2 is the default action tab unless an action has its own dedicated tab.
- Orbita is the first action button. Without a dedicated Orbita tab, clicking the main button focuses BO1 only when BO1 is already assigned; if BO1 is not assigned, the main button enters assignment mode for Orbita's own dedicated action tab, never BO1. Its corner control assigns/focuses a dedicated Orbita action tab and shows the small triangle when that dedicated tab exists. With a dedicated Orbita action tab, it autoruns the same Orbita/MyEduzz Clientes lookup pattern as BO1 for the current action value.
- Faturas defaults to BO2 unless it has its own dedicated action tab.
- Orbita, Nutror, and Contratos can have dedicated action tabs.
- Autoruns happen when the extension gathers a usable CPF/CNPJ/doc value, or email when the account has no doc / invalid-foreign doc cases require email.
- Action button clicks should either focus an already verified result for the current item/value or run the action. They should not be blocked by stale `SEARCH_STARTED` or stale in-flight autorun state.
- Before a manual action runs after focusing its BO tab, the background waits briefly for the BO tab to be awake/injectable. This avoids first-click misses when Chrome has left the BO tab idle/discarded or just refocused.
- Repeated clicks for the same current item/action/value should reuse the in-flight action instead of queueing duplicate searches.
- If Faturas, Nutror, and Contratos all have dedicated action tabs, BO2 is no longer required for action fallback and the popup should not warn `sem BO2 definida` just because BO2 is empty. Orbita without a dedicated action tab uses BO1, not BO2.
- Triangle/corner action-tab buttons are focus controls only. Focusing a defined tab should not start a search.
- BO action result proof must be value-aware. Rows/popups from a previous manual search or previous ticket/chat are stale unless they visibly match the current item's search value. Text-only no-result states are not reusable button-click proof.
- Faturas empty popup is not a trusted final state. `Nenhum registro encontrado` is not reusable button-click proof because the visible text does not identify the search value; clicking the action should rerun in that case.
- BO1 doc lookup is owned by the injected doc-search script: it runs the first doc search, immediately runs the definitive second doc search after the first row return, and then updates `contas`. Background code should not start another doc-search pair before applying that definitive result.
- Nutror/Contratos action tabs must continue inside the same injected action after switching the BO product tab to Nutror/Next whenever the search UI remains available. After section selection, they must ensure Clientes, set `#searchField`, submit, and run the definitive second search.
- Nutror action reuse is value-proofed from visible result rows. Its Clientes dropdown button may not have `id="menuSearch"`, so checks must locate the visible `button[aria-haspopup="true"]` near `#searchField`.
- Contratos should rerun on click because its visible result cannot reliably prove the current search value.
- Faturas reuse requires a visible faturas popup with matching rows. If the popup was closed, clicking Faturas must rerun.
- When actions share BO2, the latest manual/auto action for that BO tab must preempt stale queued work and stale injected scripts. Do not let old Orbita/Faturas/Nutror/Contratos clicks replay later as a chain.
- BO action scripts use a tiny per-page submit gate (`50ms`) before real BO search submissions. This is intentionally small: it prevents near-simultaneous submits that can blank/overload BO while keeping action clicks feeling immediate.
- Hyperflow chat detection covers `/chats/<chat_id>`, `/all-chats/<chat_id>`, and `/all-chats/all` right-side drawer previews. Direct routes may detect the protocol from the URL immediately, but email extraction must only accept an `E-mail:` value from a DOM root that contains the same expected `span.chat-protocol`; do not accept stale email values from the previous chat while Hyperflow is still swapping DOM.
- HubSpot ticket email extraction order is strict and scoped to the active ticket panel/root first, because list-view pages can keep many unrelated ticket/contact fragments in the DOM. First check the active header contact value; if it is already an email, update popup/cache immediately. If HubSpot shows `+ Add Contact` in the header or `Requerente (0)`/`Requester (0)`, treat the ticket as `> Ticket sem email` immediately. If the header is a name, compare composer contact labels in the same active root immediately; hover the matching label immediately for the tooltip email. If there are no labels, or visible labels are already names and none match the header name, fall through to Requerente/Requester immediately instead of waiting. Only labels that are still transient email strings get a tiny transition window before fallback. Requerente/Requester is pre-expanded in the background and, if HubSpot withholds the off-screen email node, the fallback does a very fast bottom-scroll/read/top-scroll mount pass; keep this last-resort pass as fast/imperceptible as possible. The `> Ticket sem email` state is only valid after these no-contact markers or all retries fail.
- BO1 email lookup must update `email`/`doc` in the popup as soon as values are known. If a valid doc is found, do not finalize `contas` from the email-search row; proceed to the two-pass doc search and use that definitive result.
- BO1 email/doc searches should dismiss any lingering Faturas result popup before selecting Orbita/MyEduzz Clientes and submitting.
- Default Chrome command copy shortcuts: `Alt+1` ticket/chat ID, `Alt+2` doc, `Alt+3` email, `Alt+4` first/name. Chrome only allows four default suggested command shortcuts, so extra shortcuts use TicketHelper internal page-level handling and are stored in `chrome.storage.local` as `internalShortcuts` using action-to-key entries. Internal shortcuts have no default keybind; the options page shows `Adicionar` until the user defines one. The current internal shortcut action is `copy-bo1-masked-emails`, which reads visible BO1 Clientes result rows, copies one masked email per row, and masks by keeping the first 3 characters, replacing characters 4-5 with `***`, then keeping the rest. Internal shortcuts run on supported pages while the extension is enabled, including when normal page input fields are focused.
- Ticket/chat history: `background.js` keeps a session-only history in `chrome.storage.session`, not `chrome.storage.local`. The active ticket/chat is held as an active candidate and finalized into history only when the user switches/exits, so the Historico popup lists previous items and not the current item. Keep at most 30 unique entries, dedupe by ticket/chat ID, and move repeats to the top. History entries store `{ kind, id, name }`; `kind` is `hubspot` or `hyperflow`. The HubSpot portal/account ID is stored once in session as `hubspotPortalId` and updated from HubSpot URLs. Opening a HubSpot history row builds `https://app.hubspot.com/help-desk/<hubspotPortalId>/view/search/ticket/<ticketId>`; opening a Hyperflow row builds `https://conversas.hyperflow.global/all-chats/<protocol>`. The display name is first-name from gathered name, else email, else `-`.
- Producer/date warnings: the options page has `Avisos de produtores` stored in `chrome.storage.local` under `producerWarningRules`. Each producer rule has a normalized unique producer/seller string and warning text. `content.js` also runs on `bo.eduzz.com` and starts only a lightweight Faturas popup watcher there; it scans visible Faturas rows only when the popup/table exists. On extension install/update/startup/enable, the background script idempotently injects the content scripts into already-open BO tabs so warnings can appear without requiring a manual BO refresh. Producer warnings match the seller name in the Produto column by normalized exact match and insert a body-level fixed light-red overlay below the seller email line. Date warnings require `Recebimento: dd/mm/yyyy`; if that line is absent because the purchase was not received/paid, show no date warning. When present, read it from the Valor cell with tolerant `p`/`span`/`div`/cell-text fallback, align horizontally under that date text, and align vertically below the `Reembolso atÃ©` line. Date warning colors: `Hoje`, `1 dia` through `7 dias` use the light-green overlay, `8 dias` through `60 dias` use the standard slightly-stronger light-red overlay, and `61+ dias` uses that same red overlay. These overlays must not affect table/popup layout. They are fixed-position nodes appended inside the active Faturas popup root so they stay over the Faturas rows but remain in the Faturas popup stacking context; BO UI that appears above Faturas should also appear above TicketHelper warnings. They clamp to two lines with ellipsis, expand on hover, and must keep normal text-selection behavior (`cursor: text`, selectable text) so users can copy warning text. Do not rewrite/reposition an existing overlay while the user is actively selecting text inside it. The watcher uses MutationObserver plus a low-frequency self-healing rescan only while a Faturas popup is present, so old-date warnings should be recreated if BO rerenders rows. Keep this BO watcher isolated from ticket extraction/popup logic and debounced to avoid BO performance issues.
- If no email is found after all retries, show `> Ticket sem email` in the email row only; the doc/accounts rows should stop as `-`.
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
6. Verify Git identity guard before gitcheck/gitcheckpoint/commit/push:

```powershell
Get-Content .git-identity
git config user.email
git config core.hooksPath
```

7. On a fresh clone or different computer, run once: `git config core.hooksPath .githooks`.
8. Inspect `project/` files before editing.
9. Ask before major structure, release, branch, or workflow changes.
