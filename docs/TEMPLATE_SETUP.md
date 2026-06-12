# Template Setup Status

This repository started as the existing TicketHelper extension repo and was migrated into the AI project template frame in place.

## What Was Preserved

- Same folder: `C:\C.Nvme\Projects\TicketHelper`.
- Same `.git` history.
- Same configured remote: `https://github.com/LorenzoBerto-Eduzz/TicketHelper.git`.
- Same Chrome extension source files, moved under `project/`.

No new repo was created. No remote was changed.

## What Was Adapted

The template frame was brought into the existing repo root:

```text
project/
docs/
notes/
asset_staging/
local_assets/
AGENTS.md
README.md
.editorconfig
.gitattributes
.gitignore
```

Template placeholders were replaced with TicketHelper-specific facts in the main docs. The generic template setup guidance is retained here only as historical/reference context.

## Current Main Project Folder

```text
project/
```

Chrome load-unpacked testing should select `project/`, not the repo root.

## Packaging After Migration

Source lives in `project/`, but release/test zips should preserve the old user-facing extension folder shape:

```text
TicketHelper/manifest.json
TicketHelper/background.js
TicketHelper/content.js
...
```

This means package `project/` contents under top-level `TicketHelper/`.

## Adaptation Checklist

- `README.md` names TicketHelper and explains source location.
- `AGENTS.md` names `project/` as source root.
- `docs/PROJECT_BRIEF.md` contains TicketHelper identity, stack, commands, and constraints.
- `docs/AI_HANDOFF.md` summarizes current state.
- `docs/BO_ACTION_MODEL.md` records BO action behavior.
- `.gitignore` excludes generated/local/private artifacts, including `TicketHelper.zip`.
- `.gitattributes` sets text/binary handling.
- `notes/todos.txt` remains user scratch space.

## Future Template Changes

Do not re-run generic template setup blindly. This repo is already adapted. If changing organization or docs, update the specific TicketHelper docs instead.
