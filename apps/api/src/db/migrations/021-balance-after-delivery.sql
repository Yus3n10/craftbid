-- The balance is paid after delivery or at a meet-up, nothing else.
--
-- "transfer" now means paying by GCash, Maya or bank once the piece has
-- arrived, rather than after seeing photos and before shipping; the value is
-- kept so the site and the API agree while they deploy. Cash on delivery to a
-- courier is removed. Any commission still set to it moves to paying after
-- delivery, the closest remaining option; production had none when this ran.
--
-- Payment records that were already made as cash on delivery keep their method.

UPDATE commissions SET balance_method = 'transfer' WHERE balance_method = 'cod';

ALTER TABLE commissions DROP CONSTRAINT ck_commissions_split;
ALTER TABLE commissions ADD CONSTRAINT ck_commissions_split CHECK (
  (payment_tracking = 0
     AND down_payment_centavos IS NULL AND balance_centavos IS NULL AND balance_method IS NULL)
  OR
  (payment_tracking = 1
     AND down_payment_centavos > 0 AND balance_centavos >= 0
     AND down_payment_centavos + balance_centavos = agreed_price_centavos
     AND balance_method IN ('transfer', 'meetup'))
);
