import { http } from 'viem'
import { createClient, Account, Addresses } from 'viem/tempo'
import { nvnmchain, PATHUSD, RPC_URL } from '../chain'
import type { StoredCredential } from './keystore'

/**
 * Shared Tempo client for public reads (no account).
 */
export const publicClient = createClient({
  chain: nvnmchain.extend({ feeToken: PATHUSD }),
  transport: http(nvnmchain.rpcUrls.default.http[0]),
})

/**
 * Wallet client bound to a passkey-backed WebAuthn account.
 * Transactions sent through this client are serialized as Tempo
 * Transactions (EIP-2718 type 0x76) signed with the passkey.
 */
export function walletClientFor(credential: StoredCredential) {
  const account = Account.fromWebAuthnP256({
    id: credential.id,
    publicKey: credential.publicKey as `0x${string}`,
  })
  return createClient({
    account,
    chain: nvnmchain.extend({ feeToken: PATHUSD }),
    transport: http(nvnmchain.rpcUrls.default.http[0]),
  })
}

/** Standard Multicall3 — deployed on NVNM chain (Tempo's chain config omits it). */
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'

/** Minimal TIP-20 view ABI (avoids `Abis.tip20`'s deep tuple types in multicall). */
const tip20MetaAbi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'account' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

const pathUsdAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'account' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

export async function getPathUsdBalance(address: string): Promise<bigint> {
  return publicClient.readContract({
    address: PATHUSD,
    abi: pathUsdAbi,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
  })
}

/**
 * Estimates the gas and pathUSD fee for a transfer.
 *
 * Gas is measured with `tempo_simulateV1`, which returns `gasUsed` even when
 * the transfer reverts (e.g. the sender has no pathUSD balance yet) — so this
 * works before the account is funded. The fee reserve is deterministic:
 * the node pre-charges `gasLimit × maxFeePerGas`, refunding unused gas.
 */
export type FeeEstimate = {
  /** Gas limit to set on the tx (simulated gas + buffer). */
  gasLimit: bigint
  /** Fee cap we commit to on-chain. */
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  /** Reserve needed on top of the send amount, in pathUSD base units. */
  fee: bigint
}

const FALLBACK_GAS = 300_000n
const FALLBACK_CONTRACT_GAS = 1_000_000n
const GAS_BUFFER = 50_000n
const GAS_PRICE_MULTIPLIER = 2n

/**
 * Estimates the gas + pathUSD fee for a TIP-20 `transfer` on the given token.
 * (Fees are always paid in pathUSD regardless of which token is being sent.)
 */
export async function estimateTokenTransferFee(
  from: string,
  token: string,
  to: string,
): Promise<FeeEstimate> {
  return estimateCallFee(from, token, encodeTransfer(to, 1n), FALLBACK_GAS)
}

/**
 * Estimates gas + pathUSD fee for an arbitrary contract call (calldata).
 * Uses `tempo_simulateV1` like transfers, which reports `gasUsed` even when
 * the call would revert (e.g. insufficient token balance) — so this works
 * before the account is funded or before the user holds the tokens.
 */
export async function estimateCallFee(
  from: string,
  to: string,
  data: `0x${string}`,
  fallbackGas: bigint = FALLBACK_CONTRACT_GAS,
): Promise<FeeEstimate> {
  let gasPrice: bigint
  try {
    gasPrice = await publicClient.getGasPrice()
  } catch {
    gasPrice = 600_000_000n
  }
  const maxFeePerGas = gasPrice * GAS_PRICE_MULTIPLIER
  const gasUsed = await simulateCallGas(from, to, data, fallbackGas)
  const gasLimit = gasUsed + GAS_BUFFER
  // pathUSD has 6 decimals; gas price is quoted in wei (1e18) → /1e12
  const fee = (gasLimit * maxFeePerGas) / 10n ** 12n
  return { gasLimit, maxFeePerGas, maxPriorityFeePerGas: 0n, fee }
}

async function simulateCallGas(
  from: string,
  to: string,
  data: `0x${string}`,
  fallbackGas: bigint,
): Promise<bigint> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tempo_simulateV1',
        params: [
          {
            blockStateCalls: [
              {
                blockOverrides: {},
                calls: [
                  {
                    from,
                    to,
                    data,
                    value: '0x0',
                  },
                ],
              },
            ],
          },
          'latest',
        ],
      }),
    })
    const json = await res.json()
    const gasUsed = json?.result?.blocks?.[0]?.calls?.[0]?.gasUsed
    const g = gasUsed ? BigInt(gasUsed) : 0n
    return g > 0n ? g : fallbackGas
  } catch {
    return fallbackGas
  }
}

/**
 * Sends an arbitrary contract call (encoded calldata) as a Tempo Transaction
 * signed by the passkey, with fees paid in pathUSD. Returns the tx hash and
 * the final on-chain status.
 */
export async function sendContractCall(
  credential: StoredCredential,
  from: string,
  to: string,
  data: `0x${string}`,
  onSubmitted?: (hash: string) => void,
): Promise<{ hash: string; status: 'ok' | 'reverted' | 'timeout' }> {
  const fee = await estimateCallFee(from, to, data)
  const client = walletClientFor(credential)
  const hash = await client.sendTransaction({
    to: to as `0x${string}`,
    data,
    value: 0n,
    feeToken: PATHUSD,
    gas: fee.gasLimit,
    maxFeePerGas: fee.maxFeePerGas,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
  })
  onSubmitted?.(hash)
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000,
    })
    return {
      hash,
      status: receipt.status === 'success' ? 'ok' : 'reverted',
    }
  } catch {
    return { hash, status: 'timeout' }
  }
}

/**
 * Sends a TIP-20 `transfer` of `amount` on `token` in a Tempo Transaction
 * signed by the passkey. Fees are paid in pathUSD (the chain's fee token).
 *
 * @returns hash plus final on-chain status: 'ok' | 'reverted' | 'timeout'
 */
export async function sendToken(
  credential: StoredCredential,
  token: string,
  to: string,
  amount: bigint,
  fee: FeeEstimate,
  feeToken: string = PATHUSD,
  onSubmitted?: (hash: string) => void,
): Promise<{ hash: string; status: 'ok' | 'reverted' | 'timeout' }> {
  const client = walletClientFor(credential)
  const hash = await client.sendTransaction({
    to: token as `0x${string}`,
    data: encodeTransfer(to, amount),
    value: 0n,
    feeToken: feeToken as `0x${string}`,
    gas: fee.gasLimit,
    maxFeePerGas: fee.maxFeePerGas,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
  })
  onSubmitted?.(hash)
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000,
    })
    return {
      hash,
      status: receipt.status === 'success' ? 'ok' : 'reverted',
    }
  } catch {
    return { hash, status: 'timeout' }
  }
}

export function encodeTransfer(to: string, amount: bigint): `0x${string}` {
  const fn = 'a9059cbb' // transfer(address,uint256)
  const toPart = to.slice(2).toLowerCase().padStart(64, '0')
  const amountPart = amount.toString(16).padStart(64, '0')
  return `0x${fn}${toPart}${amountPart}`
}

// ---------------------------------------------------------------------------
// Transaction history via Blockscout API
// ---------------------------------------------------------------------------
export type HistoryItem = {
  hash: string
  from: string
  to: string
  status: 'ok' | 'error' | 'pending'
  timestamp: string
  fee?: string
}

export type HistoryResult = {
  items: HistoryItem[]
  ok: boolean
}

export async function getHistory(
  address: string,
  limit = 20,
): Promise<HistoryResult> {
  // 1) Prefer the explorer JSON API. Note: the explorer must send CORS
  //    headers for this to work cross-origin (see the nvnmchain-explorer repo).
  try {
    const url = `${nvnmchain.blockExplorers!.default.url}/address/${address}?format=json&tab=transactions&page=1`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      const items: any[] = data?.transactions ?? []
      return {
        items: items.slice(0, limit).map((t) => ({
          hash: t.hash,
          from: t.from_addr ?? '',
          to: t.to_addr ?? '',
          // indexer status: 1 = success, 0 = reverted
          status: t.status === 1 ? 'ok' : t.status === 0 ? 'error' : 'pending',
          timestamp: t.timestamp
            ? new Date(Number(t.timestamp) * 1000).toISOString()
            : '',
          fee: t.fee_amount,
        })),
        ok: true,
      }
    }
  } catch {
    // CORS or network failure → fall through to the RPC reconstruction below.
  }

  // 2) Fallback: reconstruct recent TIP-20 transfer activity from the RPC
  //    (the RPC allows CORS, unlike the explorer).
  return getTransferHistory(address, limit)
}

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
/** ~13.7 hours at 0.5s blocks — the RPC caps `eth_getLogs` range at 100k. */
const HISTORY_WINDOW_BLOCKS = 99_000n
const BLOCK_TIME_SECONDS = 0.5

async function getTransferHistory(
  address: string,
  limit = 20,
): Promise<HistoryResult> {
  try {
    const [latestNum, latestBlock] = await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.getBlock({ blockTag: 'latest' }).catch(() => null),
    ])
    const fromBlock =
      latestNum > HISTORY_WINDOW_BLOCKS ? latestNum - HISTORY_WINDOW_BLOCKS : 0n
    const addrTopic = `0x${address.toLowerCase().slice(2).padStart(64, '0')}`

    const [inLogs, outLogs] = await Promise.all([
      rpcGetLogs({
        fromBlock: toHex(fromBlock),
        toBlock: 'latest',
        topics: [TRANSFER_TOPIC, null, addrTopic],
      }),
      rpcGetLogs({
        fromBlock: toHex(fromBlock),
        toBlock: 'latest',
        topics: [TRANSFER_TOPIC, addrTopic],
      }),
    ])

    const latestTs = latestBlock ? Number(latestBlock.timestamp) : 0
    const seen = new Set<string>()
    const all = [...inLogs, ...outLogs].sort((a, b) => {
      const d = Number(BigInt(b.blockNumber) - BigInt(a.blockNumber))
      return d !== 0 ? d : Number(BigInt(b.logIndex ?? 0) - BigInt(a.logIndex ?? 0))
    })

    const items: HistoryItem[] = []
    for (const log of all) {
      const key = `${log.transactionHash}:${log.logIndex ?? 0}`
      if (seen.has(key)) continue
      seen.add(key)
      const blockNumber = BigInt(log.blockNumber)
      // Tempo's RPC includes the block timestamp on logs; approximate when absent.
      const timestamp = log.blockTimestamp
        ? new Date(Number(BigInt(log.blockTimestamp)) * 1000).toISOString()
        : latestTs > 0
          ? new Date(
              latestTs * 1000 -
                Number(latestNum - blockNumber) * BLOCK_TIME_SECONDS * 1000,
            ).toISOString()
          : ''
      items.push({
        hash: log.transactionHash,
        from: topicToAddress(log.topics?.[1]),
        to: topicToAddress(log.topics?.[2]),
        status: 'ok',
        timestamp,
      })
      if (items.length >= limit) break
    }
    return { items, ok: true }
  } catch {
    return { items: [], ok: false }
  }
}

function toHex(n: bigint): string {
  return `0x${n.toString(16)}`
}

// ---------------------------------------------------------------------------
// Token holdings (non-pathUSD) via the explorer index; RPC fallback
// ---------------------------------------------------------------------------
export type TokenHolding = {
  token: string
  name: string
  symbol: string
  decimals: number
  balance: bigint
}

const HOLDINGS_TOKEN_CAP = 60

/**
 * Returns the TIP-20 tokens (other than pathUSD) that `address` holds a
 * non-zero balance of.
 *
 * The chain has no on-chain per-address token index, so we use the explorer's
 * indexed `holdings` (all balances, not just recent ones) to discover
 * candidates, then read name/symbol/decimals from the chain — the explorer's
 * indexed metadata can be stale/garbage (NUL-padded rows from an early
 * decoder bug). If the explorer is unreachable (CORS/network), falls back to
 * reconstructing candidates from recent incoming Transfer logs.
 */
export async function getTokenHoldings(
  address: string,
): Promise<TokenHolding[]> {
  let candidates: { token: string; balance: bigint }[] | null = null
  try {
    const url = `${nvnmchain.blockExplorers!.default.url}/address/${address}?format=json&tab=tokens`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      const holdings: any[] = data?.holdings ?? []
      candidates = holdings
        .filter(
          (h) => h.token && h.token.toLowerCase() !== PATHUSD.toLowerCase(),
        )
        .map((h) => ({ token: h.token, balance: BigInt(h.balance ?? 0) }))
        .filter((h) => h.balance > 0n)
        .slice(0, HOLDINGS_TOKEN_CAP)
    }
  } catch {
    // CORS/network failure → fall through to the RPC reconstruction below.
  }
  if (candidates) {
    return enrichHoldings(candidates)
  }
  return getHoldingsFromLogs(address)
}

/** Reads name/symbol/decimals from the chain (batched) for each candidate. */
async function enrichHoldings(
  candidates: { token: string; balance: bigint }[],
): Promise<TokenHolding[]> {
  const out: TokenHolding[] = []
  for (let i = 0; i < candidates.length; i += 25) {
    const chunk = candidates.slice(i, i + 25)
    const metas = await Promise.all(chunk.map((c) => readTokenMeta(c.token)))
    for (let j = 0; j < chunk.length; j++) {
      out.push({
        token: chunk[j].token,
        name: metas[j]?.name || 'Token',
        symbol: metas[j]?.symbol ?? '',
        decimals: metas[j]?.decimals ?? 6,
        balance: chunk[j].balance,
      })
    }
  }
  return out
}

async function readTokenMeta(token: string): Promise<{
  name: string
  symbol: string
  decimals: number
} | null> {
  try {
    const [name, symbol, decimals] = await publicClient.multicall({
      multicallAddress: MULTICALL3,
      contracts: [
        { address: token as `0x${string}`, abi: tip20MetaAbi, functionName: 'name' },
        { address: token as `0x${string}`, abi: tip20MetaAbi, functionName: 'symbol' },
        { address: token as `0x${string}`, abi: tip20MetaAbi, functionName: 'decimals' },
      ],
    })
    const clean = (v: unknown) =>
      String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
    return {
      name: clean(name.result),
      symbol: clean(symbol.result),
      decimals: Number(decimals.result ?? 6) || 6,
    }
  } catch {
    return null
  }
}

/**
 * RPC fallback: discover candidate tokens from recent incoming Transfer logs
 * (~13.7h window, same as the history fallback) and verify non-zero balances.
 */
async function getHoldingsFromLogs(address: string): Promise<TokenHolding[]> {
  try {
    const latestNum = await publicClient.getBlockNumber()
    const fromBlock =
      latestNum > HISTORY_WINDOW_BLOCKS ? latestNum - HISTORY_WINDOW_BLOCKS : 0n
    const addrTopic = `0x${address.toLowerCase().slice(2).padStart(64, '0')}`
    const inLogs = await rpcGetLogs({
      fromBlock: toHex(fromBlock),
      toBlock: 'latest',
      topics: [TRANSFER_TOPIC, null, addrTopic],
    })
    const tokens = new Set<string>()
    for (const log of inLogs) {
      const t = String(log.address ?? '').toLowerCase()
      if (t && t !== PATHUSD.toLowerCase()) tokens.add(t)
    }
    const list = [...tokens].slice(0, HOLDINGS_TOKEN_CAP)
    if (list.length === 0) return []
    const balances = await publicClient.multicall({
      multicallAddress: MULTICALL3,
      contracts: list.map((t) => ({
        address: t as `0x${string}`,
        abi: pathUsdAbi,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      })),
    })
    const held = list
      .map((t, i) => ({
        token: t,
        balance:
          balances[i]?.status === 'success'
            ? (balances[i].result as bigint)
            : 0n,
      }))
      .filter((h) => h.balance > 0n)
    return enrichHoldings(held)
  } catch {
    return []
  }
}

function topicToAddress(topic: string | undefined): string {
  if (!topic || topic.length < 40) return ''
  return `0x${topic.slice(-40)}`
}

async function rpcGetLogs(params: unknown): Promise<any[]> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getLogs',
      params: [params],
    }),
  })
  const json = await res.json()
  return Array.isArray(json?.result) ? json.result : []
}

/** Attempts the Tempo faucet RPC (not enabled on this canary). */
export async function tryFaucet(address: string): Promise<string | null> {
  try {
    const res = await fetch(nvnmchain.rpcUrls.default.http[0], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tempo_fundAddress',
        params: [address],
      }),
    })
    const json = await res.json()
    if (json?.result) return json.result
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// AccountKeychain precompile — access keys
// ---------------------------------------------------------------------------
const keychainAbi = [
  {
    type: 'function',
    name: 'getKey',
    stateMutability: 'view',
    inputs: [
      { type: 'address', name: 'account' },
      { type: 'address', name: 'keyId' },
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          { type: 'uint8', name: 'signatureType' },
          { type: 'address', name: 'keyId' },
          { type: 'uint64', name: 'expiry' },
          { type: 'bool', name: 'enforceLimits' },
          { type: 'bool', name: 'isRevoked' },
        ],
        name: 'keyInfo',
      },
    ],
  },
  {
    type: 'function',
    name: 'isAdminKey',
    stateMutability: 'view',
    inputs: [
      { type: 'address', name: 'account' },
      { type: 'address', name: 'keyId' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

export const ACCOUNT_KEYCHAIN = Addresses.accountKeychain

export async function getKeyInfo(
  account: string,
  keyId: string,
): Promise<{
  signatureType: number
  expiry: bigint
  enforceLimits: boolean
  isRevoked: boolean
} | null> {
  try {
    const [info, isAdmin] = await publicClient.multicall({
      multicallAddress: MULTICALL3,
      contracts: [
        {
          address: ACCOUNT_KEYCHAIN,
          abi: keychainAbi,
          functionName: 'getKey',
          args: [account as `0x${string}`, keyId as `0x${string}`],
        },
        {
          address: ACCOUNT_KEYCHAIN,
          abi: keychainAbi,
          functionName: 'isAdminKey',
          args: [account as `0x${string}`, keyId as `0x${string}`],
        },
      ],
    })
    if (info.status !== 'success' || info.result === undefined) return null
    const k = info.result
    return {
      signatureType: Number(k.signatureType),
      expiry: k.expiry,
      enforceLimits: k.enforceLimits,
      isRevoked: k.isRevoked,
      ...(isAdmin.status === 'success' ? { isAdmin: isAdmin.result } : {}),
    }
  } catch {
    return null
  }
}
