-- Keep payment entry time for audit, and record the date the money actually changed hands.
alter table public.payments add column paid_at timestamptz;
update public.payments set paid_at = recorded_at where paid_at is null;
alter table public.payments alter column paid_at set default now();
alter table public.payments alter column paid_at set not null;
create index payments_paid_at_idx on public.payments (paid_at);

-- Update the current function without copying unrelated order-creation rules. Past dates are
-- permitted only through this staff-only RPC; website orders use a separate path.
do $migration$
declare
  definition text;
  old_block text;
begin
  definition := replace(pg_get_functiondef(
    'public.create_order(uuid,public.order_source,jsonb,text,text,timestamptz,text,text,boolean,text,public.fulfilment_type,text,text)'::regprocedure
  ), E'\r', '');
  old_block := replace($old$
  if not immediate then
    if due < now() - interval '5 minutes' then
      perform private.fail('The pickup time is in the past.');
    end if;
    problem := private.pickup_slot_problem(due);
    if problem is not null and override is null then
      perform private.fail(problem || ' An admin can override with a reason.', 'slot');
    end if;
  end if;
$old$, E'\r', '');
  if position(old_block in definition) = 0 then
    raise exception 'Could not locate create_order pickup-date validation';
  end if;
  definition := replace(definition, old_block, $new$
  if not immediate and due >= now() - interval '5 minutes' then
    problem := private.pickup_slot_problem(due);
    if problem is not null and override is null then
      perform private.fail(problem || ' An admin can override with a reason.', 'slot');
    end if;
  end if;
$new$);

  old_block := replace($old$
  problem := private.lead_time_problem(o.id, due);
  if problem is not null and override is null then
    perform private.fail(problem || ' An admin can override with a reason.', 'lead_time');
  end if;

  if not immediate then
    select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, due) c;
    if cap_msg is not null and override is null then
      perform private.fail(cap_msg || ' An admin can override with a reason.', cap_kind);
    end if;
  end if;
$old$, E'\r', '');
  if position(old_block in definition) = 0 then
    raise exception 'Could not locate create_order lead-time and capacity validation';
  end if;
  definition := replace(definition, old_block, $new$
  if due >= now() - interval '5 minutes' then
    problem := private.lead_time_problem(o.id, due);
    if problem is not null and override is null then
      perform private.fail(problem || ' An admin can override with a reason.', 'lead_time');
    end if;

    if not immediate then
      select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, due) c;
      if cap_msg is not null and override is null then
        perform private.fail(cap_msg || ' An admin can override with a reason.', cap_kind);
      end if;
    end if;
  end if;
$new$);
  execute definition;

  definition := replace(pg_get_functiondef('private.confirm_locked(public.orders,text)'::regprocedure), E'\r', '');
  old_block := replace($old$
  problem := private.lead_time_problem(o.id, o.requested_due_at);
  if problem is not null and p_override_reason is null then
    perform private.fail(problem || ' An admin can override with a reason.', 'lead_time');
  end if;

  -- 4C: windows and category caps (walk-in immediate orders do not reserve capacity).
  if not o.is_immediate then
    select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, o.requested_due_at) c;
    if cap_msg is not null and p_override_reason is null then
      perform private.fail(cap_msg || ' An admin can override with a reason.', cap_kind);
    end if;
  end if;
$old$, E'\r', '');
  if position(old_block in definition) = 0 then
    raise exception 'Could not locate confirm_locked scheduling validation';
  end if;
  definition := replace(definition, old_block, $new$
  if o.requested_due_at >= now() - interval '5 minutes' then
    problem := private.lead_time_problem(o.id, o.requested_due_at);
    if problem is not null and p_override_reason is null then
      perform private.fail(problem || ' An admin can override with a reason.', 'lead_time');
    end if;

    -- 4C: windows and category caps (walk-in immediate orders do not reserve capacity).
    if not o.is_immediate then
      select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, o.requested_due_at) c;
      if cap_msg is not null and p_override_reason is null then
        perform private.fail(cap_msg || ' An admin can override with a reason.', cap_kind);
      end if;
    end if;
  end if;
$new$);
  execute definition;
end;
$migration$;

-- Replace the old RPC with a date-aware version. Its trailing default preserves existing callers,
-- including counter sales and legacy custom-cake creation.
drop function public.record_payment(uuid, uuid, public.payment_kind, public.payment_method, bigint, text, text);

create function public.record_payment(
  p_order_id uuid,
  p_idempotency_key uuid,
  p_kind public.payment_kind,
  p_method public.payment_method,
  p_amount_paise bigint,
  p_reference text default null,
  p_note text default null,
  p_paid_at timestamptz default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
  o public.orders;
  paid bigint;
  refunded bigint;
  charge bigint;
  note text := nullif(trim(coalesce(p_note, '')), '');
  payment_date timestamptz := coalesce(p_paid_at, now());
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to record payments.', 'forbidden');
  end if;

  select * into p from public.payments where idempotency_key = p_idempotency_key;
  if found then
    return p;
  end if;

  if p_amount_paise is null or p_amount_paise <= 0 then
    perform private.fail('Enter an amount greater than zero.');
  end if;
  if (payment_date at time zone private.business_timezone())::date >
     (now() at time zone private.business_timezone())::date then
    perform private.fail('The payment date cannot be in the future.');
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;

  select coalesce(sum(amount_paise) filter (where kind = 'payment'), 0),
         coalesce(sum(amount_paise) filter (where kind = 'refund'), 0)
  into paid, refunded
  from public.payments where order_id = o.id;
  charge := case when o.status in ('cancelled', 'rejected') then 0 else o.total_paise - private.order_credited(o.id) end;

  if p_kind = 'payment' then
    if o.status in ('cancelled', 'rejected') then
      perform private.fail('Payments cannot be taken on a cancelled or rejected order.');
    end if;
    if p_amount_paise > charge - paid + refunded then
      perform private.fail(format('This is more than the balance due (₹%s).', to_char((charge - paid + refunded) / 100.0, 'FM999999990.00')));
    end if;
  else
    if not private.has_role(array['admin']::public.staff_role[]) then
      perform private.fail('Only an admin can record refunds.', 'forbidden');
    end if;
    if note is null then
      perform private.fail('Give a reason for the refund.');
    end if;
    if p_amount_paise > paid - refunded then
      perform private.fail(format('Refund cannot exceed the amount paid (₹%s).', to_char((paid - refunded) / 100.0, 'FM999999990.00')));
    end if;
  end if;

  insert into public.payments (order_id, idempotency_key, kind, method, amount_paise, reference, note, recorded_by, paid_at)
  values (o.id, p_idempotency_key, p_kind, p_method, p_amount_paise, nullif(trim(p_reference), ''), note, auth.uid(), payment_date)
  returning * into p;

  update public.orders set version = version + 1 where id = o.id;
  perform private.log_order_event(o.id, case when p_kind = 'payment' then 'payment_recorded' else 'refund_recorded' end, note,
    jsonb_build_object('amount_paise', p_amount_paise, 'method', p_method, 'paid_at', payment_date));
  return p;
end;
$$;

revoke execute on function
  public.record_payment(uuid, uuid, public.payment_kind, public.payment_method, bigint, text, text, timestamptz)
  from public, anon;
grant execute on function
  public.record_payment(uuid, uuid, public.payment_kind, public.payment_method, bigint, text, text, timestamptz)
  to authenticated;

-- Save the initial custom-cake advance as a dated payment in the same transaction as the order.
create function public.create_custom_cake_order_with_advance_date(
  p_idempotency_key uuid,
  p_source public.order_source,
  p_customer_name text,
  p_customer_phone text,
  p_due_at timestamptz,
  p_price_paise bigint,
  p_cake jsonb,
  p_customer_notes text default null,
  p_internal_notes text default null,
  p_confirm boolean default false,
  p_override_reason text default null,
  p_fulfilment public.fulfilment_type default 'collect',
  p_setup_address text default null,
  p_setup_note text default null,
  p_advance_paise bigint default 0,
  p_advance_method public.payment_method default null,
  p_advance_reference text default null,
  p_advance_paid_at timestamptz default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  advance bigint := coalesce(p_advance_paise, 0);
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to create orders.', 'forbidden');
  end if;
  select * into o from public.orders where idempotency_key = p_idempotency_key;
  if found then
    return o;
  end if;
  if advance < 0 then
    perform private.fail('The advance cannot be negative.');
  end if;
  if advance > 0 and p_advance_method is null then
    perform private.fail('Choose how the advance was paid.');
  end if;
  if advance > 0 and p_advance_paid_at is null then
    perform private.fail('Choose the date the advance was paid.');
  end if;

  o := public.create_custom_cake_order(
    p_idempotency_key => p_idempotency_key,
    p_source => p_source,
    p_customer_name => p_customer_name,
    p_customer_phone => p_customer_phone,
    p_due_at => p_due_at,
    p_price_paise => p_price_paise,
    p_cake => p_cake,
    p_customer_notes => p_customer_notes,
    p_internal_notes => p_internal_notes,
    p_confirm => p_confirm,
    p_override_reason => p_override_reason,
    p_fulfilment => p_fulfilment,
    p_setup_address => p_setup_address,
    p_setup_note => p_setup_note,
    p_advance_paise => 0,
    p_advance_method => null,
    p_advance_reference => null
  );
  if advance > 0 then
    perform public.record_payment(o.id, md5(p_idempotency_key::text || ':advance')::uuid, 'payment',
      p_advance_method, advance, p_advance_reference, 'Advance', p_advance_paid_at);
    select * into o from public.orders where id = o.id;
  end if;
  return o;
end;
$$;

revoke execute on function
  public.create_custom_cake_order_with_advance_date(
    uuid, public.order_source, text, text, timestamptz, bigint, jsonb, text, text, boolean, text,
    public.fulfilment_type, text, text, bigint, public.payment_method, text, timestamptz
  ) from public, anon;
grant execute on function
  public.create_custom_cake_order_with_advance_date(
    uuid, public.order_source, text, text, timestamptz, bigint, jsonb, text, text, boolean, text,
    public.fulfilment_type, text, text, bigint, public.payment_method, text, timestamptz
  ) to authenticated;

-- Report money by the date it was paid, not the date staff entered it; include a daily collection series.
do $migration$
declare
  definition text;
  old_block text;
begin
  definition := pg_get_functiondef('public.sales_report(date,date)'::regprocedure);
  old_block := 'recorded_at >= t0 and recorded_at < t1';
  if position(old_block in definition) = 0 then
    raise exception 'Could not locate sales_report payment date filter';
  end if;
  definition := replace(definition, old_block, 'paid_at >= t0 and paid_at < t1');

  old_block := $old$    'products', ($old$;
  if position(old_block in definition) = 0 then
    raise exception 'Could not locate sales_report product section';
  end if;
  definition := replace(definition, old_block, $new$    'daily_money', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', day, 'received_paise', received, 'refunded_paise', refunded) order by day), '[]')
      from (select (paid_at at time zone tz)::date as day,
                   coalesce(sum(amount_paise) filter (where kind = 'payment'), 0) as received,
                   coalesce(sum(amount_paise) filter (where kind = 'refund'), 0) as refunded
            from p group by 1) x),
    'products', ($new$);
  execute definition;
end;
$migration$;

revoke execute on function public.create_custom_cake_order_with_advance_date(
  uuid, public.order_source, text, text, timestamptz, bigint, jsonb, text, text, boolean, text,
  public.fulfilment_type, text, text, bigint, public.payment_method, text, timestamptz
) from public, anon;
grant execute on function public.create_custom_cake_order_with_advance_date(
  uuid, public.order_source, text, text, timestamptz, bigint, jsonb, text, text, boolean, text,
  public.fulfilment_type, text, text, bigint, public.payment_method, text, timestamptz
) to authenticated;

-- The staff To-do page was a private diary with no remaining application use.
drop table public.diary_entries;
