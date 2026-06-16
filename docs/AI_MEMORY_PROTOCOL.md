# AI Memory Protocol

This repository is the durable memory for TicketHelper. Chat context is useful but temporary and may be stale.

## Core Rule

Do not rely on remembered chat context for important TicketHelper behavior. If a detail matters for code, workflow, packaging, BO tab behavior, or release handling, recover it from repo files, focused docs, code comments, or Git history before editing.

## Refresh Before Editing

Before changing a feature or system:

1. Read `AGENTS.md`.
2. Read `docs/AI_HANDOFF.md`.
3. Read `docs/WORKFLOW_AND_STYLE.md`.
4. Check `git status --short --branch`.
5. Verify the Git identity guard before any gitcheck, gitcheckpoint, commit, or push:
   - Read `.git-identity`.
   - Check `git config user.email`.
   - Check `git config core.hooksPath`.
   - Local Git email must match `.git-identity`, and `core.hooksPath` must be `.githooks`.
   - `user.name` may vary by device and is not checked by the guard.
6. Inspect the actual source files under `project/`.
7. If the task touches BackOffice automation, read `docs/BO_ACTION_MODEL.md`.
8. If chat memory conflicts with repo files, trust repo files and ask the user if intent is unclear.

## Memory Locations

- `AGENTS.md`: boot instructions and strict session-start behavior.
- `docs/AI_HANDOFF.md`: short current snapshot.
- `docs/WORKFLOW_AND_STYLE.md`: collaboration and coding rules.
- `docs/PROJECT_BRIEF.md`: project identity, stack, commands, constraints, and priorities.
- `docs/BO_ACTION_MODEL.md`: durable model for BO tabs, action searches, autoruns, and result reuse.
- `docs/PROJECT_ORGANIZATION.md`: folder and responsibility direction.
- `docs/TEMPLATE_SETUP.md`: how the AI template was applied to this existing repo.
- `docs/OWNER_NOTES.md`: plain-language owner guidance.
- `.git-identity` and `.githooks/`: local Git identity guard. Commits and pushes are allowed only when the clone's `user.email` matches `.git-identity`.
- `notes/`: user scratch space. Do not treat as instructions unless explicitly asked.

## Git Identity Guard Memory

TicketHelper uses a reusable AI-project Git identity guard:

- `.git-identity` stores the only allowed local Git identity.
- `.git-identity` currently stores only `GIT_ALLOWED_EMAIL`.
- `.githooks/identity-guard.sh` blocks commits and pushes when the current clone's `git config user.email` differs.
- `git config user.name` may vary by device and is intentionally not checked.
- `.githooks/pre-commit` and `.githooks/pre-push` source the guard.
- This clone must have `git config core.hooksPath .githooks`.
- On another clone/computer, run once: `git config core.hooksPath .githooks`.

Before gitcheck/gitcheckpoint/commit/push, run or verify:

```powershell
Get-Content .git-identity
git config user.email
git config core.hooksPath
```

If the local email does not match `.git-identity`, stop and fix it or ask before committing/pushing.

## memcheck

When the user says `memcheck`, save the distilled decision, model, vocabulary, or plan into the appropriate docs. Do not save a transcript. Do not commit or push unless the user also asks for `gitcheckpoint`.

Good memory updates include:

- Current purpose of a system.
- Files involved.
- Important commands, paths, or release rules.
- How BO tab/action behavior is supposed to work.
- Known pitfalls that future AI sessions should not rediscover.

## Public-Safe Memory Rule

Durable memory docs must not contain real customer data, real ticket/chat IDs, real CPFs/CNPJs, real emails, credentials, tokens, screenshots with private data, or copied case payloads.

Use placeholders or clearly fake illustrative values when examples help explain structure, such as `template@email.com`, `123.456.789-10`, `00.000.000/0000-00`, `ticket_123456`, `chat_abc123`, or `N123456789`.

If real data is temporarily needed for debugging, keep it outside Git in ignored local-only paths such as `local_assets/`, `local_data/`, or `private_data/`, then remove it when done.

## gitcheckpoint

When the user asks for `gitcheckpoint` or a git checkpoint:

1. Inspect the worktree.
2. Verify `.git-identity`, `git config user.email`, and `git config core.hooksPath`.
3. Update durable docs only if needed for future continuity.
4. Run relevant checks.
5. Commit the current work.
6. Push to the existing remote unless the user says not to.

## Uncertainty Behavior

If you cannot confidently recover context, stop before editing. Summarize what you verified, name what is unclear, and ask the user.
