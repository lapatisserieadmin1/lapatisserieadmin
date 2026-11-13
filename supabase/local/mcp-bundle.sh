#!/usr/bin/env bash
# Builds one SQL batch for the Supabase MCP execute_sql tool (or any client that returns only the
# last result): begin; the given migrations; the test body; then an exception that lists every
# check and rolls everything back. Nothing is committed.
#
#   supabase/local/mcp-bundle.sh revisions_logic supabase/migrations/20261003000300_kitchen_revisions.sql > bundle.sql
#
# Paste the file's contents into execute_sql. Save the error message (from "RESULTS" on, without
# that first line) to a file and check it with:
#   python supabase/local/check_results.py supabase/tests/<test>.sql <saved file>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
test=$1; shift
echo "begin;"
for m in "$@"; do cat "$m"; echo; done
# The test file without its own "begin;" and without its last two lines (select from r; rollback;).
sed '0,/^begin;$/d' "$here/../tests/$test.sql" | head -n -2
cat <<'SQL'
do $$ begin raise exception E'RESULTS\n%', (select string_agg(check_name || ' => ' || coalesce(outcome, 'NULL'), E'\n' order by n) from r); end $$;
SQL
