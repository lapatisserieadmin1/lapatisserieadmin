-- Counter sale: refuse made-to-order items before order creation, with a clear message.
create or replace function public.counter_sale(
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

  -- Check before creating the order so staff see the real reason, not a lead-time error.
  if jsonb_typeof(p_items) = 'array' then
    select string_agg(distinct p.name, ', ') into v_made
    from jsonb_array_elements(p_items) item
    join public.product_variants pv on pv.id::text = item ->> 'variant_id'
    join public.products p on p.id = pv.product_id
    where p.prep_type = 'made_to_order';
    if v_made is not null then
      perform private.fail(format('Made-to-order items need a normal order: %s.', v_made));
    end if;
  end if;

  o := public.create_order(p_idempotency_key, 'IN_STORE', p_items, p_customer_name, p_customer_phone, null, null, null, true, null);

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
