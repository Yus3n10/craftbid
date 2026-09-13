import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { MeDto } from "@craftbid/shared";
import { cx } from "../../lib/cx.js";
import { Avatar } from "../ui/Primitives.js";

export function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {/* A cog: eight teeth as a dashed ring (2 x pi x 6.9 / 8 = 5.42 per tooth) around a body and a hub. */}
      <circle cx="10" cy="10" r="6.9" stroke="currentColor" strokeWidth="2.4" strokeDasharray="2.3 3.12" />
      <circle cx="10" cy="10" r="5.1" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="1.9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Where the account menu leads. Shared with the phone menu so the two match. */
export function accountLinks(user: MeDto) {
  return [
    { to: `/artists/${user.username}`, label: "Your profile" },
    { to: "/settings", label: "Edit profile and settings" },
    { to: "/saved", label: "Saved posts" },
    { to: "/activity", label: "Activity history" },
    { to: "/notifications", label: "Notifications" },
  ];
}

/**
 * The cog in the desktop header, opening the account's own places.
 *
 * A disclosure (a button that shows a list of links) rather than an ARIA
 * menu: every entry is an ordinary link, reachable with Tab and announced as a
 * link, which is what they are. The ARIA menu pattern would promise arrow-key
 * behaviour that links in a list do not need.
 *
 * Closes on a choice, a change of page, Escape (returning focus to the cog),
 * or a click anywhere else.
 */
export function AccountMenu({ user, onSignOut }: { user: MeDto; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Account and settings"
        title="Account and settings"
        className={cx(
          "relative flex size-11 items-center justify-center rounded-sm transition-colors hover:bg-paper-sunk hover:text-ink",
          open ? "bg-paper-sunk text-ink" : "text-ink-soft",
        )}
      >
        <SettingsIcon />
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-fiber bg-paper-raised shadow-lift"
        >
          <div className="flex items-center gap-3 border-b border-fiber px-4 py-3">
            <Avatar user={user} size={36} />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{user.displayName}</p>
              <p className="truncate text-xs text-ink-faint">@{user.username}</p>
            </div>
          </div>
          <ul className="py-1">
            {accountLinks(user).map((link) => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2.5 text-sm text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-fiber py-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className="block w-full px-4 py-2.5 text-left text-sm text-rust transition-colors hover:bg-rust-wash"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
