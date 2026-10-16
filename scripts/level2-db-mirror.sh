#!/usr/bin/env bash
# Level 2 — restore the newest backup into a local PostgreSQL database.
#
# The mirror is a read-only copy for inspection and offline work. It is never
# what the application writes to: that stays the live database, so the mirror
# cannot drift into being a second source of truth by accident.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${1:-openmaic_mirror}"
DUMP="$(ls -1t db/backups/openmaic-*.dump 2>/dev/null | head -1 || true)"
[ -n "$DUMP" ] || { echo "No backup found. Run scripts/level2-db-backup.sh first."; exit 1; }

echo "Restoring ${DUMP} into local database ${DB}"
psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}'" | grep -q 1 \
  || psql -U postgres -q -c "CREATE DATABASE ${DB}"

# auth and public come from the dump; recreate them clean so a second restore
# is not a merge of two moments in time.
psql -U postgres -d "${DB}" -q -c "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA public;"

# Supabase-managed roles do not exist locally; --no-owner already drops the
# ownership statements, and the remaining role grants are reported and skipped.
pg_restore --no-owner --no-privileges --dbname "postgresql://postgres@localhost:5432/${DB}" "$DUMP" 2>&1 \
  | grep -vE "already exists|must be owner|no privileges|role .* does not exist" || true

echo
echo "Mirror ready:  psql -U postgres -d ${DB}"
psql -U postgres -d "${DB}" -tAc "
  SELECT '  ' || table_schema || ': ' || count(*) || ' tables'
    FROM information_schema.tables
   WHERE table_schema IN ('public','auth') GROUP BY table_schema ORDER BY 1;"
