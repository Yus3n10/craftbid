-- Lets the notification queue carry reactions and comments.
--
-- The type list is a CHECK rather than a lookup table, which means widening it
-- is a migration. That is the trade the original design made on purpose: an
-- unknown type can never reach the table, and the cost is this file whenever
-- the product genuinely grows a new kind of notice.
--
-- Dropped and recreated rather than altered, because Oracle has no syntax for
-- editing a CHECK in place. Existing rows are re-validated against the new
-- constraint as it is added, so a value outside the list would fail here
-- rather than silently persist.

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_type;

ALTER TABLE notifications ADD CONSTRAINT ck_notifications_type CHECK (type IN
  ('application_received', 'application_accepted', 'application_rejected',
   'commission_completed', 'review_received',
   'post_reaction', 'post_comment'));

-- Reaction notices are deduplicated per actor per post while they are unread,
-- so someone cycling love to support to like leaves one notice rather than
-- three. That lookup reads two fields out of the JSON payload, and without an
-- index it is a full scan of the table on every reaction.
CREATE INDEX ix_notifications_dedupe ON notifications (
  user_id,
  type,
  JSON_VALUE(payload, '$.postId'),
  JSON_VALUE(payload, '$.actorId')
);
