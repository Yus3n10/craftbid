import { Link } from "react-router-dom";
import { CRAFT_CATEGORIES } from "@craftbid/shared";
import { useAuth } from "../lib/auth.js";
import { materialColor } from "../lib/materials.js";
import { ButtonLink } from "../components/ui/Button.js";
import { ThreadRule } from "../components/ui/Primitives.js";
import { Feed } from "../components/Feed.js";
import { WorkRibbon } from "../components/WorkRibbon.js";

/**
 * The hero states the exchange itself rather than decorating around it: one
 * person wants something made, another can make it. The two panels are the two
 * discovery paths the product actually has, and the woven seam between them is
 * the thing being described.
 */
function Hero() {
  const { user } = useAuth();

  return (
    <section className="border-b border-fiber bg-paper-raised">
      {/*
        The four lines arrive in the order they are read, roughly a beat apart.
        Slower than the grids elsewhere because this is the first thing anyone
        sees and there is nothing behind it competing for attention.
      */}
      <div className="mx-auto max-w-6xl px-4 pb-14 pt-16 sm:pt-24">
        <p className="eyebrow rise-in" style={{ animationDelay: "0ms" }}>
          Handmade in the Philippines
        </p>
        <h1 className="mt-4 max-w-3xl font-display text-4xl leading-[1.08] sm:text-6xl">
          <span className="block rise-in" style={{ animationDelay: "80ms" }}>
            Someone wants a thing made by hand.
          </span>
          <span
            className="block rise-in text-indigo"
            style={{ animationDelay: "180ms" }}
          >
            Someone can make it.
          </span>
        </h1>
        <p
          className="rise-in mt-6 max-w-xl text-lg text-ink-soft"
          style={{ animationDelay: "280ms" }}
        >
          Craftbid is where Filipino crafters and the people who commission them
          find each other. Post what you want made, or bid on work that suits
          your hands.
        </p>

        <div
          className="rise-in mt-12 grid gap-px overflow-hidden rounded-lg border border-fiber bg-fiber sm:grid-cols-2"
          style={{ animationDelay: "380ms" }}
        >
          <div className="bg-paper p-7">
            <h2 className="font-display text-2xl">I want something made</h2>
            <p className="mt-2 text-sm text-ink-soft">
              Describe the piece, set your starting budget in pesos, and compare
              the artists who bid.
            </p>
            <div className="mt-6">
              <ButtonLink
                to={user?.role === "client" ? "/postings/new" : "/register"}
              >
                Post a craft request
              </ButtonLink>
            </div>
          </div>

          <div className="bg-paper p-7">
            <h2 className="font-display text-2xl">I make things</h2>
            <p className="mt-2 text-sm text-ink-soft">
              Build a portfolio, bid on requests in your craft, and get reviewed
              on work you have finished.
            </p>
            <div className="mt-6">
              <ButtonLink
                to={user?.role === "artist" ? "/postings" : "/register"}
                variant="secondary"
              >
                Find commissions
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>

      <WorkRibbon />
    </section>
  );
}

function CategoryStrip() {
  return (
    <section className="border-b border-fiber">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="eyebrow mb-4">Crafts on Craftbid</h2>
        <ul className="flex flex-wrap gap-2">
          {CRAFT_CATEGORIES.map((category) => (
            <li key={category.slug}>
              <Link
                to={`/postings?category=${category.slug}`}
                className="inline-flex items-center gap-2 rounded-sm border border-fiber bg-paper-raised py-1.5 pl-2 pr-3 text-sm text-ink-soft transition-colors hover:border-fiber-strong hover:text-ink"
              >
                <span
                  aria-hidden="true"
                  className="h-4 w-1 rounded-full"
                  style={{ background: materialColor(category.slug) }}
                />
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}



/**
 * The home page.
 *
 * A signed-out visitor gets the hero first, because they still need telling
 * what this is. Once someone has an account the explanation is wasted space,
 * so they land straight in the feed.
 */
export function HomePage() {
  const { user } = useAuth();

  return (
    <>
      {!user && (
        <>
          <Hero />
          <CategoryStrip />
        </>
      )}
      <Feed />
    </>
  );
}
