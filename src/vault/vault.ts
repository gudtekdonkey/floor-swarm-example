// The vault: one encrypted file per swarm holding its HD mnemonic and imported keys. scrypt → AES-256-GCM,
// unlocked with a passphrase. Keys live in memory only while the process runs; nothing here logs or returns a secret by name.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { parseSolSecret, solFromMnemonic, solSigner, type SolSigner } from "./sol-keys.ts";

interface Secrets {
  mnemonic: string | null;
  /** Imported keys by key id: an EVM key, or a Solana ed25519 seed (hex). */
  keys: ({ id: number; evm: `0x${string}`; sol?: undefined } | { id: number; sol: string; evm?: undefined })[];
}

interface Sealed {
  v: 1;
  kdf: { salt: string; N: number; r: number; p: number };
  iv: string;
  tag: string;
  ct: string;
}

const KDF = { N: 1 << 15, r: 8, p: 1 };

function seal(s: Secrets, pass: string): Sealed {
  const salt = randomBytes(16);
  const key = scryptSync(pass, salt, 32, { ...KDF, maxmem: 64 * 1024 * 1024 });
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(s), "utf8"), c.final()]);
  return { v: 1, kdf: { salt: salt.toString("hex"), ...KDF }, iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex"), ct: ct.toString("hex") };
}

function unseal(x: Sealed, pass: string): Secrets {
  const key = scryptSync(pass, Buffer.from(x.kdf.salt, "hex"), 32, { N: x.kdf.N, r: x.kdf.r, p: x.kdf.p, maxmem: 64 * 1024 * 1024 });
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(x.iv, "hex"));
  d.setAuthTag(Buffer.from(x.tag, "hex"));
  try {
    return JSON.parse(Buffer.concat([d.update(Buffer.from(x.ct, "hex")), d.final()]).toString("utf8")) as Secrets;
  } catch {
    throw new Error("wrong passphrase (or the vault file is damaged)");
  }
}

/** Where a wallet's key comes from: the swarm's HD seed at an index, or an imported key by id. */
export type KeyRef = { source: "hd"; index: number } | { source: "key"; keyId: number };

export class Vault {
  private readonly path: string;
  private readonly pass: string;
  private secrets: Secrets;

  private constructor(path: string, pass: string, secrets: Secrets) {
    this.path = path;
    this.pass = pass;
    this.secrets = secrets;
  }

  static exists(path: string): boolean {
    return existsSync(path);
  }

  static create(path: string, pass: string, opts: { mnemonic?: string } = {}): Vault {
    if (existsSync(path)) throw new Error(`a vault already exists at ${path}`);
    if (pass.length < 8) throw new Error("the passphrase needs at least 8 characters");
    const v = new Vault(path, pass, { mnemonic: opts.mnemonic?.trim() ?? generateMnemonic(english), keys: [] });
    mnemonicToAccount(v.secrets.mnemonic!); // refuses a bad mnemonic before anything is written
    v.save();
    return v;
  }

  static open(path: string, pass: string): Vault {
    return new Vault(path, pass, unseal(JSON.parse(readFileSync(path, "utf8")) as Sealed, pass));
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(seal(this.secrets, this.pass)), { mode: 0o600 });
  }

  /** Imports a raw EVM key; returns its key id. The same key twice returns the first id. */
  importEvmKey(hex: string): { keyId: number; address: string } {
    const k = (hex.startsWith("0x") ? hex : `0x${hex}`).toLowerCase() as `0x${string}`;
    const address = privateKeyToAccount(k).address;
    const had = this.secrets.keys.find((x) => x.evm === k);
    if (had) return { keyId: had.id, address };
    const keyId = this.secrets.keys.reduce((m, x) => Math.max(m, x.id + 1), 0);
    this.secrets.keys.push({ id: keyId, evm: k });
    this.save();
    return { keyId, address };
  }

  /** Imports a Solana secret (`solana-keygen` JSON, base58 or a 32-byte seed); returns its key id. The same key twice returns the first id. */
  importSolKey(secret: string): { keyId: number; address: string } {
    const seed = Buffer.from(parseSolSecret(secret)).toString("hex");
    const address = solSigner(Buffer.from(seed, "hex")).address;
    const had = this.secrets.keys.find((x) => x.sol === seed);
    if (had) return { keyId: had.id, address };
    const keyId = this.secrets.keys.reduce((m, x) => Math.max(m, x.id + 1), 0);
    this.secrets.keys.push({ id: keyId, sol: seed });
    this.save();
    return { keyId, address };
  }

  /** The ref's EVM account, or null for an imported Solana key. */
  evmAccountOrNull(ref: KeyRef): LocalAccount | null {
    if (ref.source === "key" && this.secrets.keys.find((x) => x.id === ref.keyId)?.sol) return null;
    return this.evmAccount(ref);
  }

  /** The ref's Solana signer (HD: `m/44'/501'/i'/0'`), or null for an imported EVM key. */
  solSigner(ref: KeyRef): SolSigner | null {
    if (ref.source === "hd") {
      if (!this.secrets.mnemonic) throw new Error("this swarm has no HD seed");
      return solFromMnemonic(this.secrets.mnemonic, ref.index);
    }
    const k = this.secrets.keys.find((x) => x.id === ref.keyId);
    if (!k) throw new Error(`no imported key ${ref.keyId}`);
    return k.sol ? solSigner(Buffer.from(k.sol, "hex")) : null;
  }

  evmAccount(ref: KeyRef): LocalAccount {
    if (ref.source === "hd") {
      if (!this.secrets.mnemonic) throw new Error("this swarm has no HD seed");
      return mnemonicToAccount(this.secrets.mnemonic, { addressIndex: ref.index });
    }
    const k = this.secrets.keys.find((x) => x.id === ref.keyId);
    if (!k) throw new Error(`no imported key ${ref.keyId}`);
    if (!k.evm) throw new Error(`key ${ref.keyId} is a Solana key`);
    return privateKeyToAccount(k.evm);
  }
}
