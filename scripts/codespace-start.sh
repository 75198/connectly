#!/usr/bin/env bash
# (Re)starts Connectly inside a Codespace: Postgres + build + migrations + seed + server on :3000.
# Safe to run repeatedly. No sudo needed: Postgres runs as the current user, localhost:5433 only (5432 may be taken by the image default cluster).
# Data lives in /workspaces/.connectly-pgdata (the persistent Codespaces volume, OUTSIDE the git repo) so it survives
# container rebuilds. The old location ~/pgdata is copied once (never deleted) if the new one is empty.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
PERSIST="${CONNECTLY_PERSIST_DIR:-/workspaces/.connectly-state}"
export PGDATA="${CONNECTLY_PGDATA:-/workspaces/.connectly-pgdata}"
umask 077
mkdir -p "$PERSIST"; chmod 700 "$PERSIST"
PWFILE="$PERSIST/pg_superuser_pw"
[ -s "$PWFILE" ] || { [ -s "$HOME/.pg_superuser_pw" ] && cp -p "$HOME/.pg_superuser_pw" "$PWFILE"; } || true
OLD="$HOME/pgdata"
if [ ! -s "$PGDATA/PG_VERSION" ] && [ -s "$OLD/PG_VERSION" ]; then
  echo "Moving database to persistent storage: $OLD -> $PGDATA (old copy kept)"
  "$PGBIN/pg_ctl" -D "$OLD" status >/dev/null 2>&1 && "$PGBIN/pg_ctl" -D "$OLD" -m fast -w stop >/dev/null
  mkdir -p "$PGDATA"; cp -a "$OLD/." "$PGDATA/"; rm -f "$PGDATA/postmaster.pid"
fi
if [ -d "$PGDATA" ]; then chmod 700 "$PGDATA"; fi
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  [ -s "$PWFILE" ] || openssl rand -hex 16 > "$PWFILE"
  "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=scram-sha-256 --pwfile="$PWFILE" >/dev/null
fi
"$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1 || \
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$HOME/pg.log" -w -o "-c listen_addresses=localhost -c port=5433 -k /tmp" start >/dev/null
export PGPASSWORD=$(cat "$PWFILE")
PSQL="$PGBIN/psql -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
touch .env; chmod 600 .env
if ! $PSQL -tc "SELECT 1 FROM pg_roles WHERE rolname='connectly'" | grep -q 1; then
  PW=$(openssl rand -hex 16)
  $PSQL -c "CREATE USER connectly WITH PASSWORD '$PW'"
  $PSQL -c "CREATE DATABASE connectly OWNER connectly"
  sed -i '/^DATABASE_URL=/d' .env
  echo "DATABASE_URL=postgres://connectly:$PW@localhost:5433/connectly" >> .env
fi
unset PGPASSWORD
grep -q '^CODE_SECRET=' .env || echo "CODE_SECRET=$(openssl rand -hex 32)" >> .env
if ! grep -q '^APP_URL=' .env; then
  echo "APP_URL=https://${CODESPACE_NAME:?set CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}" >> .env
  printf 'PORT=3000\nNODE_ENV=production\nCOOKIE_SECURE=true\nUPLOAD_DIR=./uploads\n' >> .env
fi
chmod 600 .env ADMIN_CREDENTIALS.txt 2>/dev/null || true   # secrets readable by owner only
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build >/dev/null
bash scripts/backup-local.sh || echo "WARNING: pre-start local backup failed"
npm run seed
[ -s data/geonames/cities500.txt ] || bash scripts/fetch-places.sh || echo "places load failed"
# never start with a world-readable .env
[ "$(stat -c %a .env)" = "600" ] || { echo "refusing to start: .env must be chmod 600"; exit 1; }
pkill -f "node server/index.js" 2>/dev/null || true
setsid nohup npm start > /tmp/app.log 2>&1 < /dev/null &
sleep 3; curl -fsS localhost:3000/api/health && echo " Connectly is up"
