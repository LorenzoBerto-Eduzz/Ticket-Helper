# BackOffice Action Model

This document records the intended behavior for TicketHelper's BackOffice automation. Read it before changing action buttons, BO tab assignments, autoruns, or result reuse.

## Core Model

The extension tracks one current work item: the latest HubSpot ticket or Hyperflow chat that the user actively opened, focused, or switched to.

BackOffice automation must always belong to that current item. It must not show, copy, or reuse data from a previous ticket/chat unless the user has returned to that exact current item and the result still matches its search value.

## Tabs

- BO1: primary account lookup tab. Used for email search, doc discovery, doc search, account count/type, and parceiro detail lookup.
- BO2: default action tab. Used for Faturas by default, and for any action without a dedicated action tab.
- Dedicated action tabs: optional tabs assigned specifically to `orbita`, `faturas`, `nutror`, or `contratos`.

If Faturas, Nutror, or Contratos has a dedicated tab, it should use that tab. Otherwise it falls back to BO2. Orbita is special: if it has no dedicated action tab, its main button focuses BO1 only when BO1 is already assigned instead of falling back to BO2. If BO1 is not assigned, the Orbita main button enters assignment mode for Orbita's own dedicated action tab, never BO1. Its corner control also assigns/focuses a dedicated Orbita action tab.

If Faturas, Nutror, and Contratos all have dedicated action tabs, BO2 is not required for action fallback and the popup should not warn `sem BO2 definida` only because BO2 is empty. Orbita without a dedicated tab uses BO1, not BO2.

## BO Setup Launcher

When no BO tab assignments exist at all, the top reset/redefine control is not useful as a reset button. In that empty state, the same control becomes `Lançar abas definidas` and shows an up-arrow icon instead of the reset icon.

Clicking the launcher should:

1. Create one new focused BO window.
2. Open six `https://bo.eduzz.com/dashboard/home` tabs in this exact order: BO1, BO2, Orbita, Faturas, Nutror, Contratos.
3. Assign the created tab IDs directly to `boTab1Id`, `boTab2Id`, and `boActionTabIds.orbita/faturas/nutror/contratos` by that order.
4. Persist and broadcast BO tab state so all popups, including the options/config popup preview, show the same assigned state.
5. Inject the extension content scripts into the new BO tabs.
6. Resume the existing BO1 restart and action autorun paths for the current ticket/chat when possible, instead of inventing a parallel gather/search flow.

If any BO tab assignment already exists, the same control must remain the normal clear/reset control and must not launch duplicate BO windows. The launcher is a setup convenience, not a search trigger by itself; searches only happen through the normal assignment aftermath and autorun rules.

Implementation note: create and collect the launched tabs sequentially from Chrome callbacks. Use a stable first-tab placeholder, update it to BO, then create the remaining BO tabs in order. Do not rely on a single `chrome.windows.create({ url: [...] })` result or an immediate window tab query to infer all six tabs, because Chrome can report a partial tab list during creation and leave BO1/BO2/action slots unassigned. After assignment, verify that every expected BO1/BO2/action slot has exactly the launched tab ID; if verification fails, clear the partial assignment instead of leaving a mixed state.

## Search Triggers

Only these should start an action search:

1. Autorun after the extension gathers the needed current item value.
2. Direct user click on an action button.

These should not start an action search:

- Focusing a BO tab manually.
- Clicking the small triangle/corner focus control.
- Merely returning to the same ticket/chat when the current item did not change.

When a search does start, it should be the latest requested action for that BO tab. Older queued or injected work for the same tab must be treated as stale and stopped, especially when several actions share BO2.

## Search Values

For Faturas:

- Use valid CPF/CNPJ doc when available.
- Use email for no-doc or invalid/foreign-doc cases when the email is the correct fallback.

For Nutror and Contratos:

- Use valid CPF/CNPJ doc when available.
- Use email for no-doc or invalid/foreign-doc cases when the email is the correct fallback.

For Orbita:

- Use valid CPF/CNPJ doc when available.
- Use email for no-doc or invalid/foreign-doc cases when the email is the correct fallback.
- On a dedicated Orbita tab, use the same MyEduzz/Orbita + Clientes search UI as BO1. Email action-value searches run once and stop. Doc action-value searches use the definitive two-pass pattern.

Valid CPF/CNPJ docs must match the whole value exactly, not only have 11 or 14 digits after non-digits are stripped. Accepted shapes are raw CPF (`00000000000`), formatted CPF (`000X000X000X00`), raw CNPJ (`00000000000000`), or formatted CNPJ (`00X000X000X0000X00`), where each `X` separator is one of `.`, `-`, or `/`. Values with extra suffixes, prefixes, letters, underscores, internal spaces, or separators outside those slots are invalid/foreign-doc cases and must use the email fallback instead of starting the doc account-count search.

The expected value must be tied to the current item/ticket ID and stored result state.

## Complete Result States

Orbita is complete only when:

- BO product tab is Orbita/MyEduzz.
- Search category is Clientes.
- Matching account rows are visible and at least one row contains the current item's search value.
- Stored completed/search-started state is not enough proof for a manual Orbita click; visible row proof must pass or the action should run.
- `Nenhum registro encontrado` is not reusable proof on a later action-button click, because the visible text does not identify the searched value.

Faturas is complete only when:

- BO product tab is Orbita/MyEduzz.
- Search category is Faturas 2.0 / Faturas, not the old screen.
- The faturas result popup is visible.
- The popup contains at least one visible fatura row that matches the current item's search value.
- The popup contains no visible fatura row that clearly belongs to a different search value. For doc searches, compare the buyer `CPF/CNPJ:` value from the Fatura column to the current doc. For email searches, compare the buyer email line from the Fatura column to the current email; do not use the producer/support email in the Produto column as proof.
- Empty or closed faturas popups are not trusted as final, because they do not prove which value produced the result. Clicking Faturas must rerun when the popup is not visible with matching rows.
- Before running a fresh Faturas search, if an existing Faturas popup has any visible buyer row with another doc/email, close it with `Esc` first. This clears BO's occasional stale popup rows from previous searches before the new search result appears.

Nutror is complete only when:

- BO product tab is Nutror.
- Search category is Clientes.
- Matching rows are visible and at least one row contains the current item's search value.
- Stored completed/search-started state is not enough proof for a manual Nutror click; visible row proof must pass or the action should run.
- When rows exist, the first matching Nutror access button should be focused so pressing Enter opens that account. Manual input focus should clear this selection.
- Nutror's Clientes dropdown button may not have `id="menuSearch"`; result/context checks must also find the visible `button[aria-haspopup="true"]` near `#searchField`.
- `Nenhum registro encontrado` is not reusable proof on a later action-button click, because the visible text does not identify the searched value. Clicking Nutror should rerun in that case.

Contratos is complete only when:

- BO product tab is Next.
- Search category is Clientes.
- The action finishes its automatic/background search attempt.
- A user click on Contratos should rerun the action, because the visible result cannot reliably prove which current search value produced it.

Nutror and Contratos searches run twice for definitive row results: the first visible row or the start-prompt state triggers an immediate second search, and the second return is treated as the definitive display.

When Nutror or Contratos must first switch the BO product tab, the injected action should wait for the target section search UI, continue in the same run when possible, ensure Clientes, set `#searchField`, submit, and then run the definitive second search. If the page fully reloads and the script errors, the background runner may retry/reinject.

## Button Click Behavior

When the user clicks Faturas, Nutror, or Contratos:

1. Resolve the action's dedicated tab, or BO2 fallback.
2. If a verified complete result for the current item/value is already displayed, focus the tab and do not rerun.
3. If the tab state is stale, wrong action, wrong product tab, wrong search category, wrong value, missing result, or manually changed by the user, run the action.
4. `Nenhum registro encontrado` is not a verified visible result for button reuse. It should rerun when clicked.
5. A button click must not be blocked by stale `SEARCH_STARTED`, stale completed state, or an old in-flight autorun promise.
6. A button click can focus the BO tab as part of showing the action, but focus alone is not a search trigger.
7. Repeated clicks for the same current item/action/value while a search is already starting should reuse the in-flight run instead of queueing duplicate submissions.
8. When multiple actions share BO2, a new action request for that tab should preempt stale queued work for older actions. Old queued actions must not replay later in a chain.
9. Injected BO action scripts should check the latest in-page action token between steps. If another action becomes current on that BO tab, older scripts must stop as stale instead of continuing with section switches or second searches.
10. Actual BO search submits are protected by a per-page `50ms` minimum gap. This is not meant as a visible delay; it prevents same-breath double submits/rapid stale-action collisions that can blank the BO page.

When the user clicks Orbita:

- If Orbita has no dedicated action tab and BO1 is already assigned, focus BO1 just like a BO1 shortcut.
- If Orbita has no dedicated action tab and BO1 is not assigned, the main Orbita button should enter assignment mode for Orbita's own dedicated action tab. It must not arm or redefine BO1.
- If the user clicks Orbita's corner control while no dedicated Orbita tab exists, arm/assign a dedicated Orbita action tab.
- If Orbita has a dedicated action tab, run/reuse the dedicated Orbita search using the current action value and visible result proof.

Before running a manual action after focusing its target BO tab, the background should verify/retry that the tab is awake/injectable. This prevents first-click misses when Chrome has left a BO tab idle/discarded or has not finished reactivating it.

Manual action messages should include enough current-item data for the background to recover the process context after an MV3 service-worker restart. If in-memory `processes` is missing but the message matches the session cache/current tab data, rebuild the process instead of requiring the user to refocus the ticket/chat before clicking again.

## Autorun Behavior

Autorun should happen after the current item gets the usable doc/email search value. Autorun should be conservative and deduped, but should eventually mark the tab state as complete only when a final result is visible.

Autorun must not steal focus merely because a tab is assigned.

Faturas autoruns on its dedicated action tab when one is assigned. BO2 also keeps the default Faturas autorun copy when BO2 is a different assigned tab.

Orbita autoruns only when it has its own dedicated action tab. Without a dedicated Orbita tab, BO1 already owns the primary account lookup and the Orbita button is a BO1 focus shortcut.

When a new current item or a new manual action request targets the same BO tab, it should cancel/disregard previous action operations for that tab and use the latest current item/search value.

For no-doc or invalid/foreign-doc account cases, action searches should use the current email value. For normal doc cases, action searches should start as soon as the valid doc is known, while BO1 continues/finishes its own definitive account summary.

## BO1 Doc Search

BO1 account lookup has one definitive doc-search owner: the injected BO1 doc-search script.

The expected flow is:

1. Search once with the current CPF/CNPJ.
2. As soon as account rows or a start-prompt state appears, trigger the second definitive doc search.
3. When the second result is visible/stable, update the popup/cache `contas` row immediately.

Before BO1 email/doc lookup starts, it should dismiss any visible Faturas result popup left on the BO page. The Faturas popup can otherwise sit over BO1 and make the account lookup harder to read or interact with.

The background layer should not add another "second pass" after receiving a `FOUND` doc result. Extra background doc reruns can delay `contas` and cause duplicate doc searches.

## Triangle / Focus Controls

The small triangle/corner on action buttons is only for focusing the dedicated action tab. It must not run a search.

If an action has no dedicated tab, the normal action result uses BO2 fallback. The triangle should indicate only dedicated-tab focus behavior.

## Manual BO Tab Searches

The user may manually search other emails/docs in a defined BO tab. After that, the next action button click must compare the current BO tab context with the current ticket value. If the tab no longer matches the current item, rerun the action.

## Faturas Producer And Date Warnings

The options page stores configurable seller/producer warning rules in `chrome.storage.local` as `producerWarningRules`.

The content script also runs on `bo.eduzz.com`, but BO pages should only start the lightweight producer-warning watcher. They must not start ticket popup/extraction logic there.

The watcher should:

- Do no meaningful work unless a Faturas popup/table is present.
- Be idempotently injected into already-open BO tabs on install/update/startup/enable, so users do not need to refresh BO pages after installing or updating the extension.
- Detect the Faturas popup by stable text/table structure such as `Status da fatura:`, `Fatura`, `Produto`, and `Valor`.
- Scan only visible Faturas rows in that popup.
- Read the seller/producer name from the Produto column and match by normalized exact string.
- Insert a fixed light-red overlay below the seller email line inside the Faturas popup root, not an in-row element, so warning UI does not change table spacing.
- Read `Recebimento: dd/mm/yyyy` from the Valor column and calculate days elapsed using local calendar dates. Detection should be tolerant of BO markup changes inside the Valor cell, not only direct `p` children. If `Recebimento` is absent, do not show a date warning because the purchase has not been received/paid.
- Date warnings align horizontally below the date text itself, not below the `Recebimento:` label, and align vertically below the `Reembolso até` row. Show `Hoje`, `1 dia` through `7 dias` as light green, show `8 dias` through `180 dias` as the lighter red overlay, and show anything older as `180+ dias` with that same red style.
- Warning overlays are fixed-position nodes appended inside the Faturas popup root. This keeps them above Faturas rows without turning them into page-global top-layer UI; BO dialogs, menus, or popups that appear above Faturas should also cover TicketHelper warnings.
- Clamp the overlay text to two lines with ellipsis, expand to the full warning on hover, and keep the text selectable/copyable with normal text cursor behavior.
- Avoid rewriting or repositioning the overlay while the user is actively selecting its text, otherwise text selection can flicker or reset.
- Debounce mutation scans, avoid duplicate warning nodes, and keep a low-frequency self-healing rescan only while a Faturas popup exists.

## Known Fragility

BO pages are dynamic. Avoid assuming that one focus event or one immediate DOM check proves a result is final. Prefer explicit helpers that verify product tab, search category, input/current value, and visible rows/popup/no-result text.
