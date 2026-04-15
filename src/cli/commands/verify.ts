import { loadConfig } from "../config.js";
import { buildStorage } from "../bootstrap.js";
import { verifyChain } from "../../logging/hash-chain.js";

export interface VerifyOptions {
  config: string;
  from?: string;
  to?: string;
}

export async function runVerify(opts: VerifyOptions): Promise<void> {
  const cfg = loadConfig(opts.config);
  const storage = await buildStorage(cfg);
  const records = await Promise.resolve(
    storage.query({ from: opts.from, to: opts.to, limit: 1_000_000 }),
  );
  await Promise.resolve(storage.close());

  const result = verifyChain(records);
  if (result.ok) {
    process.stdout.write(
      `\u2713 ${result.verified} records verified, hash chain intact\n`,
    );
    return;
  }
  process.stdout.write(
    `\u2717 verification failed after ${result.verified} records\n`,
  );
  if (result.brokenAt) {
    process.stdout.write(`  first bad record: ${result.brokenAt}\n`);
  }
  if (result.reason) {
    process.stdout.write(`  reason: ${result.reason}\n`);
  }
  process.exitCode = 1;
}
