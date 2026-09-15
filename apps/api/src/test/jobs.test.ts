import { beforeEach, describe, expect, it } from "vitest";
import { newId, uuidToBuf } from "../db/ids.js";
import { db } from "../db/query.js";
import type { MailMessage, Mailer } from "../lib/mail/index.js";
import { runChatFileCleanup } from "../jobs/chat-file-cleanup.js";
import { runChatNudges } from "../jobs/chat-nudges.js";
import { runOwnerSummary } from "../jobs/owner-summary.js";
import {
  applyToPosting,
  authHeaders,
  createPosting,
  getTestApp,
  registerUser,
  resetData,
  startCommission,
  storedPrivateObject,
  testImage,
  multipartFile,
  type Session,
} from "./helpers.js";

/**
 * The scheduled jobs, run with the clock they are given rather than the real
 * one: the daily owner summary, the unread-chat notice, and clearing out chat
 * images that were uploaded and never sent.
 */

const HOUR = 3_600_000;

/** The instant it is `hh:mm` in Manila, `days` days after today there. */
function manila(days: number, hh: number, mm = 0): Date {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  // Manila is UTC+8 all year.
  return new Date(Date.UTC(y!, m! - 1, d! + days, hh - 8, mm));
}

function recordingMailer(sent: MailMessage[]): Mailer {
  return {
    name: "memory",
    async send(message) {
      sent.push(message);
    },
  };
}

async function setCreated(table: "bug_reports" | "reports" | "commission_problems", id: string, at: Date) {
  const tables = { bug_reports: "bug_reports", reports: "reports", commission_problems: "commission_problems" } as const;
  await db.run(`UPDATE ${tables[table]} SET created_at = :at WHERE id = :id`, { at, id: uuidToBuf(id) });
}

async function insertBugReport(reporter: Session, description: string, at: Date): Promise<string> {
  const id = newId();
  await db.run(
    `INSERT INTO bug_reports (id, reporter_id, description, page_url) VALUES (:id, :reporter, :description, '/postings')`,
    { id: uuidToBuf(id), reporter: uuidToBuf(reporter.id), description },
  );
  await setCreated("bug_reports", id, at);
  return id;
}

async function insertReport(reporter: Session, targetId: string, at: Date): Promise<string> {
  const id = newId();
  await db.run(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details)
     VALUES (:id, :reporter, 'user', :target, 'spam', 'Posting the same link everywhere')`,
    { id: uuidToBuf(id), reporter: uuidToBuf(reporter.id), target: uuidToBuf(targetId) },
  );
  await setCreated("reports", id, at);
  return id;
}

describe("the daily owner summary", () => {
  let client: Session;
  let artist: Session;
  const sent: MailMessage[] = [];
  const options = () => ({ recipient: "owner@example.com", mailer: recordingMailer(sent) });

  beforeEach(async () => {
    await resetData();
    sent.length = 0;
    client = await registerUser("client");
    artist = await registerUser("artist");
  });

  it("waits for 4 PM in Manila, sends once that day, and names what came in", async () => {
    expect(await runOwnerSummary(manila(1, 15, 59), options())).toBe("not_yet");

    await insertBugReport(client, "The bid button does nothing on my phone", manila(1, 14));
    expect(await runOwnerSummary(manila(1, 16, 0), options())).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("owner@example.com");
    expect(sent[0]!.subject).toMatch(/1 bug report/);
    expect(sent[0]!.text).toContain("The bid button does nothing on my phone");
    expect(sent[0]!.text).toContain("/admin?tab=bugs");

    expect(await runOwnerSummary(manila(1, 16, 30), options())).toBe("already_ran");
    expect(sent).toHaveLength(1);
  });

  it("sends nothing on a quiet day, then covers only what is new", async () => {
    await insertBugReport(client, "Old news", manila(1, 10));
    expect(await runOwnerSummary(manila(1, 16, 5), options())).toBe("sent");

    expect(await runOwnerSummary(manila(2, 16, 5), options())).toBe("nothing_new");
    expect(sent).toHaveLength(1);

    await insertReport(client, artist.id, manila(2, 18));
    const commissionId = await startCommission(client, artist);
    const app = await getTestApp();
    await app.inject({
      method: "POST",
      url: `/commissions/${commissionId}/problems`,
      headers: authHeaders(client),
      payload: { reason: "stopped_responding", details: "No reply for a week after the down payment." },
    });
    const problem = await db.one<{ id: Buffer }>(`SELECT id FROM commission_problems`);
    await db.run(`UPDATE commission_problems SET created_at = :at WHERE id = :id`, { at: manila(2, 19), id: problem!.id });

    expect(await runOwnerSummary(manila(3, 16, 5), options())).toBe("sent");
    expect(sent).toHaveLength(2);
    const second = sent[1]!;
    expect(second.subject).toMatch(/1 report/);
    expect(second.subject).toMatch(/1 commission problem/);
    expect(second.text).toContain("No reply for a week after the down payment.");
    expect(second.text).not.toContain("Old news");
  });

  it("skips quietly when there is nobody to send to", async () => {
    await insertBugReport(client, "Something broke", manila(1, 12));
    expect(await runOwnerSummary(manila(1, 16, 1), { recipient: undefined, mailer: recordingMailer(sent) })).toBe("no_recipient");
    expect(sent).toHaveLength(0);
  });

  it("tries again on the next tick when the email fails to send", async () => {
    await insertBugReport(client, "Something broke", manila(1, 12));
    const failing: Mailer = { name: "memory", send: async () => { throw new Error("Brevo is down"); } };
    await expect(runOwnerSummary(manila(1, 16, 1), { recipient: "owner@example.com", mailer: failing })).rejects.toThrow(/Brevo is down/);
    expect(await runOwnerSummary(manila(1, 16, 6), options())).toBe("sent");
  });
});

describe("the unread chat notice", () => {
  let client: Session;
  let artist: Session;
  let conversationId: string;
  let bidId: string;

  beforeEach(async () => {
    await resetData();
    client = await registerUser("client", { displayName: "Maya Dela Cruz" });
    artist = await registerUser("artist", { displayName: "Nena Hooks" });
    const postingId = (await createPosting(client, { title: "Crochet wedding bouquet" })).id;
    bidId = (await applyToPosting(artist, postingId, 173_500)).json().id;
    conversationId = (await call(client, "POST", "/conversations", { postingId, artistId: artist.id })).json().id;
  });

  async function call(session: Session, method: "GET" | "POST", url: string, payload?: object) {
    const app = await getTestApp();
    return app.inject({ method, url, headers: authHeaders(session), ...(payload ? { payload } : {}) });
  }

  async function unreadNotices(session: Session) {
    const items = (await call(session, "GET", "/notifications?limit=50")).json().items as { type: string; payload: Record<string, string> }[];
    return items.filter((item) => item.type === "chat_unread");
  }

  it("tells the other person once, after an hour, and again only after they read", async () => {
    await call(artist, "POST", `/conversations/${conversationId}/messages`, { body: "Here are the colours" });
    const sentAt = Date.now();

    expect(await runChatNudges(new Date(sentAt + 59 * 60_000))).toBe(0);
    expect(await runChatNudges(new Date(sentAt + 61 * 60_000))).toBe(1);

    const [notice] = await unreadNotices(client);
    expect(notice!.payload).toMatchObject({ conversationId, fromName: "Nena Hooks", postingTitle: "Crochet wedding bouquet" });
    expect(await unreadNotices(artist)).toHaveLength(0);

    expect(await runChatNudges(new Date(sentAt + 2 * HOUR))).toBe(0);

    await call(client, "POST", `/conversations/${conversationId}/read`);
    await call(artist, "POST", `/conversations/${conversationId}/messages`, { body: "Did you see them?" });
    const again = Date.now();
    expect(await runChatNudges(new Date(again + 61 * 60_000))).toBe(1);
    expect(await unreadNotices(client)).toHaveLength(2);
  });

  it("says nothing about a conversation that has closed", async () => {
    await call(artist, "POST", `/conversations/${conversationId}/messages`, { body: "Here are the colours" });
    await call(client, "POST", `/applications/${bidId}/reject`);
    expect(await runChatNudges(new Date(Date.now() + 2 * HOUR))).toBe(0);
  });
});

describe("clearing chat images that were never sent", () => {
  it("removes an upload left unattached for a day, and nothing else", async () => {
    await resetData();
    const client = await registerUser("client");
    const artist = await registerUser("artist");
    const postingId = (await createPosting(client)).id;
    await applyToPosting(artist, postingId, 173_500);
    const app = await getTestApp();
    const conversationId = (
      await app.inject({ method: "POST", url: "/conversations", headers: authHeaders(client), payload: { postingId, artistId: artist.id } })
    ).json().id as string;

    async function upload(seed: number): Promise<string> {
      const { payload, headers } = multipartFile(await testImage(seed));
      const response = await app.inject({
        method: "POST",
        url: `/conversations/${conversationId}/files`,
        headers: { ...authHeaders(client), ...headers },
        payload,
      });
      return response.json().fileId as string;
    }

    const abandoned = await upload(21);
    const recent = await upload(22);
    const sentFile = await upload(23);
    await app.inject({
      method: "POST",
      url: `/conversations/${conversationId}/messages`,
      headers: authHeaders(client),
      payload: { fileId: sentFile },
    });
    await db.run(`UPDATE chat_files SET created_at = SYSTIMESTAMP - INTERVAL '25' HOUR WHERE id IN (:a, :s)`, {
      a: uuidToBuf(abandoned),
      s: uuidToBuf(sentFile),
    });
    await db.run(`UPDATE chat_files SET created_at = SYSTIMESTAMP - INTERVAL '23' HOUR WHERE id = :r`, { r: uuidToBuf(recent) });

    expect(await runChatFileCleanup(new Date())).toBe(1);

    const left = await db.many<{ id: Buffer }>(`SELECT id FROM chat_files`);
    expect(left).toHaveLength(2);
    expect(storedPrivateObject(`conversations/${conversationId}/${abandoned}.webp`)).toBeUndefined();
    expect(storedPrivateObject(`conversations/${conversationId}/${recent}.webp`)).toBeDefined();
  });
});
