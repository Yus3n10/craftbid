import { useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { FeedItemDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { useRequireAccount } from "../lib/authPrompt.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";
import { FormError } from "./ui/States.js";
import { ReportDialog } from "./ReportButton.js";

interface MenuItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

/** The "..." button and its panel. Closes on a choice, Escape, or a tap outside. */
function MoreMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const panelId = useId();

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

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="press rounded-md p-2 text-ink-faint transition-colors hover:bg-paper-sunk hover:text-ink"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="currentColor">
          <circle cx="4" cy="9" r="1.4" />
          <circle cx="9" cy="9" r="1.4" />
          <circle cx="14" cy="9" r="1.4" />
        </svg>
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-md border border-fiber bg-paper-raised py-1 shadow-lift"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={
                item.danger
                  ? "block w-full px-3 py-2.5 text-left text-sm text-rust hover:bg-rust-wash"
                  : "block w-full px-3 py-2.5 text-left text-sm text-ink-soft hover:bg-paper-sunk hover:text-ink"
              }
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Everywhere a post or a share can be listed. */
function refreshPostLists(queryClient: QueryClient, postId: string) {
  for (const key of [["feed"], ["home"], ["posts"], ["shares"], ["activity"], ["post", postId]]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

/** A yes-or-no before something that cannot be undone. */
function ConfirmRemoval({
  open,
  title,
  body,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button type="button" variant="danger" loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-soft">{body}</p>
      <FormError error={error} />
    </Dialog>
  );
}

/**
 * The "..." on a portfolio post. The artist who made it can edit or delete
 * it; anyone else can report it.
 */
export function PostMoreMenu({ post }: { post: FeedItemDto }) {
  const { user } = useAuth();
  const requireAccount = useRequireAccount();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [reporting, setReporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/posts/${post.id}`),
    onSuccess: () => {
      setDeleting(false);
      refreshPostLists(queryClient, post.id);
      // On the post's own page there is nothing left to look at.
      if (location.pathname === `/posts/${post.id}`) {
        navigate(`/artists/${post.artist.username}`, { replace: true });
      }
    },
  });

  if (user?.id === post.artist.id) {
    return (
      <>
        <MoreMenu
          label="More options for this post"
          items={[
            { label: "Edit post", onSelect: () => navigate(`/posts/${post.id}/edit`) },
            { label: "Delete post", danger: true, onSelect: () => setDeleting(true) },
          ]}
        />
        <ConfirmRemoval
          open={deleting}
          title="Delete this post?"
          body="It comes off your portfolio and the feed, and so does every share of it, with their reactions and comments. This cannot be undone."
          confirmLabel="Delete post"
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate()}
          onClose={() => {
            setDeleting(false);
            remove.reset();
          }}
        />
      </>
    );
  }

  return (
    <>
      <MoreMenu
        label="More options for this post"
        items={[
          {
            label: "Report",
            danger: true,
            onSelect: () => {
              if (requireAccount("report something")) setReporting(true);
            },
          },
        ]}
      />
      <ReportDialog open={reporting} onClose={() => setReporting(false)} targetType="artist_post" targetId={post.id} />
    </>
  );
}

/**
 * The "..." on a share, for the person who shared it. Removing the share
 * leaves the original post where it is, with its own reactions and comments.
 */
export function ShareMoreMenu({ post, sharerId }: { post: FeedItemDto; sharerId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/posts/${post.id}/share`),
    onSuccess: () => {
      setRemoving(false);
      refreshPostLists(queryClient, post.id);
    },
  });

  if (user?.id !== sharerId) return null;

  return (
    <>
      <MoreMenu
        label="More options for this share"
        items={[{ label: "Remove share", danger: true, onSelect: () => setRemoving(true) }]}
      />
      <ConfirmRemoval
        open={removing}
        title="Remove this share?"
        body={`It comes off your profile and the feed, with the reactions and comments people left on your share. ${post.artist.displayName}'s original post stays.`}
        confirmLabel="Remove share"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
        onClose={() => {
          setRemoving(false);
          remove.reset();
        }}
      />
    </>
  );
}
