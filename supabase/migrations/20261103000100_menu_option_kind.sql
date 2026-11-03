-- Tags what a menu option actually is, for the checkout upsell.
--
-- `group_name` already says *where* an option lives in the builder; `kind`
-- says what it is. Checkout suggests parmesan and a drink when the basket has
-- neither, and it can only do that if "drink" and "cheese" are properties of
-- the rows rather than a hard-coded list of ids in the client. Null everywhere
-- else — sizes and proteins have nothing to tag.

alter table menu_options add column if not exists kind text;

alter table menu_options drop constraint if exists menu_options_kind_check;
alter table menu_options add constraint menu_options_kind_check
  check (kind is null or kind in ('drink', 'side', 'cheese'));

comment on column menu_options.kind is
  'What the option is, for the checkout upsell: ''drink'', ''side'' or ''cheese''. Set it on new extras and customizations so they get suggested.';

update menu_options set kind = 'drink'  where id in ('water', 'coke') and kind is null;
update menu_options set kind = 'side'   where id = 'garlic-bread'     and kind is null;
update menu_options set kind = 'cheese' where id = 'extra-cheese'     and kind is null;
