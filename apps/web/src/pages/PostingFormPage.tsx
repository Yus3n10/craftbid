import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CRAFT_CATEGORIES,
  LIMITS,
  MONEY,
  formatPeso,
  type PostingDto,
} from "@craftbid/shared";
import { ApiError, api } from "../lib/api.js";
import { Page } from "../components/layout/Shell.js";
import { Button } from "../components/ui/Button.js";
import { Field, PesoInput, Select, TextArea, TextInput } from "../components/ui/Field.js";
import { ErrorState, FormError, PageHeading, RowSkeleton } from "../components/ui/States.js";
import { ImageUploader, type UploadedImage } from "../components/ImageUploader.js";

export function PostingFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categorySlug, setCategorySlug] = useState("crochet");
  const [minBudget, setMinBudget] = useState<number | "">("");
  const [requirements, setRequirements] = useState("");
  const [deadline, setDeadline] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);

  const existing = useQuery({
    queryKey: ["posting", id],
    queryFn: () => api.get<PostingDto>(`/postings/${id}`),
    enabled: editing,
  });

  useEffect(() => {
    const posting = existing.data;
    if (!posting) return;
    setTitle(posting.title);
    setDescription(posting.description);
    setCategorySlug(posting.category.slug);
    setMinBudget(posting.minBudgetCentavos);
    setRequirements(posting.requirements ?? "");
    setDeadline(posting.deadline ? posting.deadline.slice(0, 10) : "");
    setImages(posting.images.map((image) => ({ id: image.id, url: image.url })));
  }, [existing.data]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        title,
        description,
        categorySlug,
        minBudgetCentavos: minBudget === "" ? 0 : minBudget,
        ...(requirements ? { requirements } : {}),
        ...(deadline ? { deadline } : {}),
        imageIds: images.map((image) => image.id),
      };
      return editing
        ? api.patch<PostingDto>(`/postings/${id}`, payload)
        : api.post<PostingDto>("/postings", payload);
    },
    onSuccess: (posting) => {
      void queryClient.invalidateQueries({ queryKey: ["postings"] });
      void queryClient.invalidateQueries({ queryKey: ["posting", posting.id] });
      navigate(`/postings/${posting.id}`);
    },
  });

  if (editing && existing.isLoading) {
    return (
      <Page width="narrow">
        <RowSkeleton count={4} />
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
  const hasBids = (existing.data?.applicationCount ?? 0) > 0;

  return (
    <Page width="narrow">
      <PageHeading
        eyebrow={editing ? "Editing" : "New request"}
        title={editing ? "Edit your craft request" : "Post a craft request"}
        description={
          editing
            ? "Changes are visible to artists straight away."
            : "Describe what you want made. The clearer the brief, the better the bids."
        }
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

        <Field
          label="Title"
          hint="Name the piece the way you would describe it to a friend."
          error={fields.title}
          required
        >
          {({ id: fieldId, describedBy, invalid }) => (
            <TextInput
              id={fieldId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Custom crochet wedding bouquet"
              maxLength={LIMITS.postingTitle.max}
              required
            />
          )}
        </Field>

        <Field
          label="Description"
          hint="Colours, size, materials, and what it is for. Artists price from this."
          error={fields.description}
          required
        >
          {({ id: fieldId, describedBy, invalid }) => (
            <TextArea
              id={fieldId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="I would like a handmade crochet bouquet for my wedding. White roses with light blue accents, about 25cm across."
              maxLength={LIMITS.postingDescription.max}
              rows={7}
              required
            />
          )}
        </Field>

        <Field label="Craft" error={fields.categorySlug} required>
          {({ id: fieldId, describedBy, invalid }) => (
            <Select
              id={fieldId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={categorySlug}
              onChange={(event) => setCategorySlug(event.target.value)}
            >
              {CRAFT_CATEGORIES.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Starting budget"
          hint={
            hasBids
              ? "Artists have already bid against this figure, so it can no longer be changed."
              : `The least you would pay, from ${formatPeso(MONEY.minBudgetCentavos)}. Artists bid at or above it.`
          }
          error={fields.minBudgetCentavos}
          required
        >
          {({ id: fieldId, describedBy, invalid }) => (
            <PesoInput
              id={fieldId}
              describedBy={describedBy}
              invalid={invalid}
              valueCentavos={minBudget}
              onChangeCentavos={setMinBudget}
              disabled={hasBids}
            />
          )}
        </Field>

        <ImageUploader
          label="Reference images"
          hint="Sketches, colours, or pieces you like. Optional, but they get better bids."
          images={images}
          onChange={setImages}
          max={LIMITS.postingImages.max}
        />

        <Field label="Additional requirements" error={fields.requirements}>
          {({ id: fieldId, describedBy, invalid }) => (
            <TextArea
              id={fieldId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={requirements}
              onChange={(event) => setRequirements(event.target.value)}
              placeholder="Delivery to Cebu City, hypoallergenic yarn only, and so on."
              maxLength={LIMITS.postingRequirements.max}
              rows={3}
            />
          )}
        </Field>

        <Field label="Wanted by" hint="Optional." error={fields.deadline}>
          {({ id: fieldId, describedBy, invalid }) => (
            <TextInput
              id={fieldId}
              type="date"
              aria-describedby={describedBy}
              invalid={invalid}
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
            />
          )}
        </Field>

        <div className="flex gap-3 border-t border-fiber pt-6">
          <Button type="submit" size="lg" loading={mutation.isPending}>
            {editing ? "Save changes" : "Post request"}
          </Button>
          <Button type="button" variant="ghost" size="lg" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </Page>
  );
}
