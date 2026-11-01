-- Initial menu, hours and settings, mirroring what src/lib/menu.ts hard-coded
-- in Phase 1. Idempotent so it is safe to re-run against an existing project:
-- prices the admin has since edited are left alone.

insert into menu_options (id, group_name, label, description, price_cents, sort_order) values
  ('small',  'size', 'Small',  'One scoop of spaghetti — a light plate.',     1200, 10),
  ('medium', 'size', 'Medium', 'The house standard.',                         1800, 20),
  ('large',  'size', 'Large',  'For a serious appetite, or two to share.',    2600, 30),

  ('spicy', 'heat', 'Spicy',     'Calabrian chili in the sauce.', 0, 10),
  ('mild',  'heat', 'Not Spicy', 'Classic sweet tomato sauce.',   0, 20),

  ('meatball',    'protein', 'Meatball',    'House beef-and-pork meatball.', 400, 10),
  ('sausage',     'protein', 'Sausage',     'Italian sausage, sliced.',      400, 20),
  ('minced-pork', 'protein', 'Minced Pork', 'Slow-simmered minced pork.',    400, 30),

  ('mushroom',     'customization', 'Mushroom',     'Sauteed cremini.',        100, 10),
  ('extra-cheese', 'customization', 'Extra Cheese', 'Grated parmesan, heavy.', 100, 20),

  ('garlic-bread', 'extra', 'Garlic Bread (slice)', 'Buttered, baked to order.', 200, 10),
  ('water',        'extra', 'Bottled Water',        null,                        200, 20),
  ('coke',         'extra', 'Coke (can)',           null,                        200, 30)
on conflict (id) do nothing;

-- Open 7 days, 12:00-20:00 (720-1200 minutes).
insert into business_hours (day_of_week, is_closed, open_minute, close_minute)
select d, false, 720, 1200 from generate_series(0, 6) as d
on conflict (day_of_week) do nothing;

-- Santa Clara County combined rate; adjust in the admin dashboard if it moves.
insert into settings (id) values (1)
on conflict (id) do nothing;
