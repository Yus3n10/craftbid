import { beforeEach, describe, expect, it } from "vitest";
import {
  applyToPosting,
  authHeaders,
  createArtistPost,
  createPosting,
  getTestApp,
  registerUser,
  resetData,
  type Session,
} from "./helpers.js";

describe("marketplace workflow", () => {
  let client: Session;
  let artist: Session;

  beforeEach(async () => {
    await resetData();
    client = await registerUser("client");
    artist = await registerUser("artist");
  });

  describe("postings", () => {
    it("lets a client create a posting with a peso minimum", async () => {
      const app = await getTestApp();
      const response = await app.inject({
        method: "POST",
        url: "/postings",
        headers: authHeaders(client),
        payload: {
          title: "Custom Crochet Wedding Bouquet",
          description:
            "I want a handmade crochet bouquet for my wedding. White roses with light blue accents.",
          categorySlug: "crochet",
          minBudgetCentavos: 150_000,
          imageIds: [],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.minBudgetCentavos).toBe(150_000);
      expect(body.status).toBe("open");
      expect(body.category.slug).toBe("crochet");
      expect(body.client.id).toBe(client.id);
    });

    it("refuses to let an artist create a posting", async () => {
      const app = await getTestApp();
      const response = await app.inject({
        method: "POST",
        url: "/postings",
        headers: authHeaders(artist),
        payload: {
          title: "Artists cannot post jobs",
          description:
            "This request should be refused because the account is an artist account.",
          categorySlug: "crochet",
          minBudgetCentavos: 150_000,
          imageIds: [],
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("carries multiple reference images in order", async () => {
      const app = await getTestApp();
      const { seedImage } = await import("./helpers.js");
      const first = await seedImage(client.id);
      const second = await seedImage(client.id);

      const posting = await createPosting(client, { imageIds: [first, second] });
      const response = await app.inject({ method: "GET", url: `/postings/${posting.id}` });

      const images = response.json().images;
      expect(images).toHaveLength(2);
      expect(images[0].id).toBe(first);
      expect(images[1].id).toBe(second);
    });

    it("filters browsing by category and search term", async () => {
      const app = await getTestApp();
      await createPosting(client, { categorySlug: "crochet", title: "Crochet bouquet" });
      await createPosting(client, { categorySlug: "pottery", title: "Stoneware mugs" });

      const byCategory = await app.inject({ method: "GET", url: "/postings?category=pottery" });
      expect(byCategory.json().total).toBe(1);
      expect(byCategory.json().items[0].category.slug).toBe("pottery");

      const bySearch = await app.inject({ method: "GET", url: "/postings?q=stoneware" });
      expect(bySearch.json().total).toBe(1);
      expect(bySearch.json().items[0].title).toBe("Stoneware mugs");
    });

    it("stops the minimum budget changing once artists have applied", async () => {
      const app = await getTestApp();
      const posting = await createPosting(client, { minBudgetCentavos: 150_000 });
      await applyToPosting(artist, posting.id, 150_000);

      const response = await app.inject({
        method: "PATCH",
        url: `/postings/${posting.id}`,
        headers: authHeaders(client),
        payload: { minBudgetCentavos: 500_000 },
      });

      // Artists priced their bids against the advertised minimum.
      expect(response.statusCode).toBe(400);
    });
  });

  describe("applications", () => {
    it("lets an artist apply at exactly the minimum", async () => {
      const posting = await createPosting(client, { minBudgetCentavos: 150_000 });
      const response = await applyToPosting(artist, posting.id, 150_000);

      expect(response.statusCode).toBe(201);
      expect(response.json().proposedPriceCentavos).toBe(150_000);
      expect(response.json().status).toBe("pending");
    });

    it("lets an artist apply above the minimum", async () => {
      const posting = await createPosting(client, { minBudgetCentavos: 150_000 });
      const response = await applyToPosting(artist, posting.id, 220_000);
      expect(response.statusCode).toBe(201);
    });

    it("refuses a bid one centavo below the minimum", async () => {
      const posting = await createPosting(client, { minBudgetCentavos: 150_000 });
      const response = await applyToPosting(artist, posting.id, 149_999);

      expect(response.statusCode).toBe(400);
      expect(response.json().error.fields.proposedPriceCentavos).toBeDefined();
    });

    it("refuses a second application from the same artist", async () => {
      const posting = await createPosting(client);
      const first = await applyToPosting(artist, posting.id, 200_000);
      expect(first.statusCode).toBe(201);

      const second = await applyToPosting(artist, posting.id, 250_000);
      expect(second.statusCode).toBe(409);
    });

    it("refuses applications once the posting is no longer open", async () => {
      const app = await getTestApp();
      const posting = await createPosting(client);
      await app.inject({
        method: "POST",
        url: `/postings/${posting.id}/cancel`,
        headers: authHeaders(client),
      });

      const response = await applyToPosting(artist, posting.id, 200_000);
      expect(response.statusCode).toBe(400);
    });

    it("attaches only the applying artist's own work samples", async () => {
      const otherArtist = await registerUser("artist");
      const mine = await createArtistPost(artist, "My own bouquet");
      const theirs = await createArtistPost(otherArtist, "Someone else's work");

      const posting = await createPosting(client);
      const response = await applyToPosting(artist, posting.id, 200_000, [
        mine.id,
        theirs.id,
      ]);

      // Passing another artist's post id must not credit their work.
      const samples = response.json().samples;
      expect(samples).toHaveLength(1);
      expect(samples[0].id).toBe(mine.id);
    });

    it("hides rival bids from other artists but shows them to the client", async () => {
      const app = await getTestApp();
      const rival = await registerUser("artist");
      const posting = await createPosting(client);
      await applyToPosting(artist, posting.id, 200_000);

      const asRival = await app.inject({
        method: "GET",
        url: `/postings/${posting.id}/applications`,
        headers: authHeaders(rival),
      });
      const asClient = await app.inject({
        method: "GET",
        url: `/postings/${posting.id}/applications`,
        headers: authHeaders(client),
      });

      expect(asRival.statusCode).toBe(403);
      expect(asClient.statusCode).toBe(200);
      expect(asClient.json().total).toBe(1);
    });

    it("lets an artist withdraw a pending application", async () => {
      const app = await getTestApp();
      const posting = await createPosting(client);
      const application = await applyToPosting(artist, posting.id, 200_000);
      const id = application.json().id;

      const response = await app.inject({
        method: "POST",
        url: `/applications/${id}/withdraw`,
        headers: authHeaders(artist),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe("withdrawn");
    });
  });

  describe("selecting an artist", () => {
    it("accepts one artist, declines the rest and opens a commission", async () => {
      const app = await getTestApp();
      const runnerUp = await registerUser("artist");
      const posting = await createPosting(client);

      const winning = await applyToPosting(artist, posting.id, 200_000);
      const losing = await applyToPosting(runnerUp, posting.id, 180_000);

      const accept = await app.inject({
        method: "POST",
        url: `/applications/${winning.json().id}/accept`,
        headers: authHeaders(client),
      });

      expect(accept.statusCode).toBe(200);
      expect(accept.json().status).toBe("accepted");

      // The losing bid is declined in the same transaction, so no artist is
      // left waiting on a decision already made.
      const loser = await app.inject({
        method: "GET",
        url: `/applications/${losing.json().id}`,
        headers: authHeaders(runnerUp),
      });
      expect(loser.json().status).toBe("rejected");

      const after = await app.inject({
        method: "GET",
        url: `/postings/${posting.id}`,
        headers: authHeaders(client),
      });
      expect(after.json().status).toBe("in_progress");
      expect(after.json().commissionId).toBeTruthy();
    });

    it("refuses a second acceptance on the same posting", async () => {
      const app = await getTestApp();
      const second = await registerUser("artist");
      const posting = await createPosting(client);
      const first = await applyToPosting(artist, posting.id, 200_000);
      const other = await applyToPosting(second, posting.id, 210_000);

      await app.inject({
        method: "POST",
        url: `/applications/${first.json().id}/accept`,
        headers: authHeaders(client),
      });

      const response = await app.inject({
        method: "POST",
        url: `/applications/${other.json().id}/accept`,
        headers: authHeaders(client),
      });

      expect(response.statusCode).toBe(400);
    });

    it("refuses new applications after an artist is selected", async () => {
      const app = await getTestApp();
      const latecomer = await registerUser("artist");
      const posting = await createPosting(client);
      const application = await applyToPosting(artist, posting.id, 200_000);

      await app.inject({
        method: "POST",
        url: `/applications/${application.json().id}/accept`,
        headers: authHeaders(client),
      });

      const response = await applyToPosting(latecomer, posting.id, 190_000);
      expect(response.statusCode).toBe(400);
    });
  });

  describe("commissions and reviews", () => {
    it("completes a commission and closes the posting", async () => {
      const app = await getTestApp();
      const { completeCommission } = await import("./helpers.js");
      const { postingId, commissionId } = await completeCommission(client, artist);

      const commission = await app.inject({
        method: "GET",
        url: `/commissions/${commissionId}`,
        headers: authHeaders(client),
      });
      expect(commission.json().status).toBe("completed");
      expect(commission.json().canReview).toBe(true);

      const posting = await app.inject({ method: "GET", url: `/postings/${postingId}` });
      expect(posting.json().status).toBe("completed");
    });

    it("refuses a review before the commission is complete", async () => {
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
        url: `/commissions/${view.json().commissionId}/reviews`,
        headers: authHeaders(client),
        payload: { rating: 5, body: "Too early to review." },
      });

      expect(response.statusCode).toBe(400);
    });

    it("lets both parties review a completed commission, once each", async () => {
      const app = await getTestApp();
      const { completeCommission } = await import("./helpers.js");
      const { commissionId } = await completeCommission(client, artist);

      const clientReview = await app.inject({
        method: "POST",
        url: `/commissions/${commissionId}/reviews`,
        headers: authHeaders(client),
        payload: { rating: 5, body: "Beautiful work, exactly what I asked for." },
      });
      expect(clientReview.statusCode).toBe(201);
      expect(clientReview.json().revieweeId).toBe(artist.id);

      const artistReview = await app.inject({
        method: "POST",
        url: `/commissions/${commissionId}/reviews`,
        headers: authHeaders(artist),
        payload: { rating: 4, body: "Clear brief and prompt replies." },
      });
      expect(artistReview.statusCode).toBe(201);

      // A second review from the same person on the same commission is what
      // rating farming would look like.
      const duplicate = await app.inject({
        method: "POST",
        url: `/commissions/${commissionId}/reviews`,
        headers: authHeaders(client),
        payload: { rating: 5, body: "Trying again." },
      });
      expect(duplicate.statusCode).toBe(409);
    });

    it("shows the new rating on the artist's public profile", async () => {
      const app = await getTestApp();
      const { completeCommission } = await import("./helpers.js");
      const { commissionId } = await completeCommission(client, artist);

      await app.inject({
        method: "POST",
        url: `/commissions/${commissionId}/reviews`,
        headers: authHeaders(client),
        payload: { rating: 5, body: "Wonderful." },
      });

      const profile = await app.inject({
        method: "GET",
        url: `/users/${artist.username}`,
      });
      expect(profile.json().rating.count).toBe(1);
      expect(profile.json().rating.average).toBe(5);
      expect(profile.json().completedCommissions).toBe(1);
    });

    it("refuses a review from someone who was not part of the commission", async () => {
      const app = await getTestApp();
      const outsider = await registerUser("client");
      const { completeCommission } = await import("./helpers.js");
      const { commissionId } = await completeCommission(client, artist);

      const response = await app.inject({
        method: "POST",
        url: `/commissions/${commissionId}/reviews`,
        headers: authHeaders(outsider),
        payload: { rating: 1, body: "I was never involved in this." },
      });

      expect(response.statusCode).toBe(404);
    });

    it("refuses a rating outside 1 to 5", async () => {
      const app = await getTestApp();
      const { completeCommission } = await import("./helpers.js");
      const { commissionId } = await completeCommission(client, artist);

      for (const rating of [0, 6, -1]) {
        const response = await app.inject({
          method: "POST",
          url: `/commissions/${commissionId}/reviews`,
          headers: authHeaders(client),
          payload: { rating },
        });
        expect(response.statusCode).toBe(400);
      }
    });
  });
});
