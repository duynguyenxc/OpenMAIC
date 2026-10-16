#!/usr/bin/env bash
# Level 2 — pull the whole live database down to this machine.
#
# The live database is Supabase, because a Vercel staging deployment cannot
# reach a laptop and because user_profiles references Supabase's own
# auth.users. This script keeps a complete local copy anyway: every table in
# public (OpenMAIC's 17 and our 4) plus the auth schema, so a backup can be
# restored and read offline.
#
# Backups contain password hashes and session rows. db/backups/ is gitignored;
# treat the files as credentials.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.level2"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }
URL="$(grep '^POSTGRES_URL_NON_POOLING=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
[ -n "$URL" ] || { echo "POSTGRES_URL_NON_POOLING not set"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="db/backups/openmaic-${STAMP}.dump"
mkdir -p db/backups

echo "Dumping live database -> ${OUT}"
# Custom format: compressed, and restorable table-by-table with pg_restore.
# auth is included so the copy is complete; supabase-internal schemas that the
# role cannot read are skipped rather than failing the whole dump.
pg_dump "$URL" \
  --format=custom --no-owner --no-privileges \
  --schema=public --schema=auth \
  --file="$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "Wrote ${OUT} (${SIZE})"

# Keep the ten most recent; a prototype does not need more and these are large.
ls -1t db/backups/openmaic-*.dump 2>/dev/null | tail -n +11 | while read -r old; do
  echo "Removing old backup ${old}"; rm -f "$old"
done

echo
echo "Restore into the local mirror with:  scripts/level2-db-mirror.sh"
