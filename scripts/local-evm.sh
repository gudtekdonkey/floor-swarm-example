#!/usr/bin/env bash
# The local EVM world the swarm soaks against: the FLOOR Program's anvil devkit (deploy, configure, open), then two
# test launches (preset 3: one on dUSDC, one on the native coin), and dUSDC minted to the treasury (anvil's dev account 9).
# Writes data/local-evm.json. Anvil stays running on 127.0.0.1:$PORT.
#   FLOOR_AMM_REPO=../floor-amm scripts/local-evm.sh [--port 8545] [--chain anvil] [--fork <testnet rpc url>]
# --fork runs anvil on a local fork of a TESTNET (the devkit's --fork); the run takes the fork's chain id. Writes go only
# to the local fork, never to the testnet. ⚠ The fork RPC must serve OLD state (an archive node): a pruned one
# (publicnode's Sepolia) fails once the fork block is a few minutes old ("historical state … is not available"). Used:
#   Base Sepolia https://sepolia.base.org · Sepolia https://sepolia.drpc.org · Arbitrum Sepolia https://sepolia-rollup.arbitrum.io/rpc Writes data/local-evm.json, or data/local-evm-<chain id>.json with --fork.
# ⛔ Loopback only. Anvil's dev keys are public test keys; nothing here sends to a network.
# The devkit runs end to end; this script needs only its steps 1–4
# (through "OPEN ok") and creates its own launches with the 10-field tuple.
set -euo pipefail
export HERE="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8545 CHAIN=anvil FORK=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --chain) CHAIN="$2"; shift 2 ;;
    --fork) FORK="$2"; shift 2 ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done
REPO="${FLOOR_AMM_REPO:?set FLOOR_AMM_REPO to a floor-amm checkout (main)}"
export PATH="$HOME/.foundry/bin:$PATH"
R="http://127.0.0.1:$PORT"
LOG="$HERE/data/local-evm-$PORT.log"
mkdir -p "$HERE/data"

echo "== the devkit (about 2 minutes, mostly compiling)"
(cd "$REPO" && deploy/evm/devkit/anvil.sh --chain "$CHAIN" --port "$PORT" ${FORK:+--fork "$FORK"}) >"$LOG" 2>&1 || true
grep -q "OPEN ok" "$LOG" || { echo "✗ the devkit did not open the program; see $LOG" >&2; exit 1; }
AMM=$(grep -o 'predicted: FloorAmm 0x[0-9a-fA-F]\{40\}' "$LOG" | awk '{print $3}')
DUSDC=$(grep -o 'dUSDC *0x[0-9a-fA-F]\{40\}' "$LOG" | head -1 | awk '{print $2}')
# a native create's value must be EXACTLY the Team Buy + the create fee (else BadValue); here no Team Buy
FEE=$(grep -o 'ETH *0x0\{40\} *create_fee [0-9]*' "$LOG" | head -1 | awk '{print $4}')
echo "   FloorAmm $AMM · dUSDC $DUSDC · native create fee $FEE"

CREATOR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8   # anvil dev account 1
TREASURY=0xa0Ee7A142d267C1f36714E4a8F75612F20a79720  # anvil dev account 9
Z=0x0000000000000000000000000000000000000000000000000000000000000000
SIG='createLaunch((uint8,address,string,string,uint256,uint256,bool,bytes32,uint256,uint16))'
# no Team Buy (optional); the Team Slot opens at exactly the row's max (read off the row with the vendored SDK)
SLOT=$(node --no-warnings -e '
const [amm, rpc] = process.argv.slice(1);
const { presetRowCallV2, decodePresetRowEvmV2 } = await import(process.env.HERE + "/vendor/floor-sdk/v2/presetRowEvm.ts");
const { decodeRowV2 } = await import(process.env.HERE + "/vendor/floor-sdk/math/v2/preset.ts");
const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: amm, data: presetRowCallV2(3) }, "latest"] }) }).then((x) => x.json());
console.log(decodeRowV2(decodePresetRowEvmV2(r.result).row).teamSlotMaxBps);' --input-type=module "$AMM" "$R")
echo "   preset 3's Team Slot max: $SLOT bps"

echo "== two launches (preset 3)"
cast send -q --unlocked --from $CREATOR "$DUSDC" 'approve(address,uint256)' "$AMM" "$(cast max-uint)" --rpc-url "$R"
cast send -q --unlocked --from $CREATOR "$AMM" "$SIG" "(3,$DUSDC,Swarm Test USDC,SWU,0,0,false,$Z,0,$SLOT)" --rpc-url "$R"
cast send -q --unlocked --from $CREATOR "$AMM" "$SIG" "(3,0x0000000000000000000000000000000000000000,Swarm Test ETH,SWE,0,0,false,$Z,0,$SLOT)" \
  --value "$FEE" --rpc-url "$R"
N=$(cast call "$AMM" 'launchCount()(uint256)' --rpc-url "$R" | awk '{print $1}')
TU=$(cast call "$AMM" 'launchToken(uint256)(address)' $((N - 1)) --rpc-url "$R")
TE=$(cast call "$AMM" 'launchToken(uint256)(address)' "$N" --rpc-url "$R")
echo "   launch $((N - 1)) $TU (dUSDC) · launch $N $TE (ETH)"

# the devkit moves the clock a day on (its Team Buy unlock), so the registry prices it wrote are over the SDK's 24 h
# re-write each at its own value from the devkit's price updater (anvil dev account 5), stamping them now
PU=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
for Q in 0x0000000000000000000000000000000000000000 "$DUSDC"; do
  P=$(cast call "$AMM" 'quoteEntry(address)((bool,bool,uint8,uint256,uint256,uint64,uint64))' "$Q" --rpc-url "$R" | tr -d '()' | awk -F', ' '{print $5}' | awk '{print $1}')
  cast send -q --unlocked --from $PU "$AMM" 'setQuotePrice(address,uint256)' "$Q" "$P" --rpc-url "$R"
done

cast send -q --unlocked --from $TREASURY "$DUSDC" 'mint(address,uint256)' $TREASURY 1000000000000 --rpc-url "$R"
echo "   1,000,000 dUSDC to the treasury $TREASURY"

CID=$(cast chain-id --rpc-url "$R")
OUT="$HERE/data/local-evm.json"; [ -n "$FORK" ] && OUT="$HERE/data/local-evm-$CID.json"
cat >"$OUT" <<JSON
{ "rpc": "$R", "chainId": $CID, "fork": "${FORK}", "floorAmm": "$AMM", "dUSDC": "$DUSDC",
  "launches": { "usdc": "$TU", "eth": "$TE" }, "priceUpdater": "$PU",
  "treasury": { "address": "$TREASURY", "key": "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6" } }
JSON
echo "✓ ${OUT#$HERE/}"
