import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CRAFT_CATEGORIES,
  LIMITS,
  LINK_PLATFORMS,
  PH_REGIONS,
  type LinkPlatform,
  type MeDto,
} from "@raxtan/shared";
import { ApiError, api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { cx } from "../lib/cx.js";
import { Page } from "../components/layout/Shell.js";
import { Button } from "../components/ui/Button.js";
import { Field, Select, TextArea, TextInput } from "../components/ui/Field.js";
import { Card, ThreadRule } from "../components/ui/Primitives.js";
import { FormError, PageHeading } from "../components/ui/States.js";
import { ImageUploader, type UploadedImage } from "../components/ImageUploader.js";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="pl-3">
        <h2 className="font-display text-xl">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
        <ThreadRule className="my-4 w-14" />
        {children}
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [region, setRegion] = useState(user?.region ?? "");
  const [city, setCity] = useState(user?.city ?? "");
  const [avatar, setAvatar] = useState<UploadedImage[]>(
    user?.avatar ? [{ id: user.avatar.id, url: user.avatar.url }] : [],
  );
  const [cover, setCover] = useState<UploadedImage[]>(
    user?.cover ? [{ id: user.cover.id, url: user.cover.url }] : [],
  );

  const [headline, setHeadline] = useState(user?.artist?.headline ?? "");
  const [accepting, setAccepting] = useState(
    user?.artist?.acceptingCommissions ?? true,
  );
  const [categories, setCategories] = useState<string[]>(
    user?.artist?.categories.map((category) => category.slug) ?? [],
  );
  const [skills, setSkills] = useState((user?.artist?.skills ?? []).join(", "));

  const [links, setLinks] = useState<{ platform: LinkPlatform; url: string }[]>(
    user?.links.map((link) => ({ platform: link.platform, url: link.url })) ?? [],
  );

  const onSaved = (updated: MeDto) => {
    queryClient.setQueryData(["me"], updated);
  };

  const saveProfile = useMutation({
    mutationFn: () =>
      api.patch<MeDto>("/me/profile", {
        displayName,
        bio,
        region: region || null,
        city,
        avatarImageId: avatar[0]?.id ?? null,
        coverImageId: cover[0]?.id ?? null,
      }),
    onSuccess: onSaved,
  });

  const saveArtist = useMutation({
    mutationFn: () =>
      api.patch<MeDto>("/me/artist-profile", {
        headline,
        acceptingCommissions: accepting,
        categorySlugs: categories,
        skills: skills
          .split(",")
          .map((skill) => skill.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, LIMITS.skillsPerArtist),
      }),
    onSuccess: onSaved,
  });

  const saveLinks = useMutation({
    mutationFn: () =>
      api.put<MeDto>("/me/links", {
        links: links.filter((link) => link.url.trim().length > 0),
      }),
    onSuccess: onSaved,
  });

  if (!user) return null;

  const profileFields =
    saveProfile.error instanceof ApiError ? saveProfile.error.fields : {};

  return (
    <Page width="narrow">
      <PageHeading
        title="Your profile"
        description="This is what clients and artists see when they look you up."
      />

      <div className="space-y-6">
        <Section
          title="Basics"
          description="Location stays coarse: region and city only, never a street address."
        >
          <form
            className="space-y-5"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              saveProfile.mutate();
            }}
          >
            <FormError error={saveProfile.error} />

            <ImageUploader
              label="Profile picture"
              images={avatar}
              onChange={setAvatar}
              max={1}
            />

            <ImageUploader
              label="Cover image"
              hint="Sits behind your name at the top of your profile."
              images={cover}
              onChange={setCover}
              max={1}
            />

            <Field label="Display name" error={profileFields.displayName} required>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                />
              )}
            </Field>

            <Field
              label="About you"
              hint={
                user.role === "artist"
                  ? "What you make, how you work, and what you enjoy taking on."
                  : "A line or two so artists know who they would be working with."
              }
              error={profileFields.bio}
            >
              {({ id, describedBy, invalid }) => (
                <TextArea
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  maxLength={LIMITS.bio.max}
                  rows={5}
                />
              )}
            </Field>

            <Field label="Region" error={profileFields.region}>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                >
                  <option value="">Prefer not to say</option>
                  {PH_REGIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="City or municipality" error={profileFields.city}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                />
              )}
            </Field>

            <Button type="submit" loading={saveProfile.isPending}>
              Save profile
            </Button>
            {saveProfile.isSuccess && (
              <span className="ml-3 text-sm text-sage">Profile saved.</span>
            )}
          </form>
        </Section>

        {user.role === "artist" && (
          <Section
            title="Your craft"
            description="What you make. Clients filter by these, so keep them accurate."
          >
            <form
              className="space-y-5"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                saveArtist.mutate();
              }}
            >
              <FormError error={saveArtist.error} />

              <Field
                label="Headline"
                hint="One line at the top of your profile."
              >
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    value={headline}
                    onChange={(event) => setHeadline(event.target.value)}
                    placeholder="Handwoven inabel from Ilocos Sur"
                    maxLength={LIMITS.headline.max}
                  />
                )}
              </Field>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink">Crafts</legend>
                <ul className="flex flex-wrap gap-2">
                  {CRAFT_CATEGORIES.map((category) => {
                    const selected = categories.includes(category.slug);
                    return (
                      <li key={category.slug}>
                        <label
                          className={cx(
                            "cursor-pointer rounded-sm border px-2.5 py-1 text-sm transition-colors",
                            selected
                              ? "border-indigo bg-indigo-wash text-indigo"
                              : "border-fiber bg-paper text-ink-soft hover:border-fiber-strong",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={selected}
                            onChange={() =>
                              setCategories((current) =>
                                selected
                                  ? current.filter((slug) => slug !== category.slug)
                                  : [...current, category.slug],
                              )
                            }
                          />
                          {category.name}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>

              <Field
                label="Specialties"
                hint="Comma separated, finer than the crafts above. For example: amigurumi, tunisian crochet, bridal."
              >
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    value={skills}
                    onChange={(event) => setSkills(event.target.value)}
                  />
                )}
              </Field>

              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={accepting}
                  onChange={(event) => setAccepting(event.target.checked)}
                  className="size-4 rounded-sm border-fiber-strong text-indigo"
                />
                I am taking on new commissions
              </label>

              <Button type="submit" loading={saveArtist.isPending}>
                Save craft details
              </Button>
              {saveArtist.isSuccess && (
                <span className="ml-3 text-sm text-sage">Craft details saved.</span>
              )}
            </form>
          </Section>
        )}

        <Section
          title="Where else to find you"
          description="Public links on your profile. Only https addresses are accepted."
        >
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              saveLinks.mutate();
            }}
          >
            <FormError error={saveLinks.error} />

            <ul className="space-y-3">
              {links.map((link, index) => (
                <li key={index} className="flex gap-2">
                  <Select
                    aria-label="Platform"
                    className="w-40 shrink-0"
                    value={link.platform}
                    onChange={(event) =>
                      setLinks((current) =>
                        current.map((item, position) =>
                          position === index
                            ? { ...item, platform: event.target.value as LinkPlatform }
                            : item,
                        ),
                      )
                    }
                  >
                    {LINK_PLATFORMS.map((platform) => (
                      <option key={platform} value={platform}>
                        {platform}
                      </option>
                    ))}
                  </Select>
                  <TextInput
                    aria-label="Link address"
                    type="url"
                    placeholder="https://facebook.com/yourpage"
                    value={link.url}
                    onChange={(event) =>
                      setLinks((current) =>
                        current.map((item, position) =>
                          position === index
                            ? { ...item, url: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    onClick={() =>
                      setLinks((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={links.length >= LIMITS.linksPerUser}
                onClick={() =>
                  setLinks((current) => [...current, { platform: "facebook", url: "" }])
                }
              >
                Add a link
              </Button>
              <Button type="submit" size="sm" loading={saveLinks.isPending}>
                Save links
              </Button>
            </div>
            {saveLinks.isSuccess && (
              <p className="text-sm text-sage">Links saved.</p>
            )}
          </form>
        </Section>
      </div>
    </Page>
  );
}
