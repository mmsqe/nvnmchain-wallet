import { useEffect, useRef, useState } from 'react'
import { isAddress, parseUnits } from 'viem'
import type { StoredCredential } from '../lib/keystore'
import {
  getPool,
  quoteRebalance,
  rebalanceSwap,
  type Pool,
} from '../lib/feeamm'
import { getTokenBalance, getTokenMeta, type TokenMeta } from '../lib/tip20'
import { formatUnits, explorerTxUrl, shortAddress, PATHUSD } from '../chain'

type Phase = 'idle' | 'signing' | 'submitted'

export function SwapPanel({
  credential,
  address,
}: {
  credential: StoredCredential
  address: string
}) {
  const [userToken, setUserToken] = useState('')
  const [validatorToken, setValidatorToken] = useState(PATHUSD)
  const [amountOut, setAmountOut] = useState('')
  const [pool, setPool] = useState<Pool | null>(null)
  const [userMeta, setUserMeta] = useState<TokenMeta | null>(null)
  const [valMeta, setValMeta] = useState<TokenMeta | null>(null)
  const [userBalance, setUserBalance] = useState<bigint | null>(null)
  const [valBalance, setValBalance] = useState<bigint | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const u = userToken.trim()
      const v = validatorToken.trim()
      setPool(null)
      if (!isAddress(u) || !isAddress(v) || u.toLowerCase() === v.toLowerCase()) {
        setPool(null)
        return
      }
      const p = await getPool(u, v)
      setPool(p)
      const [um, vm, ub, vb] = await Promise.all([
        getTokenMeta(u),
        getTokenMeta(v),
        getTokenBalance(u, address),
        getTokenBalance(v, address),
      ])
      setUserMeta(um)
      setValMeta(vm)
      setUserBalance(ub)
      setValBalance(vb)
    }, 300)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [userToken, validatorToken, address])

  const amountOutWei = (() => {
    if (!amountOut) return 0n
    try {
      return parseUnits(amountOut, 6)
    } catch {
      return 0n
    }
  })()
  const amountInWei = amountOutWei > 0n ? quoteRebalance(amountOutWei) : 0n

  const insufficientReserves =
    pool !== null && amountOutWei > pool.reserveUserToken
  const insufficientBalance =
    valBalance !== null && amountInWei > valBalance

  const busy = phase !== 'idle'

  async function handleSwap() {
    setError(null)
    setDone(false)
    setTxHash(null)
    const u = userToken.trim()
    const v = validatorToken.trim()
    if (!isAddress(u) || !isAddress(v)) {
      setError('Enter valid token addresses for both sides.')
      return
    }
    if (u.toLowerCase() === v.toLowerCase()) {
      setError('User token and validator token must differ.')
      return
    }
    if (amountOutWei <= 0n) {
      setError('Enter the amount you want to receive.')
      return
    }
    if (insufficientReserves) {
      setError('The pool does not hold that much user-token liquidity.')
      return
    }
    if (insufficientBalance) {
      setError(
        `Insufficient ${valMeta?.symbol ?? 'validator token'} balance — you need ${formatUnits(amountInWei)}.`,
      )
      return
    }

    setPhase('signing')
    try {
      const res = await rebalanceSwap(
        credential,
        address,
        { userToken: u, validatorToken: v, amountOut: amountOutWei, to: address },
        () => setPhase('submitted'),
      )
      setTxHash(res.hash)
      if (res.status === 'ok') {
        setDone(true)
        setAmountOut('')
      } else if (res.status === 'reverted') {
        setError('Swap was mined but reverted on-chain.')
      } else {
        setError('Broadcast, but confirmation timed out — check the explorer.')
      }
    } catch (e: any) {
      setError(formatTxError(e))
    } finally {
      setPhase('idle')
    }
  }

  const rate =
    userMeta && valMeta
      ? `1 ${userMeta.symbol} ≈ 0.9985 ${valMeta.symbol} (fixed)`
      : ''

  return (
    <section className="card swap-card">
      <h2>Swap (FeeAMM rebalance)</h2>
      <p className="muted small">
        Fixed-rate swap: you pay the <em>validator token</em> and receive the{' '}
        <em>user token</em> at 0.9985. This is the only user-callable direction —
        the reverse runs automatically when fees are paid.
      </p>

      <label className="lbl" htmlFor="sw-user">Receive — user token</label>
      <input
        id="sw-user"
        className="field mono"
        value={userToken}
        onChange={(e) => setUserToken(e.target.value)}
        placeholder="0x20c0…"
        spellCheck={false}
        disabled={busy}
      />
      {userMeta && (
        <span className="muted small token-hint">
          {userMeta.name} ({userMeta.symbol}) · balance{' '}
          {userBalance === null ? '—' : formatUnits(userBalance)}
        </span>
      )}

      <label className="lbl" htmlFor="sw-val">Pay with — validator token</label>
      <input
        id="sw-val"
        className="field mono"
        value={validatorToken}
        onChange={(e) => setValidatorToken(e.target.value)}
        placeholder="0x…"
        spellCheck={false}
        disabled={busy}
      />
      {valMeta && (
        <span className="muted small token-hint">
          {valMeta.name} ({valMeta.symbol}) · balance{' '}
          {valBalance === null ? '—' : formatUnits(valBalance)}
        </span>
      )}

      <label className="lbl" htmlFor="sw-amount">You receive</label>
      <input
        id="sw-amount"
        className="field mono"
        value={amountOut}
        onChange={(e) => setAmountOut(e.target.value)}
        placeholder="0.00"
        inputMode="decimal"
        disabled={busy}
      />

      <div className="quote-line">
        <span className="muted small">
          {amountInWei > 0n ? (
            <>
              You pay <strong className="fee-amt">{formatUnits(amountInWei)}</strong>{' '}
              {valMeta?.symbol ?? 'validator token'}
            </>
          ) : (
            'Enter an amount to see the fixed-rate quote'
          )}
        </span>
        {rate && <span className="muted small">{rate}</span>}
      </div>

      {pool && (
        <div className="muted small pool-reserves">
          Pool reserves: {formatUnits(pool.reserveUserToken)} user ·{' '}
          {formatUnits(pool.reserveValidatorToken)} validator
          {insufficientReserves && (
            <span className="fee-warn"> — not enough user-token liquidity</span>
          )}
        </div>
      )}

      <button
        className="btn primary send-btn"
        onClick={handleSwap}
        disabled={busy || insufficientReserves || (amountOutWei > 0n && insufficientBalance)}
      >
        {phase === 'signing'
          ? 'Awaiting passkey approval…'
          : phase === 'submitted'
            ? 'Awaiting confirmation…'
            : 'Swap'}
      </button>

      {done && txHash && (
        <div className="success">
          ✓ Swap confirmed!{' '}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            {shortAddress(txHash)} ↗
          </a>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </section>
  )
}

function formatTxError(e: any): string {
  const msg = e?.shortMessage ?? e?.message ?? String(e)
  const details = e?.details ?? e?.cause?.details ?? ''
  if (/user rejected|rejected/i.test(msg)) return 'Passkey prompt was cancelled — nothing was sent.'
  if (/insufficient funds/i.test(details)) return 'Insufficient pathUSD to cover the fee.'
  return `${msg}${details ? ` — ${details}` : ''}`
}
