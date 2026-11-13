-- Phase 5B: packing and handover (docs/superpowers/specs/2026-10-03-packing-handover-design.md).
-- One packing confirmation moves an order to Ready; one handover moves it to Completed, after the
-- balance check (AC-10) and with a GST bill. Admins may reopen packing or hand over on credit, with
-- a reason. No stock is allocated or counted (owner decision, 2026-10-02).

alter table public.orders
  add column packed_at timestamptz,
  add column packed_by uuid references auth.users (id) on delete set null,
  add column packing_note text check (packing_note is null or length(packing_note) <= 300),
  add column handed_over_by uuid references auth.users (id) on delete set null,
  add column collected_by text check (collected_by is null or length(collected_by) between 1 and 80),
  add column credit_reason text check (credit_reason is null or length(credit_reason) between 5 and 300);
create index orders_packed_by_idx on public.orders (packed_by);
create index orders_handed_over_by_idx on public.orders (handed_over_by);

-- What the customer still owes (negative: a refund is due). Same rule as order_summaries.balance_paise.
create function private.order_balance(p_order_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (case when o.status in ('cancelled', 'rejected') then 0
               else o.total_paise - coalesce((select sum(cn.total_paise) from public.credit_notes cn
                                               join public.bills b on b.id = cn.bill_id where b.order_id = o.id), 0) end)
         - coalesce((select sum(p.amount_paise) from public.payments p where p.order_id = o.id and p.kind = 'payment'), 0)
         + coalesce((select sum(p.amount_paise) from public.payments p where p.order_id = o.id and p.kind = 'refund'), 0)
  from public.orders o where o.id = p_order_id
$$;

revoke execute on function private.order_balance(uuid) from public;

-- ---------------------------------------------------------------------------
-- Packing
-- ---------------------------------------------------------------------------

-- Admin and counter staff. Every live kitchen ticket must be ready and no kitchen issue open.
create function public.mark_packed(p_order_id uuid, p_expected_version integer, p_note text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  waiting text;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('Only admin and counter staff can pack orders.', 'forbidden');
  end if;
  select * into o from public.orders where id = p_order_id;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;
  -- Packing again changes nothing (a double tap or a retry after a lost answer).
  if o.status = 'ready' and o.packed_at is not null then
    return o;
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status not in ('confirmed', 'preparing') then
    perform private.fail(format('Only confirmed or preparing orders can be packed; this one is %s.', replace(o.status::text, '_', ' ')));
  end if;
  if length(v_note) > 300 then
    perform private.fail('Keep the packing note under 300 characters.');
  end if;

  select string_agg(k.name || ' (' || t.status::text || ')', ', ' order by k.name) into waiting
  from public.kitchen_tickets t join public.kitchens k on k.id = t.kitchen_id
  where t.order_id = o.id and t.status not in ('ready', 'cancelled');
  if waiting is not null then
    perform private.fail(format('Not every kitchen has finished: %s.', waiting), 'kitchen');
  end if;
  if exists (select 1 from public.kitchen_issues i join public.kitchen_tickets t on t.id = i.ticket_id
             where t.order_id = o.id and i.resolved_at is null) then
    perform private.fail('Resolve the open kitchen issue before packing.', 'kitchen');
  end if;

  update public.orders
  set status = 'ready', packed_at = now(), packed_by = auth.uid(), packing_note = v_note, version = version + 1
  where id = o.id
  returning * into o;
  perform private.log_order_event(o.id, 'packed', null, jsonb_strip_nulls(jsonb_build_object('note', v_note)));
  return o;
end;
$$;

-- Admin only, with a reason: back to Preparing (Confirmed when the order has no kitchen tickets).
create function public.reopen_packing(p_order_id uuid, p_expected_version integer, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can reopen a packed order.', 'forbidden');
  end if;
  if reason is null or length(reason) < 5 then
    perform private.fail('Give a reason of at least 5 characters for reopening.');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status <> 'ready' then
    perform private.fail(format('Only ready orders can be reopened; this one is %s.', replace(o.status::text, '_', ' ')));
  end if;

  update public.orders
  set status = (case when exists (select 1 from public.kitchen_tickets t where t.order_id = o.id and t.status <> 'cancelled')
                     then 'preparing' else 'confirmed' end)::public.order_status,
      packed_at = null, packed_by = null, packing_note = null, version = version + 1
  where id = o.id
  returning * into o;
  perform private.log_order_event(o.id, 'packing_reopened', reason);
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- Handover
-- ---------------------------------------------------------------------------

-- Admin and counter staff, ready orders only. A balance due needs an admin and a credit reason.
-- Issues the GST bill if the order has none. Handing over again changes nothing.
create function public.record_handover(
  p_order_id uuid,
  p_expected_version integer,
  p_collected_by text default null,
  p_credit_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  collected text := nullif(trim(coalesce(p_collected_by, '')), '');
  credit text := nullif(trim(coalesce(p_credit_reason, '')), '');
  due bigint;
  b public.bills;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('Only admin and counter staff can hand orders over.', 'forbidden');
  end if;
  select * into o from public.orders where id = p_order_id;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;
  if o.status = 'completed' and o.handed_over_by is not null then
    return o;
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status in ('confirmed', 'preparing') then
    perform private.fail('Pack the order before handing it over.');
  end if;
  if o.status <> 'ready' then
    perform private.fail(format('Only ready orders can be handed over; this one is %s.', replace(o.status::text, '_', ' ')));
  end if;
  if length(collected) > 80 then
    perform private.fail('Keep the collector''s name under 80 characters.');
  end if;

  due := private.order_balance(o.id);
  if due > 0 then
    if credit is null then
      perform private.fail(format('₹%s is still due. Record the payment first, or an admin can hand over on credit with a reason.',
        to_char(due / 100.0, 'FM999999990.00')), 'balance');
    end if;
    if not private.has_role(array['admin']::public.staff_role[]) then
      perform private.fail('Only an admin can hand over an order with a balance due.', 'forbidden');
    end if;
    if length(credit) < 5 or length(credit) > 300 then
      perform private.fail('Give a credit reason of 5 to 300 characters.');
    end if;
  else
    credit := null;
  end if;

  b := private.issue_bill_locked(o);

  update public.orders
  set status = 'completed', completed_at = now(), handed_over_by = auth.uid(),
      collected_by = collected, credit_reason = credit, version = version + 1
  where id = o.id
  returning * into o;
  perform private.log_order_event(o.id, 'handed_over', credit,
    jsonb_strip_nulls(jsonb_build_object('collected_by', collected, 'balance_paise', case when due > 0 then due end,
                                         'bill_number', b.bill_number)));
  return o;
end;
$$;

revoke execute on function
  public.mark_packed(uuid, integer, text),
  public.reopen_packing(uuid, integer, text),
  public.record_handover(uuid, integer, text, text)
  from public, anon;
grant execute on function
  public.mark_packed(uuid, integer, text),
  public.reopen_packing(uuid, integer, text),
  public.record_handover(uuid, integer, text, text)
  to authenticated;
