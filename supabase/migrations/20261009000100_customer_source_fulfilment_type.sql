-- 2026-10-09: a new order source for orders a customer sends in themselves (WhatsApp, message),
-- and whether the customer collects from the store or the bakery sets up at their place.
-- Own migration: a new enum value cannot be used in the transaction that adds it.
alter type public.order_source add value if not exists 'CUSTOMER';
create type public.fulfilment_type as enum ('collect', 'setup');
