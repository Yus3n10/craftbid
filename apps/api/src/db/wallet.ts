import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Materialises an Autonomous Database wallet from the environment.
 *
 * A wallet is a set of files, but free hosts only offer environment variables,
 * and the files must never be committed. So the two that Thin mode actually
 * needs travel base64-encoded and are written to a temporary directory at
 * startup.
 *
 * Only two files are needed, which is why this ships them individually rather
 * than unzipping the wallet archive:
 *   - `tnsnames.ora`, to resolve the TNS alias in ORACLE_CONNECT_STRING
 *   - `ewallet.pem`, the PEM-format wallet Thin mode requires
 *
 * `cwallet.sso` is Thick-mode only and is deliberately not supported here.
 *
 * The directory is created with mode 0700 under the system temp directory, so
 * it lives on the container's ephemeral disk and disappears with the process.
 */
export function materialiseWallet(): string | undefined {
  const tnsnames = process.env.ORACLE_TNSNAMES_B64;
  const ewallet = process.env.ORACLE_EWALLET_PEM_B64;

  if (!tnsnames && !ewallet) return undefined;

  if (!tnsnames || !ewallet) {
    throw new Error(
      "Both ORACLE_TNSNAMES_B64 and ORACLE_EWALLET_PEM_B64 must be set, or neither. " +
        "Thin mode needs tnsnames.ora to resolve the alias and ewallet.pem to authenticate.",
    );
  }

  const dir = mkdtempSync(join(tmpdir(), "craftbid-wallet-"));

  writeFileSync(join(dir, "tnsnames.ora"), Buffer.from(tnsnames, "base64"), {
    mode: 0o600,
  });
  writeFileSync(join(dir, "ewallet.pem"), Buffer.from(ewallet, "base64"), {
    mode: 0o600,
  });

  return dir;
}
