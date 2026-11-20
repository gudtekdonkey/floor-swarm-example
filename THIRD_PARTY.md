# Third-party dependencies

| Package | Version | License | Why |
|---|---|---|---|
| viem | 2.x | MIT | EVM RPC, HD and key accounts, transaction signing |
| typescript (dev) | 5.x | Apache-2.0 | `npm run typecheck` only; Node runs the `.ts` by type stripping |
| @types/node (dev) | 22.x | MIT | types for the typecheck |
| `vendor/floor-sdk/` | `@floorlaunchpad/sdk` 0.6.0 source (npm; the same `src/` as `gudtekdonkey/floor-sdk` `packages/sdk` at `146d6a4d`) | FLOOR | the FLOOR Program's builders and decoders, copied in whole but `indexer/` and its `index.ts` barrel (comments stripped) |
| Foundry (anvil, cast) | 1.5.1 | MIT/Apache-2.0 | the local chain (not an npm dependency) |
