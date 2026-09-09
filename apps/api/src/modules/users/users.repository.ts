import type { UserRole, UserStatus } from "@craftbid/shared";
import { bufToUuid, newId, uuidToBuf } from "../../db/ids.js";
import { db, type Queryable } from "../../db/query.js";

export interface UserRecord {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  displayName: string;
  bio?: string;
  region?: string;
  city?: string;
  avatarImageId: string | null;
  coverImageId: string | null;
  status: UserStatus;
  createdAt: Date;
}

interface UserRow {
  id: Buffer;
  email: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  displayName: string;
  bio: string | null;
  region: string | null;
  city: string | null;
  avatarImageId: Buffer | null;
  coverImageId: Buffer | null;
  status: UserStatus;
  createdAt: Date;
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: bufToUuid(row.id)!,
    email: row.email,
    username: row.username,
    passwordHash: row.passwordHash,
    role: row.role,
    displayName: row.displayName,
    ...(row.bio ? { bio: row.bio } : {}),
    ...(row.region ? { region: row.region } : {}),
    ...(row.city ? { city: row.city } : {}),
    avatarImageId: bufToUuid(row.avatarImageId),
    coverImageId: bufToUuid(row.coverImageId),
    status: row.status,
    createdAt: row.createdAt,
  };
}

const SELECT_USER = `
  SELECT id, email, username, password_hash, role, display_name, bio,
         region, city, avatar_image_id, cover_image_id, status, created_at
    FROM users
`;

export async function findByEmail(
  email: string,
  q: Queryable = db,
): Promise<UserRecord | null> {
  const row = await q.one<UserRow>(`${SELECT_USER} WHERE email = :email`, {
    email: email.toLowerCase(),
  });
  return row ? mapUser(row) : null;
}

export async function findById(
  id: string,
  q: Queryable = db,
): Promise<UserRecord | null> {
  const row = await q.one<UserRow>(`${SELECT_USER} WHERE id = :id`, {
    id: uuidToBuf(id),
  });
  return row ? mapUser(row) : null;
}

export async function findByUsername(
  username: string,
  q: Queryable = db,
): Promise<UserRecord | null> {
  const row = await q.one<UserRow>(`${SELECT_USER} WHERE username = :username`, {
    username: username.toLowerCase(),
  });
  return row ? mapUser(row) : null;
}

export interface CreateUserInput {
  email: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  displayName: string;
}

/**
 * Creates the user and, for an artist, the 1:1 profile row that goes with it.
 * Both happen in the caller's transaction so an artist can never exist without
 * the profile every artist page expects to find.
 */
export async function createUser(
  input: CreateUserInput,
  tx: Queryable,
): Promise<string> {
  const id = newId();

  await tx.run(
    `INSERT INTO users (id, email, username, password_hash, role, display_name)
     VALUES (:id, :email, :username, :passwordHash, :role, :displayName)`,
    {
      id: uuidToBuf(id),
      email: input.email.toLowerCase(),
      username: input.username.toLowerCase(),
      passwordHash: input.passwordHash,
      role: input.role,
      displayName: input.displayName,
    },
  );

  if (input.role === "artist") {
    await tx.run(`INSERT INTO artist_profiles (user_id) VALUES (:id)`, {
      id: uuidToBuf(id),
    });
  }

  return id;
}

export async function touchUpdatedAt(id: string, q: Queryable = db): Promise<void> {
  await q.run(`UPDATE users SET updated_at = SYSTIMESTAMP WHERE id = :id`, {
    id: uuidToBuf(id),
  });
}
