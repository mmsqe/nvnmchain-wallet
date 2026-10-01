# AGENTS.md — NVNM Passkey Wallet

Reminders for anyone (human or agent) working in this repo. Read this first.

## What this chain is

- **NVNM Chain is a fork of [Tempo](https://tempo.xyz)**, not a
  reimplementation and **not** any pre-existing "nvnmchain" you find on Google.
  The protocol/technical side is identical to Tempo: EVM + Tempo Transactions
  (`0x76`), WebAuthn/P-256 signatures, TIP-20 tokens, FeeAMM, stablecoin gas.
  Only the network identity differs (chain ID, RPC, predeployed token addresses
  can differ from Tempo mainnet).
- There are **two networks**: NVNM Canary (MANTRA canary infrastructure — hence
  the `*.mantrachain.dev` domains) and NVNM Testnet (`*.nvnmchain.io`). Both are
  selectable in the UI; see `NETWORKS` in `src/chain.ts`.

## Network facts (do not "fix" these)

| | Canary | Testnet |
|---|---|---|
| Chain ID | `787222` | `787223` |
| RPC | `https://rpc.nvnm.canary.mantrachain.dev` | `https://rpc.nvnm.testnet.nvnmchain.io` |
| Explorer | `https://explorer.nvnm.canary.mantrachain.dev` (see "Explorer" below) | `https://explorer.nvnm.testnet.nvnmchain.io` |
| Fee token | `pathUSD` = `0x20c0000000000000000000000000000000000000` (TIP-20, **6 decimals**) | `nUSD` at the **same** address (6 decimals, USD) |

- Predeploy addresses are identical across both networks; only the fee token's
  on-chain metadata (symbol `nvnmUSD` on canary, `nUSD` on testnet) differs. The
  UI calls it `pathUSD` on canary and `nUSD` on testnet
  (`NETWORKS[key].feeTokenSymbol` / `feeTokenSymbol()`) — use that helper instead
  of hardcoding either name in copy.

- **No native gas token.** `eth_getBalance` returns the Tempo placeholder
  (`4.242424242424242e75`) — always read balances via TIP-20 `balanceOf`.
- **Fee token preferences** (Tempo fee spec, `spec-fee#fee-token-preferences`):
  the node resolves the fee token for a tx in this order — 1) transaction-level
  `fee_token` field, 2) account preference (FeeManager `userTokens(addr)`, set
  via `setUserToken`), 3) the TIP-20 being called if it's `transfer` /
  `transferWithMemo` / `startReward` and its `currency` is USD, 4) StablecoinDex
  `tokenIn` for swaps, 5) pathUSD fallback. At the chosen level the token must be
  USD-currency, the payer must have balance, and the FeeAMM must have liquidity
  (fee token ↔ validator token) — else the tx is invalid.
- Gas is measured with `tempo_simulateV1` (works pre-funding); the fee reserve is
  `gasLimit × maxFeePerGas / 1e12` (6-decimal USD tokens, gas price in wei).
  `tempo_simulateV1`/`eth_estimateGas` do **not** enforce fee-token balance —
  that only happens at execution (`InsufficientFeeTokenBalance`).
- Key precompiles (from `viem/tempo` Addresses):
  - AccountKeychain `0xaAAAaaAA…0000`, NonceManager `0x4e4F4E4345…`,
    FeeManager `0xfeec…0000` (hosts the FeeAMM), pathUSD `0x20c0…0000`,
    TIP20Factory `0x20fc…0000`, StablecoinDex `0xdec0…0000`,
    TIP403Registry `0x403c…0000`, StorageCredits `0x1060…0000`.
- Address derivation: `keccak256(pubKeyX ‖ pubKeyY)[12:]` from the passkey's
  P-256 public key. This matches the chain's WebAuthn address derivation.

## Explorer (we switched from Blockscout)

- Use `https://explorer.nvnm.canary.mantrachain.dev/` (canary) or
  `https://explorer.nvnm.testnet.nvnmchain.io/` (testnet) — a custom
  Rust/SQLite explorer (repo `yihuang/nvnmchain-explorer`), one instance per
  network, same routes/JSON shape. The old
  `blockscout.nvnm.canary.mantrachain.dev` is **dead (HTTP 525)**.
- **Every page doubles as JSON**: append `?format=json` (or send
  `Accept: application/json`). Routes: `/address/{addr}`, `/tx/{hash}`,
  `/token/{addr}`, `/block/{id}`, `/blocks`, `/tokens`, `/search`.
- Transaction history (what `getHistory` uses):
  `{EXPLORER_URL}/address/{addr}?format=json&tab=transactions&page=1`
  (`EXPLORER_URL` = the active network's explorer — `getNetwork().explorerUrl`)
  → JSON object with a `transactions[]` array. Tx fields: `hash`,
  `from_addr`, `to_addr` (may be null), `status` (**`1`=success, `0`=reverted**),
  `timestamp` (**unix seconds**), `fee_amount`, `fee_token`, `block_number`.
  There is **no Blockscout-style `/api/v2`** anymore.
- `/api/events` is a **Server-Sent Events stream**, not a JSON REST endpoint.
- Link URLs: `{EXPLORER_URL}/tx/{hash}` and `{EXPLORER_URL}/address/{addr}`.
  (`chain.ts` has `explorerTxUrl` / `explorerAddressUrl` helpers.)

## FeeAMM — the important correction

**FeeAMM is NOT a Uniswap v2 constant-product (x·y=k) AMM.** It shares the
*shape* (pool = two reserves, LP shares, `mint`/`burn`, a swap fn) but prices
at **fixed, pre-defined rates**, not from reserves.

- Rates (constants on the FeeManager precompile `0xfeec…0000`):
  - `M = 9970` — fee-swap rate `0.9970` (30 bps), **user token → validator token**
  - `N = 9985` — rebalance rate `0.9985` (15 bps), **validator token → user token**
  - `SCALE = 10000`, `MIN_LIQUIDITY = 1000` (permanently locked)
- Formulas:
  - fee swap: `amountOut = amountIn * M / SCALE`
  - rebalance: `amountIn = amountOut * N / SCALE + 1` (round up)
- **Pools are directional and order matters.** `poolId = keccak256(abi.encode(userToken, validatorToken))`;
  `Pool(A,B) ≠ Pool(B,A)`. There are **two** pools per token pair.
  ⚠️ `ox/tempo`'s `PoolId.from` **sorts** addresses (order-independent) — that
  matches the *StablecoinDex* `pairKey`, **not** the FeeAMM. Don't use it for
  FeeAMM `totalSupply`/`liquidityBalances`; call on-chain `getPoolId` or
  compute `keccak256(abi.encode(u, v))` yourself.
- **Only one public swap direction**: `rebalanceSwap(userToken, validatorToken, amountOut, to)`
  → returns `amountIn` (validator tokens you pay, user tokens `to` receives).
  The user→validator "fee swap" happens **only during tx fee collection** by the
  node; it is **not callable** by users.
- `mint(userToken, validatorToken, amountValidatorToken, to)` is **single-sided**
  (validator token only; user tokens are never deposited).
  - First deposit: `liquidity = amountValidatorToken/2 - MIN_LIQUIDITY`
    (reserves start `validator=amount, user=0`).
  - Later: `liquidity = amountValidatorToken * totalSupply / (V + N*U/SCALE)`.
- `burn(userToken, validatorToken, liquidity, to)` returns the pro-rata share of
  **both** reserves.
- **Both tokens must be `currency == "USD"`** (`validate_usd_currency`). A
  generic memecoin (non-USD) **cannot** be listed in FeeAMM. Keep "memecoin
  launcher" and "FeeAMM" as separate features.
- `viem/tempo` has ready helpers: `Actions.amm.{getPool, getLiquidityBalance, rebalanceSwap, rebalanceSwapSync, mint, mintSync, burn, burnSync}` plus `watch*` event helpers. Prefer these over hand-rolled ABIs.

## TIP-20 / memecoin launcher

- TIP-20 = ERC-20 extended for Tempo (memo transfers, rewards, pause, transfer
  policies, `currency`, `quoteToken`, `logoURI`, supply cap, roles).
- Tokens are **not deployed as contracts** — they're created by the **TIP20Factory**
  precompile `0x20fc…0000`:
  `createToken(name, symbol, currency, quoteToken, admin, salt[, logoURI]) → address`.
  Address = `0x20c0…` prefix + token id, deterministic from
  `getTokenAddress(sender, salt)`.
- `viem/tempo` `Actions.token.create` / `createSync` wrap this and
  `createSync.extractEvent` gives the `TokenCreated` event → new token address.
- After creation the `admin` holds `DEFAULT_ADMIN_ROLE` — **not** `ISSUER_ROLE`.
  To mint, the admin must first `grantRole(keccak256("ISSUER_ROLE"), admin)` to
  itself (the Launch UI exposes a "Grant ISSUER_ROLE" step). `ISSUER_ROLE = 0x114e74f6…aa122`.
- Typical memecoin flow: `createToken` → `grantRole(ISSUER_ROLE, self)` →
  `mint` initial supply to the creator → (optionally) list.
- `quoteToken` defaults to pathUSD. If `currency` is `"USD"`, the `quoteToken`
  must also be USD-denominated.

## Wallet architecture (don't break this)

- Stack: `viem` + `viem/tempo`/`ox/tempo` (Tempo tx `0x76`, WebAuthn P-256,
  TIP-20), React 19 + Vite, GH Pages deploy (`GH_PAGES=1 npm run build`).
- `src/chain.ts` — chain config, URLs, formatting helpers (single source of
  truth). Hosts the **network registry**: `NETWORKS` (canary / testnet),
  `getNetwork()`, `setNetwork()`, persisted at `nvnmchain:network:v1`, plus
  `chainFor(network)` / `feeTokenSymbol()` / `explorerUrl()` helpers.
- `src/lib/useNetwork.ts` — `useNetwork()` (`useSyncExternalStore`) so React
  re-renders on a network switch; `NetworkSwitcher` is the header control and
  `App` keys the screens by `network.key` (a switch remounts them, re-reading
  every balance / list from the newly selected chain).
- `src/lib/client.ts` — `publicClient` (no account) is a **lazy proxy** that
  rebuilds the underlying viem client when the network changes, so the module
  reference stays valid; `walletClientFor(credential,
  feeToken?)` (passkey account via `Account.fromWebAuthnP256`; the chain is only
  extended with `feeToken` when one is passed — no extension = the envelope omits
  `feeToken` and the node picks per the preference rules above),
  plus `estimateCallFee`/`sendContractCall` (generic contract calls via
  `tempo_simulateV1`), `getTokenHoldings`, and `getEffectiveFeeToken` (reads
  `FeeManager.userTokens` + token `currency` via eth_call to predict the fee
  token when omitted — do NOT reimplement the whole rule chain).
  RPC / explorer URLs always come from `getNetwork()` — never hardcode them.
- `src/lib/tip20.ts` — TIP-20 create/mint/metadata + `ISSUER_ROLE` grant.
- `src/lib/feeamm.ts` — FeeAMM reads/writes (`poolIdOf` is **order-dependent**,
  matching the chain's `getPoolId`), `quoteRebalance`, mint/burn/rebalanceSwap.
- `src/lib/portfolio.ts` — localStorage tracking of "my tokens" and "my
  positions" (the chain has no per-address index; token addresses come from a
  random salt and LP balances are keyed by pool hash). Re-enriched from chain.
  Keys are **scoped per network** (`…:v1:{network}`); the pre-network-switcher
  canary entries are migrated on first read.
- `src/components/` — `LaunchPanel` (create token), `SwapPanel` (rebalance),
  `PoolPanel` (single-sided liquidity), `MyTokens`/`MyPositions` (persisted
  lists), `SendPanel`, `ActivityList`.
- `src/lib/passkey.ts` — WebAuthn credential create/get; `src/lib/keystore.ts` — local storage.
- Send: empty fee-token field omits `fee_token` from the tx (node resolves it:
  the sent token if USD → account preference → the network's fee token);
  `sendContractCall` always passes `feeToken: PATHUSD` explicitly for
  launch/swap/pool txs.
- Build/checks: `npm run build` (tsc + vite), `npm run probe [-- testnet]`
  (live broadcast pipeline), `npm run e2e` (Playwright virtual authenticator).
- Passkeys are bound to origin (`rpId`); `localhost` creds ≠ deployed creds.
  A passkey is **not** network-scoped — the same credential/address exists on
  canary and testnet (balances differ).

## Gotchas checklist

- [ ] Read balances via TIP-20 `balanceOf`, never `eth_getBalance`.
- [ ] The fee token has 6 decimals on both networks (canary `pathUSD`,
      testnet `nUSD`); the address is the same predeploy `0x20c0…0000`.
- [ ] Never hardcode a chain ID / RPC / explorer URL or the `pathUSD` label —
      read them from `getNetwork()` / `feeTokenSymbol()`.
- [ ] Local asset lists (`portfolio.ts`) are per-network; keep new persistence
      keys scoped the same way.
- [ ] FeeAMM pool id is **order-dependent**; two pools per pair.
- [ ] FeeAMM swaps are **fixed-rate**, not `x·y=k`; no price impact/slippage
      from reserves — only the flat `M`/`N` rates.
- [ ] FeeAMM `mint` takes **validator tokens only**; the user→validator
      direction is not user-callable.
- [ ] FeeAMM requires **USD** currency on both tokens.
- [ ] Explorer tx `status` is `1|0` (not strings); `timestamp` is unix seconds.
