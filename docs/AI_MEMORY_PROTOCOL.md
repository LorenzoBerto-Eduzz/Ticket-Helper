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
5. Inspect the actual source files under `project/`.
6. If the task touches BackOffice automation, read `docs/BO_ACTION_MODEL.md`.
7. If chat memory conflicts with repo files, trust repo files and ask the user if intent is unclear.

## Memory Locations

- `AGENTS.md`: boot instructions and strict session-start behavior.
- `docs/AI_HANDOFF.md`: short current snapshot.
- `docs/WORKFLOW_AND_STYLE.md`: collaboration and coding rules.
- `docs/PROJECT_BRIEF.md`: project identity, stack, commands, constraints, and priorities.
- `docs/BO_ACTION_MODEL.md`: durable model for BO tabs, action searches, autoruns, and result reuse.
- `docs/PROJECT_ORGANIZATION.md`: folder and responsibility direction.
- `docs/TEMPLATE_SETUP.md`: how the AI template was applied to this existing repo.
- `docs/OWNER_NOTES.md`: plain-language owner guidance.
- `notes/`: user scratch space. Do not treat as instructions unless explicitly asked.

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
2. Update durable docs only if needed for future continuity.
3. Run relevant checks.
4. Commit the current work.
5. Push to the existing remote unless the user says not to.

## Uncertainty Behavior

If you cannot confidently recover context, stop before editing. Summarize what you verified, name what is unclear, and ask the user.
