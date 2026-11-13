-- WhatsApp messages recorded on the order timeline (2026-10-19).
-- Runs in a transaction and rolls back. Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to anon, authenticated;
grant usage on sequence r_n_seq to anon, authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-000000000ac1','cm-c@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-000000000ac1','Cm Counter','counter');
insert into public.orders (order_number, idempotency_key, source, status, customer_name, customer_phone, requested_due_at)
  values (991001, gen_random_uuid(), 'CALL', 'confirmed', 'Meena', '9000001001', now() + interval '1 day');
insert into ctx select 'o', id::text from public.orders where order_number = 991001;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ac1","role":"authenticated"}', true);
do $$
declare o uuid := (select v::uuid from ctx where k = 'o');
begin
  perform public.record_customer_message(o, 'confirmed');
  -- expect: customer_message whatsapp confirmed by counter
  insert into r(check_name,outcome) values ('M1 counter staff record a message on the timeline',
    (select event_type || ' ' || (data ->> 'channel') || ' ' || (data ->> 'kind')
       || case when actor_id = '00000000-0000-0000-0000-000000000ac1' then ' by counter' else ' ?' end
     from public.order_events where order_id = o and event_type = 'customer_message'));

  begin perform public.record_customer_message(o, 'spam');
    insert into r(check_name,outcome) values ('M2 unknown messages are refused', 'ALLOWED');
  -- expect: Unknown message.
  exception when others then insert into r(check_name,outcome) values ('M2 unknown messages are refused', sqlerrm); end;

  begin perform public.record_customer_message(gen_random_uuid(), 'thanks');
    insert into r(check_name,outcome) values ('M3 unknown orders are refused', 'ALLOWED');
  -- expect: Order not found.
  exception when others then insert into r(check_name,outcome) values ('M3 unknown orders are refused', sqlerrm); end;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin perform public.record_customer_message((select v::uuid from ctx where k = 'o'), 'thanks');
    insert into r(check_name,outcome) values ('M4 visitors cannot record messages', 'ALLOWED');
  -- expect: permission denied for function record_customer_message
  exception when others then insert into r(check_name,outcome) values ('M4 visitors cannot record messages', sqlerrm); end;
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
