import oracledb from "oracledb";
import { config } from "../config.js";

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
  // PEM file (ewallet.pem) — cwallet.sso is Thick-mode only.
  if (config.db.walletDir) {
    attributes.configDir = config.db.walletDir;
    attributes.walletLocation = config.db.walletDir;
    if (config.db.walletPassword) {
      attributes.walletPassword = config.db.walletPassword;
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
