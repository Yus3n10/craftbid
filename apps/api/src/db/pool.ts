import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import oracledb from "oracledb";
import { config } from "../config.js";
import { materialiseWallet } from "./wallet.js";

/**
 * node-oracledb runs in Thin mode by default from v6 onward, so no Oracle
 * Instant Client is required — which is what makes deploying to a plain free
 * container host possible at all.
 */

// CLOBs come back as strings rather than streams. Descriptions and cover
// letters are small text; streaming them would complicate every read for no
// benefit.
oracledb.fetchAsString = [oracledb.CLOB];
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let pool: oracledb.Pool | undefined;

/**
 * Fails fast when the wallet is encrypted but no password was supplied.
 *
 * Without this the symptom is NJS-505 ("unable to initiate TLS connection")
 * after about a minute of silence, on the first query rather than at startup,
 * because a pool with poolMin 0 connects lazily. Naming the missing variable
 * up front turns an hour of guesswork into one line of log.
 */
function assertWalletNeedsNoPassword(walletDir: string): void {
  const pem = join(walletDir, "ewallet.pem");
  if (!existsSync(pem)) return;

  if (readFileSync(pem, "utf8").includes("ENCRYPTED PRIVATE KEY")) {
    throw new Error(
      "ewallet.pem is an encrypted private key but ORACLE_WALLET_PASSWORD is not set. " +
        "Set it to the password chosen when the wallet was downloaded from the OCI console.",
    );
  }
}

export async function initPool(): Promise<oracledb.Pool> {
  if (pool) return pool;

  const attributes: oracledb.PoolAttributes = {
    user: config.db.user,
    password: config.db.password,
    connectString: config.db.connectString,
    poolMin: config.db.poolMin,
    poolMax: config.db.poolMax,
    poolIncrement: 1,
    // Free hosts idle the process out; holding dead connections open across a
    // sleep produces confusing ORA-03113 errors on the next request.
    poolTimeout: 60,
    queueTimeout: 15_000,
  };

  // Autonomous Database connects over mTLS. In Thin mode the wallet must be a
  // PEM file (ewallet.pem); cwallet.sso is Thick-mode only.
  //
  // A local path is used when given. Otherwise, on a host that offers only
  // environment variables, the wallet is written out from them at startup.
  const walletDir = config.db.walletDir ?? materialiseWallet();

  if (walletDir) {
    attributes.configDir = walletDir;
    attributes.walletLocation = walletDir;
    if (config.db.walletPassword) {
      attributes.walletPassword = config.db.walletPassword;
    } else {
      assertWalletNeedsNoPassword(walletDir);
    }
  }

  pool = await oracledb.createPool(attributes);
  return pool;
}

export function getPool(): oracledb.Pool {
  if (!pool) {
    throw new Error("Database pool not initialised. Call initPool() first.");
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  // Give in-flight requests a moment rather than severing them mid-statement.
  await pool.close(10);
  pool = undefined;
}

export { oracledb };
