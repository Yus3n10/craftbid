import { Link, Outlet } from "react-router-dom";
import { BRAND } from "@craftbid/shared";
import { Header } from "./Header.js";
import { Logo } from "./Logo.js";

export function Shell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only rounded-md bg-indigo px-4 py-2 text-paper-raised focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Skip to content
      </a>

      <Header />

      <main id="main" className="flex-1">
        <Outlet />
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
