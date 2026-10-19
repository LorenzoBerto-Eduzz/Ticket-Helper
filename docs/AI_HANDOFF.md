# AI Handoff

This file is the portable continuity note for AI coding sessions working on TicketHelper. Keep it short and current; do not turn it into a changelog.

## Current State

- Project name: `TicketHelper`.
- Project kind: Chrome Manifest V3 extension.
- Main source folder: `project/`.
- Manifest: `project/manifest.json`.
- Current extension version: `1.9.17`.
- Primary language/stack: plain JavaScript, HTML, CSS, Chrome extension APIs.
- Run command: none. Load unpacked extension from `project/` in Chrome.
- Test commands:

```powershell
node --check project/background.js
node --check project/content.js
node --check project/popup_ui.js
node --check project/options.js
```

- Configured remote: `https://github.com/LorenzoBerto-Eduzz/Ticket-Helper.git`.
- Keep the same repo path, `.git`, and remote unless the owner explicitly asks for a change.
- The repo uses an AI-ready frame. Source code is in `project/`; durable memory and workflow docs are in `docs/`.
- Root `image.png` is intentionally tracked as the public repo/portfolio preview image. It duplicates `project/image.png`; keep both unless the owner asks otherwise.
- Git identity guard is enabled through `.git-identity` and `.githooks/`. It is email-based: before commit/push, local `git config user.email` must match `.git-identity`, and `git config core.hooksPath` must be `.githooks`. `user.name` may vary by device and is not checked.

## Product Summary

TicketHelper assists support work across HubSpot Help Desk tickets, Hyperflow chats, and Eduzz BackOffice. It displays a floating popup with ticket/chat data and copy shortcuts, with BO setup managed by the launcher control.

## Important Behavior To Preserve

- Version `1.9.17` is the current release candidate. It preserves the compact five-value popup, session-only ticket state/history, strict current-ticket ownership, the HubSpot `Contas Eduzz` extraction flow, and four assigned BackOffice work tabs with per-tab recovery. The Chrome toolbar action and `_execute_action` remain the pause/resume control. BO action buttons and all BO searches are temporarily paused. Version `2.0.0` remains reserved until the owner declares the remaster ready.
- The current work item is the latest focused/opened ticket or chat detected by the extension.
- BO1 is the primary account lookup tab.
- BO2 is the default action tab unless an action has its own dedicated tab.
- When a required work tab is missing, the popup/config control launches only the missing slot(s): `https://bo.eduzz.com/dashboard/home` for the two BO1 slots and `https://bo2.eduzz.com/` for the two BO2-host slots. Existing assigned tabs are preserved. Each slot remembers its latest window ID; a missing tab returns to that window if it still exists, or missing tabs formerly together are grouped in one replacement window. Tabs with no saved window use the default BO1 upper / BO2 lower window grouping. All four are reserved for later TicketHelper work; individual search/action roles are not assigned yet. The existing clear/reset control remains when all four are assigned.
- The following BO action/search rules describe the older paused implementation. The four newly launched tabs have no per-action roles yet, and BO2 in legacy action names means the second BO1-host tab, not `bo2.eduzz.com`.
- Orbita is the first action button. Without a dedicated Orbita tab, clicking the main button focuses BO1 only when BO1 is already assigned; if BO1 is not assigned, the main button enters assignment mode for Orbita's own dedicated action tab, never BO1. Its corner control assigns/focuses a dedicated Orbita action tab and shows the small triangle when that dedicated tab exists. With a dedicated Orbita action tab, it autoruns the same Orbita/MyEduzz Clientes lookup pattern as BO1 for the current action value.
- Faturas defaults to BO2 unless it has its own dedicated action tab.
- Orbita, Nutror, and Contratos can have dedicated action tabs.
- Autoruns happen when the extension gathers a usable CPF/CNPJ/doc value, or email when the account has no doc / invalid-foreign doc cases require email.
- Action button clicks should either focus an already verified visible result for the current item/value or run the action. They should not be blocked by stale `SEARCH_STARTED`, stale completed state, or stale in-flight autorun state.
- Before a manual action runs after focusing its BO tab, the background waits/retries for the BO tab to be awake/injectable. This avoids first-click misses when Chrome has left the BO tab idle/discarded or just refocused. Manual action messages also carry enough current-item data for the background to rebuild the in-memory process after an MV3 service-worker restart; do not regress to requiring the user to refocus the ticket just because `processes` was lost.
- Repeated clicks for the same current item/action/value should reuse the in-flight action instead of queueing duplicate searches.
- In the older three-tab action workflow, dedicated Faturas and Contratos tabs removed the need for the legacy BO2 action tab. Revisit this rule when assigning roles to the current four tabs.
- Triangle/corner action-tab buttons are focus controls only. Focusing a defined tab should not start a search.
- BO action result proof must be value-aware. Rows/popups from a previous manual search or previous ticket/chat are stale unless they visibly match the current item's search value. Text-only no-result states are not reusable button-click proof.
- Faturas empty popup is not a trusted final state. `Nenhum registro encontrado` is not reusable button-click proof because the visible text does not identify the search value; clicking the action should rerun in that case.
- BO1 doc lookup is owned by the injected doc-search script: it runs the first doc search, immediately runs the definitive second doc search after the first row return, and then updates `contas`. Background code should not start another doc-search pair before applying that definitive result.
- Nutror/Contratos action tabs must continue inside the same injected action after switching the BO product tab to Nutror/Next whenever the search UI remains available. After section selection, they must ensure Clientes, set `#searchField`, submit, and run the definitive second search.
- Orbita and Nutror action reuse are value-proofed from visible Clientes result rows containing the current action value. Stored completed state is not enough proof for a manual click.
- Nutror's Clientes dropdown button may not have `id="menuSearch"`, so checks must locate the visible `button[aria-haspopup="true"]` near `#searchField`.
- Contratos should rerun on click because its visible result cannot reliably prove the current search value.
- Faturas reuse requires a visible faturas popup with matching buyer rows and no visible buyer row that clearly belongs to another search. For doc searches, compare each visible row's buyer `CPF/CNPJ:` value to the current doc. For email searches, compare the buyer email in the Fatura column, not the producer/support email in the Produto column. If any visible row clearly has another doc/email, close the stale popup with `Esc` before running the fresh search. If the popup was closed, clicking Faturas must rerun.
- When actions share BO2, the latest manual/auto action for that BO tab must preempt stale queued work and stale injected scripts. Do not let old Orbita/Faturas/Nutror/Contratos clicks replay later as a chain.
- BO action scripts use a tiny per-page submit gate (`50ms`) before real BO search submissions. This is intentionally small: it prevents near-simultaneous submits that can blank/overload BO while keeping action clicks feeling immediate.
- Hyperflow chat detection covers `/chats/<chat_id>`, `/all-chats/<chat_id>`, and `/all-chats/all` right-side drawer previews. Direct routes may detect the protocol from the URL immediately, but email extraction must only accept an `E-mail:` value from a DOM root that contains the same expected `span.chat-protocol`; do not accept stale email values from the previous chat while Hyperflow is still swapping DOM.
- HubSpot ticket ID is shown immediately from the focused ticket URL. The current gathering step ignores the header contact and Requerente card for values. Name, email, and doc show loading while the matching ticket's Details sidebar is prepared. Read only the `Contas Eduzz (N)` card: confirmed N=0 displays `Ticket sem conta <` in Email; N>1 displays `N contas atreladas <` in Email; N=1 reads Razão Social, E-mail, and CPF/CNPJ from its single account tile. A blank or dash-only CPF/CNPJ value for that one account means `Conta sem doc. <` in Document. A nonempty value not matching the exact CPF/CNPJ digit and separator patterns displays `Doc. Estrang./Inválido <`. Status values retain their internal leading `>` marker for non-copy behavior, but the popup omits that marker and appends ` <` for all such statuses. Format validation checks 11-digit CPF or 14-digit CNPJ shapes, with optional `.`, `/`, or `-` separators in the expected positions; it does not verify check digits. End-state values are display-only and cannot be clicked, copied, or underlined. An absent or still loading card is not classified as zero accounts. Other missing fields become `-`. The Contas popup row stays `-` for now. This sidebar result ends the gathering step; other cases and searches will be aligned later.
- HubSpot sidebar gathering: require the current ticket header to match the URL ID, select the visible Details tab, and wait until the first About card is ready. Reuse an already visible sidebar shell and wait for its inner panel to mount; click the sidebar toggle only when the shell is absent and HubSpot explicitly indicates it is collapsed. As soon as the first About card has opened, find Contas Eduzz by title and target its existing *-loading placeholder with native scrollIntoView (or its card if there is no placeholder). The account watcher expands Contas whenever collapsed and reads its values. A card-scoped MutationObserver detects its count/tile immediately; the sidebar returns to the top as soon as the account tile is ready, with a 300 ms fallback check while loading. Do not traverse Requerente in this current gathering step; it can use the same card helper later. Capture the scrollable ancestors that move, then restore the sidebar ancestors to the top and outer ancestors to their original positions. This replaces the ineffective fast bottom/top sweep. Account values are read only from Contas Eduzz; Requerente is deferred to later steps. The account watcher observes only the visible sidebar (rebinding if HubSpot replaces it), remains active for late data, and rejects stale tickets. The account result is acknowledged by the background process; a transient missing response is retried for the same process only. Live Chrome verification is still needed.
- When the matching ticket's Details tab mounts the Contas Eduzz card, TicketHelper visually pins that card above the other Details cards using a scoped extension stylesheet. This is reapplied when HubSpot replaces the card on another ticket and removed when TicketHelper is disabled. It does not change HubSpot's saved card order or reorder React-owned DOM nodes. The existing targeted lazy-load fallback remains available when the card shell has not mounted yet.
- BO1 email lookup must update `email`/`doc` in the popup as soon as values are known. If a valid doc is found, do not finalize `contas` from the email-search row; proceed to the two-pass doc search and use that definitive result.
- A valid doc is not just any value with 11 or 14 digits after cleanup. It must match exactly raw CPF (`00000000000`), formatted CPF (`000X000X000X00`), raw CNPJ (`00000000000000`), or formatted CNPJ (`00X000X000X0000X00`), where each `X` separator is only `.`, `-`, or `/`. Extra letters, underscores, suffixes, prefixes, spaces inside the value, or separators in other positions make it an invalid/foreign-doc case and must not start doc-based account counting.
- BO1 email/doc searches should dismiss any lingering Faturas result popup before selecting Orbita/MyEduzz Clientes and submitting.
- Default Chrome command copy shortcuts: `Alt+1` ticket/chat ID, `Alt+2` doc, `Alt+3` email, `Alt+4` first/name. `copy-bo1-masked-emails` is an additional Chrome command with no suggested default; assign/edit it in Chrome's extension shortcut settings from its options shortcut row. It reads visible BO1 Clientes result rows, copies one masked email per row, and masks by keeping the first 3 characters, replacing characters 4-5 with `***`, then keeping the rest. Copy shortcuts work across browser tabs only while TicketHelper work is active.
- The options shortcut rows read Chrome command values with `chrome.commands.getAll()` and refresh when the options page regains focus or becomes visible after returning from Chrome's shortcut settings, so users do not need to reload the config page.
- Performance/reliability guard: the content route observer ignores the extension popup's own DOM mutations and avoids repeated ticket DOM scans in unfocused tabs. Mutation-driven checks are coalesced while a 700ms poll remains as a route fallback. Popup value fitting caches unchanged text/width and does not schedule endless animation frames while hidden. Copy commands use the background's hydrated session state on the normal path, recover on service-worker wake, and reject live/cached data belonging to another URL ticket ID. Preserve these safeguards when changing detection or shortcuts; browser profiling and live workflow checks are still needed.
- Chrome's built-in `_execute_action` shortcut and the toolbar icon are the single TicketHelper pause/resume control. The config row `Ativar / Desativar TicketHelper` maps to that same action. The overlay X also pauses work. Pausing hides the overlay, stops gathering/searches and user shortcuts, tears down page observers and leaves the latest ticket's known fields in the session cache. It captures that ticket tab's address in `chrome.storage.session`; paused mode does no tab polling or page monitoring. On resume, only the currently focused tab is checked. If it is a supported ticket page at the same address, the matching cache is restored and gathering continues for missing fields. A different ticket address discards the old cache and starts fresh; if the focused tab is not a ticket page, current-ticket state is cleared. Ticket fields, ticket history, and the paused address use `chrome.storage.session`, which is memory-only and cleared when Chrome restarts or the extension is disabled/reloaded/updated. Persistent local storage is for settings and overlay positions, not ticket/customer data. There is no separate overlay toggle. Chrome's own extension enable switch remains controlled by Chrome. A fresh install defaults TicketHelper work to off; an existing saved on/off choice is preserved across extension reloads and updates.
- The extension logo is stored under `project/icons/`: 16, 32, 48, and 128 pixel variants serve Chrome, and `icon512.png` is the full-size master. The same logo is used for the toolbar/extension icon and as the options page favicon and header mark. Options-page details include a dark blue background, HubSpot/Hugme/Hyperflow subtitle, and a download-update button with 14px text. The enabled switch changes without transition when its state changes while the options tab is hidden, then animates normally for changes made while visible.
- Ticket/chat history remains session-only in `chrome.storage.session`. The active item is held separately and enters the most-recent-first history only when switched/exited; keep at most 30 unique `{ kind, id, email }` entries. The popup keeps its five-button header and current ID in place. Below them, the scrollable history lists one clickable row per past item, with email truncated on the left and full ID aligned right. Clicking a row opens that ticket/chat in a new inactive tab; clicking outside, blurring, or hiding the popup closes history. HubSpot history URLs use the session's `hubspotPortalId` and `/view/search/ticket/<ticketId>`; Hyperflow uses `/all-chats/<protocol>`.
- BackOffice searches, including action searches, remain paused during the sidebar gathering remaster. The four work-tab assignments are session-only; launching them does not start BO searches.
- See `docs/BO_ACTION_MODEL.md` before changing BO action behavior.

## V2 Stabilization Status

Version 1.9.17 continues hardening the extension before new integrations. Version 2.0.0 is reserved until the owner declares the remaster ready. Current-item handling, HubSpot sidebar extraction, and recovery of only missing assigned BO tabs are implemented; live Chrome checks are still needed. See `docs/TICKET_AND_DATA_MODEL.md` and `docs/BO_ACTION_MODEL.md`.

- The most recently focused supported ticket/chat page becomes the current item, including an already-open ticket tab. Navigating the focused tab to a different recognized ticket/chat switches the current item. A ticket opened in a background tab does not take ownership until focused.
- Focusing BackOffice or another non-ticket tab leaves the current item unchanged while its source tab still exists and still shows that ticket. Closing that source tab or navigating it away from its ticket page clears the active ticket and active data to a neutral state; it must not silently fall back to another ticket tab.
- BackOffice assignments are reusable work tabs, independent of any one ticket. Each current-item change clears active fields and starts a fresh process, including a return to a previously visited ticket. Preserve history separately. Process IDs and owner epochs reject delayed extraction, BackOffice, and shortcut data from prior ownership, including rapid A-B-A switching.
- Ticket-page extraction continues while external work tabs are unavailable. All external searches are currently paused regardless of tab readiness. Four distinct session-only tab IDs are assigned: two on `bo.eduzz.com` and two on `bo2.eduzz.com`. Assignments follow tab IDs when the user moves tabs or merges windows; the last window ID is remembered for recovery after closing a tab. Closing a tab clears only that slot; relaunch fills only missing slots and groups tabs that were in the same closed window. Navigating away keeps the assignment; when a later action needs that tab, TicketHelper should take it to that action's exact required URL, wait until it is ready, then continue only for the still-current ticket/process. Avoid redirect loops. No BO action/search should start yet; slot roles and search resumption are pending alignment.
- The floating TicketHelper overlay appears on the sole active HubSpot ticket tab while work is enabled; another open ticket tab cannot show a second copy. When there is no current owner, the focused `https://app.hubspot.com/` non-ticket page may show the neutral (`-`) overlay. It stays hidden on other HubSpot subdomains, Hyperflow, BackOffice, and other Chrome pages. A HubSpot ticket is recognized on `/help-desk/<portal>/view/.../ticket/<ticketId>` routes (or a thread route under that view when the active ticket ID is present in its DOM). Leaving the owning ticket page clears the current item and its displayed values. Background commands and current-ticket coordination remain browser-wide while work is enabled. The overlay's saved HubSpot position is applied before it becomes visible, shared across open HubSpot app tabs through `chrome.storage.local`, and clamped/saved when a focused tab has a smaller viewport. Live Chrome verification remains needed for focus/navigation edge cases, four-tab recovery, position sync across tabs/windows, and the additional Chrome command on the target Chrome version.

## Packaging And Loading

Local development install:

```text
C:\C.Nvme\Projects\Ticket-Helper\project
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
6. Verify Git identity guard before gitcheck/commit/push:

```powershell
Get-Content .git-identity
git config user.email
git config core.hooksPath
```

7. On a fresh clone or different computer, run once: `git config core.hooksPath .githooks`.
8. Inspect `project/` files before editing.
9. Ask before major structure, release, branch, or workflow changes.
