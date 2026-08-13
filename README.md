# NVNM Passkey Wallet

A self-custodial **WebAuthn (passkey) wallet** for **NVNM Chain** — a
Tempo-compatible L1 (EVM + Tempo Transactions). Sign in with Face ID,
Touch ID, Windows Hello, or a hardware security key. **No seed phrases.**

The wallet derives your address from the passkey's P-256 (secp256r1) public
key and signs **Tempo Transactions** (EIP-2718 type `0x76`) natively —
the same scheme used by [Tempo](https://wallet.tempo.xyz/) and its
[WebAuthn transaction spec](https://tempo.xyz/developers/docs/protocol/transactions/spec-tempo-transaction).

## Network

| | |
|---|---|
| Chain ID | `787222` |
| RPC | `https://rpc.nvnm.canary.mantrachain.dev` |
| Explorer | `https://explorer.nvnm.canary.mantrachain.dev` |
| Fee token | `pathUSD` (`0x20c0000000000000000000000000000000000000`) |
| Transaction type | Tempo Transaction (`0x76`) — WebAuthn/P-256 signatures |

NVNM Canary is a Tempo fork: it ships the Tempo precompiles
(AccountKeychain `0xaAAAaaAA…0000`, NonceManager `0x4e4F4E4345…`,
FeeManager `0xfeec…`, pathUSD `0x20c0…`), has **no native gas token**
(`eth_getBalance` returns the documented Tempo placeholder), and charges
fees in `pathUSD` via the Fee Manager.

## Features

- **Create wallet** — enter an email (it becomes your account name, stored
  locally; normalized to lowercase + trimmed) and register a passkey
  (resident key, user-verifying). Address is derived on-chain-style as
  `keccak256(pubKeyX ‖ pubKeyY)[12:]`.
- **Sign back in** — pick your email from the list and authenticate with the
  existing passkey; the public key is restored from the local keystore (it
  isn't extractable from the authenticator).
- **Cross-device login** — *"Sign in with a passkey on this device"* works
  with **zero local data**: the P-256 public key is recovered from the
  WebAuthn assertion itself (ECDSA public-key recovery). Because a signature
  yields two candidate keys, the wallet disambiguates via on-chain state
  (balance/nonce/code) or by intersecting candidates from a second
  confirmation — your address never depends on local storage.
- **Fee-aware Max** — gas is measured via `tempo_simulateV1` (works before
  the account is funded), the pathUSD fee reserve is computed deterministically
  (`gasLimit × maxFeePerGas / 1e12`), and Max leaves room for the fee.
- **Send any TIP-20 token** — one passkey prompt per transaction; fees are
  paid in `pathUSD`; broadcasts a type-`0x76` Tempo Transaction and reports the
  final on-chain status (confirmed / reverted / pending) instead of failing
  silently. The token field accepts any TIP-20 address (with pathUSD and your
  created tokens suggested).
- **Balance** — live `pathUSD` balance via the TIP-20 precompile.
- **Activity** — recent transactions from the nvnmchain explorer.
- **Request funds** — attempts the Tempo faucet RPC (`tempo_fundAddress`);
  currently not enabled on the canary, so it explains how to fund.
- **Launch a token** — create a TIP-20 permissionlessly via the factory
  precompile (name / symbol / currency / logo), predict the deterministic
  address, grant yourself `ISSUER_ROLE`, and mint supply.
- **Swap (FeeAMM)** — the user-callable `rebalanceSwap` direction
  (validator token → user token) at the fixed 0.9985 rate.
- **Pool (FeeAMM)** — single-sided liquidity: deposit validator tokens to
  create/seed a directional pool, view your LP position, and burn it back.
- **My tokens & positions** — the Launch and Pool tabs remember what you've
  created and provided liquidity to (locally, in this browser) and re-enrich
  with live balances, supplies, reserves, and LP share.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

> Passkeys are bound to the origin's hostname. On `localhost` they work out
> of the box; for a deployed site, serve it over HTTPS and the passkey's
> `rpId` becomes your domain automatically.

### Scripts

```bash
npm run probe     # validates the WebAuthn → type-0x76 broadcast pipeline
                  # against the live chain (expects "insufficient funds")
npm run e2e       # Playwright + virtual authenticator end-to-end test
npm run build     # production build
```

## Deploy

**Live at <https://yihuang.github.io/nvnmchain-wallet/>** — deployed with
GitHub Actions from the `main` branch (`.github/workflows/deploy.yml`):

```bash
git push origin main   # triggers build + deploy to GitHub Pages
```

To build with the Pages base path locally:

```bash
GH_PAGES=1 npm run build
```

Verify the live deployment with a virtual authenticator:

```bash
node scripts/gh-pages-check.mjs
```

> Passkeys are bound to the origin — on `yihuang.github.io` the passkey's
> RP ID is `yihuang.github.io`, so credentials created locally on
> `localhost` won't authenticate there (and vice-versa).

## How it works

1. **Register** — `viem/tempo`'s `WebAuthnP256.createCredential` creates a
   resident P-256 passkey. The public key is stored locally (the private
   key never leaves the authenticator).
2. **Derive** — the account address is
   `keccak256(publicKeyX ‖ publicKeyY)` truncated to 20 bytes, matching the
   chain's P-256/WebAuthn address derivation.
3. **Sign** — to send, the app builds a Tempo Transaction, computes the
   sign payload `keccak256(0x76 ‖ rlp([…]))`, and invokes
   `navigator.credentials.get()` with that hash as the challenge. The
   authenticator returns `authenticatorData ‖ clientDataJSON ‖ r ‖ s`,
   wrapped in a WebAuthn signature envelope (type byte `0x02`).
4. **Broadcast** — the envelope is serialized as a type-`0x76` transaction
   and sent via `eth_sendRawTransaction`. The node verifies the P-256
   signature over `sha256(authenticatorData ‖ sha256(clientDataJSON))`,
   checks the `webauthn.get` client data and challenge, derives the sender,
   and charges fees in `pathUSD`.

This pipeline is verified against the live canary node
(`scripts/probe.mjs`): the node parses, signature-verifies, and fee-checks
the transaction, rejecting only for missing funds.

## Stack

- [viem](https://viem.sh) + `viem/tempo` / `ox/tempo` — Tempo Transactions,
  TIP-20, fee tokens, WebAuthn/P-256 accounts
- React 19 + Vite
- nvnmchain explorer JSON API (`?format=json`) for explorer data

## Notes

- The canary has **no public faucet** — you need `pathUSD` sent to your
  address to pay fees. Ask the chain operator to fund the derived address.
- `eth_getBalance` always returns the Tempo placeholder
  (`4.242424242424242e75`); always read balances from TIP-20
  `balanceOf(pathUSD, …)` instead.

## Cross-device & iCloud Keychain

Passkeys live in the platform authenticator and **sync automatically** between
devices signed into the same account (iCloud Keychain on Apple devices,
Google Password Manager on Android). To log in on another device:

1. Use the **same URL** on both devices (passkeys are bound to the origin —
   a passkey created on `localhost` won't appear on the deployed site).
2. On the new device, tap **"Sign in with a passkey on this device"**.
3. Pick your passkey. If the account has no on-chain activity yet, approve
   **twice** — the wallet uses the two assertions to cryptographically
   identify your passkey (see below), then remembers it on that device.

> Why twice? A WebAuthn assertion does not expose the public key, and ECDSA
> recovery from a single signature yields **two** candidate keys that both
> validate. The wallet intersects candidates from two assertions — the true
> key appears in both, the decoy differs each time — so the recovered address
> is exact. For accounts with any on-chain activity, one confirmation suffices
> (the wallet checks which candidate address actually has state).
