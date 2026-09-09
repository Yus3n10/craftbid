import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

// One .env at the repo root serves every workspace package. Resolved relative
// to this module rather than the working directory, because pnpm runs scripts
// with the package as cwd and the file lives two levels above it. Works
// identically from src/ under tsx and from dist/ after a build.
//
// ENV_FILE selects a different one, which is how a command can be pointed at
// the cloud database without editing the file local development uses. Mixing
// the two in one file is how someone ends up running a migration, or a reset,
// against production while believing they are on their laptop.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(repoRoot, process.env.ENV_FILE ?? ".env") });

/**
 * Configuration is validated once at startup and the process refuses to boot on
 * anything invalid. A marketplace that starts with a placeholder JWT secret and
 * only discovers it under load is worse than one that will not start at all.
 */

const isProduction = process.env.NODE_ENV === "production";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default("0.0.0.0"),

    ORACLE_USER: z.string().min(1),
    ORACLE_PASSWORD: z.string().min(1),
    ORACLE_CONNECT_STRING: z.string().min(1),
    /** Set only when targeting Autonomous Database. Must live outside the repo. */
    ORACLE_WALLET_DIR: z.string().optional(),
    ORACLE_WALLET_PASSWORD: z.string().optional(),
    ORACLE_POOL_MIN: z.coerce.number().int().min(0).default(0),
    ORACLE_POOL_MAX: z.coerce.number().int().min(1).default(4),

    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    ACCESS_TOKEN_TTL: z.string().default("15m"),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),

    CORS_ORIGINS: z.string().default("http://localhost:5173"),

    STORAGE_DRIVER: z.enum(["local", "imagekit"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default(".storage"),
    STORAGE_PUBLIC_BASE_URL: z.string().default("http://localhost:4000/media"),
    IMAGEKIT_PUBLIC_KEY: z.string().optional(),
    IMAGEKIT_PRIVATE_KEY: z.string().optional(),
    IMAGEKIT_URL_ENDPOINT: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "imagekit") {
      for (const key of [
        "IMAGEKIT_PUBLIC_KEY",
        "IMAGEKIT_PRIVATE_KEY",
        "IMAGEKIT_URL_ENDPOINT",
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=imagekit`,
          });
        }
      }
    }

    // The local driver writes to a container filesystem that is wiped on every
    // deploy and is not shared between instances. Silently losing every
    // uploaded image in production is not an acceptable failure mode.
    if (isProduction && env.STORAGE_DRIVER === "local") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_DRIVER"],
        message:
          "STORAGE_DRIVER=local cannot be used in production: hosts like Render have ephemeral disks and uploads would be lost on restart.",
      });
    }

    if (isProduction && env.JWT_SECRET.includes("replace-me")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_SECRET"],
        message: "JWT_SECRET is still the example placeholder.",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and fill it in.`,
  );
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  server: {
    port: env.PORT,
    host: env.HOST,
  },
  db: {
    user: env.ORACLE_USER,
    password: env.ORACLE_PASSWORD,
    connectString: env.ORACLE_CONNECT_STRING,
    walletDir: env.ORACLE_WALLET_DIR,
    walletPassword: env.ORACLE_WALLET_PASSWORD,
    poolMin: env.ORACLE_POOL_MIN,
    poolMax: env.ORACLE_POOL_MAX,
  },
  auth: {
    jwtSecret: new TextEncoder().encode(env.JWT_SECRET),
    accessTokenTtl: env.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  },
  corsOrigins: env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  storage: {
    driver: env.STORAGE_DRIVER,
    localDir: env.STORAGE_LOCAL_DIR,
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, ""),
    imagekit: {
      publicKey: env.IMAGEKIT_PUBLIC_KEY,
      privateKey: env.IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: env.IMAGEKIT_URL_ENDPOINT,
    },
  },
} as const;

export type Config = typeof config;
