#!/usr/bin/env bash
# The EVM e2e world WITHOUT a floor-amm checkout: anvil forking a mainnet where FloorAmm is deployed
# (0xF10000bd…d225), then what scripts/local-evm.sh does after its devkit step: a mock dUSDC added as a quote (as the
# program's authority, impersonated on the fork), two preset-3 launches (dUSDC and native), dUSDC minted to the treasury.
# Writes data/local-evm-<chain id>.json. Anvil stays running on 127.0.0.1:$PORT.
#   scripts/fork-evm.sh [--port 8545] [--fork https://mainnet.base.org]
#   SWARM_WORLD=data/local-evm-8453.json npm run test:local
# ⛔ Every write goes to the local fork only (anvil on loopback, --auto-impersonate); nothing is sent to the forked chain.
# Needs Foundry (anvil, cast, forge) on PATH or in ~/.foundry/bin. The fork RPC must serve recent state (any public RPC does).
set -euo pipefail
export HERE="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8545 FORK=https://mainnet.base.org
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --fork) FORK="$2"; shift 2 ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done
export PATH="$HOME/.foundry/bin:$PATH"
R="http://127.0.0.1:$PORT"
mkdir -p "$HERE/data"

AMM=0xF10000bd05c2C01793C6d55F027346469683d225
NATIVE=0x0000000000000000000000000000000000000000
CREATOR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8   # anvil dev account 1
TREASURY=0xa0Ee7A142d267C1f36714E4a8F75612F20a79720  # anvil dev account 9
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266  # anvil dev account 0

if ! cast chain-id --rpc-url "$R" >/dev/null 2>&1; then
  echo "== anvil forking $FORK on $R"
  nohup anvil --fork-url "$FORK" --port "$PORT" --auto-impersonate --silent >"$HERE/data/anvil-fork-$PORT.log" 2>&1 &
  for _ in $(seq 1 60); do cast chain-id --rpc-url "$R" >/dev/null 2>&1 && break; sleep 1; done
fi
cast chain-id --rpc-url "$R" >/dev/null 2>&1 || { echo "✗ anvil did not answer; see data/anvil-fork-$PORT.log" >&2; exit 1; }
[ "$(cast code $AMM --rpc-url "$R")" != "0x" ] || { echo "✗ no FloorAmm at $AMM on the forked chain" >&2; exit 1; }

AUTH=$(cast call $AMM 'authority()(address)' --rpc-url "$R")
PU=$(cast call $AMM 'priceUpdater()(address)' --rpc-url "$R")
cast rpc anvil_setBalance "$AUTH" 0x56BC75E2D63100000 --rpc-url "$R" >/dev/null   # 100 ETH for gas
cast rpc anvil_setBalance "$PU" 0x56BC75E2D63100000 --rpc-url "$R" >/dev/null

echo "== dUSDC"
BUILD="$HERE/data/fork-dusdc"   # data/ is git-ignored: forge's out/ and cache/ stay out of the tree
mkdir -p "$BUILD/src" && cp "$HERE/scripts/fork/DUSDC.sol" "$BUILD/src/DUSDC.sol"
# --root: forge would otherwise take the repository's git root as the project
DEPLOY=$(forge create --root "$BUILD" "$BUILD/src/DUSDC.sol:DUSDC" --broadcast --unlocked --from $DEPLOYER --rpc-url "$R" 2>&1 || true)
DUSDC=$(echo "$DEPLOY" | grep -o 'Deployed to: 0x[0-9a-fA-F]\{40\}' | awk '{print $3}' || true)
[ -n "$DUSDC" ] || { echo "✗ the dUSDC deploy failed:" >&2; echo "$DEPLOY" >&2; exit 1; }
# the row of a listed 6-decimal USD quote (Base's USDC when it is listed), else $1 at the native row's create fee in cents
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
ROW=$(cast call $AMM 'quoteEntry(address)((bool,bool,uint8,uint256,uint256,uint64,uint64))' $USDC --rpc-url "$R" 2>/dev/null | tr -d '()' || true)
if [ -n "$ROW" ] && [ "$(echo "$ROW" | awk -F', ' '{print $1}')" = "true" ]; then
  FEE_U=$(echo "$ROW" | awk -F', ' '{print $4}' | awk '{print $1}')
  PX_U=$(echo "$ROW" | awk -F', ' '{print $5}' | awk '{print $1}')
else
  FEE_U=10000000                        # 10 dUSDC
  PX_U=$(python3 -c 'print(100 * 2**64)')   # $1 a whole dUSDC, in USD cents × 2^64 (as Base USDC's row: ≈ 1.844e21)
fi
cast send -q --unlocked --from "$AUTH" $AMM 'addQuote(address,uint256,uint256)' "$DUSDC" "$FEE_U" "$PX_U" --rpc-url "$R"
echo "   dUSDC $DUSDC (create fee $FEE_U; added by the authority $AUTH, impersonated)"

SLOT=$(node --no-warnings -e '
const [amm, rpc] = process.argv.slice(1);
const { presetRowCallV2, decodePresetRowEvmV2 } = await import(process.env.HERE + "/vendor/floor-sdk/v2/presetRowEvm.ts");
const { decodeRowV2 } = await import(process.env.HERE + "/vendor/floor-sdk/math/v2/preset.ts");
const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: amm, data: presetRowCallV2(3) }, "latest"] }) }).then((x) => x.json());
console.log(decodeRowV2(decodePresetRowEvmV2(r.result).row).teamSlotMaxBps);' --input-type=module "$AMM" "$R")
echo "   preset 3's Team Slot max: $SLOT bps"

# fresh registry prices for both quotes (the SDK refuses one over 24 h old), as the program's price updater
for Q in $NATIVE "$DUSDC"; do
  P=$(cast call $AMM 'quoteEntry(address)((bool,bool,uint8,uint256,uint256,uint64,uint64))' "$Q" --rpc-url "$R" | tr -d '()' | awk -F', ' '{print $5}' | awk '{print $1}')
  cast send -q --unlocked --from "$PU" $AMM 'setQuotePrice(address,uint256)' "$Q" "$P" --rpc-url "$R"
done

echo "== two launches (preset 3)"
Z=0x0000000000000000000000000000000000000000000000000000000000000000
SIG='createLaunch((uint8,address,string,string,uint256,uint256,bool,bytes32,uint256,uint16))'
FEE=$(cast call $AMM 'nativeCreateFee()(uint256)' --rpc-url "$R" | awk '{print $1}')
cast send -q --unlocked --from $CREATOR "$DUSDC" 'mint(address,uint256)' $CREATOR 1000000000 --rpc-url "$R"
cast send -q --unlocked --from $CREATOR "$DUSDC" 'approve(address,uint256)' $AMM "$(cast max-uint)" --rpc-url "$R"
cast send -q --unlocked --from $CREATOR $AMM "$SIG" "(3,$DUSDC,Swarm Test USDC,SWU,0,0,false,$Z,0,$SLOT)" --rpc-url "$R"
cast send -q --unlocked --from $CREATOR $AMM "$SIG" "(3,$NATIVE,Swarm Test ETH,SWE,0,0,false,$Z,0,$SLOT)" --value "$FEE" --rpc-url "$R"
N=$(cast call $AMM 'launchCount()(uint256)' --rpc-url "$R" | awk '{print $1}')
TU=$(cast call $AMM 'launchToken(uint256)(address)' $((N - 1)) --rpc-url "$R")
TE=$(cast call $AMM 'launchToken(uint256)(address)' "$N" --rpc-url "$R")
echo "   launch $((N - 1)) $TU (dUSDC) · launch $N $TE (ETH)"

cast send -q --unlocked --from $TREASURY "$DUSDC" 'mint(address,uint256)' $TREASURY 1000000000000 --rpc-url "$R"
echo "   1,000,000 dUSDC to the treasury $TREASURY"

CID=$(cast chain-id --rpc-url "$R")
OUT="$HERE/data/local-evm-$CID.json"
cat >"$OUT" <<JSON
{ "rpc": "$R", "chainId": $CID, "fork": "$FORK", "floorAmm": "$AMM", "dUSDC": "$DUSDC",
  "launches": { "usdc": "$TU", "eth": "$TE" }, "priceUpdater": "$PU",
  "treasury": { "address": "$TREASURY", "key": "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6" } }
JSON
echo "✓ ${OUT#$HERE/}   (SWARM_WORLD=${OUT#$HERE/} npm run test:local)"
