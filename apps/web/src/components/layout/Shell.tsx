import { useEffect } from "react";
import { Link, Outlet, useLocation, useNavigationType } from "react-router-dom";
import { BRAND } from "@craftbid/shared";
import { Header } from "./Header.js";
import { Logo } from "./Logo.js";
import { ErrorBoundary } from "../ErrorBoundary.js";

export function Shell() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  /**
   * A new page starts at its top, as it would after a full page load.
   *
   * Without this, following a link kept the previous page's scroll offset, so
   * the next page opened partway down, and with a header that slides away on
   * a phone it could open with the header already out of view. Back and
   * forward (POP) are left to the browser. Query-string changes, such as
   * filtering requests, keep the pathname and so keep their place.
   */
  useEffect(() => {
    if (navigationType !== "POP") window.scrollTo(0, 0);
  }, [pathname, navigationType]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only rounded-md bg-indigo px-4 py-2 text-paper-raised focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Skip to content
      </a>

      <Header />

      {/*
        The error boundary sits here, inside the chrome, so a screen that fails
        to render leaves the header, the search box and the footer alone and
        the rest of the app still reachable. Around the router instead, the one
        thing a reader could do about a broken page would be to retype a URL.

        The Suspense boundary deliberately stays where it was, above the
        router, and is not moved down beside this one. Above the router it
        already holds mounted content, so React keeps the current page on
        screen through a navigation and swaps it when the next chunk lands.
        Nested here it would be a boundary with nothing to hold, and every
        navigation would flash a skeleton over a page that was perfectly fine.

        resetKey, not key: see the note on that prop. A key here would remount
        this subtree on every navigation and cost the same skeleton flash.
      */}
      <main id="main" className="flex-1">
        <ErrorBoundary resetKey={pathname} label="the current page">
          <Outlet />
        </ErrorBoundary>
      </main>

      <footer className="mt-20 border-t border-fiber bg-paper-raised">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
            <div className="max-w-xs">
              <Logo />
              <p className="mt-3 text-sm text-ink-soft">{BRAND.tagline}</p>
            </div>

            <nav aria-label="Footer" className="flex gap-12 text-sm">
              <div>
                <h2 className="eyebrow mb-3">For clients</h2>
                <ul className="space-y-2 text-ink-soft">
                  <li>
                    <Link to="/postings/new" className="hover:text-ink hover:underline">
                      Post a request
                    </Link>
                  </li>
                  <li>
                    <Link to="/discover" className="hover:text-ink hover:underline">
                      Browse artists
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <h2 className="eyebrow mb-3">For artists</h2>
                <ul className="space-y-2 text-ink-soft">
                  <li>
                    <Link to="/postings" className="hover:text-ink hover:underline">
                      Find commissions
                    </Link>
                  </li>
                  <li>
                    <Link to="/register" className="hover:text-ink hover:underline">
                      Create a portfolio
                    </Link>
                  </li>
                </ul>
              </div>
            </nav>
          </div>

          <p className="mt-10 border-t border-fiber pt-6 text-xs text-ink-faint">
            Prices are shown in Philippine pesos. Craftbid does not handle payment;
            clients and artists agree terms directly.
          </p>
        </div>
      </footer>
    </div>
  );
}

/** A centred column for reading-width pages such as forms and detail views. */
export function Page({
  children,
  width = "wide",
}: {
  children: React.ReactNode;
  width?: "wide" | "narrow";
}) {
  return (
    <div
      className={
        width === "narrow"
          ? "mx-auto max-w-2xl px-4 py-10"
          : "mx-auto max-w-6xl px-4 py-10"
      }
    >
      {children}
    </div>
  );
}
