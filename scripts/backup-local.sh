#!/usr/bin/env bash
# Safety-net DB dump INSIDE the codespace (taken automatically before every start/migration).
# Keeps the newest 10 in /workspaces/.connectly-state/backups (mode 700, outside the git repo).
# NOTE: this is NOT an off-server backup: if the codespace is deleted these go with it.
# For real backups use scripts/backup-offsite.sh from another machine (see DEVELOPER_HANDBOOK.md).
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${CONNECTLY_PERSIST_DIR:-/workspaces/.connectly-state}/backups"
umask 077; mkdir -p "$DIR"
DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
[ -n "$DBURL" ] || { echo "no DATABASE_URL yet, skipping backup"; exit 0; }
F="$DIR/connectly-$(date +%Y%m%d-%H%M%S).dump"
pg_dump "$DBURL" -Fc --no-owner --no-privileges -f "$F"
ls -1t "$DIR"/connectly-*.dump | tail -n +11 | xargs -r rm -f
echo "local backup: $F"
