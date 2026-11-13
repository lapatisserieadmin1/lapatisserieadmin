-- Phase 5D: chef PIN sign-in on registered kitchen tablets (docs/superpowers/specs/2026-10-03-chef-pin-signin-design.md).
-- An admin registers a tablet for one kitchen and sets each chef's PIN. On the tablet, a chef taps
-- their name and types the PIN; the web server checks it with the service-role key and signs the
-- chef in. Owner decisions (2026-10-03): admin sets PINs; no auto-lock; no lock-out (wrong PINs are
-- only counted per tablet). PIN hashes live in their own table, out of reach of every staff role and
-- out of audit_events (PIN changes are logged there as UPDATE/DELETE on staff_pins without the hash).

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table public.kitchen_devices (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens (id) on delete restrict,
  label text not null check (length(label) between 1 and 60),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  registered_by uuid references auth.users (id) on delete set null,
  registered_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  last_used_at timestamptz,
  failed_pins integer not null default 0 check (failed_pins >= 0)
);
create index kitchen_devices_kitchen_id_idx on public.kitchen_devices (kitchen_id);
create index kitchen_devices_registered_by_idx on public.kitchen_devices (registered_by);
create index kitchen_devices_revoked_by_idx on public.kitchen_devices (revoked_by);

create table public.staff_pins (
  user_id uuid primary key references public.staff_profiles (user_id) on delete cascade,
  pin_hash text not null,
  set_at timestamptz not null default now(),
  set_by uuid references auth.users (id) on delete set null
);
create index staff_pins_set_by_idx on public.staff_pins (set_by);

alter table public.kitchen_devices enable row level security;
alter table public.staff_pins enable row level security;
create policy "Admins read kitchen tablets" on public.kitchen_devices for select to authenticated
  using ((select private.has_role(array['admin']::public.staff_role[])));
-- staff_pins: no policies and no grants; only the functions below (and the service role) touch it.
revoke all on public.kitchen_devices, public.staff_pins from anon, authenticated;
grant select on public.kitchen_devices to authenticated;

-- Tablets are audited like other tables (the token hash cannot be turned back into the token).
-- PIN changes are audited by hand below, without the hash.
create trigger kitchen_devices_audit after insert or update or delete on public.kitchen_devices
  for each row execute function private.audit_row('id');

-- ---------------------------------------------------------------------------
-- 2. Admin functions
-- ---------------------------------------------------------------------------

-- Sets (or with null, clears) a chef's PIN: 4 to 6 digits.
create function public.set_staff_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can set PINs.', 'forbidden');
  end if;
  if not exists (select 1 from public.staff_profiles where user_id = p_user_id and role = 'chef') then
    perform private.fail('PINs are only for chefs.');
  end if;
  if p_pin is null then
    delete from public.staff_pins where user_id = p_user_id;
    insert into public.audit_events (actor_id, action, table_name, record_id, old_data)
    values (auth.uid(), 'DELETE', 'staff_pins', p_user_id::text, jsonb_build_object('pin', 'cleared'));
    return;
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    perform private.fail('A PIN is 4 to 6 digits.');
  end if;
  insert into public.staff_pins (user_id, pin_hash, set_at, set_by)
  values (p_user_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), now(), auth.uid())
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, set_at = excluded.set_at, set_by = excluded.set_by;
  insert into public.audit_events (actor_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'UPDATE', 'staff_pins', p_user_id::text, jsonb_build_object('pin_set_at', now()));
end;
$$;

-- Registers a tablet for one kitchen. The web server makes the token and passes only its SHA-256.
create function public.register_kitchen_device(p_kitchen_id uuid, p_label text, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := trim(coalesce(p_label, ''));
  v_id uuid;
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can register kitchen tablets.', 'forbidden');
  end if;
  if length(v_label) < 1 or length(v_label) > 60 then
    perform private.fail('Give the tablet a name of up to 60 characters.');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    perform private.fail('Invalid tablet token.');
  end if;
  if not exists (select 1 from public.kitchens where id = p_kitchen_id and is_active) then
    perform private.fail('Choose an active kitchen.');
  end if;
  insert into public.kitchen_devices (kitchen_id, label, token_hash, registered_by)
  values (p_kitchen_id, v_label, p_token_hash, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Revoking takes effect at once: no new PIN sign-ins, and open sessions end at their next check.
create function public.revoke_kitchen_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can revoke kitchen tablets.', 'forbidden');
  end if;
  update public.kitchen_devices set revoked_at = now(), revoked_by = auth.uid()
  where id = p_device_id and revoked_at is null;
  if not found and not exists (select 1 from public.kitchen_devices where id = p_device_id) then
    perform private.fail('Tablet not found.', 'not_found');
  end if;
end;
$$;

revoke execute on function
  public.set_staff_pin(uuid, text),
  public.register_kitchen_device(uuid, text, text),
  public.revoke_kitchen_device(uuid)
  from public, anon;
grant execute on function
  public.set_staff_pin(uuid, text),
  public.register_kitchen_device(uuid, text, text),
  public.revoke_kitchen_device(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tablet functions (service role only: called by the web server)
-- ---------------------------------------------------------------------------

-- Checks a chef's PIN on a tablet. Never raises for a wrong PIN (so the count is kept): returns
-- {"ok": false} for every refusal, with no hint of which check failed.
create function public.verify_kitchen_pin(p_token_hash text, p_user_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.kitchen_devices;
  v_hash text;
begin
  select * into d from public.kitchen_devices where token_hash = p_token_hash and revoked_at is null;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  select sp.pin_hash into v_hash
  from public.staff_pins sp
  join public.staff_profiles p on p.user_id = sp.user_id
  where sp.user_id = p_user_id and p.is_active and p.role = 'chef'
    and exists (select 1 from public.staff_kitchens sk where sk.user_id = p_user_id and sk.kitchen_id = d.kitchen_id);
  if v_hash is null or p_pin is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    update public.kitchen_devices set failed_pins = failed_pins + 1 where id = d.id;
    return jsonb_build_object('ok', false);
  end if;
  update public.kitchen_devices set failed_pins = 0, last_used_at = now() where id = d.id;
  -- signed_in_at comes from the database clock, the same clock as staff_pins.set_at, so the session
  -- check (kitchen_pin_session_valid) never depends on the web server's clock.
  return jsonb_build_object('ok', true, 'device_id', d.id, 'kitchen_id', d.kitchen_id, 'signed_in_at', now());
end;
$$;

-- The tablet's kitchen and its active chefs, for the chef picker; null for an unknown or revoked tablet.
create function public.kitchen_device_chefs(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'device_id', d.id,
    'kitchen', jsonb_build_object('id', k.id, 'name', k.name),
    'chefs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'full_name', p.full_name,
               'has_pin', exists (select 1 from public.staff_pins sp where sp.user_id = p.user_id))
             order by p.full_name)
      from public.staff_profiles p
      join public.staff_kitchens sk on sk.user_id = p.user_id and sk.kitchen_id = d.kitchen_id
      where p.is_active and p.role = 'chef'), '[]'))
  from public.kitchen_devices d join public.kitchens k on k.id = d.kitchen_id
  where d.token_hash = p_token_hash and d.revoked_at is null
$$;

-- Whether a PIN session that started at p_signed_in_at may continue: the tablet is still registered,
-- the chef is still active on its kitchen, and the PIN has not been reset or cleared since.
create function public.kitchen_pin_session_valid(p_token_hash text, p_user_id uuid, p_signed_in_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.kitchen_devices d
    join public.staff_profiles p on p.user_id = p_user_id and p.is_active and p.role = 'chef'
    join public.staff_kitchens sk on sk.user_id = p.user_id and sk.kitchen_id = d.kitchen_id
    join public.staff_pins sp on sp.user_id = p.user_id
    where d.token_hash = p_token_hash and d.revoked_at is null and sp.set_at <= p_signed_in_at)
$$;

revoke execute on function
  public.verify_kitchen_pin(text, uuid, text),
  public.kitchen_device_chefs(text),
  public.kitchen_pin_session_valid(text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.verify_kitchen_pin(text, uuid, text),
  public.kitchen_device_chefs(text),
  public.kitchen_pin_session_valid(text, uuid, timestamptz)
  to service_role;
