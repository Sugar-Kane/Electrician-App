#!/usr/bin/env bash
# Builds a disposable database from every migration in supabase/migrations, in
# order, on a local Postgres, then (optionally) runs a test file against it.
#
#   scripts/security/replay-migrations.sh                       # build only
#   scripts/security/replay-migrations.sh scripts/security/tenant-isolation-test.sql
#
# Connection comes from the usual PG* variables (PGHOST, PGPORT, PGUSER). The
# database is named by REPLAY_DB (default volteira_replay) and is DROPPED and
# recreated: never point this at a real project. pg_cron and pg_net lines are
# skipped (scripts/security/full-replay-stub.sql stands in for them), so no
# scheduled HTTP call is ever replayed.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${REPLAY_DB:-volteira_replay}"
case "$DB" in postgres|template0|template1) echo "refusing to use $DB" >&2; exit 2 ;; esac

psql -q -d postgres -c "drop database if exists \"$DB\"" -c "create database \"$DB\""
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f scripts/security/full-replay-stub.sql >/dev/null 2>&1 \
  || psql -q -d "$DB" -v ON_ERROR_STOP=1 -f scripts/security/full-replay-stub.sql

count=0
for file in supabase/migrations/*.sql; do
  if ! sed -E '/create extension[^;]*(pg_cron|pg_net)/Id' "$file" | psql -q -d "$DB" -v ON_ERROR_STOP=1 >/dev/null 2>/tmp/replay-error.txt; then
    echo "FAILED: $file" >&2; grep -v NOTICE /tmp/replay-error.txt | tail -5 >&2; exit 1
  fi
  count=$((count + 1))
done
echo "replayed $count migrations into $DB"

if [ "${1:-}" != "" ]; then
  psql -d "$DB" -v ON_ERROR_STOP=1 -f "$1"
fi
