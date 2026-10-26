# BackOffice Action Model

This document records the intended behavior for TicketHelper's BackOffice automation. Read it before changing action buttons, BO tab assignments, autoruns, or result reuse.

Version 2.0.0 also uses the first BO2-host Orbita tab for document recovery when the HubSpot Contas Eduzz card count is zero or multiple. It first reads the sole Requerente marked Solicitante; with multiple Contas cards, a unique email-matched card supplies values directly. Otherwise Orbita searches by that Solicitante email and reads the document from its sole matching customer card. A valid recovered CPF/CNPJ is stored and shown as digits only; if the Solicitante has no name, use that customer card's header name. A missing or invalid document leaves email as the final search value. Nutror, Faturas, and Contratos wait until this recovery finishes. The earlier single-card rule below remains the direct path when HubSpot has exactly one Contas Eduzz card.

During the HubSpot Details remaster, the first assigned `bo2.eduzz.com` tab runs Orbita customer search at `/bo/customer`. It uses a valid CPF/CNPJ, or the contact email when the single `Contas Eduzz` card has no valid document. Document search also counts customer accounts for the fifth popup row; email search does not populate that count. The second assigned BO2-host tab runs Nutror search at `/nutror/clientes` using the same selected value. The first assigned `bo.eduzz.com` tab runs Faturas at `/dashboard/reembolso`: select Orbita and Faturas 2.0, close any prior result popup, submit the selected document/email, and wait for the new popup. The second assigned `bo.eduzz.com` tab runs Contratos at `/dashboard/contratos-next`: select Next and Clientes, then submit that document/email. Automatic runs do not focus their tabs. The `Pesquisar Contas Orbita` shortcut reuses a completed document result only while the search input, every visible card's document, and the ordered masked emails match the current stored result; otherwise it reruns while retaining a completed fifth-row value until a new result is confirmed. Nutror waits for a settled result and holds its visible row keys in current-ticket session state; automatic and manual actions reuse that result only while the input, `Resultado para` value, row keys, and every row's document or email still match. Faturas reuses only a visible nonempty popup with every displayed buyer row matching the selected document/email, plus the correct page, product, and category; its search input may clear after submission. Empty or uncertain results rerun on manual action. Contratos stores the first visible contract ID in current-ticket session state. A manual shortcut reuses the visible result only when the correct page, Next product, Clientes category, search value, and that exact contract ID still appear in the current page of rows; otherwise it reruns. An empty result has no reusable ID. Orbita email/no-result reuse remains pending alignment. The unassigned suggestions are `Alt+Shift+1` for Orbita, `Alt+Shift+2` for Nutror, `Alt+Shift+3` for Faturas, and `Alt+Shift+4` for Contratos.

The Faturas popup shows a small overlay badge below each invoice's `Reembolso até` line when that invoice has a valid past or current `Recebimento` date. It counts local calendar days from the browser computer date: `Hoje`, `1 dia`, `N dias` through 149, or `150+`. Days 0–7 use green and later days use red. Future or missing payment dates have no badge. The badge does not change table row dimensions and disappears while TicketHelper work is off.

Contratos must store the first numeric ID in the visible result table's second column before treating a search as reusable. An initially empty table is still loading and supplies no anchor. When a first-page result is already visible for the current search value but no anchor has been saved, capture its stable first ID before submitting another search. After a search navigates from Home to the Contratos route, wait on that route for a stable first-row ID or an explicit no-result message; this follow-up read must not submit another search. If a saved anchor exists but is absent from the visible rows, rerun the search. The manual shortcut focuses the assigned tab and skips a new search only while the stored ID remains in the current visible rows and the required page, product, category, and search input still match.

That BO2 count also reads the email from every verified customer card. It replaces positions 3–5 of the local part with four asterisks, preserves card order, and keeps only the masked newline-separated value in current-ticket session state. The fifth popup row displays `Type | count` or `Type | 5+` for at least five cards; clicking it or using its shortcut copies the masked email list once the count is complete. The clipboard includes HTML with soft line breaks alongside plain text so HubSpot's rich editor preserves literal asterisks on every line. If the first BO2-host tab is unassigned, the same action launches the missing work tabs. An interrupted or stale search must never provide a previous ticket's list.

## Core Model

The extension tracks one current work item: the latest HubSpot ticket or Hyperflow chat that the user actively opened, focused, or switched to.

BackOffice automation must always belong to that current item. It must not show, copy, or reuse data from a previous ticket/chat unless the user has returned to that exact current item and the result still matches its search value.

## Tabs

- BO1: primary account lookup tab. Used for email search, doc discovery, doc search, account count/type, and parceiro detail lookup.
- BO2: default action tab. Used for Faturas by default, and for any action without a dedicated action tab.
- In legacy action naming below, `BO2` means the second `bo.eduzz.com` tab (`boTab2Id`), not the separate `bo2.eduzz.com` service. Those legacy roles are inactive; the active BO2-host roles are Orbita customer search and Nutror search.
- Dedicated action tabs: optional tabs assigned specifically to `orbita`, `faturas`, `nutror`, or `contratos`.

If Faturas, Nutror, or Contratos has a dedicated tab, it should use that tab. Otherwise it falls back to BO2. Orbita is special: if it has no dedicated action tab, its main button focuses BO1 only when BO1 is already assigned instead of falling back to BO2. If BO1 is not assigned, the Orbita main button enters assignment mode for Orbita's own dedicated action tab, never BO1. Its corner control also assigns/focuses a dedicated Orbita action tab.

In the older three-tab action workflow, dedicated Faturas and Contratos tabs removed the need for the legacy BO2 action tab. Revisit this rule when giving the current four tabs their roles. Nutror was skipped in that workflow. Orbita without a dedicated tab used BO1, not BO2.

## V2 Required-Tab Gate And Recovery

BackOffice tabs are reusable work tabs for whichever ticket/chat is current. They are not owned by one ticket. The current required set is two `https://bo.eduzz.com/` tabs and two `https://bo2.eduzz.com/` tabs. Ticket-page gathering continues independently. The two BO1 tabs occupy legacy `boTab1Id` and `boTab2Id` slots; the BO2-host tabs occupy `backOffice2TabIds`. The first BO2-host tab searches Orbita customers and counts document-matched accounts; the second searches Nutror; the first BO1 tab searches Faturas; the second searches Contratos.

- Assignments belong to Chrome tab IDs, not windows or positions. The user may move the four tabs or merge their windows; TicketHelper must continue using those same assigned tabs for whichever ticket is current.
- The four slots are ordinary tabs, not Chrome tab groups. Their URL fragments are `#thbo1tab1`, `#thbo1tab2`, `#thbo2tab1`, and `#thbo2tab2`, written on assigned HTTP(S) tabs without a full navigation. Once per work activation, scan open tabs and adopt existing marked tabs automatically; the launcher creates only slots still missing. Never claim an unmarked BackOffice tab just because its route matches. If duplicates have the same marker, use the lowest Chrome tab ID and remove extra markers where possible. This is a deterministic proxy for age, since the tab API has no creation timestamp. Previous long markers are recognized once and replaced with the short form. Navigation refreshes markers; explicit reset removes them. This uses user-approved all-HTTP(S) host permissions. A Chrome internal page or HTTP(S) page with an unrelated URL fragment cannot safely be marked, so it may need relaunch after a restart.
- An assigned tab that navigates off its expected host keeps its identity but becomes unready; returning it to the host restores readiness. Closing an assigned tab clears only that slot. During the current Chrome session, its last window ID helps return it to an existing window. Separately, a local preference stores only the four slots' relative window groups, without ticket data or Chrome IDs, so their grouping survives extension reloads and browser restarts. Moving an assigned tab or switching to a ticket in another window updates that preference.
- A surviving but wrong-page tab stays assigned. When a future action needs it, navigate that same tab to the action's exact required page, wait for readiness, then continue the action only if its current-ticket/process ownership still matches. Do not repeatedly redirect idle tabs or launch a new tab just because an assigned one navigated away.
- Returning all four tabs to their required hosts updates readiness without starting a search in this remaster stage.
- Live Chrome verification is still needed for recovery and navigation edge cases. Future integrations may require additional assigned tabs on other BackOffice services or other websites.

The v2 goal is to harden assignment, current-item detection, extraction/cache, external search steps, and manual actions before adding new features. Do not treat an absolute 100% success guarantee as a platform capability; make steps verifiable and recoverable when Chrome or a third-party page changes.

## BO Setup Launcher

When any required BO tab assignment is missing, the top control becomes `Lançar abas definidas` and shows an up-arrow icon instead of the reset icon.

Clicking the launcher should:

1. Find missing required slots without changing any surviving assignments.
2. Recreate each missing slot on its expected page (`https://bo.eduzz.com/dashboard/reembolso` for Faturas `boTab1Id`; `https://bo.eduzz.com/dashboard/contratos-next` for Contratos `boTab2Id`; `https://bo2.eduzz.com/bo/customer` for the first BO2-host tab; `https://bo2.eduzz.com/nutror/clientes` for the second).
3. Reuse a surviving window for each saved group. The special ticket group uses the current ticket window, or the focused Chrome window when no ticket is active. Other groups use a surviving assigned tab's window, a remembered same-session window, or one new window per missing group. With no saved layout, retain the default split: BO1 tabs in an upper window and BO2 tabs in a lower window.
4. Persist and broadcast the updated assignments. If the current HubSpot ticket has a resolved Contas Eduzz card, resume its document-or-email actions. If it is waiting for Solicitante email lookup in Orbita, resume that lookup first; start Nutror, Faturas, and Contratos only after the final search value is known.

When all four are assigned, the control is the normal clear/reset control. The launcher resumes the current ticket's four searches independently. BO1 Faturas and Contratos wait for their newly assigned tabs to finish loading, then use the captured ticket context to start pending searches without requiring the ticket tab to regain focus.

The BO2 customer step waits for its page and search input separately from the result. It accepts a stable set of customer cards only when every card's document matches the current ticket document, so a slow page or an unchanged matching result does not prematurely turn the fifth row into `-`. A new ticket/process or lost tab assignment invalidates the pending run.

Implementation note: create needed new windows concurrently, then create and collect each window's tabs sequentially from Chrome callbacks. Use a stable first-tab placeholder, update it to the corresponding host, then create additional tabs in that window. Do not rely on `chrome.windows.create({ url: [...] })` or an immediate window tab query to infer all tab IDs; Chrome can report a partial list during creation. The four created IDs are the assignment source of truth. Verify each tab against its expected host; a late URL/load verification miss must not clear otherwise valid launched IDs.

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
- The old Contratos button behavior reran unconditionally. The new second-BO1 shortcut uses the stored first contract ID plus page, product, category, and input checks; a missing ID reruns the search.

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
