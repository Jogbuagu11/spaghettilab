-- Orders that start in WhatsApp.
--
-- A Flow submission produces a real order before any money moves: we price it
-- server-side, persist it as pending_payment, and reply with a Square payment
-- link. The Square webhook finishes the job when the customer pays, so a
-- WhatsApp order lands in the same pipeline as a web order — same kitchen
-- ticket, same /track link, same emails.

create type order_channel as enum ('web', 'whatsapp');

alter table orders
  add column channel          order_channel not null default 'web',
  add column whatsapp_phone   text,
  add column payment_link_url text,
  add column payment_link_id  text;

comment on column orders.payment_link_url is
  'Square-hosted checkout sent into the chat. Null once paid.';

-- The Square webhook matches an unpaid link order by its Square order id.
create index orders_square_order_idx on orders (square_order_id)
  where square_order_id is not null;

-- Abandoned chat carts shouldn't look like real orders forever.
create index orders_pending_idx on orders (created_at)
  where status = 'pending_payment';
