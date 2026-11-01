-- Owner's real details. Kept separate from the generic seed so re-running the
-- seed never clobbers values edited in the admin dashboard.

insert into admin_users (email) values ('mrs.ogbuagu@gmail.com')
on conflict (email) do nothing;

-- Disclosed on the receipt and on /track once an order is paid — never to anon.
update settings
set pickup_address = coalesce(pickup_address, '1183 Benny Ct, San Jose, CA 95131')
where id = 1;
