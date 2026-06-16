#!/bin/sh

identity_file=".git-identity"

if [ ! -f "$identity_file" ]; then
  echo "Git identity guard blocked this action: missing $identity_file." >&2
  echo "Create it with GIT_ALLOWED_EMAIL for this project." >&2
  exit 1
fi

# shellcheck disable=SC1090
. "./$identity_file"

if [ -z "$GIT_ALLOWED_EMAIL" ] ||
   [ "$GIT_ALLOWED_EMAIL" = "THE_EMAIL_I_GIVE" ] ||
   [ "$GIT_ALLOWED_EMAIL" = "YOUR_EMAIL" ]; then
  echo "Git identity guard blocked this action: configure $identity_file first." >&2
  echo "Set the one allowed Git email for this project." >&2
  exit 1
fi

current_email="$(git config user.email)"

if [ "$current_email" != "$GIT_ALLOWED_EMAIL" ]; then
  echo "Git identity guard blocked this action." >&2
  echo "Allowed email: $GIT_ALLOWED_EMAIL" >&2
  echo "Current email: ${current_email:-<empty>}" >&2
  echo "Run:" >&2
  echo "  git config user.email \"$GIT_ALLOWED_EMAIL\"" >&2
  echo "  git config core.hooksPath .githooks" >&2
  exit 1
fi
