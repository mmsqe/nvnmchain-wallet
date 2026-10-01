import { useEffect, useRef, useState } from 'react'
import { isAddress, parseUnits } from 'viem'
import type { StoredCredential } from '../lib/keystore'
import {
  getPool,
  getLiquidityBalance,
  getTotalSupply,
  mintLiquidity,
  burnLiquidity,
  poolIdOf,
  N,
  SCALE,
  MIN_LIQUIDITY,
  type Pool,
} from '../lib/feeamm'
import { getTokenBalance, getTokenMeta, type TokenMeta } from '../lib/tip20'
import { formatUnits, explorerTxUrl, shortAddress, PATHUSD, feeTokenSymbol } from '../chain'
import { saveMyPosition, listMyTokens } from '../lib/portfolio'
import { formatTxError } from '../lib/errors'

type Phase = 'idle' | 'adding' | 'removing' | 'submitted'

export function PoolPanel({
  credential,
  address,
}: {
  credential: StoredCredential
  address: string
}) {
  const [userToken, setUserToken] = useState('')
  const [validatorToken, setValidatorToken] = useState(PATHUSD)
  const feeSymbol = feeTokenSymbol()
  const [pool, setPool] = useState<Pool | null>(null)
  const [totalSupply, setTotalSupply] = useState<bigint | null>(null)
  const [lpBalance, setLpBalance] = useState<bigint | null>(null)
  const [userMeta, setUserMeta] = useState<TokenMeta | null>(null)
  const [valMeta, setValMeta] = useState<TokenMeta | null>(null)
  const [valBalance, setValBalance] = useState<bigint | null>(null)
  const [addAmount, setAddAmount] = useState('')
  const [removeAmount, setRemoveAmount] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const suggestions = [
    { value: PATHUSD, label: feeTokenSymbol() },
    ...listMyTokens().map((t) => ({
      value: t.token,
      label: t.symbol ?? t.name ?? shortAddress(t.token),
    })),
  ]

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const u = userToken.trim()
      const v = validatorToken.trim()
      setPool(null)
      setTotalSupply(null)
      setLpBalance(null)
      if (!isAddress(u) || !isAddress(v) || u.toLowerCase() === v.toLowerCase()) return
      const poolId = poolIdOf(u, v)
      const [p, ts, lb, um, vm, vb] = await Promise.all([
        getPool(u, v),
        getTotalSupply(poolId),
        getLiquidityBalance(poolId, address),
        getTokenMeta(u),
        getTokenMeta(v),
        getTokenBalance(v, address),
      ])
      setPool(p)
      setTotalSupply(ts)
      setLpBalance(lb)
      setUserMeta(um)
      setValMeta(vm)
      setValBalance(vb)
    }, 300)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [userToken, validatorToken, address])

  const addWei = (() => {
    if (!addAmount) return 0n
    try {
      return parseUnits(addAmount, 6)
    } catch {
      return 0n
    }
  })()
  const removeWei = (() => {
    if (!removeAmount) return 0n
    try {
      return parseUnits(removeAmount, 6)
    } catch {
      return 0n
    }
  })()

  const predicted = predictLiquidity(addWei, pool, totalSupply)
  const burnOut = predictBurn(removeWei, pool, totalSupply)

  const busy = phase !== 'idle'

  async function handleAdd() {
    setError(null)
    setNotice(null)
    setTxHash(null)
    const u = userToken.trim()
    const v = validatorToken.trim()
    if (!isAddress(u) || !isAddress(v)) return setError('Enter valid token addresses for both sides.')
    if (u.toLowerCase() === v.toLowerCase()) return setError('User and validator tokens must differ.')
    if (addWei <= 0n) return setError('Enter an amount to deposit.')
    if (predicted.error) return setError(predicted.error)
    if (valBalance !== null && addWei > valBalance)
      return setError(`Insufficient ${valMeta?.symbol ?? 'validator token'} balance.`)

    setPhase('adding')
    try {
      const res = await mintLiquidity(
        credential,
        address,
        { userToken: u, validatorToken: v, amountValidatorToken: addWei, to: address },
        () => setPhase('submitted'),
      )
      setTxHash(res.hash)
      if (res.status === 'ok') {
        setNotice('Liquidity added.')
        setAddAmount('')
        saveMyPosition({
          poolId: poolIdOf(u, v),
          userToken: u,
          validatorToken: v,
          createdAt: Date.now(),
        })
        refresh(u, v)
      } else if (res.status === 'reverted') {
        setError('Mint reverted on-chain.')
      } else {
        setError('Confirmation timed out — check the explorer.')
      }
    } catch (e: any) {
      setError(formatTxError(e))
    } finally {
      setPhase('idle')
    }
  }

  async function handleRemove() {
    setError(null)
    setNotice(null)
    setTxHash(null)
    const u = userToken.trim()
    const v = validatorToken.trim()
    if (!isAddress(u) || !isAddress(v)) return setError('Enter valid token addresses for both sides.')
    if (removeWei <= 0n) return setError('Enter an amount of LP to remove.')
    if (lpBalance === null || removeWei > lpBalance) return setError('Amount exceeds your LP balance.')

    setPhase('removing')
    try {
      const res = await burnLiquidity(
        credential,
        address,
        { userToken: u, validatorToken: v, liquidity: removeWei, to: address },
        () => setPhase('submitted'),
      )
      setTxHash(res.hash)
      if (res.status === 'ok') {
        setNotice('Liquidity removed.')
        setRemoveAmount('')
        refresh(u, v)
      } else if (res.status === 'reverted') {
        setError('Burn reverted on-chain.')
      } else {
        setError('Confirmation timed out — check the explorer.')
      }
    } catch (e: any) {
      setError(formatTxError(e))
    } finally {
      setPhase('idle')
    }
  }

  function refresh(u: string, v: string) {
    const poolId = poolIdOf(u, v)
    Promise.all([
      getPool(u, v),
      getTotalSupply(poolId),
      getLiquidityBalance(poolId, address),
      getTokenBalance(v, address),
    ]).then(([p, ts, lb, vb]) => {
      setPool(p)
      setTotalSupply(ts)
      setLpBalance(lb)
      setValBalance(vb)
    })
  }

  const isNew = pool && pool.reserveUserToken === 0n && pool.reserveValidatorToken === 0n

  return (
    <section className="card pool-card">
      <h2>Liquidity (FeeAMM)</h2>
      <p className="muted small">
        Liquidity is <strong>single-sided</strong>: you deposit the validator
        token only (user tokens enter via fee swaps). The first deposit registers
        the pool — pools are directional, so the token order below matters.
      </p>

      <div className="grid-2">
        <div>
          <label className="lbl" htmlFor="lp-user">User token</label>
          <input id="lp-user" className="field mono" list="lp-token-options" value={userToken} onChange={(e) => setUserToken(e.target.value)} placeholder="0x20c0…" spellCheck={false} disabled={busy} />
        </div>
        <div>
          <label className="lbl" htmlFor="lp-val">Validator token (you deposit this)</label>
          <input id="lp-val" className="field mono" list="lp-token-options" value={validatorToken} onChange={(e) => setValidatorToken(e.target.value)} placeholder="0x…" spellCheck={false} disabled={busy} />
        </div>
      </div>
      <datalist id="lp-token-options">
        {suggestions.map((s) => (
          <option key={s.value} value={s.value} label={s.label} />
        ))}
      </datalist>
      <p className="muted small">
        To pay fees in your token, set <strong>User token</strong> to it and{' '}
        <strong>Validator token</strong> to {feeSymbol}, then add {feeSymbol} below.
      </p>

      {pool && (
        <div className="pool-overview">
          <div className="muted small">
            {isNew ? 'Pool is empty — first deposit creates it.' : (
              <>Reserves: {formatUnits(pool.reserveUserToken)} {userMeta?.symbol ?? 'user'} · {formatUnits(pool.reserveValidatorToken)} {valMeta?.symbol ?? 'validator'}</>
            )}
            {totalSupply !== null && <> · LP supply {fmtLp(totalSupply)}</>}
          </div>
          <div className="muted small">
            Your LP:{' '}
            {lpBalance === null ? '—' : fmtLp(lpBalance)}
            {valMeta && valBalance !== null && (
              <> · Your {valMeta.symbol}: {formatUnits(valBalance)}</>
            )}
          </div>
        </div>
      )}

      <div className="lp-grid">
        <div className="lp-col">
          <label className="lbl" htmlFor="add-amt">Add (validator token)</label>
          <input id="add-amt" className="field mono" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} placeholder="0.00" inputMode="decimal" disabled={busy} />
          {addWei > 0n && !predicted.error && (
            <span className="muted small">You receive ≈ {fmtLp(predicted.liquidity)} LP</span>
          )}
          {predicted.error && <span className="fee-warn small">{predicted.error}</span>}
          <button className="btn primary lp-btn" onClick={handleAdd} disabled={busy}>
            {phase === 'adding' ? 'Awaiting passkey…' : phase === 'submitted' ? 'Awaiting confirmation…' : 'Add liquidity'}
          </button>
        </div>

        <div className="lp-col">
          <label className="lbl" htmlFor="rm-amt">Remove (LP amount)</label>
          <input id="rm-amt" className="field mono" value={removeAmount} onChange={(e) => setRemoveAmount(e.target.value)} placeholder="0.00" inputMode="decimal" disabled={busy} />
          {removeWei > 0n && (
            <span className="muted small">
              Returns ≈ {formatUnits(burnOut.amountUser)} {userMeta?.symbol ?? 'user'} + {formatUnits(burnOut.amountValidator)} {valMeta?.symbol ?? 'validator'}
            </span>
          )}
          <button className="btn ghost lp-btn" onClick={handleRemove} disabled={busy || lpBalance === null || lpBalance === 0n}>
            {phase === 'removing' ? 'Awaiting passkey…' : phase === 'submitted' ? 'Awaiting confirmation…' : 'Remove liquidity'}
          </button>
        </div>
      </div>

      {notice && txHash && (
        <div className="success">
          {notice}{' '}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            {shortAddress(txHash)} ↗
          </a>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </section>
  )
}

const fmtLp = (v: bigint) => v.toLocaleString('en-US')

function predictLiquidity(
  amountValidatorToken: bigint,
  pool: Pool | null,
  totalSupply: bigint | null,
): { liquidity: bigint; error?: string } {
  if (amountValidatorToken <= 0n) return { liquidity: 0n }
  if (!pool) return { liquidity: 0n }
  if (pool.reserveUserToken === 0n && pool.reserveValidatorToken === 0n) {
    const half = amountValidatorToken / 2n
    if (half <= MIN_LIQUIDITY) {
      return {
        liquidity: 0n,
        error: `Initial deposit must exceed ${formatUnits(MIN_LIQUIDITY * 2n)} (2 × MIN_LIQUIDITY).`,
      }
    }
    return { liquidity: half - MIN_LIQUIDITY }
  }
  const product = (N * pool.reserveUserToken) / SCALE
  const denom = pool.reserveValidatorToken + product
  if (denom === 0n) return { liquidity: 0n, error: 'Pool has no validator reserves.' }
  const liquidity = (amountValidatorToken * (totalSupply ?? 0n)) / denom
  return { liquidity }
}

function predictBurn(
  liquidity: bigint,
  pool: Pool | null,
  totalSupply: bigint | null,
): { amountUser: bigint; amountValidator: bigint } {
  if (!pool || !totalSupply || totalSupply === 0n || liquidity <= 0n) {
    return { amountUser: 0n, amountValidator: 0n }
  }
  return {
    amountUser: (liquidity * pool.reserveUserToken) / totalSupply,
    amountValidator: (liquidity * pool.reserveValidatorToken) / totalSupply,
  }
}
