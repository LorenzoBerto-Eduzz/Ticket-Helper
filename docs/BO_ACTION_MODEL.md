# BackOffice Action Model

This document records the intended behavior for TicketHelper's BackOffice automation. Read it before changing action buttons, BO tab assignments, autoruns, or result reuse.

For the current HubSpot Details sidebar remaster step, all BackOffice searches and action searches are temporarily paused. The active setup is four generic assigned tabs across BO1 and BO2 hosts; the older search/action roles below describe future behavior to revisit before reactivation. The current HubSpot gathering step ends with the `Contas Eduzz` sidebar result.

## Core Model

The extension tracks one current work item: the latest HubSpot ticket or Hyperflow chat that the user actively opened, focused, or switched to.

BackOffice automation must always belong to that current item. It must not show, copy, or reuse data from a previous ticket/chat unless the user has returned to that exact current item and the result still matches its search value.

## Tabs

- BO1: primary account lookup tab. Used for email search, doc discovery, doc search, account count/type, and parceiro detail lookup.
- BO2: default action tab. Used for Faturas by default, and for any action without a dedicated action tab.
- In legacy action naming, `BO2` means the second `bo.eduzz.com` tab (`boTab2Id`), not the separate `bo2.eduzz.com` service. Search roles are inactive in the current four-tab setup.
- Dedicated action tabs: optional tabs assigned specifically to `orbita`, `faturas`, `nutror`, or `contratos`.

If Faturas, Nutror, or Contratos has a dedicated tab, it should use that tab. Otherwise it falls back to BO2. Orbita is special: if it has no dedicated action tab, its main button focuses BO1 only when BO1 is already assigned instead of falling back to BO2. If BO1 is not assigned, the Orbita main button enters assignment mode for Orbita's own dedicated action tab, never BO1. Its corner control also assigns/focuses a dedicated Orbita action tab.

In the older three-tab action workflow, dedicated Faturas and Contratos tabs removed the need for the legacy BO2 action tab. Revisit this rule when giving the current four tabs their roles. Nutror was skipped in that workflow. Orbita without a dedicated tab used BO1, not BO2.

## V2 Required-Tab Gate And Recovery

BackOffice tabs are reusable work tabs for whichever ticket/chat is current. They are not owned by one ticket. The current required set is two `https://bo.eduzz.com/` tabs and two `https://bo2.eduzz.com/` tabs. Ticket-page gathering continues independently; all external searches remain paused even when the four assignments are ready. The two BO1 tabs occupy legacy `boTab1Id` and `boTab2Id` slots; the BO2-host tabs occupy `backOffice2TabIds`. Individual roles will be aligned later.

- Assignments belong to Chrome tab IDs, not windows or positions. The user may move the four tabs or merge their windows; TicketHelper must continue using those same assigned tabs for whichever ticket is current.
- Current implementation: an assigned tab that navigates off its expected host keeps its identity but becomes unready; returning it to the host restores readiness. Closing an assigned tab clears only that slot and keeps its last window ID as a recovery hint. The launcher creates only missing tabs: it reuses the remembered window when it still exists, or creates a replacement window and groups tabs that shared the closed window. Other assigned tab IDs remain unchanged.
- A surviving but wrong-page tab stays assigned. When a future action needs it, navigate that same tab to the action's exact required page, wait for readiness, then continue the action only if its current-ticket/process ownership still matches. Do not repeatedly redirect idle tabs or launch a new tab just because an assigned one navigated away.
- Returning all four tabs to their required hosts updates readiness without starting a search in this remaster stage.
- Live Chrome verification is still needed for recovery and navigation edge cases. Future integrations may require additional assigned tabs on other BackOffice services or other websites.

The v2 goal is to harden assignment, current-item detection, extraction/cache, external search steps, and manual actions before adding new features. Do not treat an absolute 100% success guarantee as a platform capability; make steps verifiable and recoverable when Chrome or a third-party page changes.

## BO Setup Launcher

When any required BO tab assignment is missing, the top control becomes `Lançar abas definidas` and shows an up-arrow icon instead of the reset icon.

Clicking the launcher should:

1. Find missing required slots without changing any surviving assignments.
2. Recreate each missing slot on its expected host (`https://bo.eduzz.com/dashboard/home` for `boTab1Id` and `boTab2Id`; `https://bo2.eduzz.com/` for `backOffice2TabIds`).
3. Reuse the slot's remembered window if it remains open. If that window was closed, create a replacement and put missing tabs from that same old window together in it. With no remembered window, retain the default split: BO1 tabs in an upper window and BO2 tabs in a lower window.
4. Persist and broadcast the updated assignments. Do not start gathering or searching in either BackOffice service.

When all four are assigned, the control is the normal clear/reset control. The launcher is setup only; searches remain paused.

Implementation note: create both windows concurrently, then create and collect each window's tabs sequentially from Chrome callbacks. Use a stable first-tab placeholder, update it to the corresponding host, then create the second tab. Do not rely on `chrome.windows.create({ url: [...] })` or an immediate window tab query to infer all tab IDs; Chrome can report a partial list during creation. The four created IDs are the assignment source of truth. Verify each tab against its expected host; a late URL/load verification miss must not clear otherwise valid launched IDs.

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

## Popup Scope

The compact popup prototype temporarily hides BO action buttons. The underlying BackOffice action model remains documented here for when those controls are brought back. Producer and purchase-age warning overlays have been removed from the extension.

## Known Fragility

BO pages are dynamic. Avoid assuming that one focus event or one immediate DOM check proves a result is final. Prefer explicit helpers that verify product tab, search category, input/current value, and visible rows/popup/no-result text.
