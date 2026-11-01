-- Row-level security.
--
-- Shape of the system: the browser may READ the menu and published reviews and
-- nothing else. Every write — and every read of an order — goes through an
-- edge function holding the service role key, which is where validation and
-- re-pricing live. Admins additionally get direct read/write via their JWT.

-- Admin check used by every policy below. STABLE so the planner caches it per
-- statement; SECURITY DEFINER so it can read admin_users regardless of RLS.
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admin_users
    where email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
  );
$$;

alter table menu_options        enable row level security;
alter table settings            enable row level security;
alter table business_hours      enable row level security;
alter table schedule_exceptions enable row level security;
alter table orders              enable row level security;
alter table order_items         enable row level security;
alter table reviews             enable row level security;
alter table email_log           enable row level security;
alter table admin_users         enable row level security;

-- ---------------------------------------------------------------- menu ----
-- The storefront needs the menu before anyone logs in.

create policy "menu is public" on menu_options
  for select to anon, authenticated using (true);
create policy "admins manage menu" on menu_options
  for all to authenticated using (is_admin()) with check (is_admin());

create policy "hours are public" on business_hours
  for select to anon, authenticated using (true);
create policy "admins manage hours" on business_hours
  for all to authenticated using (is_admin()) with check (is_admin());

create policy "exceptions are public" on schedule_exceptions
  for select to anon, authenticated using (true);
create policy "admins manage exceptions" on schedule_exceptions
  for all to authenticated using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------ settings ----
-- pickup_address is only disclosed after payment, so the anon role gets
-- column-level SELECT on the storefront-safe columns rather than the whole
-- row. RLS grants the row; the GRANT restricts the columns.

create policy "settings readable" on settings
  for select to anon, authenticated using (true);
create policy "admins manage settings" on settings
  for all to authenticated using (is_admin()) with check (is_admin());

revoke all on settings from anon, authenticated;
grant select (
  id, is_accepting_orders, closed_message, tax_rate,
  delivery_fee_cents, free_delivery_over_cents, prep_minutes,
  slot_interval_minutes, delivery_radius_miles, origin_postal_code,
  contact_email, contact_phone,
  instagram_url, tiktok_url, facebook_url, google_review_url, yelp_url,
  ga4_measurement_id, meta_pixel_id, updated_at
) on settings to anon, authenticated;
-- Admins read and write every column, pickup_address included.
grant select, insert, update, delete on settings to authenticated;

-- -------------------------------------------------------------- orders ----
-- No anon policy at all: an unauthenticated SELECT returns zero rows. Customers
-- reach their own order through the track-order edge function, which matches a
-- 128-bit track_token under the service role.

create policy "admins read orders" on orders
  for select to authenticated using (is_admin());
create policy "admins update orders" on orders
  for update to authenticated using (is_admin()) with check (is_admin());

create policy "admins read order items" on order_items
  for select to authenticated using (is_admin());

-- ------------------------------------------------------------- reviews ----
-- Published reviews are public so /reviews can render AggregateRating.

create policy "published reviews are public" on reviews
  for select to anon, authenticated
  using (is_published);
create policy "admins manage reviews" on reviews
  for all to authenticated using (is_admin()) with check (is_admin());

-- -------------------------------------------------- admin-only tables ----

create policy "admins read email log" on email_log
  for select to authenticated using (is_admin());

create policy "admins read admin list" on admin_users
  for select to authenticated using (is_admin());
