import {
  generateKeyPairSync,
  sign,
  verify,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface Signature {
  algorithm: "ed25519";
  publicKey: string;
  signature: string;
  signedAt: string;
  byteLength: number;
}

const DEFAULT_KEY_PATH = "./keys/export.key";

/**
 * Ensures an Ed25519 keypair exists at `keyPath`. Generates one on first use.
 * Private key is stored unencrypted — deployments should wrap this with
 * filesystem ACLs or a KMS-backed key.
 */
export function ensureKeyPair(keyPath?: string): {
  privatePem: string;
  publicPem: string;
  path: string;
} {
  const path = resolve(keyPath ?? DEFAULT_KEY_PATH);
  if (existsSync(path)) {
    const bundle = JSON.parse(readFileSync(path, "utf8")) as {
      privateKey: string;
      publicKey: string;
    };
    return {
      privatePem: bundle.privateKey,
      publicPem: bundle.publicKey,
      path,
    };
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ privateKey: privatePem, publicKey: publicPem }, null, 2),
    { mode: 0o600 },
  );
  return { privatePem, publicPem, path };
}

/**
 * Signs an export body with an Ed25519 keypair. Returns a JSON-friendly
 * signature blob suitable for writing next to the export file.
 */
export function signExport(body: string, keyPath?: string): Signature {
  const { privatePem, publicPem } = ensureKeyPair(keyPath);
  const key = createPrivateKey(privatePem);
  const sig = sign(null, Buffer.from(body, "utf8"), key);
  return {
    algorithm: "ed25519",
    publicKey: publicPem,
    signature: sig.toString("base64"),
    signedAt: new Date().toISOString(),
    byteLength: Buffer.byteLength(body, "utf8"),
  };
}

export function verifyExport(body: string, signature: Signature): boolean {
  try {
    const key = createPublicKey(signature.publicKey);
    return verify(
      null,
      Buffer.from(body, "utf8"),
      key,
      Buffer.from(signature.signature, "base64"),
    );
  } catch {
    return false;
  }
}
