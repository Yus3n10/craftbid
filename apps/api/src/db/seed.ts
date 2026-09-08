import sharp from "sharp";
import { db, withTransaction } from "./query.js";
import { newId, uuidToBuf } from "./ids.js";
import { config } from "../config.js";
import { getStorage } from "../lib/storage/index.js";
import { hashPassword } from "../lib/password.js";
import * as usersRepo from "../modules/users/users.repository.js";
import * as profilesRepo from "../modules/users/profiles.repository.js";
import * as imagesRepo from "../modules/images/images.repository.js";
import * as postingsRepo from "../modules/postings/postings.repository.js";
import * as applicationsRepo from "../modules/applications/applications.repository.js";
import * as commissionsRepo from "../modules/commissions/commissions.repository.js";
import * as reviewsRepo from "../modules/reviews/reviews.repository.js";
import * as postsRepo from "../modules/posts/posts.repository.js";

/**
 * Demo data for local development.
 *
 * The images are generated, not photographs: this repository ships no pictures
 * of anyone's actual work. They are woven-pattern placeholders in the material
 * colour of their craft, which is enough to check layout, aspect ratios and
 * the look of a populated grid without passing off invented work as real.
 */

const SEED_PASSWORD = "raxtan demo password";

/**
 * Draws a plain weave: continuous warp threads, weft threads crossing them, and
 * the over/under alternating at each intersection the way real cloth does.
 * Recognisably fabric rather than a flat colour swatch, which is the point of
 * a placeholder on a page about woven and stitched work.
 */
function makeWeaveSvg(color: string, accent: string, width = 900, height = 700): string {
  const cell = 15;
  const warp: string[] = [];
  const weft: string[] = [];
  const overs: string[] = [];

  for (let x = 0, i = 0; x < width; x += cell * 2, i += 1) {
    warp.push(`<rect x="${x}" y="0" width="${cell}" height="${height}" fill="${accent}"/>`);
    void i;
  }

  for (let y = 0, j = 0; y < height; y += cell * 2, j += 1) {
    weft.push(`<rect x="0" y="${y}" width="${width}" height="${cell}" fill="${color}"/>`);
    // Re-draw the warp segment on top wherever the warp passes over this weft.
    for (let x = 0, i = 0; x < width; x += cell * 2, i += 1) {
      if ((i + j) % 2 === 0) {
        overs.push(
          `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${accent}"/>`,
        );
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="${color}"/>
    ${warp.join("")}
    ${weft.join("")}
    ${overs.join("")}
    <rect width="${width}" height="${height}" fill="${color}" opacity="0.12"/>
  </svg>`;
}

async function makeCraftImage(color: string, accent: string): Promise<Buffer> {
  return sharp(Buffer.from(makeWeaveSvg(color, accent))).png().toBuffer();
}

async function seedImage(ownerId: string, color: string, accent: string): Promise<string> {
  const png = await makeCraftImage(color, accent);
  const output = await sharp(png).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });

  const id = newId();
  const key = `${ownerId}/${id}.webp`;
  await getStorage().put(key, output.data, "image/webp");
  await imagesRepo.insertImage({
    id,
    ownerId,
    objectKey: key,
    contentType: "image/webp",
    byteSize: output.data.byteLength,
    width: output.info.width,
    height: output.info.height,
  });
  return id;
}

interface SeedUser {
  username: string;
  displayName: string;
  role: "client" | "artist";
  bio: string;
  region: string;
  city: string;
  headline?: string;
  categories?: string[];
  skills?: string[];
  links?: { platform: string; url: string }[];
}

const PEOPLE: SeedUser[] = [
  {
    username: "maria_santos",
    displayName: "Maria Santos",
    role: "client",
    bio: "Planning a wedding in Cebu and looking for handmade pieces that will last longer than the day itself.",
    region: "Region VII — Central Visayas",
    city: "Cebu City",
  },
  {
    username: "paolo_cruz",
    displayName: "Paolo Cruz",
    role: "client",
    bio: "I run a small coffee shop in Quezon City. I would rather commission local makers than order another container of imported stock.",
    region: "National Capital Region (NCR)",
    city: "Quezon City",
  },
  {
    username: "ana_weaves",
    displayName: "Ana Reyes",
    role: "artist",
    bio: "Third-generation handloom weaver. I work on my grandmother's loom and dye with natural indigo grown behind the house.",
    region: "Region I — Ilocos Region",
    city: "Vigan",
    headline: "Handwoven inabel from Ilocos Sur",
    categories: ["weaving"],
    skills: ["inabel", "natural indigo", "backstrap loom"],
    links: [
      { platform: "facebook", url: "https://facebook.com/example-anaweaves" },
      { platform: "instagram", url: "https://instagram.com/example-anaweaves" },
    ],
  },
  {
    username: "malou_hooks",
    displayName: "Malou Bautista",
    role: "artist",
    bio: "I crochet flowers that do not wilt. Bridal bouquets, boutonnieres, and the occasional very serious amigurumi.",
    region: "Region IV-A — CALABARZON",
    city: "Lipa",
    headline: "Crochet florals and amigurumi",
    categories: ["crochet", "knitting"],
    skills: ["amigurumi", "bridal bouquets", "cotton yarn"],
    links: [{ platform: "tiktok", url: "https://tiktok.com/@example-malouhooks" }],
  },
  {
    username: "kirby_clay",
    displayName: "Kirby Tan",
    role: "artist",
    bio: "Stoneware for people who actually use their cups. Wheel-thrown, high-fired, dishwasher safe.",
    region: "Region VII — Central Visayas",
    city: "Cebu City",
    headline: "Wheel-thrown stoneware, made to be used",
    categories: ["pottery"],
    skills: ["stoneware", "glazing", "wheel throwing"],
    links: [{ platform: "instagram", url: "https://instagram.com/example-kirbyclay" }],
  },
  {
    username: "rosa_stitch",
    displayName: "Rosa Delgado",
    role: "artist",
    bio: "Calado and hand embroidery on piña and jusi. I learned from my mother in Lumban and have been at it for twenty-two years.",
    region: "Region IV-A — CALABARZON",
    city: "Lumban",
    headline: "Calado and hand embroidery on piña",
    categories: ["embroidery", "stitch-art"],
    skills: ["calado", "barong embroidery", "pina fabric"],
  },
];

const CRAFT_COLORS: Record<string, [string, string]> = {
  weaving: ["#3E5C6B", "#8FA9B5"],
  crochet: ["#4A6070", "#C7D3D9"],
  pottery: ["#A85434", "#E3BFA9"],
  embroidery: ["#6B4A72", "#CDB5D2"],
  painting: ["#6E5138", "#D3BCA6"],
};

export async function runSeed(log: (message: string) => void = console.log): Promise<void> {
  if (config.isProduction) {
    throw new Error("Seeding is disabled when NODE_ENV=production.");
  }

  const existing = await db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM users`);
  if (Number(existing?.cnt ?? 0) > 0) {
    log("Users already exist. Run `pnpm db:reset` first if you want a clean seed.");
    return;
  }

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const ids = new Map<string, string>();

  log("Creating people...");
  for (const person of PEOPLE) {
    const id = await withTransaction((tx) =>
      usersRepo.createUser(
        {
          email: `${person.username}@example.com`,
          username: person.username,
          passwordHash,
          role: person.role,
          displayName: person.displayName,
        },
        tx,
      ),
    );
    ids.set(person.username, id);

    const [color, accent] = CRAFT_COLORS[person.categories?.[0] ?? "painting"] ?? [
      "#5C6661",
      "#C9CFCC",
    ];
    const avatarId = await seedImage(id, color, accent);
    const coverId = await seedImage(id, accent, color);

    await profilesRepo.updateProfile(id, {
      bio: person.bio,
      region: person.region,
      city: person.city,
      avatarImageId: avatarId,
      coverImageId: coverId,
    });

    if (person.role === "artist") {
      await withTransaction(async (tx) => {
        await profilesRepo.updateArtistProfile(
          id,
          { headline: person.headline ?? null, acceptingCommissions: true },
          tx,
        );
        if (person.categories) {
          await profilesRepo.setCategories(id, person.categories, tx);
        }
        if (person.skills) await profilesRepo.setSkills(id, person.skills, tx);
        if (person.links) await profilesRepo.setLinks(id, person.links, tx);
      });
    }
  }

  log("Creating portfolio pieces...");
  const portfolio: { artist: string; caption: string; category: string }[] = [
    { artist: "ana_weaves", caption: "Inabel table runner in indigo and undyed cotton", category: "weaving" },
    { artist: "ana_weaves", caption: "Binakol blanket, four-yard panel", category: "weaving" },
    { artist: "malou_hooks", caption: "Crochet bridal bouquet in white and dusty blue", category: "crochet" },
    { artist: "malou_hooks", caption: "Amigurumi carabao, about 20cm tall", category: "crochet" },
    { artist: "malou_hooks", caption: "Boutonniere set for a Tagaytay wedding", category: "crochet" },
    { artist: "kirby_clay", caption: "Stoneware mugs, ash glaze, set of six", category: "pottery" },
    { artist: "kirby_clay", caption: "Wide serving bowl in matte oatmeal", category: "pottery" },
    { artist: "rosa_stitch", caption: "Calado panel on piña, sampaguita motif", category: "embroidery" },
    { artist: "rosa_stitch", caption: "Hand-embroidered barong front, jusi", category: "embroidery" },
  ];

  const postIds = new Map<string, string[]>();
  for (const piece of portfolio) {
    const artistId = ids.get(piece.artist)!;
    const [color, accent] = CRAFT_COLORS[piece.category] ?? ["#5C6661", "#C9CFCC"];
    const imageId = await seedImage(artistId, color, accent);
    const postId = newId();

    await withTransaction(async (tx) => {
      await postsRepo.insertPost(
        { id: postId, artistId, caption: piece.caption, categorySlug: piece.category },
        tx,
      );
      await postsRepo.attachImages(postId, [imageId], tx);
    });

    postIds.set(piece.artist, [...(postIds.get(piece.artist) ?? []), postId]);
  }

  log("Creating craft requests...");
  const requests = [
    {
      client: "maria_santos",
      title: "Custom crochet wedding bouquet",
      description:
        "I want a handmade crochet bouquet for my wedding in March. White roses with light blue accents, about 25cm across, with a wrapped handle in matching ribbon. I would like two smaller bridesmaid bouquets to match if that is possible within budget.",
      category: "crochet",
      min: 150_000,
      requirements: "Delivery to Cebu City. Cotton yarn preferred, nothing that sheds.",
    },
    {
      client: "maria_santos",
      title: "Handwoven inabel table runner for the reception",
      description:
        "Looking for a woven runner for the long reception table, roughly 3 metres by 40cm. Natural indigo with undyed cotton stripes would suit the venue. Happy to talk through the pattern.",
      category: "weaving",
      min: 250_000,
    },
    {
      client: "paolo_cruz",
      title: "Stoneware mug set for a small cafe",
      description:
        "We need twenty-four mugs for the shop, around 250ml, stackable if possible. They will go through a commercial dishwasher several times a day so they need to be properly high-fired. Matte glaze, earthy colours.",
      category: "pottery",
      min: 400_000,
      requirements: "Quote per mug as well as the full set. Pickup in Quezon City is fine.",
    },
    {
      client: "paolo_cruz",
      title: "Embroidered barong panel for a family occasion",
      description:
        "Hand-embroidered front panel on jusi for a barong, traditional calado work. This is for my father's 70th so I would rather it be done properly than quickly.",
      category: "embroidery",
      min: 600_000,
    },
  ];

  const postingIds: string[] = [];
  for (const request of requests) {
    const clientId = ids.get(request.client)!;
    const [color, accent] = CRAFT_COLORS[request.category] ?? ["#5C6661", "#C9CFCC"];
    const imageIds = [
      await seedImage(clientId, color, accent),
      await seedImage(clientId, accent, color),
    ];
    const postingId = newId();

    await withTransaction(async (tx) => {
      await postingsRepo.insertPosting(
        {
          id: postingId,
          clientId,
          title: request.title,
          description: request.description,
          categorySlug: request.category,
          minBudgetCentavos: request.min,
          ...(request.requirements ? { requirements: request.requirements } : {}),
        },
        tx,
      );
      await postingsRepo.attachImages(postingId, imageIds, tx);
    });
    postingIds.push(postingId);
  }

  log("Creating bids...");
  const bids = [
    { posting: 0, artist: "malou_hooks", price: 180_000, letter: "I have made eleven bridal bouquets in this style, including two with the same blue you described. For the bouquet plus two bridesmaid bouquets I would use mercerised cotton so it holds shape and does not shed. About three weeks from confirmation." },
    { posting: 0, artist: "rosa_stitch", price: 165_000, letter: "Crochet is not my main craft but I have done floral work for barong details for years. I would be glad to take this on if you want the accents hand-embroidered rather than crocheted." },
    { posting: 1, artist: "ana_weaves", price: 280_000, letter: "A three-metre runner is two panels joined at the selvedge on my loom. Natural indigo with undyed stripes is exactly what I dye for. Four weeks, because the indigo needs its dips." },
    { posting: 2, artist: "kirby_clay", price: 456_000, letter: "Twenty-four stackable mugs at ₱190 each. High-fired stoneware at cone 10, so they will take a commercial dishwasher without crazing. Six weeks for a run this size." },
  ];

  const applicationIds: string[] = [];
  for (const bid of bids) {
    const artistId = ids.get(bid.artist)!;
    const postingId = postingIds[bid.posting]!;
    const applicationId = newId();
    const posting = await postingsRepo.findOwnership(postingId);

    await withTransaction(async (tx) => {
      await applicationsRepo.insertApplication(
        {
          id: applicationId,
          postingId,
          artistId,
          proposedPriceCentavos: bid.price,
          minPriceAtApplyCentavos: posting!.minBudgetCentavos,
          coverLetter: bid.letter,
        },
        tx,
      );
      await applicationsRepo.attachSamples(
        applicationId,
        (postIds.get(bid.artist) ?? []).slice(0, 2),
        artistId,
        tx,
      );
    });
    applicationIds.push(applicationId);
  }

  log("Completing one commission so reviews have something to attach to...");
  // Ana's runner: accepted, delivered, and reviewed by both sides.
  const acceptedApplication = applicationIds[2]!;
  const runnerPosting = postingIds[1]!;
  const commissionId = newId();

  await withTransaction(async (tx) => {
    await applicationsRepo.setStatus(acceptedApplication, "accepted", tx);
    await postingsRepo.rejectPendingApplications(runnerPosting, tx, acceptedApplication);
    await commissionsRepo.insertCommission(
      {
        id: commissionId,
        postingId: runnerPosting,
        applicationId: acceptedApplication,
        clientId: ids.get("maria_santos")!,
        artistId: ids.get("ana_weaves")!,
        agreedPriceCentavos: 280_000,
      },
      tx,
    );
    await postingsRepo.setStatus(runnerPosting, "in_progress", tx);
    await commissionsRepo.complete(commissionId, tx);
    await postingsRepo.setStatus(runnerPosting, "completed", tx);

    await reviewsRepo.insertReview(
      {
        id: newId(),
        commissionId,
        reviewerId: ids.get("maria_santos")!,
        revieweeId: ids.get("ana_weaves")!,
        rating: 5,
        body: "The runner is better than the photos I sent as reference. Ana sent progress pictures at each stage and it arrived a week early. The indigo is deep and even.",
      },
      tx,
    );
    await reviewsRepo.insertReview(
      {
        id: newId(),
        commissionId,
        reviewerId: ids.get("ana_weaves")!,
        revieweeId: ids.get("maria_santos")!,
        rating: 5,
        body: "Maria knew what she wanted and said so clearly, which makes the weaving easy. Paid on delivery without being asked.",
      },
      tx,
    );
  });

  // A pending bid on the crochet bouquet so the review screen has content.
  await db.run(
    `UPDATE applications SET status = 'pending' WHERE id = :id`,
    { id: uuidToBuf(applicationIds[0]!) },
  );

  log("");
  log(`Seeded ${PEOPLE.length} people, ${portfolio.length} portfolio pieces,`);
  log(`${requests.length} craft requests, ${bids.length} bids, 1 completed commission.`);
  log("");
  log(`Sign in as any of these with the password: ${SEED_PASSWORD}`);
  for (const person of PEOPLE) {
    log(`  ${person.username}@example.com  (${person.role})`);
  }
}
