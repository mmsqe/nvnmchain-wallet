import { useEffect, useId, useState } from 'react'
import { parseUnits } from 'viem'
import type { StoredCredential } from '../lib/keystore'
import {
  grantIssuerRole,
  hasRole,
  mintTip20,
  ISSUER_ROLE,
} from '../lib/tip20'
import { formatTxError } from '../lib/errors'

type Phase = 'idle' | 'granting' | 'minting'

/**
 * Reusable "grant ISSUER_ROLE (if needed) + mint" control for a TIP-20 token.
 * Minting requires ISSUER_ROLE; a freshly created token only grants its
 * creator DEFAULT_ADMIN_ROLE, so the first mint auto-grants the role first.
 */
export function TokenMint({
  credential,
  address,
  token,
  onMinted,
}: {
  credential: StoredCredential
  address: string
  token: string
  onMinted?: () => void
}) {
  const id = useId()
  const [amount, setAmount] = useState('')
  const [issuerGranted, setIssuerGranted] = useState<boolean | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    hasRole(token, address, ISSUER_ROLE).then((g) => {
      if (alive) setIssuerGranted(g)
    })
    return () => {
      alive = false
    }
  }, [token, address])

  const busy = phase !== 'idle'

  async function handleMint() {
    setError(null)
    setNotice(null)
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

    // Ensure ISSUER_ROLE first (one-time, one extra passkey prompt).
    try {
      let granted = issuerGranted
      if (!granted) {
        granted = await hasRole(token, address, ISSUER_ROLE)
        if (!granted) {
          setPhase('granting')
          setNotice('Granting ISSUER_ROLE…')
          const g = await grantIssuerRole(credential, address, token, address)
          if (g.status !== 'ok') {
            setError(
              g.status === 'reverted'
                ? 'Could not grant ISSUER_ROLE — are you the token admin?'
                : 'Grant confirmation timed out — check the explorer.',
            )
            return
          }
          granted = true
        }
        setIssuerGranted(true)
      }
    } catch (e: any) {
      setError(formatTxError(e))
      setPhase('idle')
      return
    }

    setPhase('minting')
    setNotice('Minting…')
    try {
      const res = await mintTip20(credential, address, token, address, value)
      if (res.status !== 'ok') {
        setError(
          res.status === 'reverted'
            ? 'Mint reverted on-chain (check supply cap / pause / policy).'
            : 'Confirmation timed out — check the explorer.',
        )
        return
      }
      setNotice('Supply minted to your address.')
      setAmount('')
      onMinted?.()
    } catch (e: any) {
      setError(formatTxError(e))
    } finally {
      setPhase('idle')
    }
  }

  return (
    <div className="token-mint">
      <div className="mint-row">
        <div className="mint-input">
          <label className="lbl" htmlFor={id}>
            Mint supply to yourself
          </label>
          <input
            id={id}
            className="field mono"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1000000"
            inputMode="decimal"
            disabled={busy}
          />
          {issuerGranted === false && (
            <span className="muted small">
              You don't hold ISSUER_ROLE yet — Mint will grant it first (two
              passkey prompts).
            </span>
          )}
        </div>
        <button className="btn primary" onClick={handleMint} disabled={busy}>
          {phase === 'granting'
            ? 'Awaiting passkey…'
            : phase === 'minting'
              ? 'Minting…'
              : issuerGranted
                ? 'Mint'
                : 'Grant role + mint'}
        </button>
      </div>
      {notice && <div className="success">{notice}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  )
}
