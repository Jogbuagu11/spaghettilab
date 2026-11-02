-- Cancellation policy, by how far the order has got.
--
--   pending_payment / paid  -> cancel, refunded in full
--   preparing / ready       -> cancel, minus a fee: the food exists and can't
--                              be resold
--   out_for_delivery        -> refused, it's already in the car
--   completed               -> refused
--
-- The fee is a share of the FOOD subtotal only. Delivery and tip are returned
-- in full because neither service was rendered — charging for a trip that
-- never happened would be hard to defend on a chargeback.

alter table settings
  add column late_cancel_fee_percent smallint not null default 50
    check (late_cancel_fee_percent between 0 and 100);

comment on column settings.late_cancel_fee_percent is
  'Share of the food subtotal retained when cancelling an order already being
   cooked. 0 makes late cancellation free.';

grant select (late_cancel_fee_percent) on settings to anon, authenticated;

alter table orders add column cancellation_fee_cents integer not null default 0
  check (cancellation_fee_cents >= 0);
