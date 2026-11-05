#!/usr/bin/env bash
# The local Solana world the swarm soaks against, on 127.0.0.1:$PORT, then a treasury keypair airdropped SOL and minted the
# devkit's mock dUSDC. The swarm makes its own launches (the e2e's `launch`). Writes data/local-sol.json.
#   FLOOR_AMM_REPO=../floor-amm scripts/local-sol.sh [--port 8899]
# Default: the pinned floor_amm + floor_hook at their REAL ids on solana-test-validator, opened by the FLOOR Program's devkit
#   --local --preloaded (its tools/audit-sdk/sol/up.sh). No program keypair needed. Build the two .so first, once, in the
#   checkout (or point FLOOR_SO_DIR at them):
#   cargo-build-sbf --tools-version v1.57 --manifest-path programs/floor_{amm,hook}/Cargo.toml -- --locked
# With FLOOR_HOOK_KEYPAIR (+ FLOOR_HOOK_SO): Surfpool (started here if it is not up) and the devkit --local, floor_amm built
#   with a throwaway id and floor_hook deployed at the id that keypair names.
# Needs Agave 3.1.14 (solana, solana-keygen, solana-test-validator, spl-token, cargo-build-sbf + platform-tools v1.57), and
# surfpool for the second mode, on PATH, or Agave in ~/.local/agave-v3.1.14/bin.
# ⛔ Loopback only. Every key here is a throwaway in data/sol-keys or data/sol-pair (git-ignored); nothing sends to a cluster.
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

# The default (no FLOOR_HOOK_KEYPAIR): the hook checks its caller, so floor_amm and floor_hook must sit at their REAL ids, and
# no keypair for either exists. The FLOOR Program's own local pair does it keylessly: solana-test-validator with both pinned
# builds loaded at the real ids, then its devkit --local --preloaded (tools/audit-sdk/sol/up.sh). Needs floor_amm.so and
# floor_hook.so built from the checkout (FLOOR_SO_DIR, default $REPO/target/deploy:
# cargo-build-sbf --tools-version v1.57 --manifest-path programs/floor_{amm,hook}/Cargo.toml -- --locked).
write_world() {  # <programId> <hookProgramId> <dUSDC> <keys dir holding deployer.json>
  local pid="$1" hook="$2" mock="$3" keys="$4"
  [ -f "$KEYS/treasury.json" ] || solana-keygen new --no-bip39-passphrase --silent -o "$KEYS/treasury.json" >/dev/null
  local tre; tre=$(solana-keygen pubkey "$KEYS/treasury.json")
  solana airdrop 500 "$tre" --url "$R" >/dev/null
  spl-token create-account "$mock" --owner "$tre" --fee-payer "$keys/deployer.json" --url "$R" >/dev/null 2>&1 || true
  spl-token mint "$mock" 1000000 --recipient-owner "$tre" --mint-authority "$keys/deployer.json" --fee-payer "$keys/deployer.json" --url "$R" >/dev/null
  echo "   floor_amm $pid · floor_hook ${hook:-none} · dUSDC $mock"
  echo "   500 SOL and 1,000,000 dUSDC to the treasury $tre"
  OUT="$HERE/data/local-sol.json"
  local hookf=""; [ -z "$hook" ] || hookf=" \"hookProgramId\": \"$hook\","   # (bash drops quotes inside ${x:+…} in a heredoc)
  cat >"$OUT" <<JSON
{ "rpc": "$R", "programId": "$pid",$hookf "dUSDC": "$mock",
  "treasury": { "address": "$tre", "key": $(cat "$KEYS/treasury.json") } }
JSON
  echo "✓ ${OUT#$HERE/}"
}
if [ -z "${FLOOR_HOOK_KEYPAIR:-}" ]; then
  PAIR="$HERE/data/sol-pair"
  if alive && ! { [ -f "$PAIR/validator.pid" ] && kill -0 "$(cat "$PAIR/validator.pid")" 2>/dev/null; }; then
    echo "✗ something else answers on $R; stop it first (the pinned pair runs its own validator there)" >&2; exit 1
  fi
  echo "== the pinned floor_amm + floor_hook at their real ids (solana-test-validator, the devkit --preloaded)"
  # Metaplex Token Metadata, which create_launch CPIs: the same READ-ONLY mainnet-beta dump as below (cached, 31f0a627…)
  MPL_SO="${FLOOR_MPL_SO:-$HOME/.cache/floor-mpl/mpl.so}"
  [ -f "$MPL_SO" ] || { mkdir -p "$(dirname "$MPL_SO")"; solana program dump -u mainnet-beta metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s "$MPL_SO" >/dev/null; }
  FLOOR_MPL_SO="$MPL_SO" FLOOR_AUDIT_SOL_DIR="$PAIR" FLOOR_E2E_SOLANA_PORT="$PORT" "$REPO/tools/audit-sdk/sol/up.sh" --so-dir "${FLOOR_SO_DIR:-$REPO/target/deploy}" >"$LOG" 2>&1 \
    || { tail -30 "$LOG" >&2; echo "✗ the pinned pair did not come up; see $LOG" >&2; exit 1; }
  ST="$PAIR/state.json"
  write_world "$(node -p "require('$ST').programId")" "$(node -p "require('$ST').hookProgramId")" "$(node -p "require('$ST').quoteMint")" "$(node -p "require('$ST').keys")"
  exit 0
fi

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
HOOK=$(solana-keygen pubkey "$FLOOR_HOOK_KEYPAIR")
HOOK_ARGS=(--hook-program-id "$HOOK" --hook-keypair "$FLOOR_HOOK_KEYPAIR" ${FLOOR_HOOK_SO:+--hook-so "$FLOOR_HOOK_SO"})
"$REPO/deploy/solana/devkit.sh" --local --url "$R" --keys "$KEYS" --deployer-keypair "$KEYS/deployer.json" "${HOOK_ARGS[@]}" >"$LOG" 2>&1 \
  || { grep -q "== 5 a launch's life" "$LOG" || { tail -30 "$LOG" >&2; echo "✗ the devkit did not open the program; see $LOG" >&2; exit 1; }
       echo "   ⚠ the devkit's life step failed (the program is open; the swarm makes its own launches): see $LOG"; }
PID=$(solana-keygen pubkey "$KEYS/program.json")
MOCK=$(solana-keygen pubkey "$KEYS/mock-usdc-mint.json" 2>/dev/null || grep -o 'MOCK_USDC=[1-9A-HJ-NP-Za-km-z]*' "$LOG" | tail -1 | cut -d= -f2)
echo "   floor_amm $PID · dUSDC $MOCK"

write_world "$PID" "$HOOK" "$MOCK" "$KEYS"
