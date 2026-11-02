-- Delivery capacity, dynamic wait times, and allergens.
--
-- Pickup is deliberately uncapped: plates come off the same stove whether one
-- person or ten collect them. Delivery is capped per hour because each one
-- costs a round trip, and three in an hour is already most of that hour.
--
-- Total orders stay uncapped too — a busy evening pushes the quoted ready
-- time out rather than turning customers away.

alter table settings
  add column delivery_per_hour_limit smallint not null default 3
    check (delivery_per_hour_limit between 0 and 50),
  add column queue_minutes_per_order smallint not null default 3
    check (queue_minutes_per_order between 0 and 60),
  add column max_prep_minutes smallint not null default 90
    check (max_prep_minutes between 5 and 480);

comment on column settings.delivery_per_hour_limit is
  'Deliveries accepted per clock hour. 0 disables delivery entirely.';
comment on column settings.queue_minutes_per_order is
  'Minutes added to the ASAP estimate for each order already in the queue.';
comment on column settings.max_prep_minutes is
  'Ceiling on the ASAP estimate however long the queue gets.';

grant select (delivery_per_hour_limit, queue_minutes_per_order, max_prep_minutes)
  on settings to anon, authenticated;

-- Allergens live per option so a plate's warning is assembled from exactly
-- what the customer chose, rather than warning about the whole menu.
alter table menu_options add column allergens text[] not null default '{}';
comment on column menu_options.allergens is
  'Lowercase allergen tags, e.g. {wheat,dairy}. Shown on the menu and at checkout.';

update menu_options set allergens = '{wheat}'           where id in ('small','medium','large');
update menu_options set allergens = '{wheat,dairy}'     where id = 'garlic-bread';
update menu_options set allergens = '{dairy}'           where id = 'extra-cheese';
update menu_options set allergens = '{pork}'            where id in ('sausage','minced-pork');
update menu_options set allergens = '{beef,pork,wheat}' where id = 'meatball';

/**
 * How many deliveries are already booked per clock hour.
 *
 * SECURITY DEFINER so the storefront can see load without any read access to
 * orders: it returns counts and nothing else. Cancelled and refunded orders
 * free their slot back up.
 */
create or replace function delivery_load(from_ts timestamptz, to_ts timestamptz)
returns table (hour_start timestamptz, booked bigint)
language sql
stable
security definer
set search_path = public
as $$
  select date_trunc('hour', ready_at) as hour_start, count(*) as booked
  from orders
  where fulfillment = 'delivery'
    and status in ('pending_payment', 'paid', 'preparing', 'ready', 'out_for_delivery')
    and ready_at >= from_ts
    and ready_at <  to_ts
  group by 1
$$;

grant execute on function delivery_load(timestamptz, timestamptz) to anon, authenticated;

/** Orders the kitchen still has to make — drives the dynamic wait estimate. */
create or replace function kitchen_queue_depth()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from orders where status in ('paid', 'preparing')
$$;

grant execute on function kitchen_queue_depth() to anon, authenticated;
