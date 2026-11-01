-- Free delivery now requires planning ahead, not just a big basket.
--
-- Old rule:  subtotal over $60.
-- New rule:  subtotal at or over $60 AND scheduled at least a day ahead.
--            Weekly standing orders get free delivery unconditionally.
--
-- Both knobs are admin-editable: setting the lead requirement to 0 restores
-- the old size-only behaviour without a deploy.

alter table settings
  add column free_delivery_min_lead_days smallint not null default 1
    check (free_delivery_min_lead_days between 0 and 7),
  add column subscription_free_delivery boolean not null default true;

comment on column settings.free_delivery_min_lead_days is
  'Kitchen-calendar days of notice required for free delivery. 0 = size threshold only.';
comment on column settings.subscription_free_delivery is
  'Weekly standing orders skip the delivery fee regardless of basket size.';
