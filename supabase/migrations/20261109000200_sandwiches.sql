-- Meatball and sausage sandwiches, in three sizes.
--
-- Price lives on the size, like it does for plates; the filling is a free
-- choice because both cost the same. Receipts compose the two into
-- "Meatball Sandwich — Medium (5 in)".

-- Which products an add-on belongs to. Provolone on spaghetti and grated
-- parmesan on a sub are both wrong, but mushroom goes on either — scoping the
-- row beats duplicating it, which would give the kitchen two sold-out
-- switches for one ingredient.
alter table menu_options
  add column if not exists applies_to text[] not null default '{plate,sandwich}';

alter table menu_options drop constraint if exists menu_options_applies_to_check;
alter table menu_options add constraint menu_options_applies_to_check
  check (applies_to <@ array['plate', 'sandwich']);

comment on column menu_options.applies_to is
  'For group_name = ''customization'': which products the add-on is offered on.';

insert into menu_options
  (id, group_name, label, description, price_cents, sort_order, allergens, applies_to)
values
  ('sandwich-small',  'sandwich_size', 'Small',  '3 in', 1000, 10, '{wheat}', '{sandwich}'),
  ('sandwich-medium', 'sandwich_size', 'Medium', '5 in', 1200, 20, '{wheat}', '{sandwich}'),
  ('sandwich-large',  'sandwich_size', 'Large',  '8 in', 1800, 30, '{wheat}', '{sandwich}'),

  ('sandwich-meatball', 'sandwich', 'Meatball', 'House beef-and-pork meatballs.', 0, 10,
   '{beef,pork,wheat}', '{sandwich}'),
  ('sandwich-sausage',  'sandwich', 'Sausage',  'Italian sausage, sliced.',       0, 20,
   '{pork}', '{sandwich}'),

  ('provolone', 'customization', 'Provolone', 'A slice, melted.', 100, 30, '{dairy}', '{sandwich}')
on conflict (id) do nothing;

-- Grated parmesan belongs on a plate; a slice of provolone belongs on a sub.
update menu_options set applies_to = '{plate}'          where id = 'extra-cheese';
update menu_options set applies_to = '{sandwich}'       where id = 'provolone';
update menu_options set applies_to = '{plate,sandwich}' where id = 'mushroom';

-- Standing orders store the cart they repeat, so they need somewhere to keep
-- a sandwich — and "must contain a plate" becomes "must contain something".
alter table subscriptions
  add column if not exists sandwiches jsonb not null default '[]'::jsonb;

alter table subscriptions drop constraint if exists subscription_needs_plates;
alter table subscriptions add constraint subscription_needs_items
  check (
    jsonb_typeof(plates) = 'array'
    and jsonb_typeof(sandwiches) = 'array'
    and jsonb_array_length(plates) + jsonb_array_length(sandwiches) > 0
  );
