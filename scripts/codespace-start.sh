#!/usr/bin/env bash
# (Re)starts Connectly inside a Codespace: Postgres + build + migrations + seed + server on :3000.
set -euo pipefail
cd "$(dirname "$0")/.."
sudo service postgresql start >/dev/null
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='connectly'" | grep -q 1 || {
  PW=$(openssl rand -hex 16)
  sudo -u postgres psql -c "CREATE USER connectly WITH PASSWORD '$PW'" >/dev/null
  sudo -u postgres psql -c "CREATE DATABASE connectly OWNER connectly" >/dev/null
  echo "DATABASE_URL=postgres://connectly:$PW@localhost:5432/connectly" > .env
}
if ! grep -q APP_URL .env; then
  echo "APP_URL=https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}" >> .env
  printf 'PORT=3000\nNODE_ENV=production\nCOOKIE_SECURE=true\nUPLOAD_DIR=./uploads\n' >> .env
fi
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build >/dev/null
npm run seed
pkill -f "node server/index.js" 2>/dev/null || true
setsid nohup npm start > /tmp/app.log 2>&1 < /dev/null &
sleep 3; curl -fsS localhost:3000/api/health && echo " Connectly is up"
