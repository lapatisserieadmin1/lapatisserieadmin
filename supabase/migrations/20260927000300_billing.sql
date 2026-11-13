-- Phase 4B: order discounts, GST bills, credit notes, counter quick sale.
-- Bills are tax documents: numbered gap-free per financial year (India, April–March), immutable,
-- corrected only by linked credit notes. Intra-state supply: GST splits equally into CGST and SGST.

alter table public.business_settings
  add column bill_prefix text not null default 'AB' check (bill_prefix ~ '^[A-Z0-9]{1,6}$'),
  add column counter_discount_limit_bps integer not null default 1000
    check (counter_discount_limit_bps between 0 and 10000);

alter table public.order_items
  add column discount_paise bigint not null default 0 check (discount_paise >= 0);

alter table public.orders
  add column discount_reason text check (discount_reason is null or length(discount_reason) <= 300),
  add column discount_by uuid references auth.users (id) on delete set null;
create index orders_discount_by_idx on public.orders (discount_by);

create table public.document_sequences (
  doc_type text not null check (doc_type in ('bill', 'credit_note')),
  financial_year text not null,
  last_number integer not null default 0,
  primary key (doc_type, financial_year)
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  bill_number text not null unique,
  financial_year text not null,
  sequence_number integer not null,
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users (id) on delete set null,
  business jsonb not null,
  customer_name text,
  customer_phone text,
  lines jsonb not null,
  subtotal_paise bigint not null,
  discount_paise bigint not null,
  total_paise bigint not null,
  taxable_paise bigint not null,
  cgst_paise bigint not null,
  sgst_paise bigint not null,
  unique (financial_year, sequence_number)
);
create index bills_issued_at_idx on public.bills (issued_at);
create index bills_issued_by_idx on public.bills (issued_by);

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete restrict,
  idempotency_key uuid not null unique,
  credit_note_number text not null unique,
  financial_year text not null,
  sequence_number integer not null,
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users (id) on delete set null,
  reason text not null check (length(trim(reason)) between 3 and 300),
  total_paise bigint not null check (total_paise > 0),
  taxable_paise bigint not null,
  cgst_paise bigint not null,
  sgst_paise bigint not null,
  unique (financial_year, sequence_number)
);
create index credit_notes_bill_id_idx on public.credit_notes (bill_id);
create index credit_notes_issued_by_idx on public.credit_notes (issued_by);

create function private.block_document_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Bills and credit notes cannot be edited or deleted; issue a credit note instead.';
end;
$$;
create trigger bills_immutable before update or delete on public.bills
  for each row execute function private.block_document_changes();
create trigger credit_notes_immutable before update or delete on public.credit_notes
  for each row execute function private.block_document_changes();

create trigger bills_audit after insert or update or delete on public.bills
  for each row execute function private.audit_row('id');
create trigger credit_notes_audit after insert or update or delete on public.credit_notes
  for each row execute function private.audit_row('id');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.financial_year(ts timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with d as (select (ts at time zone private.business_timezone())::date as local_date)
  select case
    when extract(month from local_date) >= 4
      then extract(year from local_date)::int || '-' || lpad(((extract(year from local_date)::int + 1) % 100)::text, 2, '0')
    else (extract(year from local_date)::int - 1) || '-' || lpad((extract(year from local_date)::int % 100)::text, 2, '0')
  end
  from d
$$;

-- The row stays locked until commit, so numbers are gap-free and never reused.
create function private.next_document_number(p_doc_type text, p_financial_year text)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.document_sequences (doc_type, financial_year, last_number)
  values (p_doc_type, p_financial_year, 1)
  on conflict (doc_type, financial_year)
    do update set last_number = public.document_sequences.last_number + 1
  returning last_number
$$;

create function private.order_credited(p_order_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cn.total_paise), 0)
  from public.credit_notes cn
  join public.bills b on b.id = cn.bill_id
  where b.order_id = p_order_id
$$;

-- Recomputes totals and spreads the order discount across lines (for per-line GST).
create function private.recalc_order_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subtotal bigint;
  v_discount bigint;
  v_remaining bigint;
  v_count integer;
  v_index integer := 0;
  v_share bigint;
  v_line record;
begin
  select coalesce(sum(line_total_paise), 0), count(*) into v_subtotal, v_count
  from public.order_items where order_id = p_order_id;
  select least(discount_paise, v_subtotal) into v_discount from public.orders where id = p_order_id;
  v_remaining := v_discount;

  -- Smallest lines first so the rounding remainder lands on the largest line.
  for v_line in
    select id, line_total_paise, tax_rate_bps from public.order_items
    where order_id = p_order_id order by line_total_paise, line_no
  loop
    v_index := v_index + 1;
    v_share := case
      when v_index = v_count then v_remaining
      when v_subtotal = 0 then 0
      else v_discount * v_line.line_total_paise / v_subtotal
    end;
    v_share := least(v_share, v_line.line_total_paise);
    v_remaining := v_remaining - v_share;
    update public.order_items
    set discount_paise = v_share,
        tax_paise = round((v_line.line_total_paise - v_share) * v_line.tax_rate_bps::numeric / (10000 + v_line.tax_rate_bps))
    where id = v_line.id;
  end loop;

  update public.orders
  set subtotal_paise = v_subtotal,
      discount_paise = v_discount,
      total_paise = v_subtotal - v_discount,
      tax_paise = (select coalesce(sum(tax_paise), 0) from public.order_items where order_id = p_order_id)
  where id = p_order_id;
end;
$$;

create function private.apply_discount_locked(o public.orders, p_kind text, p_value bigint, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.current_staff_role();
  v_amount bigint;
  v_limit integer;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  result public.orders;
begin
  if v_role is null or v_role not in ('admin', 'counter') then
    perform private.fail('You do not have permission to apply discounts.', 'forbidden');
  end if;
  if o.status in ('completed', 'rejected', 'cancelled') then
    perform private.fail('Discounts cannot be changed on a closed order.');
  end if;
  if exists (select 1 from public.bills where order_id = o.id) then
    perform private.fail('This order already has a bill. Issue a credit note instead.');
  end if;
  if p_kind not in ('amount', 'percent') or p_value is null or p_value < 0 then
    perform private.fail('Enter a valid discount.');
  end if;

  v_amount := case when p_kind = 'percent' then round(o.subtotal_paise * least(p_value, 10000)::numeric / 10000) else p_value end;
  if v_amount > o.subtotal_paise then
    perform private.fail('The discount cannot be more than the order value.');
  end if;
  if v_amount > 0 and v_reason is null then
    perform private.fail('Give a reason for the discount.');
  end if;

  if v_role = 'counter' then
    select counter_discount_limit_bps into v_limit from public.business_settings where id;
    if v_amount > round(o.subtotal_paise * v_limit::numeric / 10000) then
      perform private.fail(format('Counter staff can give up to %s%% off. Ask an admin for a larger discount.', trim(to_char(v_limit / 100.0, 'FM990.99'), '.')), 'forbidden');
    end if;
  end if;

  update public.orders
  set discount_paise = v_amount,
      discount_reason = case when v_amount > 0 then v_reason end,
      discount_by = case when v_amount > 0 then auth.uid() end,
      version = version + 1
  where id = o.id;
  perform private.recalc_order_totals(o.id);

  select * into result from public.orders where id = o.id;
  perform private.log_order_event(o.id, case when v_amount > 0 then 'discount_applied' else 'discount_removed' end, v_reason,
    jsonb_build_object('amount_paise', v_amount, 'kind', p_kind, 'value', p_value));
  return result;
end;
$$;

create function private.issue_bill_locked(o public.orders)
returns public.bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bills;
  v_fy text := private.financial_year(now());
  v_seq integer;
  v_prefix text;
  v_tax bigint;
  v_business jsonb;
begin
  select * into b from public.bills where order_id = o.id;
  if found then
    return b;
  end if;
  if o.status not in ('confirmed', 'preparing', 'ready', 'completed') then
    perform private.fail('Only confirmed orders can be billed.');
  end if;

  select bill_prefix, jsonb_build_object('name', business_name, 'address', address, 'phone', phone,
           'email', email, 'gstin', gstin, 'fssai_licence', fssai_licence)
  into v_prefix, v_business
  from public.business_settings where id;

  v_seq := private.next_document_number('bill', v_fy);
  v_tax := o.tax_paise;

  insert into public.bills (
    order_id, bill_number, financial_year, sequence_number, issued_by, business, customer_name, customer_phone,
    lines, subtotal_paise, discount_paise, total_paise, taxable_paise, cgst_paise, sgst_paise
  )
  select o.id, v_prefix || '/' || v_fy || '/' || lpad(v_seq::text, 5, '0'), v_fy, v_seq, auth.uid(), v_business,
    o.customer_name, o.customer_phone,
    coalesce(jsonb_agg(jsonb_build_object(
      'line_no', line_no, 'name', product_name, 'variant', variant_name, 'hsn', hsn_code,
      'is_veg', is_veg, 'is_eggless', is_eggless,
      'quantity', quantity - cancelled_quantity, 'unit_price_paise', unit_price_paise,
      'gross_paise', line_total_paise, 'discount_paise', discount_paise,
      'net_paise', line_total_paise - discount_paise, 'tax_rate_bps', tax_rate_bps,
      'tax_paise', tax_paise, 'taxable_paise', line_total_paise - discount_paise - tax_paise
    ) order by line_no), '[]'),
    o.subtotal_paise, o.discount_paise, o.total_paise, o.total_paise - v_tax, v_tax / 2, v_tax - v_tax / 2
  from public.order_items where order_id = o.id
  returning * into b;

  perform private.log_order_event(o.id, 'bill_issued', null, jsonb_build_object('bill_number', b.bill_number, 'total_paise', b.total_paise));
  return b;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public functions
-- ---------------------------------------------------------------------------

create function public.apply_discount(p_order_id uuid, p_expected_version integer, p_kind text, p_value bigint, p_reason text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.apply_discount_locked(private.lock_order(p_order_id, p_expected_version), p_kind, p_value, p_reason);
end;
$$;

create function public.issue_bill(p_order_id uuid)
returns public.bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to issue bills.', 'forbidden');
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;
  return private.issue_bill_locked(o);
end;
$$;

create function public.issue_credit_note(p_bill_id uuid, p_idempotency_key uuid, p_amount_paise bigint, p_reason text)
returns public.credit_notes
language plpgsql
security definer
set search_path = ''
as $$
declare
  cn public.credit_notes;
  b public.bills;
  v_credited bigint;
  v_tax bigint;
  v_fy text := private.financial_year(now());
  v_seq integer;
  v_prefix text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can issue credit notes.', 'forbidden');
  end if;
  select * into cn from public.credit_notes where idempotency_key = p_idempotency_key;
  if found then
    return cn;
  end if;
  if v_reason is null or length(v_reason) < 3 then
    perform private.fail('Give a reason for the credit note.');
  end if;

  select * into b from public.bills where id = p_bill_id;
  if not found then
    perform private.fail('Bill not found.', 'not_found');
  end if;
  perform 1 from public.orders where id = b.order_id for update;

  select coalesce(sum(total_paise), 0) into v_credited from public.credit_notes where bill_id = b.id;
  if p_amount_paise is null or p_amount_paise <= 0 then
    perform private.fail('Enter an amount greater than zero.');
  end if;
  if p_amount_paise > b.total_paise - v_credited then
    perform private.fail(format('Credit cannot exceed the uncredited bill amount (₹%s).', to_char((b.total_paise - v_credited) / 100.0, 'FM999999990.00')));
  end if;

  v_tax := case when b.total_paise = 0 then 0 else round(p_amount_paise * (b.cgst_paise + b.sgst_paise)::numeric / b.total_paise) end;
  select bill_prefix into v_prefix from public.business_settings where id;
  v_seq := private.next_document_number('credit_note', v_fy);

  insert into public.credit_notes (bill_id, idempotency_key, credit_note_number, financial_year, sequence_number, issued_by,
    reason, total_paise, taxable_paise, cgst_paise, sgst_paise)
  values (b.id, p_idempotency_key, v_prefix || '-CN/' || v_fy || '/' || lpad(v_seq::text, 5, '0'), v_fy, v_seq, auth.uid(),
    v_reason, p_amount_paise, p_amount_paise - v_tax, v_tax / 2, v_tax - v_tax / 2)
  returning * into cn;

  update public.orders set version = version + 1 where id = b.order_id;
  perform private.log_order_event(b.order_id, 'credit_note_issued', v_reason,
    jsonb_build_object('credit_note_number', cn.credit_note_number, 'amount_paise', p_amount_paise));
  return cn;
end;
$$;

-- One-screen counter checkout for ready-stock items (AC-28): create, discount, pay, complete, and bill atomically.
create function public.counter_sale(
  p_idempotency_key uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount_kind text default null,
  p_discount_value bigint default null,
  p_discount_reason text default null,
  p_customer_name text default null,
  p_customer_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  b public.bills;
  pay jsonb;
  i integer := 0;
  v_paid bigint := 0;
  v_amount bigint;
  v_made text;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to make counter sales.', 'forbidden');
  end if;

  select * into o from public.orders where idempotency_key = p_idempotency_key;
  if found then
    select * into b from public.bills where order_id = o.id;
    return jsonb_build_object('order_id', o.id, 'reference', o.reference, 'bill_id', b.id, 'bill_number', b.bill_number, 'total_paise', o.total_paise);
  end if;

  o := public.create_order(p_idempotency_key, 'IN_STORE', p_items, p_customer_name, p_customer_phone, null, null, null, true, null);

  select string_agg(product_name, ', ') into v_made
  from public.order_items where order_id = o.id and prep_type = 'made_to_order';
  if v_made is not null then
    perform private.fail(format('Made-to-order items need a normal order: %s.', v_made));
  end if;

  if coalesce(p_discount_value, 0) > 0 then
    o := private.apply_discount_locked(o, coalesce(p_discount_kind, 'amount'), p_discount_value, p_discount_reason);
  end if;

  if p_payments is null or jsonb_typeof(p_payments) <> 'array' then
    perform private.fail('Record how the customer paid.');
  end if;
  for pay in select value from jsonb_array_elements(p_payments)
  loop
    i := i + 1;
    begin
      v_amount := (pay ->> 'amount_paise')::bigint;
    exception when others then
      perform private.fail('Payment amount is not valid.');
    end;
    if coalesce(v_amount, 0) <= 0 then
      continue;
    end if;
    perform public.record_payment(o.id, md5(p_idempotency_key::text || ':' || i)::uuid, 'payment',
      (pay ->> 'method')::public.payment_method, v_amount, nullif(pay ->> 'reference', ''), null);
    v_paid := v_paid + v_amount;
  end loop;

  if v_paid <> o.total_paise then
    perform private.fail(format('Payments (₹%s) must equal the total (₹%s).',
      to_char(v_paid / 100.0, 'FM999999990.00'), to_char(o.total_paise / 100.0, 'FM999999990.00')));
  end if;

  update public.orders set status = 'completed', completed_at = now(), version = version + 1
  where id = o.id returning * into o;
  perform private.log_order_event(o.id, 'completed', null, jsonb_build_object('via', 'counter_sale'));

  b := private.issue_bill_locked(o);
  return jsonb_build_object('order_id', o.id, 'reference', o.reference, 'bill_id', b.id, 'bill_number', b.bill_number, 'total_paise', o.total_paise);
end;
$$;

-- Billed orders must be credited before cancelling (a bill is never silently voided).
create or replace function public.cancel_order(p_order_id uuid, p_expected_version integer, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
  billed bigint;
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can cancel orders.', 'forbidden');
  end if;
  if reason is null then
    perform private.fail('Give a reason for cancelling the order.');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status in ('completed', 'rejected', 'cancelled') then
    perform private.fail(format('This order is already %s.', o.status));
  end if;
  select total_paise into billed from public.bills where order_id = o.id;
  if billed is not null and private.order_credited(o.id) < billed then
    perform private.fail('This order has a bill. Issue a credit note for the full bill before cancelling.', 'billed');
  end if;

  update public.orders
  set status = 'cancelled', closed_reason = reason, closed_by = auth.uid(), closed_at = now(), version = version + 1
  where id = o.id
  returning * into o;
  perform private.log_order_event(o.id, 'cancelled', reason);
  return o;
end;
$$;

-- Balance now accounts for credit notes.
create or replace function public.record_payment(
  p_order_id uuid,
  p_idempotency_key uuid,
  p_kind public.payment_kind,
  p_method public.payment_method,
  p_amount_paise bigint,
  p_reference text default null,
  p_note text default null
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

  insert into public.payments (order_id, idempotency_key, kind, method, amount_paise, reference, note, recorded_by)
  values (o.id, p_idempotency_key, p_kind, p_method, p_amount_paise, nullif(trim(p_reference), ''), note, auth.uid())
  returning * into p;

  update public.orders set version = version + 1 where id = o.id;
  perform private.log_order_event(o.id, case when p_kind = 'payment' then 'payment_recorded' else 'refund_recorded' end, note,
    jsonb_build_object('amount_paise', p_amount_paise, 'method', p_method));
  return p;
end;
$$;

drop view public.order_summaries;
create view public.order_summaries
with (security_invoker = true)
as
select
  o.*,
  coalesce(pay.paid_paise, 0) as paid_paise,
  coalesce(pay.refunded_paise, 0) as refunded_paise,
  coalesce(bill.credited_paise, 0) as credited_paise,
  bill.bill_id,
  bill.bill_number,
  (case when o.status in ('cancelled', 'rejected') then 0 else o.total_paise - coalesce(bill.credited_paise, 0) end)
    - coalesce(pay.paid_paise, 0) + coalesce(pay.refunded_paise, 0) as balance_paise,
  coalesce(items.item_count, 0) as item_count,
  coalesce(items.kitchen_ids, '{}') as kitchen_ids
from public.orders o
left join lateral (
  select sum(amount_paise) filter (where kind = 'payment') as paid_paise,
         sum(amount_paise) filter (where kind = 'refund') as refunded_paise
  from public.payments where order_id = o.id
) pay on true
left join lateral (
  select b.id as bill_id, b.bill_number,
         (select sum(cn.total_paise) from public.credit_notes cn where cn.bill_id = b.id) as credited_paise
  from public.bills b where b.order_id = o.id
) bill on true
left join lateral (
  select sum(quantity - cancelled_quantity)::integer as item_count,
         array_agg(distinct kitchen_id) filter (where kitchen_id is not null) as kitchen_ids
  from public.order_items where order_id = o.id
) items on true;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

alter table public.document_sequences enable row level security;
alter table public.bills enable row level security;
alter table public.credit_notes enable row level security;

create policy "Admin and counter read bills" on public.bills for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));
create policy "Admin and counter read credit notes" on public.credit_notes for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));
-- document_sequences: no policies; only the functions above touch it.

revoke all on public.document_sequences, public.bills, public.credit_notes, public.order_summaries from anon, authenticated;
grant select on public.bills, public.credit_notes, public.order_summaries to authenticated;

revoke execute on all functions in schema private from public;
grant execute on function private.current_staff_role(), private.is_staff(), private.is_admin(),
  private.has_role(public.staff_role[]) to authenticated;

revoke execute on function
  public.apply_discount(uuid, integer, text, bigint, text),
  public.issue_bill(uuid),
  public.issue_credit_note(uuid, uuid, bigint, text),
  public.counter_sale(uuid, jsonb, jsonb, text, bigint, text, text, text),
  public.cancel_order(uuid, integer, text),
  public.record_payment(uuid, uuid, public.payment_kind, public.payment_method, bigint, text, text)
  from public, anon;
grant execute on function
  public.apply_discount(uuid, integer, text, bigint, text),
  public.issue_bill(uuid),
  public.issue_credit_note(uuid, uuid, bigint, text),
  public.counter_sale(uuid, jsonb, jsonb, text, bigint, text, text, text),
  public.cancel_order(uuid, integer, text),
  public.record_payment(uuid, uuid, public.payment_kind, public.payment_method, bigint, text, text)
  to authenticated;
