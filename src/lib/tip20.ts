import { encodeFunctionData } from 'viem'
import { Abis, Addresses } from 'viem/tempo'
import { publicClient, sendContractCall } from './client'
import { PATHUSD } from '../chain'
import type { StoredCredential } from './keystore'

/** TIP-20 factory precompile — creates tokens deterministically (no deploy). */
export const TIP20_FACTORY = Addresses.tip20Factory

/** keccak256("ISSUER_ROLE") — required to call `mint` on a TIP-20. */
export const ISSUER_ROLE =
  '0x114e74f6ea3bd819998f78687bfcb11b140da08e9b7d222fa9c1f1ba1f2aa122'

export type TokenMeta = {
  name: string
  symbol: string
  currency: string
  decimals: number
}

export function randomSalt(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`
}

/** Reads a TIP-20 token's name / symbol / currency / decimals. */
export async function getTokenMeta(token: string): Promise<TokenMeta | null> {
  try {
    const [name, symbol, currency, decimals] = await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { address: token as `0x${string}`, abi: Abis.tip20, functionName: 'name' },
        { address: token as `0x${string}`, abi: Abis.tip20, functionName: 'symbol' },
        { address: token as `0x${string}`, abi: Abis.tip20, functionName: 'currency' },
        { address: token as `0x${string}`, abi: Abis.tip20, functionName: 'decimals' },
      ],
    })
    return {
      name: name as string,
      symbol: symbol as string,
      currency: currency as string,
      decimals: Number(decimals),
    }
  } catch {
    return null
  }
}

export async function getTokenBalance(
  token: string,
  address: string,
): Promise<bigint | null> {
  try {
    return await publicClient.readContract({
      address: token as `0x${string}`,
      abi: Abis.tip20,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    })
  } catch {
    return null
  }
}

export async function getTokenTotalSupply(token: string): Promise<bigint | null> {
  try {
    return await publicClient.readContract({
      address: token as `0x${string}`,
      abi: Abis.tip20,
      functionName: 'totalSupply',
    })
  } catch {
    return null
  }
}

/** Checks whether `account` holds a role on the token (e.g. ISSUER_ROLE). */
export async function hasRole(
  token: string,
  account: string,
  role: string,
): Promise<boolean> {
  try {
    return await publicClient.readContract({
      address: token as `0x${string}`,
      abi: Abis.tip20,
      functionName: 'hasRole',
      args: [account as `0x${string}`, role as `0x${string}`],
    })
  } catch {
    return false
  }
}

/**
 * Predicts the deterministic address a token will be created at.
 * Address = TIP20 prefix (0x20c0…00) + token id from keccak256(sender, salt).
 */
export async function predictTokenAddress(
  sender: string,
  salt: `0x${string}`,
): Promise<string | null> {
  try {
    return await publicClient.readContract({
      address: TIP20_FACTORY,
      abi: Abis.tip20Factory,
      functionName: 'getTokenAddress',
      args: [sender as `0x${string}`, salt],
    })
  } catch {
    return null
  }
}

export type TxResult = { hash: string; status: 'ok' | 'reverted' | 'timeout' }

export type CreateTokenParams = {
  name: string
  symbol: string
  currency: string
  quoteToken?: string
  logoURI?: string
  admin: string
  salt?: `0x${string}`
}

/**
 * Creates a TIP-20 token permissionlessly via the TIP20Factory precompile.
 * The creator (`admin`) receives the default admin role and can then grant
 * itself ISSUER_ROLE and mint supply.
 *
 * Note: FeeAMM only accepts tokens whose `currency` is `"USD"`.
 */
export async function createTip20(
  credential: StoredCredential,
  from: string,
  params: CreateTokenParams,
  onSubmitted?: (hash: string) => void,
): Promise<TxResult & { token: string | null }> {
  const { name, symbol, currency, quoteToken = PATHUSD, logoURI = '', admin } = params
  const salt = params.salt ?? randomSalt()
  const args = logoURI
    ? [name, symbol, currency, quoteToken, admin, salt, logoURI]
    : [name, symbol, currency, quoteToken, admin, salt]
  const data = encodeFunctionData({
    abi: Abis.tip20Factory,
    functionName: 'createToken',
    args: args as [string, string, string, `0x${string}`, `0x${string}`, `0x${string}`] &
      [string, string, string, `0x${string}`, `0x${string}`, `0x${string}`, string],
  })
  const result = await sendContractCall(
    credential,
    from,
    TIP20_FACTORY,
    data,
    onSubmitted,
  )
  const token =
    result.status === 'ok' ? await predictTokenAddress(from, salt) : null
  return { ...result, token }
}

/** Grants ISSUER_ROLE to `account` (caller must hold DEFAULT_ADMIN_ROLE). */
export async function grantIssuerRole(
  credential: StoredCredential,
  from: string,
  token: string,
  account: string,
  onSubmitted?: (hash: string) => void,
): Promise<TxResult> {
  const data = encodeFunctionData({
    abi: Abis.tip20,
    functionName: 'grantRole',
    args: [ISSUER_ROLE, account as `0x${string}`],
  })
  return sendContractCall(credential, from, token, data, onSubmitted)
}

/** Mints TIP-20 supply (caller must hold ISSUER_ROLE). */
export async function mintTip20(
  credential: StoredCredential,
  from: string,
  token: string,
  to: string,
  amount: bigint,
  onSubmitted?: (hash: string) => void,
): Promise<TxResult> {
  const data = encodeFunctionData({
    abi: Abis.tip20,
    functionName: 'mint',
    args: [to as `0x${string}`, amount],
  })
  return sendContractCall(credential, from, token, data, onSubmitted)
}
