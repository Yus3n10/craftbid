import { uuidToBuf } from "../../db/ids.js";
import type { Queryable } from "../../db/query.js";

/**
 * Takes an account's personal details out of the database when its owner
 * closes it.
 *
 * The row itself stays, because commissions, payment records, reviews and chat
 * messages the other person still relies on point at it; everywhere those are
 * shown, a deleted account already reads "Removed account". What identified
 * the person goes: email and username are replaced with values derived from
 * the id (unique, and freeing the originals for a new account), and the
 * profile, links, payout details, saved posts, interest scores and
 * notifications are cleared.
 */
export async function scrubPersonalData(userId: string, tx: Queryable): Promise<void> {
  const id = uuidToBuf(userId);
  const hex = userId.replace(/-/g, "").toLowerCase();

  await tx.run(
    `UPDATE users
        SET email = :email,
            username = :username,
            display_name = 'Removed account',
            password_hash = 'account-closed',
            bio = NULL, region = NULL, city = NULL,
            avatar_image_id = NULL, cover_image_id = NULL,
            updated_at = SYSTIMESTAMP
      WHERE id = :id`,
    { id, email: `closed-${hex}@deleted.invalid`, username: `closed_${hex.slice(0, 23)}` },
  );
  await tx.run(`UPDATE artist_profiles SET headline = NULL, accepting_commissions = 0 WHERE user_id = :id`, { id });
  for (const table of [
    "external_links",
    "payout_accounts",
    "saved_posts",
    "user_category_interest",
    "notifications",
    "share_reactions",
    "email_verification_tokens",
    "password_reset_tokens",
  ] as const) {
    await tx.run(`DELETE FROM ${table} WHERE user_id = :id`, { id });
  }
  await tx.run(`DELETE FROM artist_skills WHERE artist_id = :id`, { id });
  await tx.run(`DELETE FROM artist_categories WHERE artist_id = :id`, { id });
}
