// Solana keys from Node's own crypto (no new dependency): BIP-39 seed → SLIP-0010 ed25519 at m/44'/501'/i'/0' (the path
// Phantom and `solana-keygen --derivation-path` use), and an ed25519 key object that signs a message.
import { createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, pbkdf2Sync, sign, type KeyObject } from "node:crypto";
import { base58Decode, base58Encode } from "../../vendor/floor-sdk/codec.ts";

/** A Solana signer: its address and a detached ed25519 signature over a message. */
export interface SolSigner {
  address: string;
  sign(message: Uint8Array): Uint8Array;
}

// PKCS#8 for a raw 32-byte ed25519 seed (RFC 8410)
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");
const HARDENED = 0x80000000;

export const bip39Seed = (mnemonic: string, passphrase = ""): Buffer => pbkdf2Sync(mnemonic.normalize("NFKD"), `mnemonic${passphrase}`.normalize("NFKD"), 2048, 64, "sha512");

/** SLIP-0010 ed25519: every index hardened. */
export function slip10Ed25519(seed: Uint8Array, path: readonly number[]): Buffer {
  let i = createHmac("sha512", "ed25519 seed").update(seed).digest();
  for (const idx of path) {
    const data = Buffer.alloc(37);
    i.copy(data, 1, 0, 32);
    data.writeUInt32BE((idx | HARDENED) >>> 0, 33);
    i = createHmac("sha512", i.subarray(32)).update(data).digest();
  }
  return i.subarray(0, 32);
}

export const solPath = (index: number): number[] => [44, 501, index, 0];

function keyObject(seed32: Uint8Array): KeyObject {
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(seed32)]), format: "der", type: "pkcs8" });
}

export function solSigner(seed32: Uint8Array): SolSigner {
  if (seed32.length !== 32) throw new Error("an ed25519 seed is 32 bytes");
  const k = keyObject(seed32);
  const pub = (createPublicKey(k).export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
  return { address: base58Encode(pub), sign: (m) => new Uint8Array(sign(null, m, k)) };
}

export const solFromMnemonic = (mnemonic: string, index: number): SolSigner => solSigner(slip10Ed25519(bip39Seed(mnemonic), solPath(index)));

/** A fresh throwaway key (a launch's base mint signs its own create once). */
export function freshSolSigner(): SolSigner {
  const { privateKey } = generateKeyPairSync("ed25519");
  const der = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  return solSigner(der.subarray(-32));
}

/**
 * A pasted Solana secret: a `solana-keygen` JSON array or base58 of the 64-byte secret key (seed ‖ public key), checked
 * against its own public half; or base58 / hex of a bare 32-byte seed. Returns the 32-byte seed.
 */
export function parseSolSecret(s: string): Uint8Array {
  const t = s.trim();
  let b: Uint8Array;
  if (t.startsWith("[")) b = Uint8Array.from(JSON.parse(t) as number[]);
  else if (/^(0x)?[0-9a-fA-F]{64}$/.test(t)) b = Buffer.from(t.replace(/^0x/, ""), "hex");
  else b = base58Decode(t);
  if (b.length === 64) {
    const seed = b.subarray(0, 32);
    if (solSigner(seed).address !== base58Encode(b.subarray(32))) throw new Error("the secret key's public half does not match its seed");
    return Uint8Array.from(seed);
  }
  if (b.length === 32) return Uint8Array.from(b);
  throw new Error(`a Solana secret is 64 bytes (or a 32-byte seed), this is ${b.length}`);
}
