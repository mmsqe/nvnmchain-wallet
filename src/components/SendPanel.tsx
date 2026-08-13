import { useEffect, useRef, useState } from 'react'
import { isAddress, parseUnits } from 'viem'
import type { StoredCredential } from '../lib/keystore'
import { estimateTokenTransferFee, sendToken, getEffectiveFeeToken, type EffectiveFeeToken, type FeeEstimate } from '../lib/client'
import { getTokenBalance, getTokenMeta, type TokenMeta } from '../lib/tip20'
import { listMyTokens } from '../lib/portfolio'
import { formatUnits, explorerTxUrl, shortAddress, PATHUSD } from '../chain'

type Phase =
  | 'idle'
  | 'estimating'
  | 'signing'
  | 'broadcasting'
  | 'submitted'
  | 'ok'
  | 'reverted'
  | 'timeout'

export function SendPanel({
  credential,
  address,
  pathUsdBalance,
  onSent,
}: {
  credential: StoredCredential
  address: string
  pathUsdBalance: bigint | null
  onSent: () => void
}) {
  const [token, setToken] = useState(PATHUSD)
  const [feeToken, setFeeToken] = useState('')
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null)
  const [tokenMeta, setTokenMeta] = useState<TokenMeta | null>(null)
  const [feeTokenBalance, setFeeTokenBalance] = useState<bigint | null>(null)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [fee, setFee] = useState<FeeEstimate | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The token that will actually pay the fee: a chosen fee token (transaction
  // level, highest precedence) or, when the field is empty, the token the node
  // resolves per its preference rules (read from chain state via eth_call).
  const [effectiveFee, setEffectiveFee] = useState<EffectiveFeeToken | null>(null)

  const suggestions = [
    { value: PATHUSD, label: 'pathUSD' },
    ...listMyTokens().map((t) => ({
      value: t.token,
      label: t.symbol ?? t.name ?? shortAddress(t.token),
    })),
  ]

  // Load token balance/meta and (re)estimate the fee when the token or
  // recipient changes (debounced).
  useEffect(() => {
    setFee(null)
    setTokenBalance(null)
    setTokenMeta(null)
    if (!isAddress(token)) return
    setPhase('estimating')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const [tb, tm] = await Promise.all([
          getTokenBalance(token, address),
          getTokenMeta(token),
        ])
        setTokenBalance(tb)
        setTokenMeta(tm)
        if (isAddress(to)) {
          try {
            setFee(await estimateTokenTransferFee(address, token, to))
          } catch {
            setFee(null)
          }
        }
      } catch {
        /* transient RPC hiccup */
      } finally {
        setPhase((p) => (p === 'estimating' ? 'idle' : p))
      }
    }, 350)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [token, to, address])

  // Resolve the effective fee token. A chosen fee token wins; when empty, the
  // node picks per its preference rules (account preference → sent token if
  // USD → pathUSD), which we read from chain state via eth_call.
  useEffect(() => {
    let alive = true
    const chosen = feeToken.trim()
    if (chosen) {
      setEffectiveFee({
        address: chosen,
        symbol:
          chosen.toLowerCase() === PATHUSD.toLowerCase()
            ? 'pathUSD'
            : chosen.toLowerCase() === token.toLowerCase()
              ? tokenMeta?.symbol || shortAddress(chosen)
              : shortAddress(chosen),
        source: 'tx',
      })
      return
    }
    if (!isAddress(token)) {
      setEffectiveFee(null)
      return
    }
    getEffectiveFeeToken(address, token, tokenMeta?.currency).then((e) => {
      if (alive) setEffectiveFee(e)
    })
    return () => {
      alive = false
    }
  }, [feeToken, token, address, tokenMeta])

  // Load the effective fee token's balance (the fee is charged in this token).
  useEffect(() => {
    if (!effectiveFee) return
    const addr = effectiveFee.address
    if (addr.toLowerCase() === PATHUSD.toLowerCase()) {
      setFeeTokenBalance(pathUsdBalance)
      return
    }
    let alive = true
    setFeeTokenBalance(null)
    getTokenBalance(addr, address).then((b) => {
      if (alive) setFeeTokenBalance(b)
    })
    return () => {
      alive = false
    }
  }, [effectiveFee, pathUsdBalance, address])

  const busy = phase === 'signing' || phase === 'broadcasting' || phase === 'submitted'

  const sameToken =
    !!effectiveFee && token.toLowerCase() === effectiveFee.address.toLowerCase()

  function balanceOf(addr: string): bigint | null {
    const a = addr.toLowerCase()
    if (a === PATHUSD.toLowerCase()) return pathUsdBalance
    if (a === token.toLowerCase()) return tokenBalance
    if (effectiveFee && a === effectiveFee.address.toLowerCase()) return feeTokenBalance
    return null
  }

  function handleMax() {
    setError(null)
    if (fee === null) return
    const bal = balanceOf(token)
    if (bal === null) return
    if (sameToken) {
      const maxSendable = bal - fee.fee
      if (maxSendable <= 0n) {
        setAmount('')
        setError('Balance is too low to cover the estimated fee — top up first.')
        return
      }
      setAmount(formatUnits(maxSendable))
    } else {
      setAmount(formatUnits(bal))
    }
  }

  async function handleSend() {
    setError(null)
    setTxHash(null)

    if (!isAddress(token)) {
      setError('Enter a valid token address (0x…).')
      return
    }
    if (feeToken.trim() !== '' && !isAddress(feeToken)) {
      setError('Enter a valid fee-token address (0x…) or leave it empty to let the network pick the fee token.')
      return
    }
    if (!effectiveFee || !isAddress(effectiveFee.address)) {
      setError('Fee token is still resolving — try again in a second.')
      return
    }
    if (!isAddress(to)) {
      setError('Enter a valid recipient address (0x…).')
      return
    }
    let value: bigint
    try {
      value = parseUnits(amount || '0', 6)
    } catch {
      setError('Enter a valid amount.')
      return
    }
    if (value <= 0n) {
      setError('Amount must be greater than zero.')
      return
    }
    if (fee === null) {
      setError('Fee estimate unavailable — check the recipient and try again.')
      return
    }

    const sym = tokenMeta?.symbol ?? 'token'
    const tokenBal = balanceOf(token)
    const feeBal = balanceOf(effectiveFee.address)
    if (tokenBal === null) {
      setError('Balance is still loading — try again in a second.')
      return
    }
    if (value > tokenBal) {
      setError(`Insufficient ${sym} balance (${formatUnits(tokenBal)}).`)
      return
    }
    if (feeBal === null) {
      setError('Fee-token balance is still loading — try again in a second.')
      return
    }
    if (fee.fee > feeBal) {
      setError(
        `Insufficient ${effectiveFee.symbol} balance — you need ${formatUnits(fee.fee)} ${effectiveFee.symbol} to cover the fee.`,
      )
      return
    }
    if (sameToken && value + fee.fee > tokenBal) {
      setError(
        `Insufficient ${sym}. Amount + fee = ${formatUnits(value + fee.fee)}, but you have ${formatUnits(tokenBal)}.`,
      )
      return
    }

    setPhase('signing')
    try {
      const result = await sendToken(
        credential,
        token,
        to,
        value,
        fee,
        effectiveFee.source === 'tx' ? effectiveFee.address : '',
        () => setPhase('submitted'),
      )
      setTxHash(result.hash)
      setPhase(result.status === 'ok' ? 'ok' : result.status)
      if (result.status === 'ok') {
        setTo('')
        setAmount('')
        setFee(null)
        onSent()
      }
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? String(e)
      const details = e?.details ?? e?.cause?.details ?? ''
      if (/insufficient funds|insufficient fee token/i.test(details)) {
        setError('Insufficient fee token to cover the fee. Top up, then try again.')
        setError('Insufficient fee token to cover the fee. Top up, then try again.')
      } else if (/insufficient liquidity/i.test(details)) {
        setError(
          'The FeeAMM pool for this fee token lacks liquidity — provide pathUSD liquidity for the pair first (Pool tab), or pay fees in pathUSD.',
        )
      } else if (/gas limit/i.test(details)) {
        setError(`Gas limit exceeded — please try again. (${details})`)
      } else if (/user rejected|rejected/i.test(msg)) {
        setError('Passkey prompt was cancelled — nothing was sent.')
      } else {
        setError(`${msg}${details ? ` — ${details}` : ''}`)
      }
    } finally {
      setPhase((p) => (p === 'signing' || p === 'broadcasting' ? 'idle' : p))
    }
  }

  const sym = tokenMeta?.symbol ?? (token.toLowerCase() === PATHUSD.toLowerCase() ? 'pathUSD' : '')
  const available = balanceOf(token)
  const availableText = available === null ? '—' : formatUnits(available)

  return (
    <section className="card send-card">
      <h2>Send</h2>
      <p className="muted small">
        Send any TIP-20 token, signed by your passkey in a Tempo Transaction
        (type <code>0x76</code>). Leave the fee token empty to pay in the
        token you're sending (if USD) or pathUSD — or pick one explicitly.
      </p>

      <label className="lbl" htmlFor="token">Token</label>
      <input
        id="token"
        className="field mono"
        list="send-token-options"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder={PATHUSD}
        spellCheck={false}
        disabled={busy}
      />
      <datalist id="send-token-options">
        {suggestions.map((s) => (
          <option key={s.value} value={s.value} label={s.label} />
        ))}
      </datalist>
      {tokenMeta && (
        <span className="muted small token-hint">
          {tokenMeta.name} ({tokenMeta.symbol}) · {tokenMeta.currency} ·{' '}
          {tokenMeta.decimals} decimals
        </span>
      )}

      <label className="lbl" htmlFor="fee-token">Fee token (optional)</label>
      <input
        id="fee-token"
        className="field mono"
        list="send-token-options"
        value={feeToken}
        onChange={(e) => setFeeToken(e.target.value)}
        placeholder="auto — sent token / pathUSD"
        spellCheck={false}
        disabled={busy}
      />
      {feeToken.trim() === '' && effectiveFee && (
        <span className="muted small token-hint">
          {effectiveFee.source === 'contract' && (
            <>Fees are charged in <strong>{effectiveFee.symbol}</strong> — the token you're sending (USD). </>
          )}
          {effectiveFee.source === 'account' && (
            <>Fees are charged in <strong>{effectiveFee.symbol}</strong> — your FeeManager preference. </>
          )}
          {effectiveFee.source === 'pathusd' && (
            <>Fees are charged in <strong>pathUSD</strong> (the sent token isn't USD). </>
          )}
          {effectiveFee.address.toLowerCase() !== PATHUSD.toLowerCase() && (
            <>Requires FeeAMM liquidity ({shortAddress(effectiveFee.address)} → pathUSD).</>
          )}
        </span>
      )}
      {feeToken.trim() !== '' &&
        effectiveFee &&
        effectiveFee.address.toLowerCase() !== PATHUSD.toLowerCase() && (
          <span className="muted small token-hint">
            Non-pathUSD fees require the FeeAMM pool ({shortAddress(effectiveFee.address)} → pathUSD)
            to have pathUSD liquidity.
          </span>
        )}

      <label className="lbl" htmlFor="to">Recipient</label>
      <input
        id="to"
        className="field mono"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="0x…"
        spellCheck={false}
        disabled={busy}
      />

      <div className="amount-row">
        <div className="amount-col">
          <label className="lbl" htmlFor="amount">Amount</label>
          <input
            id="amount"
            className="field mono"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            disabled={busy}
          />
        </div>
        <div className="amount-meta">
          <span className="muted small">
            Available: {availableText}
            {sym ? ` ${sym}` : ''}
          </span>
          <button
            className="btn ghost tiny"
            onClick={handleMax}
            disabled={fee === null || busy}
            title={fee ? 'Fills in the max sendable amount' : 'Enter a token and recipient first'}
          >
            Max
          </button>
        </div>
      </div>

      <div className="fee-line">
        {phase === 'estimating' ? (
          <span className="muted small">Estimating fee…</span>
        ) : fee ? (
          <>
            <span className="muted small">
              Estimated fee: <strong className="fee-amt">{formatUnits(fee.fee)}</strong>{' '}
              {effectiveFee?.symbol ?? 'fee token'}
              {feeTokenBalance !== null && feeTokenBalance <= fee.fee && (
                <span className="fee-warn"> — {effectiveFee?.symbol ?? 'fee token'} balance can't cover fees</span>
              )}
            </span>
            <span className="muted small fee-detail">
              gas {fee.gasLimit.toString()} · cap {formatUnits((fee.maxFeePerGas * fee.gasLimit) / 10n ** 12n)}
            </span>
          </>
        ) : (
          <span className="muted small">
            {isAddress(token) && isAddress(to) ? 'Fee estimate unavailable' : 'Enter a token and recipient to estimate the fee'}
          </span>
        )}
      </div>

      <button className="btn primary send-btn" onClick={handleSend} disabled={busy}>
        {phase === 'signing'
          ? 'Awaiting passkey approval…'
          : phase === 'broadcasting'
            ? 'Broadcasting…'
            : phase === 'submitted'
              ? 'Awaiting confirmation…'
              : 'Send'}
      </button>

      {phase === 'ok' && txHash && (
        <div className="success">
          ✓ Transaction confirmed!{' '}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            {shortAddress(txHash)} ↗
          </a>
        </div>
      )}
      {phase === 'reverted' && txHash && (
        <div className="error">
          Transaction was mined but <strong>reverted on-chain</strong> — nothing
          was sent.{' '}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            View {shortAddress(txHash)} ↗
          </a>
        </div>
      )}
      {phase === 'timeout' && txHash && (
        <div className="success">
          Submitted! Confirmation is taking a while —{' '}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            check the explorer for {shortAddress(txHash)} ↗
          </a>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </section>
  )
}
