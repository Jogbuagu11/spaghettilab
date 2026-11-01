-- Spaghetti Lab core schema.
--
-- Money is always integer cents; never floats. Menu rows are the source of
-- truth the admin dashboard edits, and checkout re-prices against them so a
-- tampered client payload can never set its own total.
--
-- No extensions required: gen_random_uuid() is core Postgres since 13.

-- ---------------------------------------------------------------- menu ----

-- The plate builder has five fixed groups rather than arbitrary nesting, so
-- one table with a group discriminator beats a generic category tree.
create type menu_group as enum ('size', 'heat', 'protein', 'customization', 'extra');

create table menu_options (
  id               text primary key,          -- stable slug, e.g. 'meatball'
  group_name       menu_group not null,
  label            text not null,
  description      text,
  price_cents      integer not null default 0 check (price_cents >= 0),
  sort_order       integer not null default 0,
  is_available     boolean not null default true,
  -- Populated by scripts/square-catalog-seed.mjs so Square receipts and
  -- reporting show real line items instead of one opaque "Order" total.
  square_object_id    text,
  square_variation_id text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index menu_options_group_idx on menu_options (group_name, sort_order);

-- ------------------------------------------------------------ settings ----

-- Single row (id = 1). Everything the admin can tune without a deploy.
create table settings (
  id                        smallint primary key default 1 check (id = 1),
  is_accepting_orders       boolean not null default true,
  closed_message            text not null default 'We''re not taking orders right now — check back soon!',
  tax_rate                  numeric(6,5) not null default 0.09375 check (tax_rate >= 0 and tax_rate < 1),
  delivery_fee_cents        integer not null default 700 check (delivery_fee_cents >= 0),
  free_delivery_over_cents  integer not null default 6000 check (free_delivery_over_cents >= 0),
  prep_minutes              integer not null default 15 check (prep_minutes > 0),
  slot_interval_minutes     integer not null default 15 check (slot_interval_minutes > 0),
  delivery_radius_miles     numeric(4,1) not null default 5.0 check (delivery_radius_miles > 0),
  -- Berryessa, North San Jose. Geocoded origin for the radius check.
  origin_lat                numeric(9,6) not null default 37.385800,
  origin_lng                numeric(9,6) not null default -121.861500,
  origin_postal_code        text not null default '95131',
  pickup_address            text,             -- revealed only after payment
  contact_email             text not null default 'hello@spaghettilab.store',
  contact_phone             text,
  instagram_url             text,
  tiktok_url                text,
  facebook_url              text,
  google_review_url         text,
  yelp_url                  text,
  ga4_measurement_id        text,
  meta_pixel_id             text,
  updated_at                timestamptz not null default now()
);

-- Per-day hours beat global open/close constants: a kitchen closes on Mondays.
create table business_hours (
  day_of_week  smallint primary key check (day_of_week between 0 and 6), -- 0 = Sunday
  is_closed    boolean not null default false,
  open_minute  integer not null default 720  check (open_minute  between 0 and 1440), -- 12:00
  close_minute integer not null default 1200 check (close_minute between 0 and 1440), -- 20:00
  constraint hours_ordered check (is_closed or close_minute > open_minute)
);

-- One-off overrides: holidays, vacations, a sold-out Saturday.
create table schedule_exceptions (
  exception_date date primary key,
  is_closed      boolean not null default true,
  open_minute    integer check (open_minute  between 0 and 1440),
  close_minute   integer check (close_minute between 0 and 1440),
  note           text
);

-- -------------------------------------------------------------- orders ----

create type order_status as enum (
  'pending_payment', 'paid', 'preparing', 'ready',
  'out_for_delivery', 'completed', 'cancelled', 'refunded'
);
create type fulfillment_type as enum ('pickup', 'delivery');

-- Human-facing order numbers: SL-1001, SL-1002, ...
create sequence order_number_seq start 1001;

create table orders (
  id                     uuid primary key default gen_random_uuid(),
  order_number           text not null unique default 'SL-' || nextval('order_number_seq'),
  status                 order_status not null default 'pending_payment',
  fulfillment            fulfillment_type not null,

  customer_name          text not null,
  customer_email         text not null,
  customer_phone         text not null,

  delivery_address       text,
  delivery_lat           numeric(9,6),
  delivery_lng           numeric(9,6),
  delivery_distance_mi   numeric(5,2),

  -- null means ASAP; ready_at is what the customer is told either way.
  scheduled_for          timestamptz,
  ready_at               timestamptz,

  -- Server-computed totals. A snapshot of tax_rate keeps old orders honest
  -- when the admin later changes the rate.
  subtotal_cents         integer not null check (subtotal_cents >= 0),
  delivery_fee_cents     integer not null default 0 check (delivery_fee_cents >= 0),
  tax_cents              integer not null default 0 check (tax_cents >= 0),
  tip_cents              integer not null default 0 check (tip_cents >= 0),
  total_cents            integer not null check (total_cents >= 0),
  tax_rate               numeric(6,5) not null,

  square_payment_id      text unique,
  square_order_id        text,
  square_receipt_url     text,
  card_brand             text,
  card_last4             text,

  -- Unguessable key for /track so customers need no account.
  track_token            uuid not null unique default gen_random_uuid(),

  customer_note          text,
  kitchen_note           text,
  cancellation_reason    text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  paid_at                timestamptz,
  completed_at           timestamptz,

  constraint delivery_needs_address
    check (fulfillment <> 'delivery' or delivery_address is not null)
);

create index orders_status_created_idx on orders (status, created_at desc);
create index orders_created_idx        on orders (created_at desc);
create index orders_email_idx          on orders (lower(customer_email));

create type order_item_kind as enum ('plate', 'extra');

-- Line items store a label/price snapshot: menu prices change, receipts must not.
create table order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders (id) on delete cascade,
  kind              order_item_kind not null,
  label             text not null,
  quantity          integer not null check (quantity > 0),
  unit_price_cents  integer not null check (unit_price_cents >= 0),
  total_price_cents integer not null check (total_price_cents >= 0),
  -- For plates: {size, heat, proteins: {id: qty}, customizations: [id]}
  config            jsonb not null default '{}'::jsonb,
  sort_order        integer not null default 0
);

create index order_items_order_idx on order_items (order_id, sort_order);

-- ------------------------------------------------------------- reviews ----

create table reviews (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null unique references orders (id) on delete cascade,
  rating        smallint not null check (rating between 1 and 5),
  body          text,
  author_name   text not null,
  is_published  boolean not null default false, -- moderated before going live
  created_at    timestamptz not null default now()
);

create index reviews_published_idx on reviews (is_published, created_at desc);

-- -------------------------------------------------------------- emails ----

-- Doubles as an idempotency guard: a unique (order_id, template) stops a
-- retried Square webhook from sending a second confirmation.
create table email_log (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references orders (id) on delete cascade,
  template   text not null,
  to_email   text not null,
  resend_id  text,
  status     text not null default 'sent',
  error      text,
  created_at timestamptz not null default now()
);

create unique index email_log_once_idx
  on email_log (order_id, template)
  where order_id is not null and status = 'sent';

-- --------------------------------------------------------------- admin ----

-- Allowlist, checked against the JWT email claim by the RLS policies below.
create table admin_users (
  email      text primary key,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ triggers ----

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger menu_options_touch before update on menu_options
  for each row execute function touch_updated_at();
create trigger settings_touch      before update on settings
  for each row execute function touch_updated_at();
create trigger orders_touch        before update on orders
  for each row execute function touch_updated_at();
