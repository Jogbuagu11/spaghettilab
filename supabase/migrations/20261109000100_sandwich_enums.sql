-- Sandwiches are a second product line, not another plate modifier: a plate is
-- $12/$18/$26 and a sandwich is $10/$12/$18, so they need their own size group.
--
-- Own migration because Postgres won't let a new enum value be *used* in the
-- transaction that adds it.

alter type menu_group      add value if not exists 'sandwich';
alter type menu_group      add value if not exists 'sandwich_size';
alter type order_item_kind add value if not exists 'sandwich';
