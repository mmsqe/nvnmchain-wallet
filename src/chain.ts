import { defineChain } from 'viem'
import { tempo } from 'viem/tempo/chains'

export const CHAIN_ID = 787222
export const RPC_URL = 'https://rpc.nvnm.canary.mantrachain.dev'
export const EXPLORER_URL = 'https://explorer.nvnm.canary.mantrachain.dev'

/**
 * NVNM Canary — a Tempo-compatible L1 (EVM + Tempo Transactions).
 *
 * Built on the official Tempo chain definition so that all Tempo
 * precompiles / transaction serializers / fee hooks apply:
 *   - AccountKeychain 0xaAAAaaAA00000000000000000000000000000000
 *   - NonceManager     0x4e4F4E4345000000000000000000000000000000
 *   - FeeManager       0xfeec000000000000000000000000000000000000
 *   - pathUSD          0x20c0000000000000000000000000000000000000
 */
export const nvnmchain = defineChain({
  ...tempo,
  id: CHAIN_ID,
  name: 'NVNM Canary',
  nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 6 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'nvnmchain Explorer', url: EXPLORER_URL },
  },
})

/** pathUSD — the fee token on NVNM Canary (TIP-20, 6 decimals). */
export const PATHUSD = '0x20c0000000000000000000000000000000000000'

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`
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
