import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ArtistPostDto, Paginated } from "@craftbid/shared";
import { api } from "../lib/api.js";

/**
 * A slow band of real work along the foot of the hero.
 *
 * The hero was words on paper. What a marketplace has that a landing page does
 * not is inventory, so the liveliest honest thing to put here is the work
 * itself: these are real posts by real artists, and clicking one goes to their
 * profile.
 *
 * Renders nothing at all when there is nothing to show. An empty marquee, or
 * one padded out with stock photographs, would be worse than the plain hero it
 * replaced.
 */
export function WorkRibbon() {
  const { data } = useQuery({
    queryKey: ["posts", "ribbon"],
    queryFn: () => api.get<Paginated<ArtistPostDto>>("/posts?limit=12"),
    staleTime: 5 * 60_000,
  });

  /**
   * Stops the animation once the ribbon has scrolled away.
   *
   * Left running it animates for as long as the tab is open, whether or not
   * anyone can see it, which on a phone is battery spent on nothing. The
   * observer is the whole cost of not doing that.
   */
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? true),
      { rootMargin: "100px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [data]);

  const posts = (data?.items ?? []).filter((post) => post.coverImage);
  if (posts.length < 4) return null;

  // Twice through: the track travels half its own width, so the second copy is
  // exactly where the first was when the loop restarts.
  const run = [...posts, ...posts];

  return (
    <div
      ref={ref}
      data-paused={!visible}
      className="ribbon relative overflow-hidden border-t border-fiber bg-paper py-5"
      aria-label="Recent work from artists on Craftbid"
    >
      {/*
        The paper ground fades in at both edges so pieces enter and leave
        rather than being cut off by a hard border.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-paper to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-paper to-transparent"
      />

      <ul className="ribbon-track flex w-max items-end gap-3">
        {run.map((post, index) => (
          <li
            key={`${post.id}-${index}`}
            // The duplicate half is decoration; only the first pass is real
            // content, so a screen reader is not read the same list twice.
            aria-hidden={index >= posts.length}
          >
            <Link
              to={`/artists/${post.artist.username}`}
              tabIndex={index >= posts.length ? -1 : undefined}
              className="block overflow-hidden rounded-sm border border-fiber bg-paper-sunk transition-colors hover:border-indigo"
              title={`${post.caption} — ${post.artist.displayName}`}
            >
              <img
                src={post.coverImage!.url}
                alt={index >= posts.length ? "" : post.caption}
                width={post.coverImage!.width}
                height={post.coverImage!.height}
                loading="lazy"
                // Height-constrained, width free: pieces keep their own
                // proportions, so an upright weaving stays upright instead of
                // being squared off into the band.
                className="h-24 w-auto max-w-[14rem] object-contain sm:h-28"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
