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
- For a ticket/chat that becomes current again, retain known valid data associated with that exact item where possible and gather each field that still lacks a value. External results must still be checked against that current item and search value before reuse. The current ticket page can gather its own visible fields even while external searches are paused for unavailable work tabs.
- Pausing TicketHelper through Chrome's action shortcut, toolbar icon, or overlay X hides the overlay and stops extraction, searches, and copy shortcuts while keeping the current item's known values frozen. On resume, compare the current page's ticket/chat ID with the frozen/cache ID. Reuse matching values and continue gathering missing fields; create a fresh process for a different ID.

The overlay is shown only on HubSpot ticket pages. Hyperflow remains a supported current-item/data source without the floating overlay. Additional support platforms and integrations will be aligned separately before implementation.

Known field values are retained in session cache by source tab. Switching to another ticket in the same tab starts a new extraction process; durable per-ticket caching across that same-tab switch remains a follow-up hardening item.

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

The extension keeps current data in memory for copy shortcuts and background actions. Existing popup rows on already-opened tickets can display data gathered earlier, but the active cache should represent the current work item.

When switching to a different ticket/chat:

- The extension should detect that the current item changed.
- The active cache should switch to that item.
- Missing data should continue gathering from where that item left off when possible.
- BO action tabs should synchronize to the current item/value.

When returning to the same current item:

- The extension should not rerun BO searches just because focus returned.
- It should only rerun if a required result is missing/stale or the user clicks an action whose tab no longer displays that current result.

## Data Gathering Flow

Typical flow:

1. Detect current ticket/chat.
2. Extract visible ID/name/email when available. For HubSpot tickets, the fastest email path is: header contact value if it is already an email, matched composer contact label hover tooltip, then requester card email fallback.
3. Update popup fields as soon as each value is gathered.
4. Use BO1 to search by email when doc/accounts are not known.
5. If BO1 email search returns a usable doc, update `doc` immediately and proceed to doc search.
6. Run doc search twice when needed because the first return can initially show only one account while later rows appear shortly after.
7. Use the second doc-search result as the definitive account-count/type result.
8. Trigger defined BO action autoruns after a usable doc/email search value is known.

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
