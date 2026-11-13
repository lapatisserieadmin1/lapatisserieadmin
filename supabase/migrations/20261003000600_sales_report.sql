-- Phase 7: daily sales report (docs/superpowers/specs/2026-10-03-sales-report-design.md).
-- Admin only. Sales are counted on the bill date, credit notes on their own date and money on the
-- payment date, all as business-time-zone days; due dates are never used (PRD 5F, AC-35).

create function public.sales_report(p_from date, p_to date)
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
        'credit_notes', (select count(*) from cn),
        'credited_paise', coalesce((select sum(total_paise) from cn), 0),
        'credited_tax_paise', coalesce((select sum(cgst_paise + sgst_paise) from cn), 0),
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

revoke execute on function public.sales_report(date, date) from public, anon;
grant execute on function public.sales_report(date, date) to authenticated;
