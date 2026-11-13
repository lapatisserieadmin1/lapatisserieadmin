-- Owner, 2026-10-20: chefs see everything about an order except money. chef_work now also returns the
-- customer's name and phone number, the customer's notes, where to set up, and how the
-- order came in. Prices, totals, discounts, charges and payments stay out, and so do staff notes
-- (internal_notes), which often record payments ("Paid 500 advance").
drop function public.chef_work(date, date);

create function public.chef_work(p_from date, p_to date)
returns table (
  order_id uuid,
  reference text,
  status public.order_status,
  due_at timestamptz,
  is_immediate boolean,
  fulfilment public.fulfilment_type,
  item_id uuid,
  line_no integer,
  product_name text,
  variant_name text,
  quantity integer,
  is_veg boolean,
  is_eggless boolean,
  notes text,
  kitchen_id uuid,
  kitchen_name text,
  image_url text,
  cake jsonb,
  customer_name text,
  customer_phone text,
  customer_notes text,
  setup_address text,
  setup_note text,
  source public.order_source
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.current_staff_role() is null then
    perform private.fail('You do not have access to the kitchen screen.', 'forbidden');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    perform private.fail('Choose up to two months of dates.');
  end if;

  return query
  select o.id, o.reference, o.status, o.due_at, o.is_immediate, o.fulfilment,
         oi.id, oi.line_no, oi.product_name, oi.variant_name,
         -- A cancelled order keeps its quantities so the kitchen can see what to stop.
         case when o.status = 'cancelled' then oi.quantity else oi.quantity - oi.cancelled_quantity end,
         oi.is_veg, oi.is_eggless, oi.notes, oi.kitchen_id, k.name, p.image_url,
         case when cc.id is null then null else jsonb_strip_nulls(jsonb_build_object(
           'flavour', cc.flavour, 'weight_kg', cc.weight_kg, 'tiers', cc.tiers, 'theme', cc.theme,
           'design', cc.design, 'model', cc.model, 'fondant', cc.fondant, 'cream', cc.cream,
           'filling', cc.filling, 'toppings', cc.toppings, 'message', cc.message, 'is_eggless', cc.is_eggless,
           'has_cupcakes', cc.has_cupcakes, 'has_popsicles', cc.has_popsicles, 'instructions', cc.instructions,
           'photo_path', cc.photo_path)) end,
         coalesce(o.customer_name, c.full_name), coalesce(o.customer_phone, c.phone),
         o.customer_notes, o.setup_address, o.setup_note, o.source
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  left join public.customers c on c.id = o.customer_id
  left join public.kitchens k on k.id = oi.kitchen_id
  left join public.products p on p.id = oi.product_id
  left join public.custom_cakes cc on cc.order_item_id = oi.id
  where (o.status in ('confirmed', 'preparing', 'ready')
         or (o.status = 'cancelled' and o.confirmed_at is not null))
    and (o.due_at at time zone private.business_timezone())::date between p_from and p_to
    and oi.prep_type = 'made_to_order'
    and (o.status = 'cancelled' or oi.quantity > oi.cancelled_quantity)
    and private.chef_sees_kitchen(oi.kitchen_id)
  order by o.due_at, o.order_number, oi.line_no;
end;
$$;
revoke execute on function public.chef_work(date, date) from public, anon;
grant execute on function public.chef_work(date, date) to authenticated;
