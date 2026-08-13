import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StoredCredential } from '../lib/keystore'
import {
  createTip20,
  predictTokenAddress,
  getTokenMeta,
  getTokenBalance,
  getTokenTotalSupply,
  randomSalt,
  type TokenMeta,
} from '../lib/tip20'
import { formatUnits, explorerAddressUrl, shortAddress } from '../chain'
import { saveMyToken } from '../lib/portfolio'
import { formatTxError } from '../lib/errors'
import { TokenMint } from './TokenMint'

type Phase = 'idle' | 'creating' | 'loading-token'

export function LaunchPanel({
  credential,
  address,
}: {
  credential: StoredCredential
  address: string
}) {
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [logoURI, setLogoURI] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [created, setCreated] = useState<{ token: string } | null>(null)
  const [meta, setMeta] = useState<TokenMeta | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [supply, setSupply] = useState<bigint | null>(null)

  // Predict the address before creating (deterministic from sender + salt).
  const salt = useMemo(() => randomSalt(), [])
  const [predicted, setPredicted] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    predictTokenAddress(address, salt).then((a) => {
      if (alive) setPredicted(a)
    })
    return () => {
      alive = false
    }
  }, [address, salt])

  const refreshCreated = useCallback(async (token: string) => {
    const [m, b, s] = await Promise.all([
      getTokenMeta(token),
      getTokenBalance(token, address),
      getTokenTotalSupply(token),
    ])
    setMeta(m)
    setBalance(b)
    setSupply(s)
  }, [address])

  useEffect(() => {
    if (!created) return
    let alive = true
    setPhase('loading-token')
    refreshCreated(created.token).then(() => {
      if (alive) setPhase('idle')
    })
    return () => {
      alive = false
    }
  }, [created, refreshCreated])

  const busy = phase !== 'idle'

  async function handleCreate() {
    setError(null)
    setNotice(null)
    if (!name.trim() || !symbol.trim()) {
      setError('Enter a name and symbol.')
      return
    }
    if (!currency.trim()) {
      setError('Enter a currency code (e.g. USD).')
      return
    }
    setPhase('creating')
    try {
      const res = await createTip20(
        credential,
        address,
        {
          name: name.trim(),
          symbol: symbol.trim().toUpperCase(),
          currency: currency.trim().toUpperCase(),
          logoURI: logoURI.trim(),
          admin: address,
          salt,
        },
        () => setNotice('Broadcast — awaiting confirmation…'),
      )
      if (res.status !== 'ok') {
        setError(
          res.status === 'reverted'
            ? 'Token creation reverted on-chain — the derived address may already be taken.'
            : 'Broadcast, but confirmation timed out. Check the explorer for the transaction.',
        )
        return
      }
      if (!res.token) {
        setError('Created, but could not resolve the token address.')
        return
      }
      setCreated({ token: res.token })
      saveMyToken({
        token: res.token,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        currency: currency.trim().toUpperCase(),
        createdAt: Date.now(),
      })
      setNotice('Token created! Mint your initial supply below.')
    } catch (e: any) {
      setError(formatTxError(e))
    } finally {
      setPhase('idle')
    }
  }

  return (
    <section className="card launch-card">
      <h2>Launch a token</h2>
      <p className="muted small">
        Create a TIP-20 token permissionlessly via the factory precompile. Set{' '}
        <code>currency</code> to <code>USD</code> if you want to pair it in the
        FeeAMM afterwards — the FeeAMM only accepts USD-denominated tokens.
      </p>

      <div className="grid-2">
        <div>
          <label className="lbl" htmlFor="tok-name">Name</label>
          <input id="tok-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Meme Coin" disabled={busy} />
        </div>
        <div>
          <label className="lbl" htmlFor="tok-symbol">Symbol</label>
          <input id="tok-symbol" className="field mono" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="MEME" disabled={busy} />
        </div>
      </div>

      <div className="grid-2">
        <div>
          <label className="lbl" htmlFor="tok-currency">Currency (ISO 4217)</label>
          <input id="tok-currency" className="field mono" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" disabled={busy} />
        </div>
        <div>
          <label className="lbl" htmlFor="tok-logo">Logo URI (optional)</label>
          <input id="tok-logo" className="field mono" value={logoURI} onChange={(e) => setLogoURI(e.target.value)} placeholder="https://…/logo.svg" disabled={busy} />
        </div>
      </div>

      {predicted && (
        <div className="muted small predicted-line">
          Predicted address:{' '}
          <span className="mono">{shortAddress(predicted)}</span>
          <span className="mono addr-full">{predicted}</span>
        </div>
      )}

      <button className="btn primary launch-btn" onClick={handleCreate} disabled={busy}>
        {phase === 'creating' ? 'Creating token…' : 'Create token'}
      </button>

      {created && (
        <div className="created-box">
          <div className="eyebrow">Created token</div>
          <code className="address">{created.token}</code>
          <div className="token-stats">
            {meta && (
              <span className="muted small">
                {meta.name} ({meta.symbol}) · {meta.currency} · {meta.decimals} decimals
              </span>
            )}
            {balance !== null && (
              <span className="muted small">Your balance: {formatUnits(balance)}</span>
            )}
            {supply !== null && (
              <span className="muted small">Total supply: {formatUnits(supply)}</span>
            )}
          </div>
          <div className="created-actions">
            <a className="btn ghost small" href={explorerAddressUrl(created.token)} target="_blank" rel="noreferrer">
              View on explorer ↗
            </a>
          </div>
          <TokenMint
            credential={credential}
            address={address}
            token={created.token}
            onMinted={() => refreshCreated(created.token)}
          />
        </div>
      )}

      {notice && <div className="success">{notice}</div>}
      {error && <div className="error">{error}</div>}
    </section>
  )
}
