import { useState } from 'react'
import { registerPasskey, loginPasskey, loginWithDiscoverablePasskey, deriveAddress, normalizeEmail, isValidEmail } from '../lib/passkey'
import type { WalletAccount } from '../lib/passkey'
import * as keystore from '../lib/keystore'
import { shortAddress } from '../chain'
import { useNetwork } from '../lib/useNetwork'
import { NetworkSwitcher } from './NetworkSwitcher'

export function ConnectScreen({
  onCreated,
}: {
  onCreated: (account: WalletAccount) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [, setRefreshKey] = useState(0)
  const network = useNetwork()
  const existing = keystore.listCredentials()

  async function handleCreate() {
    setError(null)
    if (!isValidEmail(email)) {
      setError('Enter a valid email address — it will be your account name.')
      return
    }
    const normalized = normalizeEmail(email)
    const sameEmail = existing.find((c) => c.email === normalized)
    if (sameEmail) {
      setError(
        `You already have a passkey for ${normalized} in this browser — it's a different account (${shortAddress(
          deriveAddress(sameEmail.publicKey),
        )}). Creating a new passkey with the same email makes ANOTHER separate account. Sign in with the existing one instead, or use a different email.`,
      )
      return
    }
    setBusy(`Creating passkey for ${normalized}…`)
    try {
      const account = await registerPasskey(normalized)
      onCreated(account)
    } catch (e: any) {
      setError(prettyError(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleLogin(id: string) {
    setBusy('Authenticating…')
    setError(null)
    try {
      const account = await loginPasskey(id)
      onCreated(account)
    } catch (e: any) {
      setError(prettyError(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleDiscoverableLogin() {
    setBusy('Looking for passkeys on this device…')
    setError(null)
    try {
      const account = await loginWithDiscoverablePasskey()
      onCreated(account)
    } catch (e: any) {
      setError(prettyError(e))
    } finally {
      setBusy(null)
    }
  }

  function handleRemove(c: keystore.StoredCredential) {
    if (
      !window.confirm(
        `Remove ${c.email ?? c.label} (${shortAddress(
          deriveAddress(c.publicKey),
        )}) from this browser's list? The passkey itself is untouched — you can sign back in anytime with "Sign in with a passkey on this device".`,
      )
    )
      return
    keystore.removeCredential(c.id)
    setError(null)
    // force re-render to refresh the list
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">NVNM Passkey Wallet</span>
        </div>
        <NetworkSwitcher />
      </header>

      <main className="connect">
        <div className="hero">
          <h1>
            Your keys are your <em>face</em>.
          </h1>
          <p>
            A self-custodial wallet for <strong>NVNM Chain</strong> — a
            Tempo-compatible L1. Sign in with a passkey (Face ID, Touch ID,
            Windows Hello or a security key). No seed phrases, ever.
          </p>
        </div>

        <div className="card connect-card">
          <h2>Create a wallet</h2>
          <p className="muted">
            Your passkey lives on this device only. Your address is derived
            from its P-256 public key, on-chain — nothing is uploaded. Your
            email is used as the account name and stored locally.
          </p>
          <label className="lbl" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="you@example.com"
            disabled={!!busy}
          />
          {isValidEmail(email) && (
            <div className="normalized-hint">
              Account name:{' '}
              <code>{normalizeEmail(email)}</code>
            </div>
          )}
          <button className="btn primary" onClick={handleCreate} disabled={!!busy}>
            {busy ?? 'Create new passkey wallet'}
          </button>

          {existing.length > 0 && (
            <div className="existing">
              <h3>Sign back in</h3>
              {existing.map((c) => (
                <div key={c.id} className="existing-row-wrap">
                  <button
                    className="btn ghost existing-row"
                    onClick={() => handleLogin(c.id)}
                    disabled={!!busy}
                  >
                    <span className="existing-label">
                      {c.email ?? c.label}
                      {c.source === 'recovered' && (
                        <span className="badge">synced</span>
                      )}
                    </span>
                    <span className="existing-meta">
                      {shortAddress(deriveAddress(c.publicKey))} · {fmtDate(c.createdAt)}
                    </span>
                  </button>
                  <button
                    className="btn ghost tiny remove-btn"
                    title="Remove this entry from this browser (does not delete the passkey)"
                    onClick={() => handleRemove(c)}
                    disabled={!!busy}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="existing">
            <h3>Can't find an account?</h3>
            <p className="muted small cross-device-hint">
              Accounts are bound to the passkey that created them, not to the
              email. If an account isn't in the list above:
            </p>
            <ul className="cross-device-list">
              <li>
                It lives in the <strong>browser/device where you created it</strong> —
                open the same URL there and sign in with that passkey.
              </li>
              <li>
                If the passkey synced (iCloud Keychain / Google), use{' '}
                <strong>"Sign in with a passkey on this device"</strong> below —
                it recovers the account from the passkey itself.
              </li>
              <li>
                If you never had on-chain activity (no funds sent/received),
                the account only exists as long as that passkey does — keep it
                synced so it survives browser resets.
              </li>
            </ul>
          </div>

          <div className="existing">
            <h3>Sign in with a passkey</h3>
            <button
              className="btn ghost existing-row"
              onClick={handleDiscoverableLogin}
              disabled={!!busy}
            >
              <span className="existing-label">Sign in with a passkey on this device</span>
              <span className="existing-meta">↗</span>
            </button>
            <p className="muted small cross-device-hint">
              If a <strong>QR code</strong> appears, this browser doesn't have a
              passkey for this site yet — that's the cross-device option: scan it
              with the phone that has the passkey. To get the fingerprint prompt
              instead:
            </p>
            <ul className="cross-device-list">
              <li>
                Use the <strong>same browser</strong> you registered with — on
                macOS, Chrome only reads iCloud Keychain passkeys with the
                “iCloud Passwords” extension enabled; Safari reads them
                natively.
              </li>
              <li>
                Use the <strong>same URL</strong> (e.g. always
                yihuang.github.io/nvnmchain-wallet, not localhost) — passkeys
                are bound to the site's address.
              </li>
              <li>
                Make sure <strong>iCloud Keychain sync</strong> is on for the
                same Apple ID on all your devices.
              </li>
            </ul>
          </div>

          {error && <div className="error">{error}</div>}
        </div>

        <p className="footnote">
          WebAuthn · P-256 (secp256r1) · Tempo Transactions (EIP-2718 type{' '}
          <code>0x76</code>) · fees in {network.feeTokenSymbol}
        </p>
      </main>
    </div>
  )
}

function prettyError(e: any): string {
  const msg = e?.shortMessage ?? e?.message ?? String(e)
  if (/NotAllowedError|not allowed/i.test(msg))
    return 'Passkey prompt was cancelled or blocked. Try again.'
  if (/InvalidStateError|already exists/i.test(msg))
    return 'A passkey for this email already exists on this device — use "Sign back in".'
  return msg
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
