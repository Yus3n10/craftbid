import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatPeso, type SearchResultsDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { Avatar } from "./ui/Primitives.js";
import { SearchIcon } from "./ui/Icons.js";

/**
 * One box over people, work and open requests.
 *
 * Suggestions appear after a pause rather than on every keystroke: the query
 * is a substring scan the database cannot index, so firing one per character
 * would put six queries on the wire for a six-letter word and make the slowest
 * one land last.
 */
export function SearchBox({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  // Clicking anywhere else dismisses the suggestions.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () =>
      api.get<SearchResultsDto>(`/search?q=${encodeURIComponent(debounced)}&limit=4`),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  const people = [...(data?.artists ?? []), ...(data?.clients ?? [])];
  const posts = data?.posts ?? [];
  const requests = data?.requests ?? [];
  const empty =
    debounced.length >= 2 &&
    !isFetching &&
    people.length + posts.length + requests.length === 0;

  function go(to: string) {
    setOpen(false);
    setTerm("");
    onNavigate?.();
    navigate(to);
  }

  return (
    <div ref={boxRef} className="relative w-full">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (term.trim().length >= 2) go(`/search?q=${encodeURIComponent(term.trim())}`);
        }}
      >
        <label htmlFor="site-search" className="sr-only">
          Search artists, work and requests
        </label>
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
        />
        <input
          id="site-search"
          type="search"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search artists, work, requests"
          autoComplete="off"
          className="w-full rounded-md border border-fiber bg-paper-raised py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-indigo focus:outline-none focus:ring-2 focus:ring-indigo/20"
        />
      </form>

      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-md border border-fiber bg-paper-raised shadow-lift">
          {empty ? (
            <p className="px-4 py-3 text-sm text-ink-faint">
              Nothing matches “{debounced}”.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {people.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => go(`/artists/${person.username}`)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-paper-sunk"
                  >
                    <Avatar user={person} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {person.displayName}
                      </span>
                      <span className="block text-xs text-ink-faint">
                        {person.role === "artist" ? "Artist" : "Client"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}

              {posts.map((post) => (
                <li key={post.id}>
                  <button
                    type="button"
                    onClick={() => go(`/posts/${post.id}`)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-paper-sunk"
                  >
                    {post.coverImage ? (
                      <img
                        src={post.coverImage.url}
                        alt=""
                        className="size-7 rounded-sm object-cover"
                      />
                    ) : (
                      <span className="size-7 rounded-sm bg-paper-sunk" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{post.caption}</span>
                      <span className="block text-xs text-ink-faint">Work</span>
                    </span>
                  </button>
                </li>
              ))}

              {requests.map((request) => (
                <li key={request.id}>
                  <button
                    type="button"
                    onClick={() => go(`/postings/${request.id}`)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-paper-sunk"
                  >
                    <span className="size-7 rounded-sm bg-paper-sunk" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{request.title}</span>
                      <span className="block text-xs text-ink-faint">
                        Request · from{" "}
                        <span className="tabular">
                          {formatPeso(request.minBudgetCentavos)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Link
            to={`/search?q=${encodeURIComponent(debounced)}`}
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="block border-t border-fiber px-4 py-2 text-center text-xs text-indigo hover:bg-paper-sunk"
          >
            See all results
          </Link>
        </div>
      )}
    </div>
  );
}
