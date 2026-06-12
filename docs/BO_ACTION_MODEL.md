# BackOffice Action Model

This document records the intended behavior for TicketHelper's BackOffice automation. Read it before changing action buttons, BO tab assignments, autoruns, or result reuse.

## Core Model

The extension tracks one current work item: the latest HubSpot ticket or Hyperflow chat that the user actively opened, focused, or switched to.

BackOffice automation must always belong to that current item. It must not show, copy, or reuse data from a previous ticket/chat unless the user has returned to that exact current item and the result still matches its search value.

## Tabs

- BO1: primary account lookup tab. Used for email search, doc discovery, doc search, account count/type, and parceiro detail lookup.
- BO2: default action tab. Used for Faturas by default, and for any action without a dedicated action tab.
- Dedicated action tabs: optional tabs assigned specifically to `faturas`, `nutror`, or `contratos`.

If an action has a dedicated tab, it should use that tab. Otherwise it falls back to BO2.

## Search Triggers

Only these should start an action search:

1. Autorun after the extension gathers the needed current item value.
2. Direct user click on an action button.

These should not start an action search:

- Focusing a BO tab manually.
- Clicking the small triangle/corner focus control.
- Merely returning to the same ticket/chat when the current item did not change.

## Search Values

For Faturas:

- Use valid CPF/CNPJ doc when available.
- Use email for no-doc or invalid/foreign-doc cases when the email is the correct fallback.

For Nutror and Contratos:

- Use valid CPF/CNPJ doc when available.
- Use email for no-doc or invalid/foreign-doc cases when the email is the correct fallback.

The expected value must be tied to the current item/ticket ID and stored result state.

## Complete Result States

Faturas is complete only when:

- BO product tab is Orbita/MyEduzz.
- Search category is Faturas 2.0 / Faturas, not the old screen.
- The search input or visible result context matches the current item's search value.
- The faturas result popup is visible.

Nutror is complete only when:

- BO product tab is Nutror.
- Search category is Clientes.
- Search input or visible rows/no-result state match the current item's search value.
- Either matching rows are visible or `Nenhum registro encontrado` is visible.

Contratos is complete only when:

- BO product tab is Next.
- Search category is Clientes.
- Search input or visible rows/no-result state match the current item's search value.
- Either matching rows are visible or `Nenhum registro encontrado` is visible.

## Button Click Behavior

When the user clicks Faturas, Nutror, or Contratos:

1. Resolve the action's dedicated tab, or BO2 fallback.
2. If a verified complete result for the current item/value is already displayed, focus the tab and do not rerun.
3. If the tab state is stale, wrong action, wrong product tab, wrong search category, wrong value, missing result, or manually changed by the user, run the action.
4. A button click must not be blocked by stale `SEARCH_STARTED` state or an old in-flight autorun promise.
5. A button click can focus the BO tab as part of showing the action, but focus alone is not a search trigger.

## Autorun Behavior

Autorun should happen after the current item gets the usable doc/email search value. Autorun should be conservative and deduped, but should eventually mark the tab state as complete only when a final result is visible.

Autorun must not steal focus merely because a tab is assigned.

## Triangle / Focus Controls

The small triangle/corner on action buttons is only for focusing the dedicated action tab. It must not run a search.

If an action has no dedicated tab, the normal action result uses BO2 fallback. The triangle should indicate only dedicated-tab focus behavior.

## Manual BO Tab Searches

The user may manually search other emails/docs in a defined BO tab. After that, the next action button click must compare the current BO tab context with the current ticket value. If the tab no longer matches the current item, rerun the action.

## Known Fragility

BO pages are dynamic. Avoid assuming that one focus event or one immediate DOM check proves a result is final. Prefer explicit helpers that verify product tab, search category, input/current value, and visible rows/popup/no-result text.
