-- Phase 4C: edit the items on a pending or confirmed order.
-- p_lines is the complete new list. Each element is either an existing line
-- {"line_id", "quantity", "notes"} or a new one {"variant_id", "quantity", "notes"};
-- existing lines left out are removed. Kept lines keep their price snapshot (PRD 5B);
-- new lines take the current catalogue price.
-- Only what the edit adds is rechecked (new or increased lines, newly added categories),
-- so an earlier admin override on the rest of the order does not block the edit.
-- Phase 5: once kitchen tickets exist, edits to released lines must become acknowledged
-- revisions (AC-12) and reductions must use cancelled_quantity instead of deleting lines.

create function public.update_order_items(
  p_order_id uuid,
  p_expected_version integer,
  p_lines jsonb,
  p_reason text default null,
  p_override_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  o public.orders;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
  override text := nullif(trim(coalesce(p_override_reason, '')), '');
  item jsonb;
  pos integer := 0;
  qty integer;
  line_id uuid;
  variant uuid;
  v_notes text;
  last_existing integer;
  ln public.order_items;
  v record;
  next_line integer;
  kept uuid[] := '{}';
  changes jsonb := '[]';
  grown_lead integer := 0;
  old_categories uuid[];
  new_categories uuid[] := '{}';
  total_before bigint;
  problem text;
  cap_msg text;
  cat record;
  used integer;
  day date;
begin
  if role is null or role not in ('admin', 'counter') then
    perform private.fail('You do not have permission to change orders.', 'forbidden');
  end if;
  if override is not null and role <> 'admin' then
    perform private.fail('Only an admin can override scheduling rules.', 'forbidden');
  end if;
  if override is not null and length(override) < 5 then
    perform private.fail('Give an override reason of at least 5 characters.');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.fail('An order needs at least one item. Cancel the order instead.');
  end if;
  if jsonb_array_length(p_lines) > 50 then
    perform private.fail('An order can have at most 50 lines.');
  end if;

  o := private.lock_order(p_order_id, p_expected_version);
  if o.status = 'confirmed' then
    if role <> 'admin' then
      perform private.fail('Only an admin can change the items on a confirmed order.', 'forbidden');
    end if;
    if reason is null then
      perform private.fail('Give a reason for changing a confirmed order.');
    end if;
  elsif o.status not in ('draft', 'pending_confirmation') then
    perform private.fail(format('Items cannot be changed on a %s order.', replace(o.status::text, '_', ' ')));
  end if;
  if exists (select 1 from public.bills where order_id = o.id) then
    perform private.fail('This order already has a bill. Issue a credit note instead.', 'billed');
  end if;

  total_before := o.total_paise;
  select coalesce(max(line_no), 0) into next_line from public.order_items where order_id = o.id;
  last_existing := next_line;
  select coalesce(array_agg(distinct category_id) filter (where category_id is not null), '{}') into old_categories
  from public.order_items where order_id = o.id;

  for item in select value from jsonb_array_elements(p_lines)
  loop
    pos := pos + 1;
    begin
      qty := (item ->> 'quantity')::integer;
      line_id := (item ->> 'line_id')::uuid;
      variant := (item ->> 'variant_id')::uuid;
    exception when others then
      perform private.fail(format('Line %s is not valid.', pos));
    end;
    v_notes := nullif(trim(coalesce(item ->> 'notes', '')), '');
    if qty is null or qty < 1 or qty > 999 then
      perform private.fail(format('Line %s: quantity must be between 1 and 999.', pos));
    end if;
    if length(coalesce(v_notes, '')) > 500 then
      perform private.fail(format('Line %s: notes are too long.', pos));
    end if;

    if line_id is not null then
      -- Existing line: keep its snapshot; only quantity and notes change.
      select * into ln from public.order_items where id = line_id and order_id = o.id;
      if not found then
        perform private.fail(format('Line %s is not on this order. Reload and try again.', pos), 'conflict');
      end if;
      if line_id = any (kept) then
        perform private.fail(format('Line %s appears twice.', pos));
      end if;
      kept := kept || line_id;

      if qty > ln.quantity then
        -- More of an item: it must still be available and its preparation time must fit.
        select p.is_available and pv.is_available and p.archived_at is null and pv.archived_at is null as available
        into v
        from public.product_variants pv join public.products p on p.id = pv.product_id
        where pv.id = ln.variant_id;
        if not found or not v.available then
          perform private.fail(format('%s — %s is not available, so its quantity cannot be increased.', ln.product_name, ln.variant_name), 'unavailable');
        end if;
        if ln.prep_type = 'made_to_order' then
          grown_lead := greatest(grown_lead, ln.lead_time_minutes);
        end if;
      end if;

      if qty <> ln.quantity or v_notes is distinct from ln.notes then
        update public.order_items
        set quantity = qty, line_total_paise = unit_price_paise * qty, notes = v_notes
        where id = ln.id;
        changes := changes || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'item', ln.product_name || ' — ' || ln.variant_name,
          'from', ln.quantity, 'to', qty,
          'notes', case when v_notes is distinct from ln.notes then coalesce(v_notes, '') end)));
      end if;
    else
      -- New line: snapshot the current catalogue, as create_order does.
      select p.id as product_id, p.name as product_name, p.category_id, p.prep_type, p.is_veg, p.contains_egg, p.allergens,
             p.tax_rate_bps, p.hsn_code, p.is_available as product_available, p.archived_at as product_archived,
             pv.id as variant_id, pv.name as variant_name, pv.price_paise, pv.kitchen_id, pv.lead_time_minutes,
             pv.is_eggless, pv.is_available as variant_available, pv.archived_at as variant_archived
      into v
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      where pv.id = variant;
      if not found then
        perform private.fail(format('Line %s: this item is no longer in the catalogue.', pos));
      end if;
      if v.product_archived is not null or v.variant_archived is not null
         or not v.product_available or not v.variant_available then
        perform private.fail(format('%s — %s is not available.', v.product_name, v.variant_name), 'unavailable');
      end if;
      if o.status = 'confirmed' and v.prep_type = 'made_to_order' and v.kitchen_id is null then
        perform private.fail(format('Assign a preparing kitchen before adding %s — %s to a confirmed order.', v.product_name, v.variant_name), 'unmapped');
      end if;

      next_line := next_line + 1;
      insert into public.order_items (
        order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
        is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
        hsn_code, quantity, line_total_paise, tax_paise, notes
      ) values (
        o.id, next_line, v.product_id, v.variant_id, v.category_id, v.product_name, v.variant_name, v.prep_type,
        case when v.prep_type = 'made_to_order' then v.kitchen_id end,
        v.is_veg, v.contains_egg, v.is_eggless, v.allergens, v.lead_time_minutes, v.price_paise, v.tax_rate_bps,
        v.hsn_code, qty, v.price_paise * qty, 0, v_notes
      );
      if v.prep_type = 'made_to_order' then
        grown_lead := greatest(grown_lead, v.lead_time_minutes);
      end if;
      if v.category_id is not null and not v.category_id = any (old_categories) then
        new_categories := new_categories || v.category_id;
      end if;
      changes := changes || jsonb_build_array(jsonb_build_object(
        'item', v.product_name || ' — ' || v.variant_name, 'from', 0, 'to', qty));
    end if;
  end loop;

  -- Existing lines left out of the list are removed (the audit log keeps the deleted rows).
  for ln in
    delete from public.order_items
    where order_id = o.id and line_no <= last_existing and not (id = any (kept))
    returning *
  loop
    changes := changes || jsonb_build_array(jsonb_build_object(
      'item', ln.product_name || ' — ' || ln.variant_name, 'from', ln.quantity, 'to', 0));
  end loop;

  if jsonb_array_length(changes) = 0 then
    perform private.fail('Nothing was changed.');
  end if;

  -- Preparation time for what the edit adds.
  if grown_lead > 0 and o.due_at < now() + make_interval(mins => grown_lead) - interval '1 minute' then
    problem := format('The added items need %s of preparation; the earliest pickup is %s.',
      case when grown_lead >= 60 then (grown_lead / 60) || ' h ' || (grown_lead % 60) || ' min' else grown_lead || ' min' end,
      to_char((now() + make_interval(mins => grown_lead)) at time zone private.business_timezone(), 'FMDD Mon, FMHH12:MI AM'));
    if override is null then
      perform private.fail(problem || ' An admin can override with a reason.', 'lead_time');
    end if;
  end if;

  -- Daily caps for categories this edit adds, counted against every other order (as a new booking would be).
  if not o.is_immediate and cardinality(new_categories) > 0 then
    day := (o.due_at at time zone private.business_timezone())::date;
    perform pg_advisory_xact_lock(hashtext('capacity'), day - date '2000-01-01');
    for cat in
      select c.id, c.name, private.category_cap(day, c.id) as cap
      from public.categories c where c.id = any (new_categories) order by c.name
    loop
      continue when cat.cap is null;
      select count(*) into used
      from private.counted_orders(day, o.id) x
      where exists (select 1 from public.order_items oi
                    where oi.order_id = x.id and oi.category_id = cat.id and oi.quantity > oi.cancelled_quantity);
      if used >= cat.cap then
        cap_msg := format('%s: %s/%s orders on %s.', cat.name, used, cat.cap, to_char(day, 'FMDD Mon'));
        if override is null then
          perform private.fail(cap_msg || ' An admin can override with a reason.', 'capacity');
        end if;
        exit;
      end if;
    end loop;
  end if;

  perform private.recalc_order_totals(o.id);
  update public.orders set version = version + 1 where id = o.id returning * into o;

  perform private.log_order_event(o.id, 'items_changed', reason,
    jsonb_build_object('changes', changes, 'total_from', total_before, 'total_to', o.total_paise));
  if override is not null and (problem is not null or cap_msg is not null) then
    perform private.log_order_event(o.id, 'override', override,
      jsonb_strip_nulls(jsonb_build_object('lead_time', problem, 'capacity', cap_msg)));
  end if;
  return o;
end;
$$;

revoke execute on function public.update_order_items(uuid, integer, jsonb, text, text) from public, anon;
grant execute on function public.update_order_items(uuid, integer, jsonb, text, text) to authenticated;
