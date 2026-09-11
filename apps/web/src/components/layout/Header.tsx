import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.js";
import { cx } from "../../lib/cx.js";
import { useHideOnScroll } from "../../lib/useHideOnScroll.js";
import { Avatar } from "../ui/Primitives.js";
import { Button, ButtonLink } from "../ui/Button.js";
import { Logo } from "./Logo.js";
import { SearchBox } from "../SearchBox.js";

function navClass({ isActive }: { isActive: boolean }): string {
  return cx(
    "rounded-sm px-2.5 py-1.5 text-sm font-medium transition-colors",
    isActive ? "text-indigo" : "text-ink-soft hover:text-ink",
  );
}

/** Sign-in and account creation: short forms, where a pinned header only gets in the way. */
const AUTH_PAGES = /^\/(login|register)\/?$/;

function UnreadDot() {
  const { data } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => api.get<{ unread: number }>("/notifications?limit=1"),
    refetchInterval: 120_000,
  });

  if (!data?.unread) return null;
  return (
    <span
      className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-clay text-[10px] font-bold text-paper-raised"
      aria-label={`${data.unread} unread notifications`}
    >
      {data.unread > 9 ? "9+" : data.unread}
    </span>
  );
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const ICON_BUTTON =
  "relative flex size-11 items-center justify-center rounded-sm text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink";

/**
 * The site header.
 *
 * On a phone this used to be a 64px sticky bar whose menu opened inside it:
 * search, every destination, and four more buttons, all pinned to the top of
 * the screen. Opened, that panel covered most of a phone's viewport, stayed
 * there while the page scrolled underneath, and only closed when one of the
 * plain links in it was tapped. "Your profile", "Notifications" and "Post a
 * request" navigated without closing it, so the next page opened already
 * buried. Below the full-navigation width it now:
 *
 * - closes the menu on any change of page, on Escape, and on a tap outside it;
 * - caps the open menu at the space under the bar, scrolling inside itself;
 * - moves search out of the menu into its own button, so the menu is shorter
 *   and search is one tap from anywhere rather than hidden behind "Menu";
 * - slides the bar away while reading downward and brings it straight back
 *   on the first scroll up, so it never sits over content someone is reading.
 *
 * The full navigation now starts at 1024px instead of 768px. Measured signed
 * in as a client, its contents ran to 904px, so between 768 and 900 the whole
 * page scrolled sideways and the search box was squeezed to 50px. Between
 * 1024 and 1280 the links fit but search does not, so it is the same search
 * button there too, and the inline box returns at 1280.
 *
 * On the sign-in and account pages the header is not pinned at all. Those are
 * short forms, usually filled in with the on-screen keyboard up, when a sticky
 * bar takes a large share of what little screen is left and appears to float
 * over the fields as the page scrolls.
 */
export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onAuthPage = AUTH_PAGES.test(pathname);

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hidden, reveal] = useHideOnScroll(menuOpen || searchOpen || onAuthPage);

  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // A new page starts with the header visible and nothing open over it.
  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
    reveal();
  }, [pathname, reveal]);

  // Tapping search is asking to type, so the field gets the cursor.
  useEffect(() => {
    if (searchOpen) {
      headerRef.current?.querySelector<HTMLInputElement>("#header-search input")?.focus();
    }
  }, [searchOpen]);

  // Escape and a tap anywhere outside close whatever is open. Attached only
  // while something is, so there is no listener on an ordinary page.
  useEffect(() => {
    if (!menuOpen && !searchOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setSearchOpen(false);
      menuButtonRef.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setSearchOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen, searchOpen]);

  const links = [
    { to: "/postings", label: "Craft requests" },
    { to: "/discover", label: "Discover work" },
    ...(user ? [{ to: "/commissions", label: "Commissions" }] : []),
    ...(user?.role === "client" ? [{ to: "/my/postings", label: "My requests" }] : []),
    ...(user?.role === "artist" ? [{ to: "/my/applications", label: "My bids" }] : []),
  ];

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  function toggleSearch() {
    setMenuOpen(false);
    setSearchOpen((open) => !open);
  }

  const searchToggle = (
    <button
      type="button"
      className={ICON_BUTTON}
      onClick={toggleSearch}
      aria-expanded={searchOpen}
      aria-controls="header-search"
      aria-label="Search"
    >
      <SearchIcon />
    </button>
  );

  return (
    <header
      ref={headerRef}
      // Anything focused inside a hidden header brings it back into view.
      onFocusCapture={reveal}
      className={cx(
        "top-0 z-40 border-b border-fiber bg-paper/90 backdrop-blur",
        onAuthPage ? "relative" : "sticky",
        "motion-safe:transition-transform motion-safe:duration-200",
        hidden && "max-lg:-translate-y-full",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Link to="/" className="shrink-0" aria-label="Craftbid home">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className={navClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="mx-4 hidden max-w-sm flex-1 xl:block">
          <SearchBox />
        </div>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <div className="xl:hidden">{searchToggle}</div>

          {user ? (
            <>
              <Link to="/notifications" className={ICON_BUTTON} aria-label="Notifications">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M10 2.5a5 5 0 0 0-5 5v3l-1.5 2.5h13L15 10.5v-3a5 5 0 0 0-5-5ZM8 16a2 2 0 0 0 4 0"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
                <UnreadDot />
              </Link>

              {user.role === "client" && (
                <ButtonLink to="/postings/new" size="sm">
                  Post a request
                </ButtonLink>
              )}

              <Link
                to={`/artists/${user.username}`}
                className="ml-1 rounded-full"
                aria-label="Your profile"
              >
                <Avatar user={user} size={32} />
              </Link>

              <Button variant="ghost" size="sm" onClick={handleLogout}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <ButtonLink to="/login" variant="ghost" size="sm">
                Sign in
              </ButtonLink>
              <ButtonLink to="/register" size="sm">
                Join Craftbid
              </ButtonLink>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1 lg:hidden">
          {searchToggle}
          <button
            ref={menuButtonRef}
            type="button"
            className="flex size-11 items-center justify-center rounded-sm text-ink"
            onClick={() => {
              setSearchOpen(false);
              setMenuOpen((open) => !open);
            }}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label="Menu"
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path
                d={menuOpen ? "M5 5l12 12M17 5L5 17" : "M3 6h16M3 11h16M3 16h16"}
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {searchOpen && (
        <div id="header-search" className="border-t border-fiber bg-paper-raised xl:hidden">
          <div className="mx-auto max-w-6xl px-4 py-3">
            <SearchBox onNavigate={() => setSearchOpen(false)} />
          </div>
        </div>
      )}

      {menuOpen && (
        <div
          id="mobile-nav"
          // Never taller than the screen below the bar; a long menu scrolls
          // inside itself instead of pushing past the bottom of the viewport.
          className="max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-t border-fiber bg-paper-raised lg:hidden"
        >
          <nav className="mx-auto max-w-6xl px-4 py-3" aria-label="Main">
            <ul className="space-y-1">
              {links.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    className="block rounded-sm px-2 py-2.5 text-ink-soft hover:bg-paper-sunk"
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex flex-col gap-2 border-t border-fiber pt-3">
              {user ? (
                <>
                  {user.role === "client" && (
                    <ButtonLink to="/postings/new" size="sm">
                      Post a request
                    </ButtonLink>
                  )}
                  <ButtonLink
                    to={`/artists/${user.username}`}
                    variant="secondary"
                    size="sm"
                  >
                    Your profile
                  </ButtonLink>
                  <ButtonLink to="/notifications" variant="ghost" size="sm">
                    Notifications
                  </ButtonLink>
                  <Button variant="ghost" size="sm" onClick={handleLogout}>
                    Sign out
                  </Button>
                </>
              ) : (
                <>
                  <ButtonLink to="/login" variant="secondary" size="sm">
                    Sign in
                  </ButtonLink>
                  <ButtonLink to="/register" size="sm">
                    Join Craftbid
                  </ButtonLink>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
