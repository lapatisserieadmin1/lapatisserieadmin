-- Chef screen (owner, 2026-10-20): chefs sign in again and see what to make for their kitchens.
--
-- 1. Chefs read nothing directly any more: private.is_staff() (used only by "Staff read …" policies)
--    now means admin or counter staff, so chefs cannot read prices, settings, offers or reviews
--    through the Data API. Their screen reads through public.chef_work only.
-- 2. public.chef_work(from, to): made-to-order lines of confirmed, preparing, packed and cancelled
--    orders due in that date range (business time zone), for the chef's kitchens plus lines with
--    no kitchen yet. No amounts, payments, customer names, phones, addresses or order notes.
--    Admins and counter staff see every kitchen (to check what chefs see).
-- 3. public.set_item_kitchen(item, kitchen): admin and counter staff route a made-to-order line
--    (custom cakes included) to a kitchen until the order is packed or closed.
-- 4. Chefs can open the reference photo of a custom cake that is on their screen.

-- ---------------------------------------------------------------------------
-- 1. Chefs read through chef_work only
-- ---------------------------------------------------------------------------

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Admin and counter staff. Chefs are left out on purpose: they read only through public.chef_work.
  select coalesce(private.current_staff_role() in ('admin', 'counter'), false)
$$;

-- Kitchen names only (for the chef's kitchen switch).
create policy "Chefs read kitchens" on public.kitchens for select to authenticated
  using ((select private.current_staff_role()) = 'chef');

-- ---------------------------------------------------------------------------
-- 2. The chef's work list
-- ---------------------------------------------------------------------------

-- True when the signed-in staff member may see work for this kitchen (null: no kitchen set yet).
create function private.chef_sees_kitchen(p_kitchen_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_role() in ('admin', 'counter'), false)
    or (private.current_staff_role() = 'chef'
        and (p_kitchen_id is null
             or exists (select 1 from public.staff_kitchens sk
                        where sk.user_id = (select auth.uid()) and sk.kitchen_id = p_kitchen_id)))
$$;

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
  cake jsonb
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
           'photo_path', cc.photo_path)) end
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
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

-- ---------------------------------------------------------------------------
-- 3. Route a line to a kitchen
-- ---------------------------------------------------------------------------

create function public.set_item_kitchen(p_item_id uuid, p_kitchen_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  it public.order_items;
  o public.orders;
  kname text;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to change orders.', 'forbidden');
  end if;
  select * into it from public.order_items where id = p_item_id;
  if not found then
    perform private.fail('This item was not found.');
  end if;
  select * into o from public.orders where id = it.order_id for update;
  if o.status in ('ready', 'completed', 'cancelled', 'rejected') then
    perform private.fail(format('The kitchen cannot change on a %s order.', o.status::text));
  end if;
  if it.prep_type <> 'made_to_order' then
    perform private.fail('Only made-to-order items go to a kitchen.');
  end if;
  if p_kitchen_id is not null then
    select name into kname from public.kitchens where id = p_kitchen_id and is_active;
    if kname is null then
      perform private.fail('Choose an active kitchen.');
    end if;
  end if;
  if it.kitchen_id is not distinct from p_kitchen_id then
    return;
  end if;
  update public.order_items set kitchen_id = p_kitchen_id where id = it.id;
  perform private.log_order_event(o.id, 'item_kitchen_changed', null, jsonb_strip_nulls(jsonb_build_object(
    'line_no', it.line_no, 'item', it.product_name, 'from', it.kitchen_id, 'to', p_kitchen_id, 'kitchen', kname)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Cake photos for the chef's screen
-- ---------------------------------------------------------------------------

create function private.chef_sees_cake_photo(p_path text)
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
    where cc.photo_path = p_path
      and (o.status in ('confirmed', 'preparing', 'ready') or (o.status = 'cancelled' and o.confirmed_at is not null))
      and private.chef_sees_kitchen(oi.kitchen_id))
$$;

create policy "Chefs read photos of cakes on their screen" on storage.objects for select to authenticated
  using (bucket_id = 'custom-cake-photos' and (select private.chef_sees_cake_photo(name)));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function private.chef_sees_kitchen(uuid), private.chef_sees_cake_photo(text),
  public.chef_work(date, date), public.set_item_kitchen(uuid, uuid) from public, anon;
grant execute on function private.chef_sees_kitchen(uuid), private.chef_sees_cake_photo(text),
  public.chef_work(date, date), public.set_item_kitchen(uuid, uuid) to authenticated;
