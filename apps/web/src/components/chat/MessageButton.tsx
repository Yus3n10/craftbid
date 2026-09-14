import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import type { ConversationDto } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.js";
import { FormError } from "../ui/States.js";

/**
 * Opens the conversation about one request with one artist, creating it the
 * first time, and goes to it. Used from a bid, a request and a commission, so
 * chat is reached from the work it is about rather than a separate inbox.
 */
export function MessageButton({
  postingId,
  artistId,
  label,
  variant = "secondary",
}: {
  postingId: string;
  artistId: string;
  label: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const navigate = useNavigate();
  const open = useMutation({
    mutationFn: () => api.post<ConversationDto>("/conversations", { postingId, artistId }),
    onSuccess: (conversation) => navigate(`/messages/${conversation.id}`),
  });

  return (
    <span className="inline-flex flex-col gap-2">
      <Button type="button" variant={variant} size="sm" loading={open.isPending} onClick={() => open.mutate()}>
        {label}
      </Button>
      <FormError error={open.error} />
    </span>
  );
}
