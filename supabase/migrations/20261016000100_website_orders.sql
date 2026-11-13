-- Public website (2026-10-16): the La Patisserie site reads the catalogue and sends orders in.
-- Both functions are callable without a login (anon). Orders arrive as ONLINE, pending confirmation,
-- for an admin to confirm, edit or reject like any other order.

-- ---------------------------------------------------------------------------
-- 1. Catalogue for the website
-- ---------------------------------------------------------------------------

-- Products a customer can order today: not archived, available, in an active category, with at least
-- one available variant. Prices in paise. Nothing staff-only (kitchens, tax, HSN) leaves the database.
create function public.website_catalogue()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(p.item order by p.cat_sort, p.cat_name, p.name), '[]'::jsonb)
  from (
    select c.sort_order as cat_sort, c.name as cat_name, pr.name,
      jsonb_build_object(
        'id', pr.id,
        'name', pr.name,
        'description', pr.description,
        'image_url', pr.image_url,
        'category', c.name,
        'is_veg', pr.is_veg,
        'contains_egg', pr.contains_egg,
        'from_paise', min(v.price_paise),
        'variants', jsonb_agg(jsonb_build_object(
          'id', v.id, 'name', v.name, 'price_paise', v.price_paise, 'is_eggless', v.is_eggless
        ) order by v.sort_order, v.price_paise, v.name)
      ) as item
    from public.products pr
    join public.categories c on c.id = pr.category_id
    join public.product_variants v on v.product_id = pr.id
    where pr.archived_at is null and pr.is_available
      and c.is_active
      and v.archived_at is null and v.is_available
    group by pr.id, c.id
  ) p
$$;

-- ---------------------------------------------------------------------------
-- 2. Orders from the website
-- ---------------------------------------------------------------------------

-- Anyone may call this. Messages are written for customers. Limits against spam: at most 3 orders
-- from one phone waiting for confirmation, and at most 30 website orders an hour in total.
-- Retrying with the same key returns the same order. Lines are optional: a request with no lines
-- ("a custom birthday cake") arrives with a total of 0 and staff add the items or reject it.
create function public.submit_website_order(
  p_idempotency_key uuid,
  p_name text,
  p_phone text,
  p_due_at timestamptz,
  p_message text,
  p_order_type text default null,
  p_email text default null,
  p_items jsonb default '[]',
  p_fulfilment public.fulfilment_type default 'collect',
  p_setup_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g'), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_type text;
  items jsonb := coalesce(p_items, '[]'::jsonb);
  fulfil public.fulfilment_type := coalesce(p_fulfilment, 'collect');
  setup record;
  customer uuid;
  blocked boolean;
  item jsonb;
  line integer := 0;
  v record;
  qty integer;
  variant uuid;
  subtotal bigint := 0;
  tax bigint := 0;
  line_total bigint;
  line_tax bigint;
  problem text;
  cap_msg text;
  notes text;
begin
  if p_idempotency_key is null then
    perform private.fail('Something went wrong. Please reload the page and try again.');
  end if;
  select * into o from public.orders where idempotency_key = p_idempotency_key;
  if found then
    if o.source <> 'ONLINE' then
      perform private.fail('Something went wrong. Please reload the page and try again.');
    end if;
    return jsonb_build_object('reference', o.reference, 'due_at', o.due_at);
  end if;

  if v_name is null or length(v_name) > 80 then
    perform private.fail('Please enter your name (up to 80 characters).');
  end if;
  if v_phone is null or v_phone !~ '^\+?[0-9]{10,15}$' then
    perform private.fail('Please enter a valid phone number (10 to 15 digits).');
  end if;
  if v_email is not null and (length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    perform private.fail('Please enter a valid email address, or leave it empty.');
  end if;
  if v_message is null and jsonb_typeof(items) = 'array' and jsonb_array_length(items) = 0 then
    perform private.fail('Please tell us what you would like to order.');
  end if;
  if length(coalesce(v_message, '')) > 800 then
    perform private.fail('Please keep your message under 800 characters.');
  end if;
  v_type := case p_order_type
    when 'birthday' then 'Birthday cake'
    when 'wedding' then 'Wedding cake'
    when 'custom' then 'Custom design'
    when 'macarons' then 'Macaron box'
    when 'pastries' then 'Pastry platter'
    when 'other' then 'Other'
  end;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 10 then
    perform private.fail('An online order can have at most 10 items. Please WhatsApp us for bigger orders.');
  end if;
  select * into setup from private.clean_fulfilment(fulfil, p_setup_address, null);

  if p_due_at is null then
    perform private.fail('Please choose a pickup date and time.');
  end if;
  if p_due_at < now() then
    perform private.fail('Please choose a pickup time in the future.');
  end if;
  if p_due_at > now() + interval '180 days' then
    perform private.fail('We take online orders up to 6 months ahead. Please WhatsApp us for later dates.');
  end if;
  problem := private.pickup_slot_problem(p_due_at);
  if problem is not null then
    perform private.fail(problem, 'slot');
  end if;

  -- One website order at a time, so the spam counts below cannot be raced past.
  perform pg_advisory_xact_lock(hashtext('website_order'));
  if (select count(*) from public.orders
      where source = 'ONLINE' and created_at > now() - interval '1 hour') >= 30 then
    perform private.fail('We are receiving a lot of orders right now. Please WhatsApp or call us instead.', 'busy');
  end if;
  if (select count(*) from public.orders
      where source = 'ONLINE' and status = 'pending_confirmation' and customer_phone = v_phone) >= 3 then
    perform private.fail('You already have orders waiting for us to confirm. We will call you soon, or WhatsApp us.', 'busy');
  end if;

  -- A website visitor never renames an existing customer; a missing email is filled in.
  insert into public.customers (full_name, phone, email)
  values (v_name, v_phone, v_email)
  on conflict (phone) where phone is not null
    do update set email = coalesce(public.customers.email, excluded.email)
  returning id, is_blocked into customer, blocked;
  if blocked then
    perform private.fail('We could not take this order online. Please call us to order.', 'blocked');
  end if;

  notes := concat_ws(E'\n',
    'Website order' || coalesce(' — ' || v_type, ''),
    'Email: ' || v_email,
    case when v_message is not null then E'\n' || v_message end);

  insert into public.orders (
    idempotency_key, source, status, customer_id, customer_name, customer_phone,
    is_immediate, requested_due_at, customer_notes, fulfilment, setup_address
  ) values (
    p_idempotency_key, 'ONLINE', 'pending_confirmation', customer, v_name, v_phone,
    false, p_due_at, left(notes, 1000), fulfil, setup.address
  )
  returning * into o;

  for item in select value from jsonb_array_elements(items)
  loop
    line := line + 1;
    begin
      qty := (item ->> 'quantity')::integer;
      variant := (item ->> 'variant_id')::uuid;
    exception when others then
      perform private.fail('One of the items is not valid. Please reload the page and try again.');
    end;
    if qty is null or qty < 1 or qty > 50 then
      perform private.fail('Please order between 1 and 50 of each item.');
    end if;

    select p.id as product_id, p.name as product_name, p.category_id, p.prep_type, p.is_veg, p.contains_egg, p.allergens,
           p.tax_rate_bps, p.hsn_code, pv.id as variant_id, pv.name as variant_name, pv.price_paise, pv.kitchen_id,
           pv.lead_time_minutes, pv.is_eggless
    into v
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    join public.categories c on c.id = p.category_id
    where pv.id = variant
      and p.archived_at is null and p.is_available and c.is_active
      and pv.archived_at is null and pv.is_available;
    if not found then
      perform private.fail('One of the items is no longer available. Please reload the page and try again.', 'unavailable');
    end if;

    line_total := v.price_paise * qty;
    line_tax := round(line_total * v.tax_rate_bps::numeric / (10000 + v.tax_rate_bps));
    insert into public.order_items (
      order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
      is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
      hsn_code, quantity, line_total_paise, tax_paise
    ) values (
      o.id, line, v.product_id, v.variant_id, v.category_id, v.product_name, v.variant_name, v.prep_type,
      case when v.prep_type = 'made_to_order' then v.kitchen_id end,
      v.is_veg, v.contains_egg, v.is_eggless, v.allergens, v.lead_time_minutes, v.price_paise, v.tax_rate_bps,
      v.hsn_code, qty, line_total, line_tax
    );
    subtotal := subtotal + line_total;
    tax := tax + line_tax;
  end loop;

  problem := private.lead_time_problem(o.id, p_due_at);
  if problem is not null then
    perform private.fail(problem, 'lead_time');
  end if;
  select c.message into cap_msg from private.capacity_problem(o.id, p_due_at) c;
  if cap_msg is not null then
    perform private.fail('That pickup time is fully booked. Please choose another time, or WhatsApp us.', 'capacity');
  end if;

  update public.orders
  set subtotal_paise = subtotal, total_paise = subtotal, tax_paise = tax
  where id = o.id
  returning * into o;

  perform private.log_order_event(o.id, 'created', null, jsonb_strip_nulls(jsonb_build_object(
    'source', 'ONLINE', 'website', true, 'immediate', false, 'fulfilment', fulfil, 'setup_address', setup.address)));

  return jsonb_build_object('reference', o.reference, 'due_at', o.due_at);
end;
$$;

revoke execute on function public.website_catalogue() from public, anon, authenticated;
revoke execute on function public.submit_website_order(uuid, text, text, timestamptz, text, text, text, jsonb,
  public.fulfilment_type, text) from public, anon, authenticated;
grant execute on function public.website_catalogue() to anon, authenticated;
grant execute on function public.submit_website_order(uuid, text, text, timestamptz, text, text, text, jsonb,
  public.fulfilment_type, text) to anon, authenticated;
