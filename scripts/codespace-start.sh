#!/usr/bin/env bash
# (Re)starts Connectly inside a Codespace: Postgres + build + migrations + seed + server on :3000.
# Safe to run repeatedly. No sudo needed: Postgres runs as the current user, data in ~/pgdata, localhost:5433 only (5432 may be taken by the image default cluster).
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
export PGDATA="$HOME/pgdata"
umask 077
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  openssl rand -hex 16 > "$HOME/.pg_superuser_pw"
  "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=scram-sha-256 --pwfile="$HOME/.pg_superuser_pw" >/dev/null
fi
"$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1 || \
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$HOME/pg.log" -w -o "-c listen_addresses=localhost -c port=5433 -k /tmp" start >/dev/null
export PGPASSWORD=$(cat "$HOME/.pg_superuser_pw")
PSQL="$PGBIN/psql -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
touch .env
if ! $PSQL -tc "SELECT 1 FROM pg_roles WHERE rolname='connectly'" | grep -q 1; then
  PW=$(openssl rand -hex 16)
  $PSQL -c "CREATE USER connectly WITH PASSWORD '$PW'"
  $PSQL -c "CREATE DATABASE connectly OWNER connectly"
  sed -i '/^DATABASE_URL=/d' .env
  echo "DATABASE_URL=postgres://connectly:$PW@localhost:5433/connectly" >> .env
fi
unset PGPASSWORD
if ! grep -q '^APP_URL=' .env; then
  echo "APP_URL=https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}" >> .env
  printf 'PORT=3000\nNODE_ENV=production\nCOOKIE_SECURE=true\nUPLOAD_DIR=./uploads\n' >> .env
fi
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build >/dev/null
npm run seed
pkill -f "node server/index.js" 2>/dev/null || true
setsid nohup npm start > /tmp/app.log 2>&1 < /dev/null &
sleep 3; curl -fsS localhost:3000/api/health && echo " Connectly is up"
