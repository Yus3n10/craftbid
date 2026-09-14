-- Bids below the client's starting budget.
--
-- A client can set a starting budget higher than the work needs, so an artist
-- may now bid under it. They must say why, and the client reads that reason
-- next to the price. The posting's budget is still copied onto every bid, now
-- as the reference the reason is judged against rather than a floor.
--
-- The old CHECK refused any bid below that copy. Every existing row satisfies
-- the new one, because none of them is below it and none has a reason.

ALTER TABLE applications ADD (below_budget_reason VARCHAR2(500 CHAR));

ALTER TABLE applications DROP CONSTRAINT ck_applications_meets_minimum;

-- A reason exactly when the bid is below the starting budget, and never an
-- empty one. Kept in the database so no code path can store a lower bid the
-- client is given no explanation for.
ALTER TABLE applications ADD CONSTRAINT ck_applications_below_budget CHECK (
  (proposed_price_centavos >= min_price_at_apply_centavos AND below_budget_reason IS NULL)
  OR
  (proposed_price_centavos < min_price_at_apply_centavos
     AND below_budget_reason IS NOT NULL
     AND LENGTH(TRIM(below_budget_reason)) > 0)
);
