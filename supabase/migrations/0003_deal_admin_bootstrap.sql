-- 0003: RLS bootstrap policy for deal creation (not yet applied to prod).
-- Lets the OWNER of a deal insert their own first 'seller' admin row, closing
-- the chicken-and-egg in deal_admins_admin_all (being admin required to insert
-- the first admin row). The app currently bootstraps via the service role
-- (DECISIONS #38); applying this migration makes the RLS path self-sufficient
-- and the service-role fallback can then be removed.
create policy deal_admins_owner_bootstrap on deal_admins
  for insert
  with check (
    user_id = auth.uid()
    and role = 'seller'
    and exists (select 1 from deals d where d.id = deal_id and d.owner_id = auth.uid())
  );
