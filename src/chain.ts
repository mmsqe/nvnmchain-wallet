import { defineChain } from 'viem'
import { tempo } from 'viem/tempo/chains'

/**
 * NVNM Chain networks.
 *
 * Both are Tempo-compatible L1s (EVM + Tempo Transactions) built on the
 * official Tempo chain definition, so all Tempo precompiles / transaction
 * serializers / fee hooks apply:
 *   - AccountKeychain 0xaAAAaaAA00000000000000000000000000000000
 *   - NonceManager     0x4e4F4E4345000000000000000000000000000000
 *   - FeeManager       0xfeec000000000000000000000000000000000000
 *   - pathUSD          0x20c0000000000000000000000000000000000000
 * The TIP-20 predeploy addresses are shared across networks (only the token
 * metadata — e.g. the fee token's symbol — differs per chain).
 */
export type NetworkKey = 'canary' | 'testnet' | 'local'

export type NetworkConfig = {
  key: NetworkKey
  /** Display name, e.g. "NVNM Canary". */
  name: string
  chainId: number
  rpcUrl: string
  explorerUrl: string
  /** Name shown in the explorer link title (cosmetic). */
  explorerName: string
  /**
   * UI label for the fee token at `PATHUSD` (0x20c0…0000). The chain-side
   * symbol differs per network (canary: `nvnmUSD`, testnet: `nUSD`); we keep
   * the familiar `pathUSD` label on canary.
   */
  feeTokenSymbol: string
  /** Test networks get a visual warning and looser copy. */
  testnet: boolean
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  canary: {
    key: 'canary',
    name: 'NVNM Canary',
    chainId: 787222,
    rpcUrl: 'https://rpc.nvnm.canary.mantrachain.dev',
    explorerUrl: 'https://explorer.nvnm.canary.mantrachain.dev',
    explorerName: 'nvnmchain Explorer',
    feeTokenSymbol: 'pathUSD',
    testnet: false,
  },
  testnet: {
    key: 'testnet',
    name: 'NVNM Testnet',
    chainId: 787223,
    rpcUrl: 'https://rpc.nvnm.testnet.nvnmchain.io',
    explorerUrl: 'https://explorer.nvnm.testnet.nvnmchain.io',
    explorerName: 'nvnmchain Testnet Explorer',
    feeTokenSymbol: 'nUSD',
    testnet: true,
  },
  local: {
    key: 'local',
    name: 'Local',
    // A localnet's id, which a fork of canary keeps too.
    chainId: 787222,
    rpcUrl: import.meta.env.VITE_LOCAL_RPC_URL ?? 'http://127.0.0.1:8545',
    explorerUrl: import.meta.env.VITE_LOCAL_EXPLORER_URL ?? 'http://localhost:8080',
    explorerName: 'Local Explorer',
    feeTokenSymbol: 'nUSD',
    testnet: true,
  },
}

/** The networks the picker offers: a local node only under `npm run dev`. */
export const NETWORK_KEYS = (Object.keys(NETWORKS) as NetworkKey[]).filter(
  (key) => key !== 'local' || import.meta.env.DEV,
)
export const DEFAULT_NETWORK: NetworkKey = 'canary'

const STORAGE_KEY = 'nvnmchain:network:v1'

/** Fired (on `window`) after the active network changes. */
export const NETWORK_CHANGED = 'nvnmchain:network-changed'

let activeKey: NetworkKey | null = null

/** The active network key (persisted in localStorage, defaults to canary). */
export function getNetworkKey(): NetworkKey {
  if (activeKey) return activeKey
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* storage unavailable (SSR / private mode) */
  }
  activeKey = NETWORK_KEYS.includes(stored as NetworkKey)
    ? (stored as NetworkKey)
    : DEFAULT_NETWORK
  return activeKey
}

/** The active network's config. */
export function getNetwork(): NetworkConfig {
  return NETWORKS[getNetworkKey()]
}

/**
 * Switches the active network and notifies subscribers. Everything that
 * reads `getNetwork()` (clients, explorer URLs, holdings) follows the
 * change; React components re-render via `useNetwork()`.
 */
export function setNetwork(key: NetworkKey): void {
  if (!(key in NETWORKS) || key === getNetworkKey()) return
  activeKey = key
  try {
    localStorage.setItem(STORAGE_KEY, key)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(NETWORK_CHANGED, { detail: key }))
}

/**
 * Re-reads the persisted network (used on cross-tab `storage` events) and
 * notifies subscribers when it differs from the active one.
 */
export function syncNetworkFromStorage(): void {
  const previous = getNetworkKey()
  activeKey = null
  if (getNetworkKey() !== previous) {
    window.dispatchEvent(new CustomEvent(NETWORK_CHANGED))
  }
}

const chainCache = new Map<NetworkKey, ReturnType<typeof makeChain>>()

/** viem `Chain` for a network (cached — viem compares chains by identity). */
function makeChain(net: NetworkConfig) {
  return defineChain({
    ...tempo,
    id: net.chainId,
    name: net.name,
    nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 6 },
    rpcUrls: { default: { http: [net.rpcUrl] } },
    blockExplorers: {
      default: { name: net.explorerName, url: net.explorerUrl },
    },
  })
}

export function chainFor(key: NetworkKey = getNetworkKey()) {
  const cached = chainCache.get(key)
  if (cached) return cached
  const chain = makeChain(NETWORKS[key])
  chainCache.set(key, chain)
  return chain
}

/** pathUSD — the fee token (TIP-20, 6 decimals), same predeploy on all networks. */
export const PATHUSD = '0x20c0000000000000000000000000000000000000'

/** The active network's fee-token label (e.g. `pathUSD` on canary). */
export function feeTokenSymbol(): string {
  return getNetwork().feeTokenSymbol
}

/** The active network's explorer base URL. */
export function explorerUrl(): string {
  return getNetwork().explorerUrl
}

export function explorerTxUrl(hash: string): string {
  return `${explorerUrl()}/tx/${hash}`
}

export function explorerAddressUrl(address: string): string {
  return `${explorerUrl()}/address/${address}`
}

export function formatUnits(
  value: bigint | null | undefined,
  decimals = 6,
): string {
  if (value == null) return '—'
  const negative = value < 0n
  const abs = negative ? -value : value
  const s = abs.toString().padStart(decimals + 1, '0')
  const whole = s.slice(0, -decimals)
  const frac = s.slice(-decimals).replace(/0+$/, '')
  const out = frac ? `${whole}.${frac}` : whole
  return `${negative ? '-' : ''}${out}`
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
