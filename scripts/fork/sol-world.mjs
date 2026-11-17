// The Solana e2e world on a Surfpool fork of mainnet-beta (scripts/fork-sol.sh): a throwaway treasury keypair given
// 1,000 SOL and 1,000,000 USDC with Surfpool's cheatcodes. Mainnet's USDC (a listed quote with a fresh price) stands in
// for the devkit's dUSDC. Every write stays on the loopback fork.
//   node scripts/fork/sol-world.mjs <rpc> <out.json>
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";

const [rpc, out] = process.argv.slice(2);
if (!rpc || !out) {
  console.error("node scripts/fork/sol-world.mjs <rpc> <out.json>");
  process.exit(2);
}
const { PROGRAM_IDS } = await import(new URL("../../vendor/floor-sdk/config/index.ts", import.meta.url).href);
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (b) => {
  let n = BigInt("0x" + Buffer.from(b).toString("hex"));
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const x of b) {
    if (x) break;
    s = "1" + s;
  }
  return s;
};
const call = async (method, params) => {
  const r = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
  if (r.error) throw new Error(`${method}: ${r.error.message}`);
  return r.result;
};

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const key = [...seed, ...pub]; // the 64-byte secret key, as solana-keygen writes it
const address = b58(pub);
await call("surfnet_setAccount", [address, { lamports: 1000 * 1e9 }]);
await call("surfnet_setTokenAccount", [address, USDC, { amount: 1_000_000 * 1e6 }, TOKEN]);
const bal = await call("getBalance", [address]);
const tok = await call("getTokenAccountsByOwner", [address, { mint: USDC }, { encoding: "jsonParsed" }]);
console.log(`   treasury ${address}: ${bal.value / 1e9} SOL, ${tok.value[0]?.account.data.parsed.info.tokenAmount.uiAmountString} USDC`);
writeFileSync(out, JSON.stringify({ rpc, programId: PROGRAM_IDS.floorAmm, hookProgramId: PROGRAM_IDS.floorHook, dUSDC: USDC, fork: "mainnet-beta", treasury: { address, key } }, null, 1) + "\n");
