#!/usr/bin/env bash
# Off-server encrypted backup, run from YOUR machine (needs gh logged in + gpg).
# Usage: CODESPACE=<name> PASSFILE=/path/to/passphrase.txt bash scripts/backup-offsite.sh [dest-dir]
# Produces <dest>/<timestamp>/{connectly-db.dump,connectly-uploads.tgz}.gpg + SHA256SUMS(.gpg), verifies decryption.
# The passphrase file is never printed and must never be committed.
set -euo pipefail
C="${CODESPACE:?set CODESPACE}"; PASSFILE="${PASSFILE:?set PASSFILE}"
D="${1:-$HOME/connectly-backups}/$(date +%Y%m%d-%H%M)"; umask 077; mkdir -p "$D"; cd "$D"
gh codespace ssh -c "$C" -- 'cd /workspaces/connectly && DBURL=$(grep ^DATABASE_URL= .env | cut -d= -f2-) && rm -rf ~/bk && mkdir -m 700 ~/bk && pg_dump "$DBURL" -Fc --no-owner --no-privileges -f ~/bk/connectly-db.dump && tar czf ~/bk/connectly-uploads.tgz uploads && cd ~/bk && sha256sum connectly-* > SHA256SUMS'
gh codespace cp -e -c "$C" 'remote:~/bk/connectly-db.dump' 'remote:~/bk/connectly-uploads.tgz' 'remote:~/bk/SHA256SUMS' .
gh codespace ssh -c "$C" -- 'rm -rf ~/bk'
sha256sum -c SHA256SUMS
for f in connectly-db.dump connectly-uploads.tgz SHA256SUMS; do gpg --batch --yes --pinentry-mode loopback --passphrase-file "$PASSFILE" --symmetric --cipher-algo AES256 -o "$f.gpg" "$f"; done
for f in connectly-db.dump connectly-uploads.tgz; do gpg --batch -q --pinentry-mode loopback --passphrase-file "$PASSFILE" -d "$f.gpg" | sha256sum | sed "s|-|$f|"; done | sort | diff - <(sort SHA256SUMS)
mv SHA256SUMS SHA256SUMS.plain; shred -u connectly-db.dump connectly-uploads.tgz 2>/dev/null || rm -f connectly-db.dump connectly-uploads.tgz
echo "OK encrypted + verified: $D"
