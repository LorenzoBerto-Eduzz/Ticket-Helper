# AI Memory Protocol

This repository is the durable memory for TicketHelper. Chat context is useful but temporary and may be stale.

## Core Rule

Do not rely on remembered chat context for important TicketHelper behavior. If a detail matters for code, workflow, packaging, BO tab behavior, release handling, setup, or owner vocabulary, recover it from repo files, focused docs, code comments, or Git history before editing.

## Refresh Before Editing

Before changing a feature or system:

1. Read `AGENTS.md`.
2. Read `docs/AI_HANDOFF.md`.
3. Read `docs/WORKFLOW_AND_STYLE.md`.
4. Check `git status --short --branch`.
5. Verify the Git identity guard before any gitcheck, commit, or push:
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

## Owner Commands: memcheck And gitcheck

These are owner workflow commands, not shell commands.

### memcheck

When the owner says `memcheck`, the AI must thoroughly update TicketHelper's durable meta files/docs so future AIs, future sessions, and other devices can understand and continue the project with the same context.

`memcheck` should preserve the distilled long-term memory of the work, such as:

- settled alignments and decisions;
- current and planned functionality;
- important workflow rules;
- relevant architecture or data models;
- commands, paths, release rules, and setup expectations;
- known pitfalls and debugging lessons;
- vocabulary the owner uses for this project.

`memcheck` should update the appropriate docs/meta files, usually under `docs/`, without saving transcripts and without adding private data. It does not commit or push by itself unless the owner explicitly asks for `gitcheck`.

### gitcheck

When the owner says `gitcheck`, the AI must perform `memcheck` first, then save the current project state to Git for continuity across AIs/devices.

The expected `gitcheck` flow is:

1. Update durable memory/docs as needed, just like `memcheck`.
2. Inspect the worktree and relevant diffs.
3. Run relevant checks for the project when practical.
4. Verify Git identity guard settings.
5. Stage the intended files.
6. Commit.
7. Push to the configured remote, unless the owner explicitly says not to.

The commit message must be structured like this:

```text
Short title sentence summarizing all main things done

- More specific point describing one completed thing.
- More specific point describing another completed thing.
```

Use at least one bullet. Use as many bullets as are helpful for the actual set of changes. The title should be one concise sentence that names the main changes in brief wording.

## Git Identity Guard Memory

TicketHelper uses a reusable AI-project Git identity guard:

- `.git-identity` stores the only allowed local Git identity.
- `.git-identity` currently stores only `GIT_ALLOWED_EMAIL`.
- `.githooks/identity-guard.sh` blocks commits and pushes when the current clone's `git config user.email` differs.
- `git config user.name` may vary by device and is intentionally not checked.
- `.githooks/pre-commit` and `.githooks/pre-push` source the guard.
- This clone must have `git config core.hooksPath .githooks`.
- On another clone/computer, run once: `git config core.hooksPath .githooks`.

Before gitcheck/commit/push, run or verify:

```powershell
Get-Content .git-identity
git config user.email
git config core.hooksPath
```

If the local email does not match `.git-identity`, stop and fix it or ask before committing/pushing.

## Public-Safe Memory Rule

Durable memory docs must not contain real customer data, real ticket/chat IDs, real CPFs/CNPJs, real emails, credentials, tokens, screenshots with private data, or copied case payloads.

Use placeholders or clearly fake illustrative values when examples help explain structure, such as `template@email.com`, `123.456.789-10`, `00.000.000/0000-00`, `ticket_123456`, `chat_abc123`, or `N123456789`.

If real data is temporarily needed for debugging, keep it outside Git in ignored local-only paths such as `local_assets/`, `local_data/`, or `private_data/`, then remove it when done.

## Uncertainty Behavior

If you cannot confidently recover context, stop before editing. Summarize what you verified, name what is unclear, and ask the user.