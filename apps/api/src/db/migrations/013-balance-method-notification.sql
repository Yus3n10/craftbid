-- Tell the artist how the client will pay the balance.
--
-- The client picks pay-after-photos, cash on delivery or meet-up, and until
-- now the artist only found out by opening the commission. The choice decides
-- whether they ship before or after being paid, so it is worth a notification.

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_type;

ALTER TABLE notifications ADD CONSTRAINT ck_notifications_type CHECK (type IN
  ('application_received', 'application_accepted', 'application_rejected',
   'commission_completed', 'review_received',
   'post_reaction', 'post_comment',
   'payment_submitted', 'payment_confirmed', 'payment_rejected',
   'work_finished', 'commission_shipped', 'problem_reported', 'problem_closed',
   'post_shared', 'balance_method_chosen'));
