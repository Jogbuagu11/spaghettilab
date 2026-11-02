-- Running late.
--
-- ready_at was written once at checkout and never revised, so a late order
-- kept telling the customer its original time indefinitely. ready_at is now
-- the *current* promise and moves when the kitchen pushes it back; the
-- original is preserved so both the customer and the kitchen can see the slip.

alter table orders
  add column original_ready_at timestamptz,
  add column delay_minutes     integer  not null default 0 check (delay_minutes >= 0),
  add column delay_count       smallint not null default 0 check (delay_count >= 0),
  add column delay_reason      text;

comment on column orders.original_ready_at is
  'The time first promised. Null until an order is delayed at least once.';
comment on column orders.delay_minutes is
  'Cumulative minutes pushed back, for spotting which days or dishes run late.';
comment on column orders.delay_count is
  'Number of times pushed back. Also keys the per-delay email so a second
   delay is not suppressed by the once-per-template guard.';

-- The kitchen view asks "what is overdue right now" on every poll.
create index orders_live_ready_idx on orders (ready_at)
  where status in ('paid', 'preparing', 'ready', 'out_for_delivery');
