import type { CommentDto, ReactionKind } from "@craftbid/shared";
import { withTransaction } from "../../db/query.js";
import { forbidden, notFound } from "../../lib/errors.js";
import * as postsRepo from "../posts/posts.repository.js";
import * as repo from "./social.repository.js";
import * as notifications from "../notifications/notifications.repository.js";

/**
 * Every one of these starts by confirming the post exists and is published.
 * Without it, an unpublished or deleted post could still collect reactions and
 * comments through a guessed id, and the counts on a later republish would be
 * inherited from an audience that never saw it.
 */
async function requirePost(postId: string): Promise<{ artistId: string }> {
  const owner = await postsRepo.findOwner(postId);
  if (!owner || owner.status !== "published") {
    throw notFound("That post does not exist.");
  }
  return owner;
}

export async function react(
  postId: string,
  userId: string,
  kind: ReactionKind,
): Promise<void> {
  const owner = await requirePost(postId);

  await withTransaction(async (tx) => {
    await repo.setReaction(postId, userId, kind, tx);

    // Nobody needs telling about their own reaction to their own work.
    if (owner.artistId === userId) return;

    await notifications.notifyOncePerActor(
      {
        userId: owner.artistId,
        type: "post_reaction",
        postId,
        actorId: userId,
        payload: { kind },
      },
      tx,
    );
  });
}

export async function unreact(postId: string, userId: string): Promise<void> {
  await requirePost(postId);
  // The notice is deliberately left alone. Withdrawing a reaction should not
  // reach into somebody else's list and delete something they may have read.
  await repo.clearReaction(postId, userId);
}

export async function listComments(
  postId: string,
  viewerId: string | null,
): Promise<CommentDto[]> {
  await requirePost(postId);
  return repo.listComments(postId, viewerId);
}

export async function addComment(
  postId: string,
  authorId: string,
  body: string,
): Promise<CommentDto> {
  const owner = await requirePost(postId);

  const id = await withTransaction(async (tx) => {
    const commentId = await repo.insertComment(postId, authorId, body, tx);

    if (owner.artistId !== authorId) {
      // Every comment is its own notice, unlike reactions: two comments are
      // two things somebody said, and collapsing them would hide one.
      await notifications.notify(
        {
          userId: owner.artistId,
          type: "post_comment",
          payload: { postId, actorId: authorId, commentId },
        },
        tx,
      );
    }

    return commentId;
  });

  const comments = await repo.listComments(postId, authorId);
  const created = comments.find((comment) => comment.id === id);
  if (!created) throw notFound();
  return created;
}

/**
 * Removing a comment.
 *
 * Both the author and the artist whose post it is may delete: the author
 * because it is their words, and the artist because a portfolio page is
 * somewhere they have to be able to clear abuse from without waiting on a
 * moderator this product does not have.
 */
export async function removeComment(
  commentId: string,
  userId: string,
): Promise<void> {
  const comment = await repo.findComment(commentId);
  if (!comment) throw notFound("That comment does not exist.");

  if (comment.authorId !== userId) {
    const owner = await postsRepo.findOwner(comment.postId);
    if (!owner || owner.artistId !== userId) {
      throw forbidden("You can only delete your own comments.");
    }
  }

  await repo.deleteComment(commentId);
}

export async function setSaved(
  postId: string,
  userId: string,
  saved: boolean,
): Promise<void> {
  await requirePost(postId);
  await repo.setSaved(postId, userId, saved);
}
