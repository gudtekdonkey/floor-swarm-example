#!/usr/bin/env bash
# The local Solana world the swarm soaks against: Surfpool on 127.0.0.1:$PORT (started here if it is not up), the FLOOR Program's
# Solana devkit (deploy/solana/devkit.sh --local: build with a throwaway program id, deploy, init, open, one launch's life),
# then a treasury keypair airdropped SOL and minted the devkit's mock dUSDC. The swarm makes its own launches (the e2e's
# `launch`). Writes data/local-sol.json.
#   FLOOR_AMM_REPO=../floor-amm scripts/local-sol.sh [--port 8899]
# Needs Agave 3.1.14 (solana, solana-keygen, spl-token, cargo-build-sbf + platform-tools v1.57) and surfpool on PATH, or
# Agave in ~/.local/agave-v3.1.14/bin. The first run builds floor_amm (several minutes; cached by id + source hash).
# ⛔ Loopback only. Every key here is a throwaway in data/sol-keys (git-ignored); nothing sends to a cluster.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8899
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done
REPO="${FLOOR_AMM_REPO:?set FLOOR_AMM_REPO to a floor-amm checkout (main)}"
export PATH="$HOME/.local/agave-v3.1.14/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
R="http://127.0.0.1:$PORT"
KEYS="$HERE/data/sol-keys"
LOG="$HERE/data/local-sol.log"
mkdir -p "$KEYS"; chmod 700 "$KEYS"

alive() { curl -s -m 2 "$R" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q '"ok"'; }
if ! alive; then
  command -v surfpool >/dev/null || { echo "✗ surfpool is not on PATH" >&2; exit 1; }
  echo "== surfpool on $R (offline)"
  nohup surfpool start --offline --no-tui --no-studio --no-deploy --yes --ci -o 127.0.0.1 -p "$PORT" >"$HERE/data/surfpool-$PORT.log" 2>&1 &
  for _ in $(seq 1 60); do alive && break; sleep 1; done
  alive || { echo "✗ surfpool did not answer; see data/surfpool-$PORT.log" >&2; exit 1; }
fi

# create_launch CPIs Metaplex Token Metadata, which an offline Surfpool lacks: a READ-ONLY dump from mainnet-beta once
# (cached; the program's own tests use the same bytes, 31f0a627…), loaded with Surfpool's surfnet_setAccount
MPL=metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s
MPL_SO="${FLOOR_MPL_SO:-$HOME/.cache/floor-mpl/mpl.so}"
if ! curl -s "$R" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$MPL\",{\"encoding\":\"base64\",\"dataSlice\":{\"offset\":0,\"length\":1}}]}" | grep -q '"executable":true'; then
  [ -f "$MPL_SO" ] || { mkdir -p "$(dirname "$MPL_SO")"; solana program dump -u mainnet-beta "$MPL" "$MPL_SO" >/dev/null; }
  node -e 'const [r,id,f]=process.argv.slice(1); fetch(r,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"surfnet_setAccount",params:[id,{lamports:10e9,data:require("fs").readFileSync(f).toString("hex"),owner:"BPFLoader2111111111111111111111111111111111",executable:true}]})}).then(x=>x.json()).then(j=>{if(j.error){console.error(j.error.message);process.exit(1)}})' "$R" "$MPL" "$MPL_SO"
  echo "   Metaplex Token Metadata loaded ($MPL_SO)"
fi

[ -f "$KEYS/deployer.json" ] || solana-keygen new --no-bip39-passphrase --silent -o "$KEYS/deployer.json" >/dev/null
DEP=$(solana-keygen pubkey "$KEYS/deployer.json")
[ "$(solana balance --url "$R" "$DEP" --lamports | cut -d' ' -f1)" -ge 100000000000 ] || solana airdrop 500 "$DEP" --url "$R" >/dev/null

echo "== the devkit (the first run builds floor_amm: several minutes)"
# a v2 create CPIs floor_hook; the devkit deploys only the pinned build: FLOOR_HOOK_KEYPAIR (+ FLOOR_HOOK_SO) names it
HOOK_ARGS=(); HOOK=""
if [ -n "${FLOOR_HOOK_KEYPAIR:-}" ]; then HOOK=$(solana-keygen pubkey "$FLOOR_HOOK_KEYPAIR")
  HOOK_ARGS=(--hook-program-id "$HOOK" --hook-keypair "$FLOOR_HOOK_KEYPAIR" ${FLOOR_HOOK_SO:+--hook-so "$FLOOR_HOOK_SO"})
else echo "   ⚠ FLOOR_HOOK_KEYPAIR unset: no floor_hook is deployed, so the swarm's Solana launches and trades will fail"; fi
"$REPO/deploy/solana/devkit.sh" --local --url "$R" --keys "$KEYS" --deployer-keypair "$KEYS/deployer.json" "${HOOK_ARGS[@]}" >"$LOG" 2>&1 \
  || { grep -q "== 5 a launch's life" "$LOG" || { tail -30 "$LOG" >&2; echo "✗ the devkit did not open the program; see $LOG" >&2; exit 1; }
       echo "   ⚠ the devkit's life step failed (the program is open; the swarm makes its own launches): see $LOG"; }
PID=$(solana-keygen pubkey "$KEYS/program.json")
MOCK=$(solana-keygen pubkey "$KEYS/mock-usdc-mint.json" 2>/dev/null || grep -o 'MOCK_USDC=[1-9A-HJ-NP-Za-km-z]*' "$LOG" | tail -1 | cut -d= -f2)
echo "   floor_amm $PID · dUSDC $MOCK"

[ -f "$KEYS/treasury.json" ] || solana-keygen new --no-bip39-passphrase --silent -o "$KEYS/treasury.json" >/dev/null
TRE=$(solana-keygen pubkey "$KEYS/treasury.json")
solana airdrop 500 "$TRE" --url "$R" >/dev/null
spl-token create-account "$MOCK" --owner "$TRE" --fee-payer "$KEYS/deployer.json" --url "$R" >/dev/null 2>&1 || true
spl-token mint "$MOCK" 1000000 --recipient-owner "$TRE" --mint-authority "$KEYS/deployer.json" --fee-payer "$KEYS/deployer.json" --url "$R" >/dev/null
echo "   500 SOL and 1,000,000 dUSDC to the treasury $TRE"

OUT="$HERE/data/local-sol.json"
cat >"$OUT" <<JSON
{ "rpc": "$R", "programId": "$PID",${HOOK:+ "hookProgramId": "$HOOK",} "dUSDC": "$MOCK",
  "treasury": { "address": "$TRE", "key": $(cat "$KEYS/treasury.json") } }
JSON
echo "✓ ${OUT#$HERE/}"
