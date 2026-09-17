-- Refresh token reuse detection, and sign-up that does not reveal accounts.
--
-- rotated_at marks a refresh token that was spent by a refresh, as opposed to
-- one revoked by signing out or a password change. A rotated token presented
-- again after a short grace period means a copy of it is in someone else's
-- hands, and every session of the account is ended.
--
-- account_exists_notice_at limits the email sent when someone signs up with an
-- address that already has a confirmed account to one an hour.

ALTER TABLE refresh_tokens ADD (rotated_at TIMESTAMP WITH TIME ZONE);

ALTER TABLE users ADD (account_exists_notice_at TIMESTAMP WITH TIME ZONE);
