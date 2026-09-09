import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CRAFT_CATEGORIES, LIMITS, type ArtistPostDto } from "@craftbid/shared";
import { ApiError, api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { Page } from "../components/layout/Shell.js";
import { Button } from "../components/ui/Button.js";
import { Field, Select, TextArea, TextInput } from "../components/ui/Field.js";
import { ErrorState, FormError, PageHeading, RowSkeleton } from "../components/ui/States.js";
import { ImageUploader, type UploadedImage } from "../components/ImageUploader.js";

export function PostFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [caption, setCaption] = useState("");
  const [description, setDescription] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);

  const existing = useQuery({
    queryKey: ["post", id],
    queryFn: () => api.get<ArtistPostDto>(`/posts/${id}`),
    enabled: editing,
  });

  useEffect(() => {
    const post = existing.data;
    if (!post) return;
    setCaption(post.caption);
    setDescription(post.description ?? "");
    setCategorySlug(post.category?.slug ?? "");
    setImages(post.images.map((image) => ({ id: image.id, url: image.url })));
  }, [existing.data]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        caption,
        ...(description ? { description } : {}),
        ...(categorySlug ? { categorySlug } : {}),
        imageIds: images.map((image) => image.id),
      };
      return editing
        ? api.patch<ArtistPostDto>(`/posts/${id}`, payload)
        : api.post<ArtistPostDto>("/posts", payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
      navigate(`/artists/${user!.username}`);
    },
  });

  if (editing && existing.isLoading) {
    return (
      <Page width="narrow">
        <RowSkeleton count={3} />
      </Page>
    );
  }

  if (editing && existing.error) {
    return (
      <Page width="narrow">
        <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />
      </Page>
    );
  }

  const fields = mutation.error instanceof ApiError ? mutation.error.fields : {};

  return (
    <Page width="narrow">
      <PageHeading
        eyebrow="Portfolio"
        title={editing ? "Edit this piece" : "Add work to your portfolio"}
        description="Work you have already made. Clients browse these to decide who to commission, and you can attach them to a bid."
      />

      <form
        className="space-y-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <FormError error={mutation.error} />

        <ImageUploader
          label="Photos"
          hint="The first photo is the cover. Natural light and a plain background show texture best."
          images={images}
          onChange={setImages}
          max={LIMITS.artistPostImages.max}
        />

        <Field
          label="Caption"
          hint="What the piece is, in a line."
          error={fields.caption}
          required
        >
          {({ id: fieldId, describedBy, invalid }) => (
            <TextInput
              id={fieldId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Crochet bridal bouquet in white and dusty blue"
              maxLength={LIMITS.captionMax}
              required
            />
          )}
        </Field>

        <Field label="Craft" error={fields.categorySlug}>
          {({ id: fieldId, describedBy, invalid }) => (
            <Select
              id={fieldId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={categorySlug}
              onChange={(event) => setCategorySlug(event.target.value)}
            >
              <option value="">Not specified</option>
              {CRAFT_CATEGORIES.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Details"
          hint="Optional. Materials, technique, or how long it took."
          error={fields.description}
        >
          {({ id: fieldId, describedBy, invalid }) => (
            <TextArea
              id={fieldId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          )}
        </Field>

        <div className="flex gap-3 border-t border-fiber pt-6">
          <Button
            type="submit"
            size="lg"
            loading={mutation.isPending}
            disabled={images.length === 0}
          >
            {editing ? "Save changes" : "Add to portfolio"}
          </Button>
          <Button type="button" variant="ghost" size="lg" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>

        {images.length === 0 && (
          <p className="text-sm text-ink-faint">Add at least one photo to publish.</p>
        )}
      </form>
    </Page>
  );
}
