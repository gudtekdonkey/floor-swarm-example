// One swarm: its home directory (vault, store, chains), unlocked once per process.
import { join } from "node:path";
import { formatUnits, parseUnits } from "viem";
import type { LocalAccount } from "viem/accounts";
import { Store, type WalletRow } from "./store/db.ts";
import { Vault } from "./vault/vault.ts";
import { loadChains, saveChains, type ChainConfig } from "./chains/config.ts";
import { EvmChain, NATIVE } from "./chains/evm.ts";
import { SolanaChain } from "./chains/solana.ts";
import type { Chain, Keys, LaunchRef } from "./chains/chain.ts";
import type { SolSigner } from "./vault/sol-keys.ts";
import type { Bands } from "./plan/plan.ts";

export const swarmHome = (): string => process.env.SWARM_HOME ?? join(process.cwd(), "data");

/** The general settings' keys. The per-wallet band is per unit: `<chain>:<quote or token address | native>`. */
const WSOL = "So11111111111111111111111111111111111111112";
export const perWalletKey = (chain: string, asset: string): string =>
  `per_wallet:${chain}:${asset === "native" || asset === WSOL || asset.toLowerCase() === NATIVE ? "native" : asset.startsWith("0x") ? asset.toLowerCase() : asset}`;
export const WALLETS_KEY = "wallets_per_command";

export interface HumanBand {
  min: string;
  max: string | null;
}

export class Swarm {
  readonly name: string;
  readonly dir: string;
  readonly store: Store;
  private vault: Vault | null = null;
  private readonly chainCache = new Map<string, Promise<Chain>>();
  private readonly accounts = new Map<number, LocalAccount | null>();
  private readonly solKeys = new Map<number, SolSigner | null>();
  /** What the chain adapters sign with. */
  readonly keys: Keys = { evm: (w) => this.account(w), sol: (w) => this.solSigner(w) };

  constructor(name: string, home = swarmHome()) {
    this.name = name;
    this.dir = join(home, name);
    this.store = new Store(join(this.dir, "swarm.db"));
  }

  get vaultPath(): string {
    return join(this.dir, "vault.json");
  }
  get chainsPath(): string {
    return join(this.dir, "chains.json");
  }

  hasVault(): boolean {
    return Vault.exists(this.vaultPath);
  }

  createVault(pass: string, mnemonic?: string): void {
    this.vault = Vault.create(this.vaultPath, pass, { mnemonic });
  }

  unlock(pass: string): void {
    this.vault = Vault.open(this.vaultPath, pass);
    // a store from before the Solana adapter: its HD wallets get their Solana address
    for (const w of this.store.wallets()) if (w.ref.source === "hd" && !w.sol) this.store.setSol(w.id, this.vault.solSigner(w.ref)!.address);
  }

  private v(): Vault {
    if (!this.vault) throw new Error("the vault is locked");
    return this.vault;
  }

  /** Derives `n` more HD wallets, tagged `groups`. */
  derive(n: number, groups: string[] = []): WalletRow[] {
    const start = this.store.nextHdIndex();
    return [...Array(n).keys()].map((k) => {
      const ref = { source: "hd" as const, index: start + k };
      return this.store.addWallet(ref, { evm: this.v().evmAccount(ref).address, sol: this.v().solSigner(ref)!.address }, groups);
    });
  }

  /** Imports a raw key: `0x…` (64 hex) is EVM; a `solana-keygen` JSON array or base58 secret is Solana. */
  importKey(secret: string, groups: string[] = []): WalletRow {
    const t = secret.trim();
    const evm = /^0x[0-9a-fA-F]{64}$/.test(t);
    const { keyId, address } = evm ? this.v().importEvmKey(t) : this.v().importSolKey(t);
    const w = this.store.addWallet({ source: "key", keyId }, evm ? { evm: address, sol: null } : { evm: null, sol: address }, groups);
    for (const g of groups) this.store.tag([w.id], g);
    return this.store.wallet(w.id)!;
  }

  /** The wallet's EVM account, or null when its key is Solana's. */
  account(w: WalletRow): LocalAccount | null {
    if (!this.accounts.has(w.id)) {
      const a = this.v().evmAccountOrNull(w.ref);
      if (a && a.address.toLowerCase() !== w.evm?.toLowerCase()) throw new Error(`wallet ${w.id}'s key does not match its address`);
      this.accounts.set(w.id, a);
    }
    return this.accounts.get(w.id)!;
  }

  solSigner(w: WalletRow): SolSigner | null {
    if (!this.solKeys.has(w.id)) this.solKeys.set(w.id, this.v().solSigner(w.ref));
    return this.solKeys.get(w.id)!;
  }

  // ---- chains -----------------------------------------------------------------------------------------------------------

  chains(): Record<string, ChainConfig> {
    return loadChains(this.chainsPath);
  }

  addChain(name: string, c: ChainConfig): void {
    saveChains(this.chainsPath, { ...this.chains(), [name]: c });
  }

  /** A chain, verified against the network rail once per process. */
  chain(name: string): Promise<Chain> {
    let p = this.chainCache.get(name);
    if (!p) {
      const cfg = this.chains()[name];
      if (!cfg) throw new Error(`no chain "${name}" (swarm chain add …)`);
      const c: Chain = cfg.family === "solana" ? new SolanaChain(name, cfg, this.keys) : new EvmChain(name, cfg, this.keys);
      p = c.verify().then(() => c);
      this.chainCache.set(name, p);
    }
    return p;
  }

  /**
   * A pasted address: `<chain>:<token>` goes straight to that chain; a bare `0x…` is probed on every EVM chain at once,
   * a bare base58 mint on every Solana chain.
   */
  async resolve(target: string): Promise<LaunchRef> {
    const t = target.trim();
    const m = /^([a-z0-9_-]+):(\S+)$/.exec(t);
    const all = this.chains();
    const token = m ? m[2]! : t;
    const family = /^0x[0-9a-fA-F]{40}$/.test(token) ? "evm" : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token) ? "solana" : null;
    if (!family) throw new Error(`"${target}" is not an EVM address or a Solana mint`);
    const names = m ? [m[1]!] : Object.keys(all).filter((n) => all[n]!.family === family);
    if (m && !all[m[1]!]) throw new Error(`no chain "${m[1]}"`);
    if (m && all[m[1]!]!.family !== family) throw new Error(`${token} is not a ${all[m[1]!]!.family === "evm" ? "EVM" : "Solana"} address`);
    const hits = (await Promise.all(names.map(async (n) => (await this.chain(n)).resolveToken(token).catch(() => null)))).filter((x): x is LaunchRef => x !== null);
    if (hits.length === 0) throw new Error(`${token} is not a FLOOR Program launch on ${names.join(", ")}`);
    if (hits.length > 1) throw new Error(`${token} is a launch on ${hits.map((h) => h.chain).join(" and ")}: name one, e.g. ${hits[0]!.chain}:${token}`);
    return hits[0]!;
  }

  // ---- settings ---------------------------------------------------------------------------------------------------------

  bands(chain: string, asset: string, decimals: number): Bands {
    const pw = this.store.getSetting<HumanBand>(perWalletKey(chain, asset));
    const w = this.store.getSetting<{ min: number; max: number }>(WALLETS_KEY) ?? { min: 1, max: 1000 };
    return {
      perWallet: { min: pw ? parseUnits(pw.min, decimals) : 1n, max: pw?.max ? parseUnits(pw.max, decimals) : null },
      wallets: w,
    };
  }
}

export const fmt = (x: bigint, decimals: number, symbol = ""): string => `${formatUnits(x, decimals)}${symbol ? " " + symbol : ""}`;
