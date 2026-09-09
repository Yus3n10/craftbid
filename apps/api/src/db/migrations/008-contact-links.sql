-- Messaging platforms and email on external links.
--
-- Artists asked for somewhere to put the channels their clients actually use.
-- In the Philippines that is Messenger, WhatsApp and Viber far more than it is
-- a website, so the list was missing most of what people would want to add.
--
-- The https-only rule has to give way for email, which is a mailto:. It is
-- widened to exactly two schemes rather than dropped: the point of the CHECK
-- was that a javascript: or data: URL cannot reach the database through any
-- code path, and that still holds.

ALTER TABLE external_links DROP CONSTRAINT ck_external_links_platform;

ALTER TABLE external_links ADD CONSTRAINT ck_external_links_platform CHECK (platform IN
  ('facebook', 'instagram', 'tiktok', 'x', 'youtube', 'pinterest',
   'shopee', 'lazada', 'website', 'other',
   'messenger', 'whatsapp', 'viber', 'telegram', 'email', 'etsy', 'behance'));

ALTER TABLE external_links DROP CONSTRAINT ck_external_links_https;

ALTER TABLE external_links ADD CONSTRAINT ck_external_links_scheme CHECK (
  LOWER(url) LIKE 'https://%' OR LOWER(url) LIKE 'mailto:%'
);
