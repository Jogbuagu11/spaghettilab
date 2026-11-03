-- Adds the 'base' option group: what comes in the plate before any add-ons.
--
-- Its own migration because Postgres won't let a new enum value be *used* in
-- the same transaction that adds it.

alter type menu_group add value if not exists 'base';
