import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.js";
import { cx } from "../../lib/cx.js";
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

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

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

  return (
    <header className="sticky top-0 z-40 border-b border-fiber bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Link to="/" className="shrink-0" aria-label="Craftbid home">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className={navClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="mx-4 hidden max-w-sm flex-1 md:block">
          <SearchBox />
        </div>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          {user ? (
            <>
              <Link
                to="/notifications"
                className="relative rounded-sm p-2 text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink"
                aria-label="Notifications"
              >
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

        <button
          type="button"
          className="ml-auto rounded-sm p-2 text-ink md:hidden"
          onClick={() => setMenuOpen((open) => !open)}
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

      {menuOpen && (
        <div id="mobile-nav" className="border-t border-fiber bg-paper-raised md:hidden">
          <div className="mx-auto max-w-6xl px-4 pt-3">
            <SearchBox onNavigate={() => setMenuOpen(false)} />
          </div>
          <nav className="mx-auto max-w-6xl px-4 py-3" aria-label="Main">
            <ul className="space-y-1">
              {links.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    className="block rounded-sm px-2 py-2 text-ink-soft hover:bg-paper-sunk"
                    onClick={() => setMenuOpen(false)}
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
