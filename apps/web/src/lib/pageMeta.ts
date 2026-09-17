import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

/** The address people are given, used for canonical links on either host. */
export const SITE_ORIGIN = "https://craftbid-6w5p.onrender.com";

export const DEFAULT_TITLE = "Craftbid: commission handmade work from Filipino artists";
export const DEFAULT_DESCRIPTION =
  "Craftbid connects Filipino handmade-craft artists with people who want to commission their work.";

const DESCRIPTION_LIMIT = 160;

function metaTag(selector: string, create: () => HTMLElement): HTMLElement {
  return document.head.querySelector<HTMLElement>(selector) ?? document.head.appendChild(create());
}

function setDescription(text: string): void {
  const tag = metaTag('meta[name="description"]', () => {
    const el = document.createElement("meta");
    el.setAttribute("name", "description");
    return el;
  });
  tag.setAttribute("content", text);
}

function setCanonical(pathname: string): void {
  const link = metaTag('link[rel="canonical"]', () => {
    const el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    return el;
  });
  link.setAttribute("href", `${SITE_ORIGIN}${pathname}`);
}

function setNoindex(noindex: boolean): void {
  const existing = document.head.querySelector('meta[name="robots"]');
  if (!noindex) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const el = document.createElement("meta");
  el.setAttribute("name", "robots");
  el.setAttribute("content", "noindex");
  document.head.appendChild(el);
}

/** Collapses whitespace and cuts a description at a word near the limit. */
export function shortDescription(text: string | null | undefined): string | undefined {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length <= DESCRIPTION_LIMIT) return clean;
  const cut = clean.slice(0, DESCRIPTION_LIMIT - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 80 ? lastSpace : cut.length)}…`;
}

/**
 * Resets the title, description, canonical link and robots tag on every change
 * of page. A layout effect, so it runs before the new page's own
 * `usePageMeta` and a page without one never keeps the previous page's title.
 */
export function usePageMetaReset(): void {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    document.title = DEFAULT_TITLE;
    setDescription(DEFAULT_DESCRIPTION);
    setCanonical(pathname);
    setNoindex(false);
  }, [pathname]);
}

/**
 * The page's own title and description. Pass nothing while its data loads;
 * the defaults stay until it arrives.
 */
export function usePageMeta(meta: { title?: string; description?: string; noindex?: boolean }): void {
  const { pathname } = useLocation();
  const { title, description, noindex = false } = meta;
  useEffect(() => {
    document.title = title ? `${title} · Craftbid` : DEFAULT_TITLE;
    setDescription(description ?? DEFAULT_DESCRIPTION);
    setNoindex(noindex);
  }, [pathname, title, description, noindex]);
}
