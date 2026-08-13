import { encodeAbiParameters, encodeFunctionData, keccak256 } from 'viem'
import { Abis, Addresses } from 'viem/tempo'
import { publicClient, sendContractCall } from './client'
import type { StoredCredential } from './keystore'

/** The FeeAMM lives on the FeeManager precompile. */
export const FEE_AMM = Addresses.feeManager

// Fixed-point constants (mirror the chain's `tip_fee_manager::amm`).
export const SCALE = 10_000n
/** Fee-swap rate 0.9970 (user → validator, 30 bps) — runs only during fee payment. */
export const M = 9_970n
/** Rebalance rate 0.9985 (validator → user, 15 bps) — the user-callable swap. */
export const N = 9_985n
export const MIN_LIQUIDITY = 1_000n

export type Pool = {
  reserveUserToken: bigint
  reserveValidatorToken: bigint
}

/**
 * Computes a FeeAMM pool id client-side. This is **order-dependent**:
 * `poolId(userToken, validatorToken) = keccak256(abi.encode(userToken, validatorToken))`
 * and `Pool(A,B) ≠ Pool(B,A)`.
 */
export function poolIdOf(
  userToken: string,
  validatorToken: string,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }],
      [userToken as `0x${string}`, validatorToken as `0x${string}`],
    ),
  )
}

export async function getPool(
  userToken: string,
  validatorToken: string,
): Promise<Pool | null> {
  try {
    return await publicClient.readContract({
      address: FEE_AMM,
      abi: Abis.feeAmm,
      functionName: 'getPool',
      args: [userToken as `0x${string}`, validatorToken as `0x${string}`],
    })
  } catch {
    return null
  }
}

export async function getTotalSupply(poolId: `0x${string}`): Promise<bigint | null> {
  try {
    return await publicClient.readContract({
      address: FEE_AMM,
      abi: Abis.feeAmm,
      functionName: 'totalSupply',
      args: [poolId],
    })
  } catch {
    return null
  }
}

export async function getLiquidityBalance(
  poolId: `0x${string}`,
  address: string,
): Promise<bigint | null> {
  try {
    return await publicClient.readContract({
      address: FEE_AMM,
      abi: Abis.feeAmm,
      functionName: 'liquidityBalances',
      args: [poolId, address as `0x${string}`],
    })
  } catch {
    return null
  }
}

/** Reads the caller's stored preferred fee token (set via `setUserToken`). */
export async function getUserToken(user: string): Promise<string | null> {
  try {
    const token = await publicClient.readContract({
      address: FEE_AMM,
      abi: Abis.feeManager,
      functionName: 'userTokens',
      args: [user as `0x${string}`],
    })
    return (token as string).toLowerCase() ===
      '0x0000000000000000000000000000000000000000'
      ? null
      : (token as string)
  } catch {
    return null
  }
}

/**
 * Sets the caller's preferred fee token (must be a USD-denominated TIP-20).
 * Used by the chain when a transaction doesn't specify `feeToken` explicitly.
 */
export async function setUserToken(
  credential: StoredCredential,
  from: string,
  token: string,
  onSubmitted?: (hash: string) => void,
) {
  const data = encodeFunctionData({
    abi: Abis.feeManager,
    functionName: 'setUserToken',
    args: [token as `0x${string}`],
  })
  return sendContractCall(credential, from, FEE_AMM, data, onSubmitted)
}

/**
 * Quotes a rebalance swap: pay validator tokens, receive user tokens at the
 * fixed rate `amountOut * N / SCALE + 1`.
 */
export function quoteRebalance(amountOut: bigint): bigint {
  return (amountOut * N) / SCALE + 1n
}

export type FeeAmmTxParams = {
  userToken: string
  validatorToken: string
}

/**
 * Rebalance swap — the only user-callable swap direction: pays
 * `validatorToken` in, receives `amountOut` `userToken` to `to`.
 */
export async function rebalanceSwap(
  credential: StoredCredential,
  from: string,
  params: FeeAmmTxParams & { amountOut: bigint; to: string },
  onSubmitted?: (hash: string) => void,
) {
  const data = encodeFunctionData({
    abi: Abis.feeAmm,
    functionName: 'rebalanceSwap',
    args: [
      params.userToken as `0x${string}`,
      params.validatorToken as `0x${string}`,
      params.amountOut,
      params.to as `0x${string}`,
    ],
  })
  return sendContractCall(credential, from, FEE_AMM, data, onSubmitted)
}

/**
 * Provides liquidity — single-sided: deposits `amountValidatorToken` of the
 * validator token. First deposit creates (registers) the pool. User tokens
 * are never deposited; they enter the pool via fee swaps.
 */
export async function mintLiquidity(
  credential: StoredCredential,
  from: string,
  params: FeeAmmTxParams & { amountValidatorToken: bigint; to: string },
  onSubmitted?: (hash: string) => void,
) {
  const data = encodeFunctionData({
    abi: Abis.feeAmm,
    functionName: 'mint',
    args: [
      params.userToken as `0x${string}`,
      params.validatorToken as `0x${string}`,
      params.amountValidatorToken,
      params.to as `0x${string}`,
    ],
  })
  return sendContractCall(credential, from, FEE_AMM, data, onSubmitted)
}

/** Removes liquidity — burns LP shares and returns a pro-rata share of both reserves. */
export async function burnLiquidity(
  credential: StoredCredential,
  from: string,
  params: FeeAmmTxParams & { liquidity: bigint; to: string },
  onSubmitted?: (hash: string) => void,
) {
  const data = encodeFunctionData({
    abi: Abis.feeAmm,
    functionName: 'burn',
    args: [
      params.userToken as `0x${string}`,
      params.validatorToken as `0x${string}`,
      params.liquidity,
      params.to as `0x${string}`,
    ],
  })
  return sendContractCall(credential, from, FEE_AMM, data, onSubmitted)
}
