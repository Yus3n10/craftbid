import { beforeEach, describe, expect, it } from "vitest";
import {
  applyToPosting,
  authHeaders,
  createArtistPost,
  createPosting,
  getTestApp,
  registerUser,
  resetData,
  seedImage,
  type Session,
} from "./helpers.js";

/**
 * These tests attack the API directly, the way an attacker would: by taking a
 * real resource id belonging to someone else and calling the endpoint anyway.
 *
 * The frontend never sends these requests, which is exactly why they need
 * testing. Hiding a button is not access control.
 */
describe("authorization boundaries", () => {
  let client: Session;
  let otherClient: Session;
  let artist: Session;
  let otherArtist: Session;

  beforeEach(async () => {
    await resetData();
    client = await registerUser("client");
    otherClient = await registerUser("client");
    artist = await registerUser("artist");
    otherArtist = await registerUser("artist");
  });

  it("stops a client editing another client's posting", async () => {
    const app = await getTestApp();
    const posting = await createPosting(client);

    const response = await app.inject({
      method: "PATCH",
      url: `/postings/${posting.id}`,
      headers: authHeaders(otherClient),
      payload: { title: "Hijacked by someone who does not own this" },
    });

    expect(response.statusCode).toBe(404);

    const unchanged = await app.inject({ method: "GET", url: `/postings/${posting.id}` });
    expect(unchanged.json().title).toBe("Custom Crochet Wedding Bouquet");
  });

  it("stops a client cancelling another client's posting", async () => {
    const app = await getTestApp();
    const posting = await createPosting(client);

    const response = await app.inject({
      method: "POST",
      url: `/postings/${posting.id}/cancel`,
      headers: authHeaders(otherClient),
    });

    expect(response.statusCode).toBe(404);

    const still = await app.inject({ method: "GET", url: `/postings/${posting.id}` });
    expect(still.json().status).toBe("open");
  });

  it("stops a client accepting an application on someone else's posting", async () => {
    const app = await getTestApp();
    const posting = await createPosting(client);
    const application = await applyToPosting(artist, posting.id, 200_000);

    const response = await app.inject({
      method: "POST",
      url: `/applications/${application.json().id}/accept`,
      headers: authHeaders(otherClient),
    });

    expect(response.statusCode).toBe(404);

    const untouched = await app.inject({
      method: "GET",
      url: `/applications/${application.json().id}`,
      headers: authHeaders(artist),
    });
    expect(untouched.json().status).toBe("pending");
  });

  it("stops an artist withdrawing another artist's application", async () => {
    const app = await getTestApp();
    const posting = await createPosting(client);
    const application = await applyToPosting(artist, posting.id, 200_000);

    const response = await app.inject({
      method: "POST",
      url: `/applications/${application.json().id}/withdraw`,
      headers: authHeaders(otherArtist),
    });

    expect(response.statusCode).toBe(404);
  });

  it("stops an uninvolved artist reading a rival's application", async () => {
    const app = await getTestApp();
    const posting = await createPosting(client);
    const application = await applyToPosting(artist, posting.id, 200_000);

    const response = await app.inject({
      method: "GET",
      url: `/applications/${application.json().id}`,
      headers: authHeaders(otherArtist),
    });

    // A bid's price and cover letter are competitive information.
    expect(response.statusCode).toBe(404);
  });

  it("stops a stranger reading or completing someone else's commission", async () => {
    const app = await getTestApp();
    const { completeCommission } = await import("./helpers.js");
    const posting = await createPosting(client);
    const application = await applyToPosting(artist, posting.id, 200_000);
    await app.inject({
      method: "POST",
      url: `/applications/${application.json().id}/accept`,
      headers: authHeaders(client),
    });
    const view = await app.inject({
      method: "GET",
      url: `/postings/${posting.id}`,
      headers: authHeaders(client),
    });
    const commissionId = view.json().commissionId;

    const read = await app.inject({
      method: "GET",
      url: `/commissions/${commissionId}`,
      headers: authHeaders(otherClient),
    });
    expect(read.statusCode).toBe(404);

    const complete = await app.inject({
      method: "POST",
      url: `/commissions/${commissionId}/complete`,
      headers: authHeaders(otherClient),
    });
    expect(complete.statusCode).toBe(404);

    void completeCommission;
  });

  it("stops the artist marking their own commission complete", async () => {
    const app = await getTestApp();
    const posting = await createPosting(client);
    const application = await applyToPosting(artist, posting.id, 200_000);
    await app.inject({
      method: "POST",
      url: `/applications/${application.json().id}/accept`,
      headers: authHeaders(client),
    });
    const view = await app.inject({
      method: "GET",
      url: `/postings/${posting.id}`,
      headers: authHeaders(client),
    });

    const response = await app.inject({
      method: "POST",
      url: `/commissions/${view.json().commissionId}/complete`,
      headers: authHeaders(artist),
    });

    // Only the client can confirm they received what they asked for.
    expect(response.statusCode).toBe(400);
  });

  it("stops a user attaching someone else's uploaded image", async () => {
    const app = await getTestApp();
    const theirImage = await seedImage(otherClient.id);

    const response = await app.inject({
      method: "POST",
      url: "/postings",
      headers: authHeaders(client),
      payload: {
        title: "Trying to use an image I do not own",
        description:
          "This posting references an image uploaded by a different account entirely.",
        categorySlug: "crochet",
        minBudgetCentavos: 150_000,
        imageIds: [theirImage],
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it("stops an artist passing off another artist's image as their own post", async () => {
    const app = await getTestApp();
    const theirImage = await seedImage(otherArtist.id);

    const response = await app.inject({
      method: "POST",
      url: "/posts",
      headers: authHeaders(artist),
      payload: { caption: "Not actually my work", imageIds: [theirImage] },
    });

    expect(response.statusCode).toBe(403);
  });

  it("stops an artist editing another artist's post", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(otherArtist, "Their original caption");

    const response = await app.inject({
      method: "PATCH",
      url: `/posts/${post.id}`,
      headers: authHeaders(artist),
      payload: { caption: "Rewritten by someone else" },
    });

    expect(response.statusCode).toBe(404);

    const unchanged = await app.inject({ method: "GET", url: `/posts/${post.id}` });
    expect(unchanged.json().caption).toBe("Their original caption");
  });

  it("stops an artist deleting another artist's post", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(otherArtist);

    const response = await app.inject({
      method: "DELETE",
      url: `/posts/${post.id}`,
      headers: authHeaders(artist),
    });

    expect(response.statusCode).toBe(404);
  });

  it("keeps private fields off a public profile", async () => {
    const app = await getTestApp();
    const response = await app.inject({ method: "GET", url: `/users/${artist.username}` });

    const body = response.json();
    expect(body.email).toBeUndefined();
    expect(body.passwordHash).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("@example.com");
  });

  it("enforces role separation on both sides", async () => {
    const app = await getTestApp();
    const posting = await createPosting(client);

    // A client cannot bid.
    const clientBidding = await app.inject({
      method: "POST",
      url: `/postings/${posting.id}/applications`,
      headers: authHeaders(otherClient),
      payload: {
        proposedPriceCentavos: 200_000,
        coverLetter: "A client account should not be able to submit a bid at all.",
        samplePostIds: [],
      },
    });
    expect(clientBidding.statusCode).toBe(403);

    // An artist cannot post work.
    const artistPosting = await app.inject({
      method: "POST",
      url: "/postings",
      headers: authHeaders(artist),
      payload: {
        title: "An artist should not be posting jobs",
        description:
          "Role separation is enforced on the server, not by hiding the form in the UI.",
        categorySlug: "crochet",
        minBudgetCentavos: 150_000,
        imageIds: [],
      },
    });
    expect(artistPosting.statusCode).toBe(403);
  });
});
