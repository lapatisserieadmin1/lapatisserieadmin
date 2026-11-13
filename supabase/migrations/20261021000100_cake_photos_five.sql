-- Owner, 2026-10-21: a custom cake takes up to 5 reference photos (was 1).
--
-- custom_cakes.photo_path (one object path) becomes photo_paths (0 to 5 paths, in the order added), and
-- set_custom_cake_photo becomes set_custom_cake_photos, which sets the whole list. The chef screen and
-- its storage policy read the list.

alter table public.custom_cakes
  add column photo_paths text[] not null default '{}'
    constraint custom_cakes_photo_paths_max check (cardinality(photo_paths) <= 5);
update public.custom_cakes set photo_paths = array[photo_path] where photo_path is not null;

-- chef_sees_cake_photo and chef_work read photo_path; both are replaced below before it goes.
create or replace function private.chef_sees_cake_photo(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_staff_role() = 'chef' and exists (
    select 1
    from public.custom_cakes cc
    join public.order_items oi on oi.id = cc.order_item_id
    join public.orders o on o.id = cc.order_id
    where p_path = any (cc.photo_paths)
      and (o.status in ('confirmed', 'preparing', 'ready') or (o.status = 'cancelled' and o.confirmed_at is not null))
      and private.chef_sees_kitchen(oi.kitchen_id))
$$;

create or replace function public.chef_work(p_from date, p_to date)
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
           'photo_paths', to_jsonb(cc.photo_paths))) end,
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

drop function public.set_custom_cake_photo(uuid, text);
alter table public.custom_cakes drop column photo_path;

-- Admin and counter staff, until the order is closed. Sets the whole list (empty clears it): up to 5
-- different paths, each stored under the order's folder.
create function public.set_custom_cake_photos(p_order_id uuid, p_photo_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  paths text[] := coalesce(p_photo_paths, '{}');
  st public.order_status;
  before integer;
  path text;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to change orders.', 'forbidden');
  end if;
  select status into st from public.orders where id = p_order_id;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;
  if st in ('completed', 'cancelled', 'rejected') then
    perform private.fail(format('The cake photos cannot change on a %s order.', st::text));
  end if;
  if cardinality(paths) > 5 then
    perform private.fail('A custom cake can have up to 5 reference photos.');
  end if;
  foreach path in array paths loop
    if path is null or path not like p_order_id::text || '/%' or length(path) > 300 or path like '%..%' then
      perform private.fail('The photo is not stored under this order.');
    end if;
  end loop;
  if (select count(distinct x) from unnest(paths) x) <> cardinality(paths) then
    perform private.fail('The same photo is listed twice.');
  end if;

  select cardinality(photo_paths) into before from public.custom_cakes where order_id = p_order_id;
  if not found then
    perform private.fail('This order has no custom cake.', 'not_found');
  end if;
  update public.custom_cakes set photo_paths = paths where order_id = p_order_id;
  perform private.log_order_event(p_order_id, 'custom_cake_photo', null,
    jsonb_build_object('action', case when cardinality(paths) > before then 'added' when cardinality(paths) < before then 'removed' else 'changed' end,
                       'count', cardinality(paths)));
end;
$$;

revoke execute on function public.set_custom_cake_photos(uuid, text[]) from public, anon;
grant execute on function public.set_custom_cake_photos(uuid, text[]) to authenticated;
