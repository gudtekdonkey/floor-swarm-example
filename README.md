# floor-swarm

Drives many wallets at once through the FLOOR Program with `@floor/sdk`: buy, sell and fund across tens or hundreds of
wallets, with the amount spread by rules you set (Count · Pick · Split), timing that is instant or random, retries, and a
ledger of every send. It is a soak harness for testnets and local chains, and a working example of the SDK.

**Testnets and local chains only.** A chain is refused unless its chain id is a known testnet (Sepolia, Base Sepolia, BNB
Chain testnet, Arbitrum Sepolia, HyperEVM testnet, Arc testnet, Robinhood Chain testnet) or its RPC is on loopback and the
node reports itself as anvil. A Solana cluster is refused unless its genesis hash is devnet's or testnet's, or its RPC is on
loopback (Surfpool, solana-test-validator); mainnet-beta is refused by its genesis hash. There is no switch to turn this off.

## What works today

| Built | Not built yet |
|---|---|
| The vault: an HD seed and imported keys, encrypted (scrypt + AES-256-GCM, file mode 600) | The daemon and its HTTP API |
| Wallets: derive, import, tag into groups, list with balances | The web UI (designed, not wired) |
| Chains: add, verify, list · pasting a token address resolves its launch | |
| Solana, every command above: HD wallets on `m/44'/501'/i'/0'` (the same addresses as `solana-keygen` and Phantom), `solana-keygen` JSON or base58 imports, SPL / Token-2022 quotes, wSOL launches traded in SOL | |
| `fund`, `buy`, `sell` with Count · Pick · Split, timing, retries and re-routing | TP / SL, raw, pipelines |
| `launch`: the creator picked by `--from <id \| group>`, an optional Team Buy (`--team-buy <amount \| max>`) priced from the chain's row, the Team Slot at the row's max | |
| `swap`, `snipe`, `claim`, `team-slot add` / `buy` (below) | |
| A run ledger per send · `--dry-run` · `--json` for scripts | Privy server wallets |
| Testnet forks: `scripts/local-evm.sh --fork <testnet rpc> --chain <c> --port N` | |

## Install

Node 22.18 or newer (it runs the TypeScript directly). Foundry's `anvil` and `cast` for the local EVM chain; Agave 3.1.14
(`solana`, `solana-keygen`, `spl-token`, `cargo-build-sbf` with platform-tools v1.57) and `surfpool` for the local Solana one.

```sh
git clone <this repo> floor-swarm && cd floor-swarm
npm ci
npm test                 # unit tests, no chain needed
npx tsc --noEmit         # type check
alias swarm="$PWD/bin/swarm.mjs"
```

## First run on a local chain

The local world is the FLOOR Program's anvil devkit plus two test launches (one quoted in dUSDC, one in the native coin), on
`127.0.0.1:8545`. It needs a checkout of the FLOOR Program's source (`FLOOR_AMM_REPO`).

```sh
FLOOR_AMM_REPO=../floor-amm scripts/local-evm.sh     # ~2 min; writes data/local-evm.json, leaves anvil running
npm run test:local                                   # the end-to-end tests against it

export SWARM_PASSPHRASE='a long passphrase'          # or leave it unset and type it at the prompt
swarm init --generate 50 --group snipers
W=./data/local-evm.json; TOKEN=$(node -p "require('$W').launches.eth")
swarm chain add local --rpc http://127.0.0.1:8545 --chain-id 31337 --floor-amm "$(node -p "require('$W').floorAmm")"
swarm wallets import "$(node -p "require('$W').treasury.key")" --group treasury   # anvil's public dev key 9
swarm fund --each 0.5 --chain local --from treasury --group snipers
swarm buy 10 local:$TOKEN --group snipers --count most:40 --pick least_used --split weights:0.2:1 --dry-run
swarm buy 10 local:$TOKEN --group snipers --count most:40 --pick least_used --split weights:0.2:1 --instant
swarm runs
```

## First run on local Solana

The local Solana world is Surfpool on `127.0.0.1:8899` with the FLOOR Program's Solana devkit (floor_amm built with a throwaway
program id, deployed, configured and opened, plus a mock dUSDC quote) and a treasury keypair holding SOL and dUSDC. The
swarm makes its own launches.

```sh
FLOOR_AMM_REPO=../floor-amm scripts/local-sol.sh     # starts surfpool if needed; the first run builds floor_amm (minutes)
W=./data/local-sol.json
swarm chain add sol --rpc http://127.0.0.1:8899 --program-id "$(node -p "require('$W').programId")"
swarm wallets import "$(node -p "JSON.stringify(require('$W').treasury.key)")" --group treasury
swarm fund --each 2 --chain sol --from treasury --group snipers
swarm launch Moon MOON --chain sol --from treasury --quote native     # a wSOL launch, traded in SOL
swarm buy 5 sol:<mint> --group snipers --count most:20 --instant
```

`swarm help` lists every command and knob.

## Swap, snipe, claim and the Team Slot

All four take `--dry-run` and `--json`, and each is recorded as a run in the ledger.

```sh
# every picked wallet sells its part of launch A and buys launch B with what the sell returned
swarm swap 50% local:$A local:$B --group swarm --instant
# wait for the next launch on a chain that matches, then run `buy` on it at once (--within seconds, default 600)
swarm snipe 20 --chain local (--creator 0xADDR | --symbol SYM | --any) --group swarm [--within 120]
# what each wallet is owed (Team Fees, Team Slot, holder rewards, referrals, an unlocked Team Buy), claimed; wallets owed nothing are skipped
swarm claim local:$A --group swarm [--to 0xADDR]        # or: swarm claim --all-launches --group swarm
# the creator wallet adds members to the Team Slot; members spend their Team Share on the launch's token
swarm team-slot add local:$A --from 17 (--member 3,4,0xADDR | --handle x:alice) --shares 1
swarm team-slot buy 0.05 local:$A --group swarm
```

- `swap`: both launches must be on one chain and share a quote asset, or it refuses by name. If a wallet's sell lands but its
  buy fails, the run is `partial`, the wallet is reported (the quote stays in it) and the sell is never retried.
- `snipe`: with no match inside the window it says so and exits 0 with `matched: false`. `--dry-run` watches but sends nothing.
  On Solana the watch polls the program's create events.
- `claim --all-launches` covers every launch the swarm created, joined as a Team Slot member, or traded. `--to` sends
  EVM's owed payouts bucket to another address; Solana has no such claim and refuses `--to` by name. On Solana the unlocked
  Team Buy and Team Share tokens are claimed with the same command.
- `team-slot buy` spends at most the Team Share each member is owed; the tokens are booked and arrive with `claim`.

## The knobs

- `--count most[:N] | min | exact:N | random:A:B | pct:P`: how many wallets take part.
- `--pick random | least_used | fresh | holders | richest | ordered`: which ones.
- `--split weights:MIN:MAX | balance | equal`: how the amount is divided. Every share is kept inside the per-wallet band in
  the settings.
- `--instant | --random MINMS:MAXMS`: timing. The default is random, 0.5 to 3 s apart.
- `--retries N` (3), `--slippage BPS` (300), `--seed S` (a seed replays the same plan), `--dry-run` (plan only, nothing is sent).

The general settings sit next to every command: `swarm settings per-wallet local:native 0.05:0.6` and
`swarm settings wallets 5:50`.

## Running it on a server

A small Linux box is enough: 2 vCPU and 2 GB RAM handle hundreds of wallets. The swarm keeps its state in one folder,
`SWARM_HOME` (default `./data`). The vault file is in it.

1. **A user and a folder.**
   ```sh
   sudo useradd --create-home --shell /bin/bash swarm
   sudo -iu swarm
   git clone <this repo> ~/floor-swarm && cd ~/floor-swarm && npm ci
   mkdir -p ~/swarm-data && chmod 700 ~/swarm-data
   ```
2. **The environment**, in a file only that user can read:
   ```sh
   cat > ~/swarm.env <<'ENV'
   SWARM_HOME=/home/swarm/swarm-data
   SWARM_NAME=soak-1
   SWARM_PASSPHRASE=<a long passphrase>
   ENV
   chmod 600 ~/swarm.env
   set -a; . ~/swarm.env; set +a
   ```
   Anyone who can read this file can unlock the vault. Keep it off shared disks and out of git.
3. **A chain.** Either a testnet RPC (`swarm chain add base-sepolia --rpc https://sepolia.base.org --chain-id 84532
   --floor-amm 0x…`; Solana devnet: `swarm chain add devnet --rpc https://api.devnet.solana.com --program-id <id>`) or a
   local anvil kept up by systemd:
   ```ini
   # /etc/systemd/system/anvil.service
   [Unit]
   Description=anvil for floor-swarm
   [Service]
   User=swarm
   ExecStart=/home/swarm/.foundry/bin/anvil --host 127.0.0.1 --port 8545 --state /home/swarm/anvil-state.json
   Restart=on-failure
   [Install]
   WantedBy=multi-user.target
   ```
   `sudo systemctl enable --now anvil`. Bind it to `127.0.0.1`, never `0.0.0.0`.
4. **Scheduled runs.** A soak on a timer is a cron line or a systemd timer that sources the env file and runs a command:
   ```cron
   */15 * * * * cd ~/floor-swarm && set -a && . ~/swarm.env && set +a && bin/swarm.mjs buy 2 base-sepolia:0x<token> --group snipers --count random:5:20 --json >> ~/swarm-data/cron.log 2>&1
   ```
5. **Back up** `SWARM_HOME` (it holds the vault and the ledger) and write the seed down when `swarm init` makes it. The seed
   is the only way back if the vault file is lost.
6. **No ports.** Today the swarm is a command line and opens nothing. When the daemon lands it listens on `127.0.0.1`
   only; reach it over SSH (`ssh -L 7070:127.0.0.1:7070 swarm@host`).

## Driving it from a script

Every command takes `--json` and then prints exactly one JSON object on stdout, nothing else:

```json
{"ok":true,"command":"buy 10","result":{"runId":15,"plan":{…},"report":{…}},"log":["…human lines…"]}
{"ok":false,"command":"buy 10","error":{"kind":"plan","message":"…"},"log":[]}
```

- Exit codes: `0` ok · `1` error · `2` can't plan (the knobs or balances can't produce a plan) · `3` usage (a bad command
  line).
- Amounts in `result` are strings of base units (bigints), for example `"420000000000000000"` for 0.42 ETH.
- `swarm help --json` returns every command, its arguments and whether it needs the vault, as data.
- Without a terminal the passphrase comes only from `SWARM_PASSPHRASE`. A command that needs it fails at once with exit 3
  instead of waiting at a prompt.

## Layout

| Path | What |
|---|---|
| `src/cli.ts` | The command line and its `--json` envelope |
| `src/plan/` | The planner (Count · Pick · Split, the bounded split) and the seeded random source |
| `src/exec/` | The executor: timing, retries, re-routing a failed share |
| `src/chains/` | Which chains are allowed, and the EVM adapter on `@floor/sdk` |
| `src/vault/`, `src/store/` | The encrypted vault and the ledger |
| `src/commands/` | `buy`, `sell`, `fund` |
| `vendor/floor-sdk/` | A pinned copy of `@floor/sdk` |
| `scripts/local-evm.sh` | The local anvil world |
| `test/unit/`, `test/local/` | Unit tests, and end-to-end tests against the local world |

The swarm never signs in to FLOOR and never takes a FLOOR account's key. Its wallets are its own; a launch's creator is one
of them (`swarm launch … --from <id | group>`).
