-- Proof of delivery: a photo of the drop-off, plus where it was left.
--
-- The photo lives in the public `delivery-proof` storage bucket rather than
-- behind a signed URL, because email clients can't send auth headers and an
-- expiring link would break the receipt weeks later. Privacy comes from an
-- unguessable path (order uuid + random filename) and a 30-day purge, not
-- from the bucket being private.

alter table orders
  add column delivery_photo_path text,
  add column delivery_photo_url  text,
  add column delivery_note       text;

comment on column orders.delivery_photo_path is
  'Object path inside the delivery-proof bucket. Kept so the purge job can delete it.';
comment on column orders.delivery_note is
  'Where it was left, e.g. "Front porch, behind the planter".';

-- Lets the purge job find expired photos without scanning every order.
create index orders_delivery_photo_idx on orders (completed_at)
  where delivery_photo_path is not null;

-- Only admins may upload proof. Reads are public by virtue of the bucket, so
-- there's no select policy here — the unguessable path is the control.
create policy "admins upload delivery proof" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'delivery-proof' and is_admin());

create policy "admins replace delivery proof" on storage.objects
  for update to authenticated
  using (bucket_id = 'delivery-proof' and is_admin())
  with check (bucket_id = 'delivery-proof' and is_admin());

create policy "admins delete delivery proof" on storage.objects
  for delete to authenticated
  using (bucket_id = 'delivery-proof' and is_admin());
