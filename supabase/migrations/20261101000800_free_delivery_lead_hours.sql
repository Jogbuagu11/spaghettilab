-- Free delivery now needs 12 hours' notice rather than a calendar day.
--
-- An hours threshold is both what the business wants and simpler to reason
-- about: no timezone or DST arithmetic, just a difference between two instants.
-- The calendar-day column it replaces is dropped so there's one source of truth.

alter table settings
  add column free_delivery_min_lead_hours smallint not null default 12
    check (free_delivery_min_lead_hours between 0 and 336);

comment on column settings.free_delivery_min_lead_hours is
  'Hours of notice required for free delivery. 0 = spend threshold only.';

alter table settings drop column free_delivery_min_lead_days;

grant select (free_delivery_min_lead_hours) on settings to anon, authenticated;
