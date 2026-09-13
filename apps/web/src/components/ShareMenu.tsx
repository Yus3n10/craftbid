import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LIMITS, type ArtistPostDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { useRequireAccount } from "../lib/authPrompt.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";
import { FormError } from "./ui/States.js";
import { ShareIcon } from "./ui/Icons.js";

/**
 * Share: to your own profile, or as a link to send anywhere.
 *
 * Sharing to a profile puts the post, still credited to its artist, on the
 * sharer's profile and in the feed, with an optional note. Copying the link is
 * for Messenger, Viber and the rest, and needs no account.
 */
export function ShareMenu({ post }: { post: ArtistPostDto }) {
  const { user } = useAuth();
  const requireAccount = useRequireAccount();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [caption, setCaption] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const captionId = useId();

  const ownPost = user?.id === post.artist.id;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["feed"] });
    void queryClient.invalidateQueries({ queryKey: ["shares"] });
    void queryClient.invalidateQueries({ queryKey: ["activity"] });
    void queryClient.invalidateQueries({ queryKey: ["post", post.id] });
  };

  const share = useMutation({
    mutationFn: () => api.put<void>(`/posts/${post.id}/share`, { caption }),
    onSuccess: () => {
      setComposing(false);
      setCaption("");
      setNotice("Shared to your profile");
      refresh();
    },
  });

  const unshare = useMutation({
    mutationFn: () => api.delete<void>(`/posts/${post.id}/share`),
    onSuccess: () => {
      setNotice("Removed from your profile");
      refresh();
    },
  });

  async function copyLink() {
    setOpen(false);
    const url = `${window.location.origin}/posts/${post.id}`;
    try {
      // The phone's own share sheet where there is one, since that is where
      // Messenger and Viber live; the clipboard everywhere else.
      if (navigator.share) {
        await navigator.share({ title: post.caption, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNotice("Link copied");
    } catch {
      // A cancelled share sheet and a blocked clipboard both land here, and
      // neither is worth interrupting anyone over.
    }
  }

  const itemClass =
    "block w-full px-4 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink";

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="press inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink"
      >
        <ShareIcon />
        <span>{notice ?? "Share"}</span>
        {!notice && post.shareCount > 0 && <span className="tabular text-xs">{post.shareCount}</span>}
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute bottom-full right-0 z-30 mb-2 w-60 overflow-hidden rounded-lg border border-fiber bg-paper-raised py-1 shadow-lift"
        >
          {!ownPost &&
            (post.shared ? (
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  setOpen(false);
                  unshare.mutate();
                }}
              >
                Remove from your profile
              </button>
            ) : (
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  setOpen(false);
                  if (requireAccount("share posts to your profile")) setComposing(true);
                }}
              >
                Share to your profile
              </button>
            ))}
          <button type="button" className={itemClass} onClick={() => void copyLink()}>
            Copy link
          </button>
        </div>
      )}

      <Dialog
        open={composing}
        onClose={() => setComposing(false)}
        title="Share to your profile"
        size="md"
        actions={
          <>
            <Button variant="secondary" onClick={() => setComposing(false)}>
              Cancel
            </Button>
            <Button loading={share.isPending} onClick={() => share.mutate()}>
              Share
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p>
            <strong className="text-ink">{post.caption}</strong> by {post.artist.displayName}{" "}
            will appear on your profile and in the feed, credited to them.
          </p>
          <FormError error={share.error} />
          <label htmlFor={captionId} className="block text-sm font-medium text-ink">
            Say something about it (optional)
          </label>
          <textarea
            id={captionId}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            maxLength={LIMITS.shareCaption.max}
            rows={3}
            className="w-full resize-y rounded-md border border-fiber-strong bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-indigo focus:outline-none focus:ring-2 focus:ring-indigo/20"
          />
        </div>
      </Dialog>
    </div>
  );
}
