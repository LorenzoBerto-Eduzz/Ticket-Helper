# Ticket And Data Model

This document explains how TicketHelper thinks about current tickets/chats and extracted data. It is a durable model for future AI sessions; do not add real customer examples here.

## Current Work Item

The current work item is the latest ticket or chat the user actively opened, focused, switched to, or selected.

Examples of current work items:

- A HubSpot Help Desk ticket opened from the list view.
- A HubSpot ticket preview panel opened on the list view.
- A HubSpot ticket full page.
- A Hyperflow chat opened from the chat list.
- A Hyperflow chat expanded into its own chat route.

Opening a BO preview/helper tab for automation does not make that BO tab the current work item. The current item remains the active ticket/chat the user is working on.

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
2. Extract visible ID/name/email when available.
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
