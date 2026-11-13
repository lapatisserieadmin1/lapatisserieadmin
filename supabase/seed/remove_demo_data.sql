-- Removes everything supabase/seed/demo_data.sql created, before real data goes in.
--
-- Demo orders (internal_notes 'DEMO DATA', or counter sales named 'Demo walk-in') go with their
-- items, kitchen tickets, payments, timeline, bills and credit notes; customers that only had demo
-- orders go too; then the demo catalogue. When no orders or bills are left, the order number restarts
-- at B-1001 and the bill and credit-note numbers at 00001, so the real GST series has no gap.
-- The audit log keeps a record of what was deleted. Run as a superuser (Supabase SQL editor or MCP).
begin;

create temp table demo_orders on commit drop as
  select id, customer_id from public.orders where internal_notes = 'DEMO DATA' or customer_name = 'Demo walk-in';
create temp table demo_customers on commit drop as
  select distinct d.customer_id as id from demo_orders d
  where d.customer_id is not null
    and not exists (select 1 from public.orders o where o.customer_id = d.customer_id and o.id not in (select id from demo_orders));

-- Kitchen tickets (lines and issues go with them), bills and credit notes, money, timeline, orders.
delete from public.kitchen_tickets where order_id in (select id from demo_orders);
-- Bills, credit notes and payments are protected against deletion; lift that only for the demo
-- ones, only inside this transaction.
alter table public.credit_notes disable trigger credit_notes_immutable;
alter table public.bills disable trigger bills_immutable;
alter table public.payments disable trigger payments_immutable;
delete from public.credit_notes where bill_id in (select b.id from public.bills b where b.order_id in (select id from demo_orders));
delete from public.bills where order_id in (select id from demo_orders);
alter table public.bills enable trigger bills_immutable;
alter table public.credit_notes enable trigger credit_notes_immutable;
delete from public.payments where order_id in (select id from demo_orders);
alter table public.payments enable trigger payments_immutable;
delete from public.order_events where order_id in (select id from demo_orders);
delete from public.order_items where order_id in (select id from demo_orders);
delete from public.orders where id in (select id from demo_orders);
delete from public.customers where id in (select id from demo_customers); -- customer_events go with them

-- Catalogue (variants go with their products); categories the demo added, if now empty.
delete from public.products where description like 'Demo product%';
delete from public.categories c
where c.name in ('Cakes', 'Pastries', 'Breads', 'Cookies', 'Savouries')
  and not exists (select 1 from public.products p where p.category_id = c.id);

-- Numbering: start again only when nothing real has used it.
do $$ begin
  if not exists (select 1 from public.orders) then
    alter sequence public.order_number_seq restart with 1001;
  end if;
  if not exists (select 1 from public.bills) and not exists (select 1 from public.credit_notes) then
    delete from public.document_sequences;
  end if;
end $$;

select
  (select count(*) from public.orders) as orders_left,
  (select count(*) from public.bills) as bills_left,
  (select count(*) from public.products where description like 'Demo product%') as demo_products_left,
  (select count(*) from public.document_sequences) as bill_counters;

commit;
