import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ArtistPostDto, MeDto, Paginated, PayoutAccountDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { cx } from "../lib/cx.js";
import { Card, ThreadRule } from "./ui/Primitives.js";

export interface ChecklistItem {
  key: string;
  label: string;
  /** Why it matters, in terms of getting work or getting paid. */
  why: string;
  to: string;
  done: boolean;
  /** Stops a transaction, rather than only costing exposure. */
  blocking?: boolean;
}

/**
 * What an account is missing, most important first.
 *
 * For an artist, payment details lead because without them a client who has
 * already chosen them cannot pay the down payment, and the commission stalls.
 * Everything after that is about being found and trusted.
 */
export function profileChecklist(
  me: MeDto,
  extra: { portfolioCount: number; payoutCount: number },
): ChecklistItem[] {
  if (me.role === "artist") {
    return [
      {
        key: "payout",
        label: "Add where clients pay you",
        why: "A client who chooses you cannot send the down payment until you do.",
        to: "/settings#payout",
        done: extra.payoutCount > 0,
        blocking: true,
      },
      {
        key: "crafts",
        label: "Choose your crafts",
        why: "Clients filter artists by craft.",
        to: "/settings#craft",
        done: (me.artist?.categories.length ?? 0) > 0,
      },
      {
        key: "avatar",
        label: "Add a profile picture",
        why: "People trust a face or a logo more than a blank circle.",
        to: "/settings#basics",
        done: Boolean(me.avatar),
      },
      {
        key: "portfolio",
        label: "Post your first piece",
        why: "Your portfolio is what shows up in the home feed.",
        to: "/posts/new",
        done: extra.portfolioCount > 0,
      },
      {
        key: "headline",
        label: "Write a headline",
        why: "One line that tells a client what you make.",
        to: "/settings#craft",
        done: Boolean(me.artist?.headline?.trim()),
      },
      {
        key: "bio",
        label: "Say a little about yourself",
        why: "Clients like knowing who they are commissioning.",
        to: "/settings#basics",
        done: Boolean(me.bio?.trim()),
      },
      {
        key: "links",
        label: "Add a way to reach you",
        why: "Messenger, WhatsApp or Viber makes it easy to agree details.",
        to: "/settings#links",
        done: me.links.length > 0,
      },
    ];
  }

  return [
    {
      key: "avatar",
      label: "Add a profile picture",
      why: "Artists are more comfortable bidding for someone they can recognise.",
      to: "/settings#basics",
      done: Boolean(me.avatar),
    },
    {
      key: "bio",
      label: "Say a little about yourself",
      why: "A line or two helps artists know who they would be working with.",
      to: "/settings#basics",
      done: Boolean(me.bio?.trim()),
    },
  ];
}

/**
 * "Complete your profile", shown to the account's owner only.
 *
 * Reads what the rest of the app already fetches (the account, the portfolio,
 * the payout accounts) and disappears once nothing is missing. Nothing renders
 * until those answers arrive, so it never flashes a list of things that turn
 * out to be done.
 */
export function ProfileChecklist({ me }: { me: MeDto }) {
  const isArtist = me.role === "artist";

  const portfolio = useQuery({
    queryKey: ["posts", "artist", me.username, "count"],
    queryFn: () => api.get<Paginated<ArtistPostDto>>(`/posts?artist=${me.username}&limit=1`),
    enabled: isArtist,
  });
  const payout = useQuery({
    queryKey: ["payout-accounts"],
    queryFn: () => api.get<PayoutAccountDto[]>("/me/payout-accounts"),
    enabled: isArtist,
  });

  if (isArtist && (!portfolio.data || !payout.data)) return null;

  const items = profileChecklist(me, {
    portfolioCount: portfolio.data?.total ?? 0,
    payoutCount: payout.data?.length ?? 0,
  });
  const done = items.filter((item) => item.done).length;
  if (done === items.length) return null;

  const percent = Math.round((done / items.length) * 100);

  return (
    <section aria-labelledby="profile-checklist-title">
      <Card className="p-5">
        <div className="pl-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="profile-checklist-title" className="font-display text-lg">
              Complete your profile
            </h2>
            <span className="text-sm tabular text-ink-soft">
              {done} of {items.length} done
            </span>
          </div>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-sunk"
            role="progressbar"
            aria-label="Profile completeness"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-indigo transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <ThreadRule className="my-4 w-12" />

          <ul className="space-y-2">
            {items
              .filter((item) => !item.done)
              .map((item) => (
                <li key={item.key}>
                  <Link
                    to={item.to}
                    className={cx(
                      "-mx-2 block rounded-sm px-2 py-1.5 transition-colors hover:bg-paper-sunk",
                      item.blocking && "border-l-2 border-rust bg-rust-wash hover:bg-rust-wash",
                    )}
                  >
                    <span className={cx("block text-sm font-medium", item.blocking ? "text-rust" : "text-indigo")}>
                      {item.label}
                      {item.blocking && <span className="ml-2 text-xs font-semibold uppercase">Needed to get paid</span>}
                    </span>
                    <span className="block text-sm text-ink-soft">{item.why}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      </Card>
    </section>
  );
}
