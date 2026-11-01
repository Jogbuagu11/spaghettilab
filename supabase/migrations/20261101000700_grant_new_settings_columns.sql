-- 20261101000400 added free_delivery_min_lead_days and subscription_free_delivery
-- but didn't extend the storefront's column-level SELECT grant, so anon lost
-- access to the whole row: a column-level grant makes `select *` fail outright
-- if any requested column isn't covered.
--
-- The storefront now asks for an explicit column list (src/lib/storefront.ts)
-- rather than *, so a future column can't break it the same way. Any new
-- public-facing column still has to be granted here.

grant select (free_delivery_min_lead_days, subscription_free_delivery)
  on settings to anon, authenticated;
