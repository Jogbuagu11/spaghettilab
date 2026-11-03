-- Minced pork is what a plate comes with, not a $4 add-on.
--
-- It can't just be a $0 row in the `protein` group: that group is a quantity
-- stepper, so a free option there could be taken twenty times. The base is a
-- single choice, like heat — minced pork or nothing, no charge either way.
-- Meatball and sausage stay in `protein` as paid additions on top.

update menu_options
   set group_name  = 'base',
       price_cents = 0,
       sort_order  = 10,
       description = 'Slow-simmered minced pork, already in the sauce.'
 where id = 'minced-pork';

insert into menu_options (id, group_name, label, description, price_cents, sort_order, allergens)
values ('no-meat', 'base', 'No meat', 'Just the tomato sauce.', 0, 20, '{}')
on conflict (id) do nothing;
