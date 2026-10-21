# Ticket And Data Model

This document explains how TicketHelper thinks about current tickets/chats and extracted data. It is a durable model for future AI sessions; do not add real customer examples here.

## Current Work Item

The current work item is the latest ticket or chat the user actively opened, focused, switched to, or selected.

Examples of current work items:

- A HubSpot Help Desk ticket opened from the list view.
- A HubSpot ticket preview panel opened on the list view.
- A HubSpot ticket full page.
- A Hyperflow chat opened from `/chats/<chat_id>`.
- A Hyperflow chat opened from `/all-chats/<chat_id>`.
- A Hyperflow chat selected in the right-side drawer on `/all-chats/all`.

Opening a BO preview/helper tab for automation does not make that BO tab the current work item. The current item remains the active ticket/chat the user is working on.

## V2 Current-Item Ownership

The v2 background tracks the latest focused supported ticket/chat page. The behavior below is implemented in the background/content flow and still needs live Chrome validation across HubSpot route variations:

- The last supported ticket/chat page to gain focus becomes the single current item, even if its tab was opened earlier. If the focused tab navigates to a different recognized ticket/chat page, that page becomes current. A newly opened background ticket tab does not change the current item until focused.
- Focusing a BackOffice tab or another non-ticket tab does not make it the current item. The last current ticket/chat remains current while its owning tab still exists and still shows that same ticket/chat page.
- If the owning tab closes or leaves its recognized ticket/chat page, clear the current item and active data to a neutral, no-ticket state. Do not silently choose a different already-open ticket tab. A later focus or navigation to a supported ticket/chat page can establish a new current item.
- On a current-item change, stop or disregard old extraction, searches, and delayed results so they cannot populate the newly current item. Preserve previous-item history according to the history rules, independently of active data.
- For a ticket/chat that becomes current again after another item owned the process, start a fresh extraction and external search process. Never restore prior active fields merely because its ID or tab matches; history remains separate. The current ticket page can gather its own visible fields even while external searches are paused for unavailable work tabs.
- Pausing TicketHelper through Chrome's action shortcut, toolbar icon, or overlay X hides the overlay, tears down page observers, and stops extraction, searches, and copy shortcuts. The latest ticket ID, its known fields, and source address remain in session storage while Chrome is open; assigned BO tab IDs remain assigned. On resume, inspect only the focused tab: when it is the same supported ticket/chat ID on the same platform, restore cached values immediately and gather only missing fields. A URL change for that same item does not invalidate the cache. Start fresh for a different item, and clear the active item when the focused tab is not a ticket page.

The overlay is shown on the sole active HubSpot ticket tab. When no ticket owns the process, the focused HubSpot app page can show a neutral overlay. Other open ticket tabs must hide theirs. Hyperflow remains a supported current-item/data source without the floating overlay. Additional support platforms and integrations will be aligned separately before implementation.

Active field values are session-only and belong to the current owner/process epoch. Switching tickets in the same tab or across tabs discards prior active fields and cancels prior work. A paused work session may retain its matching ticket's values until resume, subject to the focused URL check.

## Core Data Fields

The popup and copy shortcuts work with these fields:

- `id`: ticket/chat identifier.
- `name`: contact/customer name.
- `email`: contact/customer email.
- `doc`: CPF/CNPJ or a status such as `> Conta sem doc`.
- `accounts`: account summary/count/type result.

Use fake examples only:

```text
id: ticket_123456
name: Template User
email: template@email.com
doc: 123.456.789-10
accounts: 2 | Parceiro - Produtor
```

## Cache Versus Visible Popup

The extension keeps current data in memory for copy shortcuts and background actions. Only the current owner may display active values; other open ticket tabs hide their popup.

When switching to a different ticket/chat:

- The extension should detect that the current item changed.
- The active cache should clear, then gather only that item's data under a new owner epoch and process ID.
- Prior extraction, queued BackOffice work, injected actions, and delayed messages must be cancelled or rejected before they can update the new owner.
- BO action tabs should synchronize to the current item/value.

When focus returns to the still-current owning item without any intervening item change:

- The extension should not rerun BO searches just because focus returned.
- It should only rerun if a required result is missing/stale or the user clicks an action whose tab no longer displays that current result.

Rapid A-B-A changes still create a new ownership epoch for the final A. A delayed result from the first A must not be accepted for the final A just because their IDs match. Copy shortcuts, masked-email reads, and history transitions follow that same owner check.

## Data Gathering Flow

Typical flow:

1. Detect current ticket/chat.
2. Show HubSpot ticket ID immediately from the focused ticket URL. Open the matching ticket's contextual sidebar, select Details, and visually place About this ticket first and Contas Eduzz second when its card mounts. Keep both sections expanded. Bring the account card loading placeholder into view until its lazy account tile mounts; restore the sidebar scroll position afterward. Read the `Contas Eduzz (N)` card in the Details content. For one account, read Razão Social, E-mail, and CPF/CNPJ from its tile; a blank or dash-only CPF/CNPJ value displays `Conta sem doc. <`. A nonempty CPF/CNPJ value outside the accepted 11-digit CPF or 14-digit CNPJ formats displays `Doc. Estrang./Inválido <`. Accepted formatted values use `.`, `/`, or `-` separators in the expected positions; this checks shape only, not CPF/CNPJ check digits. For confirmed zero or multiple accounts, show the corresponding status in Email and stop. Statuses beginning with the internal `>` marker display without that prefix and with a closing ` <`; the marker remains in session data so these values stay non-copyable. End-state values are not clickable, copyable, or underlined. An absent or loading card is not treated as zero accounts. The header contact and Requerente card are not data sources in this step. Legacy BackOffice searches remain paused. For one account and a valid document, the first assigned BO2-host tab searches customers by document and counts matching cards. Elite from the HubSpot card supplies only the contact account type (`--` becomes `Cliente Final`); the Contas row shows `Type | count`, or `Nenhuma conta <` on an explicit empty result.
3. Update popup fields as soon as each value is gathered.
4. Future, paused flow: use BO1 to search by email when doc/accounts are not known. Steps 4-8 below describe the older BO flow to revisit before reactivation; they do not run in the current remaster stage.
5. If BO1 email search returns a usable doc, update `doc` immediately and proceed to doc search.
6. Run doc search twice when needed because the first return can initially show only one account while later rows appear shortly after.
7. Use the second doc-search result as the definitive account-count/type result.
8. After a usable doc/email search value is known, automatically run Orbita customer, Nutror, Faturas, and Contratos searches in their four assigned tabs. Manual shortcuts focus the assigned tab and reuse only results with the action's current-item visible proof; otherwise they rerun the search.

The active BO2 customer result also supplies masked emails from each verified card, kept only with the current ticket's session data. The fifth row shows `Type | 5+` for at least five cards. Its click and shortcut copy those masked emails in card order, one per line; when its BO2 tab is missing, the same action launches the missing assigned tabs.

## Email Search Outcomes

Email search in BO1 can produce:

- No account: `doc = > Email sem conta`, `accounts = -`.
- Account with doc: update `doc`, then continue to doc search before finalizing `accounts`.
- Account without doc: `doc = > Conta sem doc`, `accounts = ? | <type>`.

For no-doc single-account parceiro cases, the extension may open the account preview to read the first icon/type. It should not do this for normal single `Cliente` no-doc rows.

## Doc Search Outcomes

Doc search in BO1 can produce:

- No rows / invalid or foreign doc handling.
- One account.
- Multiple accounts.
- Parceiro accounts requiring subtype detail.
- `9+ | Consultar tipo` when too many accounts are present.

The account summary should be based on the definitive doc search result, not just the email-search result when a valid doc was found.

## Parceiro Detail Lookup

When a parceiro subtype is needed, the extension opens the account preview, reads the first icon/name from the account details, then closes the helper tab. The update must still belong to the same current process/ticket/chat before changing the popup/cache.

Examples of fake account summaries:

```text
1 | Cliente
2 | Parceiro - Produtor
3 | Parceiro - Black Belt D2
9+ | Consultar tipo
? | Parceiro - Produtor
```

## BO Action Synchronization

Action searches use the gathered doc/email value for the current item. See `docs/BO_ACTION_MODEL.md` for the full BO action rules.

In short:

- Autorun after value is gathered.
- Button click either focuses a verified current result or runs the action.
- Triangle/focus controls only focus tabs.
- Manual BO searches by the user make the tab stale for the previous current item until the action is rerun or verified again.

## Hyperflow Chat Detection

Hyperflow current-item detection recognizes:

- Direct chat route: `/chats/<chat_id>`.
- Direct all-chats route: `/all-chats/<chat_id>`.
- List route with drawer: `/all-chats/all?...` only when a visible right-side drawer contains `span.chat-protocol`.

For direct routes, prefer the protocol/chat ID from the URL because it is available immediately. For drawer/list previews, read the active visible drawer's `span.chat-protocol` value or `aria-label`.

Hyperflow email extraction should read only a chat root that contains the expected current protocol/chat ID, then find the visible `E-mail:` caption and its next value span. The value may be in `aria-label` or text. Direct route URLs can change before Hyperflow finishes swapping the DOM, so do not accept an email from a root whose `span.chat-protocol` is missing or belongs to a previous chat. Do not scan unrelated list rows as the active chat.

## Reliability Principles

- Treat stale work as disposable. If the active ticket/chat changes, old BO searches and helper preview reads must not update the new current item.
- Prefer visible, value-matching proof before reusing BO action results.
- Keep extraction fast by checking already-rendered DOM first and looping tightly only around the specific elements expected to change.
- Avoid duplicate same-tab BO submissions. The latest action for a BO tab should win, and older queued work should stop rather than replay later.

## Public-Safe Data Rule

Committed docs and examples must not contain real customer data, real ticket/chat IDs, real CPFs/CNPJs, real emails, screenshots with private data, tokens, credentials, or copied case payloads.

Use placeholders or clearly fake values such as:

- `<email>`
- `template@email.com`
- `<CPF_CNPJ>`
- `123.456.789-10`
- `00.000.000/0000-00`
- `<ticket_id>`
- `ticket_123456`
- `<chat_id>`
- `chat_abc123`
- `N123456789`

If real data is temporarily needed for debugging, keep it outside Git in ignored local-only paths such as `local_assets/`, `local_data/`, or `private_data/`, then remove it when done.
