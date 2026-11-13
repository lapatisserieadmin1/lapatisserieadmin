-- Phase 4C review fixes.
-- 1. An order that keeps its pickup time (confirming it) is checked only against orders booked before it,
--    so a later admin override or a lowered limit refuses only the excess orders, not every order in the window.
--    New orders and orders moving to a new time are still checked against all other orders.
-- 2. pickup_availability can leave out one order, so the reschedule panel does not count the order itself.

create or replace function private.capacity_problem(p_order_id uuid, p_due timestamptz, out message text, out kind text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  tz text := private.business_timezone();
  local_ts timestamp := p_due at time zone tz;
  day date := (p_due at time zone tz)::date;
  win record;
  cat record;
  used integer;
  self public.orders;
  booked_before bigint;
begin
  -- Serialise capacity checks per business day so two bookings cannot both take the last place.
  perform pg_advisory_xact_lock(hashtext('capacity'), day - date '2000-01-01');

  select * into self from public.orders where id = p_order_id;
  if found and self.due_at = p_due then
    booked_before := self.order_number; -- keeping its time: only earlier bookings count against it
  end if;

  if exists (select 1 from private.windows_for_date(day)) then
    select * into win from private.window_for(local_ts);
    if not found then
      message := format('%s is outside the pickup windows for %s.', to_char(local_ts, 'FMHH12:MI AM'), to_char(local_ts, 'FMDay DD Mon'));
      kind := 'slot';
      return;
    end if;
    if win.max_orders is not null then
      select count(*) into used
      from private.counted_orders(day, p_order_id) o
      where (booked_before is null or o.order_number < booked_before)
        and (select x.starts_at from private.window_for(o.due_at at time zone tz) x) = win.starts_at;
      if used >= win.max_orders then
        message := format('Pickup window %s–%s is full (%s/%s).',
          to_char(win.starts_at, 'FMHH12:MI AM'), to_char(win.ends_at, 'FMHH12:MI AM'), used, win.max_orders);
        kind := 'capacity';
        return;
      end if;
    end if;
  end if;

  for cat in
    select c.id, c.name, private.category_cap(day, c.id) as cap
    from public.categories c
    where c.id in (select oi.category_id from public.order_items oi
                   where oi.order_id = p_order_id and oi.quantity > oi.cancelled_quantity)
    order by c.name
  loop
    continue when cat.cap is null;
    select count(*) into used
    from private.counted_orders(day, p_order_id) o
    where (booked_before is null or o.order_number < booked_before)
      and exists (select 1 from public.order_items oi
                  where oi.order_id = o.id and oi.category_id = cat.id and oi.quantity > oi.cancelled_quantity);
    if used >= cat.cap then
      message := format('%s: %s/%s orders on %s.', cat.name, used, cat.cap, to_char(day, 'FMDD Mon'));
      kind := 'capacity';
      return;
    end if;
  end loop;
end;
$$;

drop function public.pickup_availability(date);

-- Window and category usage for one business-local day, for the staff order screens (and the website later).
-- p_exclude_order leaves one order out of the counts (the order being rescheduled).
create function public.pickup_availability(p_date date, p_exclude_order uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz text := private.business_timezone();
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to see pickup availability.', 'forbidden');
  end if;
  return jsonb_build_object(
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'starts_at', to_char(w.starts_at, 'HH24:MI'),
        'ends_at', to_char(w.ends_at, 'HH24:MI'),
        'max', w.max_orders,
        'used', (select count(*) from private.counted_orders(p_date, p_exclude_order) o
                 where (select x.starts_at from private.window_for(o.due_at at time zone tz) x) = w.starts_at)
      ) order by w.starts_at)
      from private.windows_for_date(p_date) w), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', c.id,
        'name', c.name,
        'max', c.cap,
        'used', (select count(*) from private.counted_orders(p_date, p_exclude_order) o
                 where exists (select 1 from public.order_items oi
                               where oi.order_id = o.id and oi.category_id = c.id and oi.quantity > oi.cancelled_quantity))
      ) order by c.name)
      from (select cc.id, cc.name, private.category_cap(p_date, cc.id) as cap from public.categories cc) c
      where c.cap is not null), '[]'::jsonb)
  );
end;
$$;

revoke execute on function private.capacity_problem(uuid, timestamptz) from public;
revoke execute on function public.pickup_availability(date, uuid) from public, anon;
grant execute on function public.pickup_availability(date, uuid) to authenticated;
