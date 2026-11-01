-- Weekly standing orders.
--
-- The customer saves a card with Square once, picks a day and time, and the
-- run-subscriptions function creates and charges a real order each week. Every
-- run re-prices against the live menu, so a price change or a sold-out topping
-- is reflected automatically rather than being frozen at signup.
--
-- No card data is stored here — only Square's customer and card ids.

create type subscription_status as enum ('active', 'paused', 'payment_failed', 'cancelled');

create sequence subscription_reference_seq start 101;

create table subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique
                          default 'SUB-' || nextval('subscription_reference_seq'),
  status                subscription_status not null default 'active',

  customer_name         text not null,
  customer_email        text not null,
  customer_phone        text not null,

  fulfillment           fulfillment_type not null,
  delivery_address      text,
  delivery_lat          numeric(9,6),
  delivery_lng          numeric(9,6),
  delivery_distance_mi  numeric(5,2),

  -- When the food is wanted each week, in kitchen wall-clock terms.
  day_of_week           smallint not null check (day_of_week between 0 and 6),
  ready_minute          integer  not null check (ready_minute between 0 and 1440),

  -- The saved basket, in the same shape create-order accepts.
  plates                jsonb not null,
  extras                jsonb not null default '{}'::jsonb,
  tip_percent           smallint not null default 0 check (tip_percent between 0 and 100),

  -- Square card-on-file. Storing ids only keeps us out of PCI scope.
  square_customer_id    text not null,
  square_card_id        text not null,
  card_brand            text,
  card_last4            text,

  -- Unguessable key for the manage link in every email.
  manage_token          uuid not null unique default gen_random_uuid(),

  -- The next date to charge. Advanced by the weekly run.
  next_run_date         date not null,
  last_order_id         uuid references orders (id) on delete set null,
  last_charged_at       timestamptz,
  -- Three consecutive declines pause the subscription instead of retrying forever.
  failure_count         smallint not null default 0,
  last_error            text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  cancelled_at          timestamptz,

  constraint subscription_delivery_needs_address
    check (fulfillment <> 'delivery' or delivery_address is not null),
  constraint subscription_needs_plates
    check (jsonb_typeof(plates) = 'array' and jsonb_array_length(plates) > 0)
);

-- The weekly sweep's only query: active subscriptions that are due.
create index subscriptions_due_idx on subscriptions (status, next_run_date)
  where status in ('active', 'payment_failed');
create index subscriptions_email_idx on subscriptions (lower(customer_email));

-- "Skip next week" without cancelling the whole thing.
create table subscription_skips (
  subscription_id uuid not null references subscriptions (id) on delete cascade,
  skip_date       date not null,
  created_at      timestamptz not null default now(),
  primary key (subscription_id, skip_date)
);

-- Ties each generated order back to the standing order that created it.
alter table orders
  add column subscription_id uuid references subscriptions (id) on delete set null;

create index orders_subscription_idx on orders (subscription_id, created_at desc);

create trigger subscriptions_touch before update on subscriptions
  for each row execute function touch_updated_at();

-- RLS: same shape as orders. No anonymous access at all; customers reach their
-- own subscription through the manage-subscription function, which matches the
-- 128-bit manage_token under the service role.
alter table subscriptions      enable row level security;
alter table subscription_skips enable row level security;

create policy "admins read subscriptions" on subscriptions
  for select to authenticated using (is_admin());
create policy "admins update subscriptions" on subscriptions
  for update to authenticated using (is_admin()) with check (is_admin());
create policy "admins read skips" on subscription_skips
  for select to authenticated using (is_admin());
