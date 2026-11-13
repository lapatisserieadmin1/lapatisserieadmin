-- Owner, 2026-10-24. Products no longer have a food type (20261024000100). The retired kitchen tickets
-- copied it from the order line; let their lines take a missing value too, so no old path can fail on a
-- new product. Existing rows keep their value.
alter table public.kitchen_ticket_lines alter column is_veg drop not null;
