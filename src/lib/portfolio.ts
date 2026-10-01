/**
 * Persists the user's created TIP-20 tokens and FeeAMM LP positions in
 * localStorage. The chain has no on-chain index of "assets created by
 * address" (token addresses are deterministic from a random salt, and LP
 * balances are keyed by pool hash), so we track them locally and re-enrich
 * with live on-chain data at render time.
 *
 * Entries are scoped per network — the same token address means different
 * tokens (or nothing at all) on canary vs testnet.
 */
import { getNetworkKey } from '../chain'

export type MyToken = {
  token: string
  name?: string
  symbol?: string
  currency?: string
  createdAt: number
}

export type MyPosition = {
  poolId: string
  userToken: string
  validatorToken: string
  createdAt: number
}

const TOKENS_KEY = 'nvnmchain:myTokens:v1'
const POSITIONS_KEY = 'nvnmchain:myPositions:v1'

/** Fired whenever a token or position is added/removed. */
export const ASSETS_CHANGED = 'nvnmchain:assets-changed'

/** Per-network storage key. */
function scopedKey(base: string): string {
  return `${base}:${getNetworkKey()}`
}

function read<T>(base: string): T[] {
  try {
    const key = scopedKey(base)
    let raw = localStorage.getItem(key)
    if (raw == null && getNetworkKey() === 'canary') {
      // one-time migration of entries saved before networks were selectable
      const legacy = localStorage.getItem(base)
      if (legacy != null) {
        localStorage.setItem(key, legacy)
        localStorage.removeItem(base)
        raw = legacy
      }
    }
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write<T>(base: string, items: T[]): void {
  localStorage.setItem(scopedKey(base), JSON.stringify(items))
}

function notify(): void {
  window.dispatchEvent(new CustomEvent(ASSETS_CHANGED))
}

export function listMyTokens(): MyToken[] {
  return read<MyToken>(TOKENS_KEY)
}

export function saveMyToken(token: MyToken): void {
  const all = listMyTokens().filter(
    (t) => t.token.toLowerCase() !== token.token.toLowerCase(),
  )
  all.unshift(token)
  write(TOKENS_KEY, all)
  notify()
}

export function removeMyToken(token: string): void {
  write(
    TOKENS_KEY,
    listMyTokens().filter((t) => t.token.toLowerCase() !== token.toLowerCase()),
  )
  notify()
}

export function listMyPositions(): MyPosition[] {
  return read<MyPosition>(POSITIONS_KEY)
}

export function saveMyPosition(position: MyPosition): void {
  const all = listMyPositions().filter(
    (p) => p.poolId.toLowerCase() !== position.poolId.toLowerCase(),
  )
  all.unshift(position)
  write(POSITIONS_KEY, all)
  notify()
}

export function removeMyPosition(poolId: string): void {
  write(
    POSITIONS_KEY,
    listMyPositions().filter((p) => p.poolId.toLowerCase() !== poolId.toLowerCase()),
  )
  notify()
}
