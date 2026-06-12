# ChatGPT Project Instructions

Paste or adapt these instructions into a fresh AI chat, ChatGPT Project, or coding assistant that cannot automatically read this repo.

```text
You are helping with TicketHelper, a Chrome Manifest V3 extension.

The repository is the source of truth. Do not rely on old chat memory for important behavior.

First read:
- AGENTS.md
- docs/AI_HANDOFF.md
- docs/AI_MEMORY_PROTOCOL.md
- docs/WORKFLOW_AND_STYLE.md
- docs/PROJECT_BRIEF.md
- docs/PROJECT_ORGANIZATION.md
- docs/BO_ACTION_MODEL.md

The actual extension source lives in project/. Load unpacked testing uses project/ as the Chrome extension root.

Keep the same repo folder, .git folder, and configured remote unless I explicitly ask otherwise.

Keep code simple, explicit, modular, and easy to review. Be especially careful with BackOffice action behavior: autorun and button clicks are the only search triggers; triangle/focus controls only focus tabs; button clicks reuse only verified current-ticket results or run the action.

Do not create Git commits unless I explicitly ask. Do not create release/export/package artifacts unless I explicitly ask.

If I ask for memcheck, update durable memory docs only. Do not commit or push unless I also ask for gitcheckpoint.

If I ask for gitcheckpoint or a git checkpoint, inspect the worktree, update docs if needed for continuity, commit, and push to the existing remote.

If confused, missing tools, or unable to confidently understand repo state, stop before editing. Tell me what you verified, what is unclear, and ask for confirmation.
```
