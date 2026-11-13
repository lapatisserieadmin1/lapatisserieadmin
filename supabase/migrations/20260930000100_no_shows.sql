-- Phase 4C: no-show recording and customer blocking (PRD 5F, HANDOVER section 9).
-- Recording a no-show never changes the order's status; staff cancel or complete it separately.
-- Each order counts towards customers.no_show_count at most once (orders.no_show_at).

alter table public.orders
  add column no_show_at timestamptz,
  add column no_show_by uuid references auth.users (id) on delete set null;
create index orders_no_show_by_idx on public.orders (no_show_by);

-- Block and unblock history. customers.blocked_reason holds only the current reason,
-- so the reason for unblocking would otherwise be lost.
create table public.customer_events (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  event_type text not null check (event_type in ('blocked', 'unblocked')),
  reason text not null
);
create index customer_events_customer_idx on public.customer_events (customer_id, occurred_at);

create trigger customer_events_audit after insert or update or delete on public.customer_events
  for each row execute function private.audit_row('id');

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

create function public.record_no_show(p_order_id uuid, p_expected_version integer)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  total integer;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to record no-shows.', 'forbidden');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.customer_id is null then
    perform private.fail('This order has no customer phone number to record a no-show against.');
  end if;
  if o.no_show_at is not null then
    perform private.fail('A no-show is already recorded for this order.');
  end if;
  if o.status not in ('confirmed', 'preparing', 'ready', 'cancelled') then
    perform private.fail(format('A no-show cannot be recorded on a %s order.', replace(o.status::text, '_', ' ')));
  end if;
  if o.due_at > now() then
    perform private.fail('The pickup time has not passed yet.');
  end if;

  update public.orders
  set no_show_at = now(), no_show_by = auth.uid(), version = version + 1
  where id = o.id
  returning * into o;
  update public.customers set no_show_count = no_show_count + 1
  where id = o.customer_id
  returning no_show_count into total;
  perform private.log_order_event(o.id, 'no_show_recorded', null, jsonb_build_object('no_show_count', total));
  return o;
end;
$$;

create function public.undo_no_show(p_order_id uuid, p_expected_version integer, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
  total integer;
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can undo a no-show.', 'forbidden');
  end if;
  if reason is null then
    perform private.fail('Give a reason for undoing the no-show.');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.no_show_at is null then
    perform private.fail('No no-show is recorded for this order.');
  end if;

  update public.orders
  set no_show_at = null, no_show_by = null, version = version + 1
  where id = o.id
  returning * into o;
  update public.customers set no_show_count = greatest(no_show_count - 1, 0)
  where id = o.customer_id
  returning no_show_count into total;
  perform private.log_order_event(o.id, 'no_show_undone', reason, jsonb_build_object('no_show_count', total));
  return o;
end;
$$;

create function public.set_customer_blocked(p_customer_id uuid, p_blocked boolean, p_reason text)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.customers;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can block or unblock customers.', 'forbidden');
  end if;
  if p_blocked is null then
    perform private.fail('Choose whether to block or unblock.');
  end if;
  if reason is null then
    perform private.fail(case when p_blocked then 'Give a reason for blocking.' else 'Give a reason for unblocking.' end);
  end if;
  if length(reason) > 300 then
    perform private.fail('The reason is too long (300 characters at most).');
  end if;

  select * into c from public.customers where id = p_customer_id for update;
  if not found then
    perform private.fail('Customer not found.', 'not_found');
  end if;
  if c.is_blocked = p_blocked then
    perform private.fail(case when p_blocked then 'This customer is already blocked.' else 'This customer is not blocked.' end, 'conflict');
  end if;

  update public.customers
  set is_blocked = p_blocked, blocked_reason = case when p_blocked then reason end
  where id = c.id
  returning * into c;
  insert into public.customer_events (customer_id, actor_id, event_type, reason)
  values (c.id, auth.uid(), case when p_blocked then 'blocked' else 'unblocked' end, reason);
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

alter table public.customer_events enable row level security;
create policy "Admin and counter read customer events" on public.customer_events for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));

revoke all on public.customer_events from anon, authenticated;
grant select on public.customer_events to authenticated;

revoke execute on function
  public.record_no_show(uuid, integer),
  public.undo_no_show(uuid, integer, text),
  public.set_customer_blocked(uuid, boolean, text)
  from public, anon;
grant execute on function
  public.record_no_show(uuid, integer),
  public.undo_no_show(uuid, integer, text),
  public.set_customer_blocked(uuid, boolean, text)
  to authenticated;
