import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/Button.js";
import { ThreadRule } from "./ui/Primitives.js";

/**
 * Recognises the failure of a code-split route chunk.
 *
 * Every route in this app is a dynamic import, and a deploy renames every
 * chunk it rebuilds. A page that was already open when a deploy landed still
 * holds the previous filenames in its module graph, and those files no longer
 * exist. Worse, they do not 404: Cloudflare's `not_found_handling:
 * "single-page-application"` answers any unknown path with index.html, so the
 * browser is handed HTML where it asked for a module and refuses it on MIME
 * grounds. Every browser words that differently, hence the several patterns.
 *
 * The service worker turns this from a rare race into a certainty. `autoUpdate`
 * compiles to skipWaiting + clientsClaim + cleanupOutdatedCaches, so a new
 * worker activates under the open page and deletes the precache the page is
 * still relying on.
 */
const CHUNK_LOAD_FAILURE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk \S+ failed|expected a javascript(?:-or-wasm)? module script/i;

function isChunkLoadFailure(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return CHUNK_LOAD_FAILURE.test(message);
}

/**
 * A stale chunk is fixed by fetching the current index.html, and index.html is
 * served `max-age=0, must-revalidate`, so an ordinary reload is enough.
 *
 * The mark is the whole safety mechanism. If the reload does not fix it, the
 * cause is not a stale build, and reloading again would spin forever showing
 * nothing. So a reload is attempted at most once per minute per tab, and any
 * failure after that falls through to the visible error with a manual button.
 * sessionStorage rather than a field on the component, because the reload
 * discards the component.
 */
const RELOAD_MARK = "craftbid.chunkReloadAt";
const RELOAD_COOLDOWN_MS = 60_000;

function reloadOnceForStaleBuild(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_MARK)) || 0;
  } catch {
    // Storage can be unavailable. Without a mark a reload cannot be proven
    // safe, so decline it and let the visible error offer the button instead.
    return false;
  }

  if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;

  try {
    sessionStorage.setItem(RELOAD_MARK, String(Date.now()));
  } catch {
    return false;
  }

  window.location.reload();
  return true;
}

interface State {
  error: unknown;
  reloading: boolean;
}

/**
 * Catches a render error so one broken screen does not blank the whole app.
 *
 * Without this, a rejected route import unmounted the entire tree and left an
 * empty <div id="root">: a white page, with the URL updated so it looked like
 * the app had simply stopped. Nothing recovered it either, because React
 * caches a lazy component's rejection, so navigating back and forth replayed
 * the same failure. Only a manual refresh brought it back.
 */
interface Props {
  children: ReactNode;
  label?: string;
  /**
   * Changing this clears a caught error.
   *
   * The route boundary passes the pathname, so asking for a different screen
   * is a way out of a broken one. It is a prop rather than a `key` on purpose:
   * a key remounts the subtree on every navigation, and remounting takes the
   * Suspense boundary with it. A fresh boundary has no content to keep showing,
   * so React stops holding the previous page during the transition and flashes
   * the skeleton fallback instead -- which is a good deal worse than what it
   * replaced, since nothing was wrong in the first place.
   */
  resetKey?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, reloading: isChunkLoadFailure(error) };
  }

  override componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null, reloading: false });
    }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (isChunkLoadFailure(error)) {
      // Recovers before anyone sees a failure: the reload lands on the build
      // that actually has these files.
      if (reloadOnceForStaleBuild()) return;
      this.setState({ reloading: false });
    }

    console.error(
      `Unhandled error in ${this.props.label ?? "the app"}:`,
      error,
      info.componentStack,
    );
  }

  override render(): ReactNode {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;

    // The reload is already in flight. Anything rendered here would flash for
    // a moment and be thrown away, so hold the last frame instead.
    if (reloading) return null;

    const stale = isChunkLoadFailure(error);

    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div
          role="alert"
          className="rounded-md border border-rust/30 bg-rust-wash px-6 py-12 text-center"
        >
          <h1 className="font-display text-2xl text-ink">
            {stale ? "This page needs reloading" : "This screen stopped working"}
          </h1>
          <ThreadRule className="mx-auto my-4 w-16" />
          <p className="mx-auto max-w-md text-ink-soft">
            {stale
              ? "Craftbid was updated while you had this open, so part of the page is no longer available. Reloading picks up the new version."
              : "Something in this screen failed to render. Reloading usually clears it. Nothing you had saved is affected."}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={() => window.location.reload()}>Reload the page</Button>
            {!stale && (
              <Button
                variant="secondary"
                onClick={() => this.setState({ error: null, reloading: false })}
              >
                Try again
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
