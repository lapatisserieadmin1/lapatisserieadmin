#!/usr/bin/env bash
# Two-session check of the kitchen lock order (migration 20261003000100_kitchen_review_fixes).
#
# Session A is an admin editing a confirmed order: it holds the order lock (as update_order_items
# does from its first statement) and is slow. Session B is a chef starting that order's ticket in the
# meantime. Both must succeed one after the other; before the fix the chef locked the ticket first
# and the two deadlocked.
#
#   supabase/local/concurrency-kitchen.sh                    # current migrations: expect PASS
#   EXCLUDE=20261003000100 supabase/local/concurrency-kitchen.sh   # without the fix: expect a deadlock
#
# Uses a scratch database (DB, default bakery_concurrency) that is dropped and recreated.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
db=${DB:-bakery_concurrency}
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
q() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$db" "$@"; }

psql -X -q -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null 2>&1
q -f "$here/shim.sql" >/dev/null
for f in "$root"/migrations/*.sql; do
  if [ -n "${EXCLUDE:-}" ] && [[ "$(basename "$f")" == ${EXCLUDE}* ]]; then echo "skipping $(basename "$f")"; continue; fi
  q -f "$f" >/dev/null
done

admin=00000000-0000-0000-0000-00000000c0a1
chef=00000000-0000-0000-0000-00000000c0f1
q >/dev/null <<SQL
insert into auth.users (id, email, aud, role) values
  ('$admin', 'cc-a@t.local', 'authenticated', 'authenticated'),
  ('$chef', 'cc-f@t.local', 'authenticated', 'authenticated');
insert into public.staff_profiles (user_id, full_name, role) values ('$admin', 'Cc Admin', 'admin'), ('$chef', 'Cc Chef', 'chef');
insert into public.kitchens (code, name) values ('CK1', 'C Kitchen');
insert into public.staff_kitchens (user_id, kitchen_id) select '$chef', id from public.kitchens where code = 'CK1';
delete from public.capacity_overrides; delete from public.category_daily_caps; delete from public.pickup_windows; delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;
insert into public.categories (name) values ('C Bakes');
insert into public.products (category_id, name, prep_type, tax_rate_bps) select id, 'C Cake', 'made_to_order', 500 from public.categories where name = 'C Bakes';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, '1 kg', 50000, 60, k.id from public.products p, public.kitchens k where p.name = 'C Cake' and k.code = 'CK1';
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$admin","role":"authenticated"}', true);
select public.create_order(gen_random_uuid(), 'CALL',
  jsonb_build_array(jsonb_build_object('variant_id', (select id from public.product_variants where name = '1 kg'), 'quantity', 1)),
  p_customer_name => 'Cc Customer', p_customer_phone => '9000000901',
  p_due_at => (((now() at time zone 'Asia/Kolkata')::date + 3) + time '12:00') at time zone 'Asia/Kolkata',
  p_confirm => true);
commit;
SQL

order_id=$(q -c "select id from public.orders limit 1")
version=$(q -c "select version from public.orders where id = '$order_id'")
item=$(q -c "select id from public.order_items where order_id = '$order_id'")
ticket=$(q -c "select id from public.kitchen_tickets where order_id = '$order_id'")
echo "order $(q -c "select reference || ' ' || status from public.orders where id = '$order_id'"), ticket $(q -c "select reference || ' ' || status from public.kitchen_tickets where id = '$ticket'")"

# Session A: admin edit holding the order lock for 2 s before editing.
q >"$out/a.txt" 2>&1 <<SQL &
begin;
select 1 from public.orders where id = '$order_id' for update;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$admin","role":"authenticated"}', true);
select pg_sleep(2);
select 'A edited: ' || status || ' v' || version
from public.update_order_items('$order_id', $version, '[{"line_id": "$item", "quantity": 2}]'::jsonb, 'Customer wants two');
commit;
SQL
a_pid=$!
sleep 0.5

# Session B: the chef starts the ticket while A holds the order.
q >"$out/b.txt" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$chef","role":"authenticated"}', true);
select 'B started: ' || status || ' r' || revision from public.start_ticket('$ticket');
commit;
SQL
b_pid=$!

a_status=0; b_status=0
wait $a_pid || a_status=$?
wait $b_pid || b_status=$?
echo "session A (admin edit): exit $a_status: $(tr '\n' ' ' <"$out/a.txt")"
echo "session B (chef start): exit $b_status: $(tr '\n' ' ' <"$out/b.txt")"
final=$(q -c "select t.status || ' r' || t.revision || ' qty ' || l.quantity from public.kitchen_tickets t join public.kitchen_ticket_lines l on l.ticket_id = t.id where t.id = '$ticket'")
echo "ticket afterwards: $final"

if grep -qi deadlock "$out/a.txt" "$out/b.txt"; then
  echo "FAIL: deadlock"; exit 1
fi
if [ $a_status -ne 0 ] || [ $b_status -ne 0 ] || [ "$final" != "preparing r2 qty 2" ]; then
  echo "FAIL: expected both sessions to succeed and the ticket to be 'preparing r2 qty 2'"; exit 1
fi
echo "PASS: the chef waited for the admin edit, then started the revised ticket"
