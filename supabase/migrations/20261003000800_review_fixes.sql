-- Final review of the sales report and chef PIN sign-in (2026-10-03).
--
-- 1. PIN logins are recorded by their Supabase session id. Whether a login is a PIN login, and
--    whether it may continue, is now decided by the database, not by a browser cookie that can be
--    lost (browser restart) or deleted. Revoking a tablet, or setting or removing a chef's PIN,
--    deletes those logins from auth.sessions, which also ends their refresh tokens; an access token
--    already issued lasts until it expires (about an hour) but the kitchen screen stops at its next
--    10-second check. Replaces public.kitchen_pin_session_valid.
-- 2. The sales report gives CGST, SGST and taxable value separately, for bills, credit notes and net
--    (the spec asked for them; the first version gave only combined GST).

-- ---------------------------------------------------------------------------
-- 1. PIN logins
-- ---------------------------------------------------------------------------

create table public.kitchen_pin_sessions (
  session_id uuid primary key,
  device_id uuid not null references public.kitchen_devices (id) on delete cascade,
  user_id uuid not null references public.staff_profiles (user_id) on delete cascade,
  signed_in_at timestamptz not null,
  ended_at timestamptz -- set when a revoke or PIN change ends it; never valid again
);
create index kitchen_pin_sessions_device_id_idx on public.kitchen_pin_sessions (device_id);
create index kitchen_pin_sessions_user_id_idx on public.kitchen_pin_sessions (user_id);
alter table public.kitchen_pin_sessions enable row level security;
-- No policies and no grants: only the functions below (and the service role) touch it.
revoke all on public.kitchen_pin_sessions from anon, authenticated;

-- Ends PIN logins: marks them ended (so the kitchen screen stops them at its next check) and deletes
-- them from Supabase Auth (their refresh tokens go with them).
create function private.end_pin_logins(p_session_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.kitchen_pin_sessions set ended_at = now()
  where session_id = any (coalesce(p_session_ids, '{}')) and ended_at is null;
  delete from auth.sessions where id = any (coalesce(p_session_ids, '{}'));
$$;
revoke execute on function private.end_pin_logins(uuid[]) from public;

-- Called by the web server right after it opens a chef's session from a PIN.
create function public.record_kitchen_pin_session(p_session_id uuid, p_device_id uuid, p_user_id uuid, p_signed_in_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.kitchen_pin_sessions (session_id, device_id, user_id, signed_in_at)
  values (p_session_id, p_device_id, p_user_id, p_signed_in_at)
  on conflict (session_id) do nothing
$$;

-- For a signed-in chef's session: 'none' when it was not opened by PIN (email and password), 'ok'
-- while it is used on the tablet it was opened on (p_token_hash: that browser's tablet cookie hash),
-- the tablet is still registered, the chef still active there and the PIN unchanged since; otherwise
-- 'invalid'.
create function public.kitchen_pin_session_status(p_session_id uuid, p_token_hash text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when ps.session_id is null then 'none'
    when exists (
      select 1
      from public.kitchen_devices d
      join public.staff_profiles p on p.user_id = ps.user_id and p.is_active and p.role = 'chef'
      join public.staff_kitchens sk on sk.user_id = p.user_id and sk.kitchen_id = d.kitchen_id
      join public.staff_pins sp on sp.user_id = p.user_id
      where ps.ended_at is null and d.id = ps.device_id and d.token_hash = p_token_hash and d.revoked_at is null
        and sp.set_at <= ps.signed_in_at) then 'ok'
    else 'invalid'
  end
  from (select 1) one
  left join public.kitchen_pin_sessions ps on ps.session_id = p_session_id
$$;

revoke execute on function
  public.record_kitchen_pin_session(uuid, uuid, uuid, timestamptz),
  public.kitchen_pin_session_status(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.record_kitchen_pin_session(uuid, uuid, uuid, timestamptz),
  public.kitchen_pin_session_status(uuid, text)
  to service_role;

drop function public.kitchen_pin_session_valid(text, uuid, timestamptz);

create or replace function public.set_staff_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can set PINs.', 'forbidden');
  end if;
  if not exists (select 1 from public.staff_profiles where user_id = p_user_id and role = 'chef') then
    perform private.fail('PINs are only for chefs.');
  end if;
  -- A new or removed PIN ends every login this chef opened with the old one, on any tablet.
  perform private.end_pin_logins(array(select session_id from public.kitchen_pin_sessions where user_id = p_user_id and ended_at is null));
  if p_pin is null then
    delete from public.staff_pins where user_id = p_user_id;
    insert into public.audit_events (actor_id, action, table_name, record_id, old_data)
    values (auth.uid(), 'DELETE', 'staff_pins', p_user_id::text, jsonb_build_object('pin', 'cleared'));
    return;
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    perform private.fail('A PIN is 4 to 6 digits.');
  end if;
  insert into public.staff_pins (user_id, pin_hash, set_at, set_by)
  values (p_user_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), now(), auth.uid())
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, set_at = excluded.set_at, set_by = excluded.set_by;
  insert into public.audit_events (actor_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'UPDATE', 'staff_pins', p_user_id::text, jsonb_build_object('pin_set_at', now()));
end;
$$;

create or replace function public.revoke_kitchen_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can revoke kitchen tablets.', 'forbidden');
  end if;
  update public.kitchen_devices set revoked_at = now(), revoked_by = auth.uid()
  where id = p_device_id and revoked_at is null;
  if not found and not exists (select 1 from public.kitchen_devices where id = p_device_id) then
    perform private.fail('Tablet not found.', 'not_found');
  end if;
  -- Every login opened by PIN on this tablet ends now, whatever the tablet's cookies say.
  perform private.end_pin_logins(array(select session_id from public.kitchen_pin_sessions where device_id = p_device_id and ended_at is null));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Sales report: CGST, SGST and taxable value
-- ---------------------------------------------------------------------------

create or replace function public.sales_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz text := private.business_timezone();
  t0 timestamptz;
  t1 timestamptz;
  result jsonb;
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can see sales reports.', 'forbidden');
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    perform private.fail('Choose a start date on or before the end date.');
  end if;
  if p_to - p_from > 365 then
    perform private.fail('Choose a range of at most one year.');
  end if;
  t0 := p_from::timestamp at time zone tz;
  t1 := (p_to + 1)::timestamp at time zone tz;

  with
  b as (
    select b.*, o.source from public.bills b join public.orders o on o.id = b.order_id
    where b.issued_at >= t0 and b.issued_at < t1
  ),
  cn as (
    select cn.*, o.source from public.credit_notes cn
    join public.bills b on b.id = cn.bill_id join public.orders o on o.id = b.order_id
    where cn.issued_at >= t0 and cn.issued_at < t1
  ),
  lines as (
    select b.order_id, (l ->> 'line_no')::integer as line_no, l ->> 'name' as name, l ->> 'variant' as variant,
           (l ->> 'quantity')::integer as quantity, (l ->> 'gross_paise')::bigint as gross,
           (l ->> 'discount_paise')::bigint as discount, (l ->> 'net_paise')::bigint as net
    from b cross join lateral jsonb_array_elements(b.lines) l
  ),
  p as (
    select * from public.payments where recorded_at >= t0 and recorded_at < t1
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'timezone', tz,
    'summary', (
      select jsonb_build_object(
        'bills', (select count(*) from b),
        'gross_paise', coalesce((select sum(subtotal_paise) from b), 0),
        'discount_paise', coalesce((select sum(discount_paise) from b), 0),
        'billed_paise', coalesce((select sum(total_paise) from b), 0),
        'tax_paise', coalesce((select sum(cgst_paise + sgst_paise) from b), 0),
        'cgst_paise', coalesce((select sum(cgst_paise) from b), 0),
        'sgst_paise', coalesce((select sum(sgst_paise) from b), 0),
        'taxable_paise', coalesce((select sum(taxable_paise) from b), 0),
        'credit_notes', (select count(*) from cn),
        'credited_paise', coalesce((select sum(total_paise) from cn), 0),
        'credited_tax_paise', coalesce((select sum(cgst_paise + sgst_paise) from cn), 0),
        'credited_cgst_paise', coalesce((select sum(cgst_paise) from cn), 0),
        'credited_sgst_paise', coalesce((select sum(sgst_paise) from cn), 0),
        'credited_taxable_paise', coalesce((select sum(taxable_paise) from cn), 0),
        'net_cgst_paise', coalesce((select sum(cgst_paise) from b), 0) - coalesce((select sum(cgst_paise) from cn), 0),
        'net_sgst_paise', coalesce((select sum(sgst_paise) from b), 0) - coalesce((select sum(sgst_paise) from cn), 0),
        'net_taxable_paise', coalesce((select sum(taxable_paise) from b), 0) - coalesce((select sum(taxable_paise) from cn), 0),
        'net_paise', coalesce((select sum(total_paise) from b), 0) - coalesce((select sum(total_paise) from cn), 0),
        'net_tax_paise', coalesce((select sum(cgst_paise + sgst_paise) from b), 0)
                         - coalesce((select sum(cgst_paise + sgst_paise) from cn), 0))),
    'money', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'method', method, 'received_paise', received, 'refunded_paise', refunded) order by method::text), '[]')
      from (select method,
                   coalesce(sum(amount_paise) filter (where kind = 'payment'), 0) as received,
                   coalesce(sum(amount_paise) filter (where kind = 'refund'), 0) as refunded
            from p group by method) x),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', name, 'variant', variant, 'quantity', quantity,
               'gross_paise', gross, 'discount_paise', discount, 'net_paise', net) order by net desc, name, variant), '[]')
      from (select name, variant, sum(quantity) as quantity, sum(gross) as gross, sum(discount) as discount, sum(net) as net
            from lines group by name, variant) x),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', name, 'quantity', quantity,
               'gross_paise', gross, 'discount_paise', discount, 'net_paise', net) order by net desc, name), '[]')
      from (select coalesce(c.name, 'Uncategorised') as name, sum(l.quantity) as quantity, sum(l.gross) as gross,
                   sum(l.discount) as discount, sum(l.net) as net
            from lines l
            left join public.order_items oi on oi.order_id = l.order_id and oi.line_no = l.line_no
            left join public.categories c on c.id = oi.category_id
            group by 1) x),
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'source', source, 'bills', bills, 'billed_paise', billed,
               'credited_paise', credited, 'net_paise', billed - credited) order by source::text), '[]')
      from (select source, sum(bills) as bills, sum(billed) as billed, sum(credited) as credited
            from (select source, 1 as bills, total_paise as billed, 0::bigint as credited from b
                  union all
                  select source, 0, 0, total_paise from cn) u
            group by source) x)
  ) into result;
  return result;
end;
$$;
