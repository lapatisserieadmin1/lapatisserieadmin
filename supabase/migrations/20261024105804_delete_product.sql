-- Admins delete a product (owner, 2026-10-24), with its sizes. Old orders keep the product's name, size
-- and price on their lines (the links to it are emptied); the audit log keeps the deleted rows.
create or replace function public.delete_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can delete products.', 'forbidden');
  end if;
  delete from public.products where id = p_product_id;
  if not found then
    perform private.fail('This product was already deleted.', 'not_found');
  end if;
end;
$$;

revoke execute on function public.delete_product(uuid) from public, anon;
grant execute on function public.delete_product(uuid) to authenticated;
