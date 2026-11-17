#!/usr/bin/env bash
# The Solana e2e world WITHOUT a floor-amm checkout: Surfpool forking mainnet-beta, where the FLOOR programs are deployed
# (accounts are fetched from the forked cluster on first read), a treasury given SOL and USDC with Surfpool's cheatcodes,
# and a loopback proxy in front (scripts/fork/sig-proxy.mjs) for the one call Surfpool forwards that a local signature
# breaks. Writes data/local-sol-fork.json, whose rpc is the proxy. Surfpool and the proxy stay running.
#   scripts/fork-sol.sh [--port 8899] [--proxy-port 8898] [--fork https://api.mainnet-beta.solana.com]
#   SWARM_SOL_WORLD=data/local-sol-fork.json npm run test:local
# ⛔ Every write goes to the local fork only (Surfpool on loopback); nothing is sent to the forked cluster.
# Needs surfpool (https://github.com/txtx/surfpool, v1.0.0 tested) on PATH, and Node 22+.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8899 PPORT=8898 FORK=https://api.mainnet-beta.solana.com
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --proxy-port) PPORT="$2"; shift 2 ;;
    --fork) FORK="$2"; shift 2 ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done
R="http://127.0.0.1:$PORT" P="http://127.0.0.1:$PPORT"
mkdir -p "$HERE/data"
alive() { curl -sf -m 3 "$1" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' >/dev/null 2>&1; }

if ! alive "$R"; then
  command -v surfpool >/dev/null || { echo "✗ surfpool is not on PATH (https://github.com/txtx/surfpool/releases)" >&2; exit 1; }
  echo "== surfpool forking $FORK on $R"
  nohup surfpool start --rpc-url "$FORK" --no-tui --no-studio --no-deploy --yes --ci -o 127.0.0.1 -p "$PORT" >"$HERE/data/surfpool-$PORT.log" 2>&1 &
  for _ in $(seq 1 90); do alive "$R" && break; sleep 1; done
fi
alive "$R" || { echo "✗ surfpool did not answer; see data/surfpool-$PORT.log" >&2; exit 1; }
if ! alive "$P"; then
  nohup node "$HERE/scripts/fork/sig-proxy.mjs" "$PPORT" "$R" >"$HERE/data/sig-proxy-$PPORT.log" 2>&1 &
  for _ in $(seq 1 20); do alive "$P" && break; sleep 0.5; done
fi
alive "$P" || { echo "✗ the proxy did not answer; see data/sig-proxy-$PPORT.log" >&2; exit 1; }

echo "== treasury"
OUT="$HERE/data/local-sol-fork.json"
node --no-warnings "$HERE/scripts/fork/sol-world.mjs" "$P" "$OUT"
echo "✓ ${OUT#$HERE/}   (SWARM_SOL_WORLD=${OUT#$HERE/} npm run test:local)"
