# Release And Export Model

This document records how TicketHelper should be packaged and published after the AI project frame migration.

## What Releases Are For

A release is for end users of the Chrome extension. The AI project frame (`docs/`, `notes/`, `asset_staging/`, `local_assets/`, `AGENTS.md`) is not part of the extension runtime and should not be included in release zips.

Repository-only restructuring, docs, and AI memory changes do not require a release unless the owner explicitly asks.

## Source Location

The extension source root is:

```text
project/
```

Chrome local development should use **Load unpacked** on:

```text
C:\C.Nvme\Projects\TicketHelper\project
```

Do not load the repo root.

## Local Export Location

When the owner asks for a local release/test export, create a folder at the repo root:

```text
C:\C.Nvme\Projects\TicketHelper\TicketHelper
```

This folder is a direct clone of `project/`, renamed to `TicketHelper`. It is generated and ignored by Git.

Chrome can load either `project/` for development or this generated `TicketHelper/` folder for manual release-style testing. The generated folder should contain `manifest.json` directly inside it.

## GitHub Release Zip Layout

For GitHub Releases, zip the generated `TicketHelper/` folder. The zip should preserve the old user-facing release shape:

```text
TicketHelper/manifest.json
TicketHelper/background.js
TicketHelper/content.js
TicketHelper/popup_ui.js
TicketHelper/options.html
TicketHelper/options.js
TicketHelper/offscreen.html
TicketHelper/offscreen.js
TicketHelper/image.png
```

That means package the contents of `project/` into a top-level `TicketHelper/` folder.

Do not include:

- `.git/`
- `docs/`
- `notes/`
- `asset_staging/`
- `local_assets/`
- repo root `README.md`
- `AGENTS.md`
- generated temp files
- private/local data

## Current Packaging File List

The expected extension files are:

```text
manifest.json
background.js
content.js
popup_ui.js
options.html
options.js
offscreen.html
offscreen.js
image.png
```

If the extension adds runtime files later, update this list and packaging commands.

## Versioning

The extension version lives in:

```text
project/manifest.json
```

Do not change the version for repo-only meta/docs/template-frame changes. Change it only when the owner requests a new version or the extension runtime behavior changes and a release is intended.

## Git Flow Used By This Repo

The configured remote is:

```text
https://github.com/LorenzoBerto-Eduzz/TicketHelper.git
```

The current practical flow has been:

1. Work locally on `dev`.
2. Commit a normal forward commit.
3. Push the current commit to remote `main` with `git push origin HEAD:main` when the owner asks to put it on remote/main.
4. Update local `main` to the same commit when useful to reduce confusion.

Do not force-push or rewrite history unless the owner explicitly asks and approves the risk.

`origin/dev` may be diverged from local `dev`; do not pull/rebase it casually. Inspect status and history first.

## GitHub Releases

Only create or update a GitHub Release when the owner explicitly asks.

Release conventions used recently:

- Release title/body should usually be the version only, for example `v1.8.16`.
- Upload `TicketHelper.zip` as the release asset. It should be a zip of the generated root `TicketHelper/` folder.
- If replacing an asset on an existing release, use clobber/overwrite only when explicitly requested.

## Verification Before Export Or Release

Run at minimum:

```powershell
node --check project/background.js
node --check project/content.js
node --check project/popup_ui.js
node --check project/options.js
git diff --check
```

After creating a local release folder, verify `TicketHelper/manifest.json` has the expected version. If also creating `TicketHelper.zip`, verify the manifest inside the zip has the expected version and the top-level folder is `TicketHelper/`.

## Public-Safe Export Rule

Never include real customer data, real ticket/chat IDs, screenshots with private data, credentials, tokens, or copied case payloads in release packages or committed docs.

Fake illustrative examples are allowed when clearly fake, such as:

- `template@email.com`
- `123.456.789-10`
- `00.000.000/0000-00`
- `ticket_123456`
- `chat_abc123`
- `N123456789`
