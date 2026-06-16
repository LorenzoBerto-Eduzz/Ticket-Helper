# Workflow And Style

TicketHelper should stay easy for the owner and future AI sessions to understand, test, package, and modify.

## Collaboration Rules

- Explain the intended change before editing when the change affects structure, architecture, workflow, release behavior, or BO automation flow.
- Ask or confirm before major changes: moving folders, renaming many files, deleting files, changing branch strategy, introducing a framework, changing release flow, or rewriting established automation.
- Do not create Git commits unless the user explicitly asks.
- Do not create release/export/package artifacts unless the user explicitly asks.
- When the user asks for suggestions or analysis, answer first and wait for approval before editing.
- When the user edits files, assume their changes are intentional. Read current files before editing and work with them.
- Avoid force-push or history rewrite unless explicitly requested and approved.
- Keep changes focused enough that the user can review them in source control.
- Use commit messages that explain what changed without needing the chat.

## Git Identity Guard

This repo uses a local Git identity guard:

- `.git-identity` stores the one allowed `user.email`.
- `.githooks/pre-commit` and `.githooks/pre-push` source `.githooks/identity-guard.sh`.
- `user.name` may vary by device and is intentionally not checked.
- The local clone must have `git config core.hooksPath .githooks`.

Before gitcheck, gitcheckpoint, commit, or push, verify:

```powershell
Get-Content .git-identity
git config user.email
git config core.hooksPath
```

If local email does not match `.git-identity`, stop and fix it or ask before committing/pushing. On every other clone/computer, run once:

```powershell
git config core.hooksPath .githooks
```

## Source Location

The actual extension source is in `project/`. Do not add source files at repo root unless they are root-level repo frame files.

## Code Style

- Plain JavaScript is used; there is no build system.
- Prefer explicit helper functions over hidden timing assumptions.
- Keep behavior modular when practical, especially in `project/background.js` where BO automation is complex.
- Add comments only when they explain intent, fragile platform behavior, or a decision future AI would otherwise miss.
- Keep UI/popup behavior in `project/content.js` and `project/popup_ui.js` unless there is a reason to centralize differently.
- Keep Chrome/background orchestration in `project/background.js`, but prefer focused helper functions for new behavior.

## Checks

Use these checks after JavaScript changes:

```powershell
node --check project/background.js
node --check project/content.js
node --check project/popup_ui.js
```

Use `git diff --check` before committing.

## Packaging

Release/test packages are generated only on request. Package `project/` contents into a top-level `TicketHelper/` folder. Keep `TicketHelper.zip` ignored and out of Git.

## Public-Safe Documentation

Repo docs and examples must not include real customer data, real ticket/chat IDs, real CPFs/CNPJs, real emails, credentials, tokens, screenshots with private data, or copied case payloads.

Use placeholders or obviously fake examples when structure matters, such as `template@email.com`, `123.456.789-10`, `00.000.000/0000-00`, `ticket_123456`, `chat_abc123`, or `N123456789`.

Keep any temporary real debugging data outside Git in ignored local-only paths such as `local_assets/`, `local_data/`, or `private_data/`.

## BO Automation Caution

Before changing BO tab/action behavior, read `docs/BO_ACTION_MODEL.md`. The desired model is intentionally strict:

- Autorun and button click are the only search triggers.
- Focusing a tab or clicking the triangle only focuses; it should not start a search.
- A button click should reuse only verified results for the current ticket/value, otherwise run the action.
- Stale `SEARCH_STARTED`, old in-flight promises, and manually changed BO tab inputs must not block user button clicks.
