#!/usr/bin/env bash
# Runs the SQL rule checks without touching the Supabase project.
#
# Builds a scratch database on a local PostgreSQL (16+) from supabase/local/shim.sql (stand-ins for
# Supabase's auth schema and API roles) and every file in supabase/migrations, then runs each
# supabase/tests/*.sql check file (except qa_users.sql) and compares every outcome with the
# expectation written in the file (supabase/local/check_results.py).
#
#   supabase/local/run-tests.sh                 # all check files
#   supabase/local/run-tests.sh kitchen_logic   # one file
#
# Connects with psql's defaults (PGHOST, PGUSER, ...); the role must be a superuser. DB names the
# scratch database (default bakery_test), which is dropped and recreated each run.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
db=${DB:-bakery_test}
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

psql -X -q -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/shim.sql" >/dev/null
for f in "$root"/migrations/*.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$f" >/dev/null || { echo "migration failed: $(basename "$f")"; exit 1; }
done
echo "migrations applied: $(ls "$root"/migrations/*.sql | wc -l)"

if [ $# -gt 0 ]; then
  tests=$(for t in "$@"; do echo "$root/tests/$t.sql"; done)
else
  tests=$(ls "$root"/tests/*.sql | grep -v qa_users.sql)
fi

status=0
for t in $tests; do
  name=$(basename "$t" .sql)
  echo "$name"
  if ! psql -X -t -A -F ' => ' -v ON_ERROR_STOP=1 -d "$db" -f "$t" >"$out/$name.out" 2>"$out/$name.err"; then
    echo "  ERROR running $name:"; sed 's/^/    /' "$out/$name.err" | head -20; status=1; continue
  fi
  python3 "$here/check_results.py" "$t" "$out/$name.out" || status=1
done
exit $status
