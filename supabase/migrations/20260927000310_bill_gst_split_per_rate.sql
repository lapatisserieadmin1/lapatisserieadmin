-- Split CGST/SGST per GST rate (matches the rate summary printed on bills).
create or replace function private.issue_bill_locked(o public.orders)
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
  v_cgst bigint;
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
  -- CGST/SGST split per GST rate so the bill total matches the printed rate summary exactly.
  select coalesce(sum(div(rate_tax, 2)), 0)::bigint into v_cgst
  from (select sum(tax_paise) as rate_tax from public.order_items where order_id = o.id group by tax_rate_bps) t;

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
    o.subtotal_paise, o.discount_paise, o.total_paise, o.total_paise - v_tax, v_cgst, v_tax - v_cgst
  from public.order_items where order_id = o.id
  returning * into b;

  perform private.log_order_event(o.id, 'bill_issued', null, jsonb_build_object('bill_number', b.bill_number, 'total_paise', b.total_paise));
  return b;
end;
$$;
revoke execute on function private.issue_bill_locked(public.orders) from public;
