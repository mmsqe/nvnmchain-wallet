import { useCallback, useEffect, useState } from 'react'
import type { StoredCredential } from '../lib/keystore'
import type { WalletAccount } from '../lib/passkey'
import { deriveAddress } from '../lib/passkey'
import { getPathUsdBalance, getHistory, tryFaucet, type HistoryResult } from '../lib/client'
import { shortAddress, explorerAddressUrl } from '../chain'
import { useNetwork } from '../lib/useNetwork'
import { NetworkSwitcher } from './NetworkSwitcher'
import { SendPanel } from './SendPanel'
import { ActivityList } from './ActivityList'
import { TokenHoldings } from './TokenHoldings'
import { LaunchPanel } from './LaunchPanel'
import { SwapPanel } from './SwapPanel'
import { PoolPanel } from './PoolPanel'
import { MyTokens } from './MyTokens'
import { MyPositions } from './MyPositions'

type Tab = 'wallet' | 'launch' | 'swap' | 'pool'

const TABS: { id: Tab; label: string }[] = [
  { id: 'wallet', label: 'Wallet' },
  { id: 'launch', label: 'Launch' },
  { id: 'swap', label: 'Swap' },
  { id: 'pool', label: 'Pool' },
]

export function Dashboard({
  credential,
  onConnected,
  onDisconnect,
}: {
  credential: StoredCredential
  onConnected: (a: WalletAccount) => void
  onDisconnect: () => void
}) {
  const [address] = useState(() => deriveAddress(credential.publicKey))
  const network = useNetwork()
  const [balance, setBalance] = useState<bigint | null>(null)
  const [history, setHistory] = useState<HistoryResult>({ items: [], ok: false })
  const [faucetMsg, setFaucetMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [tab, setTab] = useState<Tab>('wallet')

  const refresh = useCallback(async () => {
    try {
      const [bal, hist] = await Promise.all([
        getPathUsdBalance(address),
        getHistory(address),
      ])
      setBalance(bal)
      setHistory(hist)
    } catch {
      // transient RPC hiccup — keep stale data
    }
  }, [address, network.key])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [refresh, refreshKey])

  async function handleFaucet() {
    setFaucetMsg('Requesting funds…')
    const res = await tryFaucet(address)
    setFaucetMsg(
      res
        ? 'Funds requested — check back in a moment.'
        : `The ${network.name} faucet is not enabled. Ask the chain operator to fund this address, or send ${network.feeTokenSymbol} from a funded account.`,
    )
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">NVNM Passkey Wallet</span>
        </div>
        <div className="topbar-right">
          <NetworkSwitcher compact />
          <button className="btn ghost small" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      </header>

      <main className="dashboard">
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'wallet' && (
          <>
            <section className="card account-card">
          <div className="account-head">
            <div>
              <span className="eyebrow">Passkey account</span>
              <h2>{credential.email ?? credential.label}</h2>
            </div>
            <div className="acct-actions">
              <button className="btn ghost small" onClick={copyAddress}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
              <a
                className="btn ghost small"
                href={explorerAddressUrl(address)}
                target="_blank"
                rel="noreferrer"
              >
                Explorer ↗
              </a>
            </div>
          </div>
          <code className="address">{address}</code>
          <div className="faucet-row">
            <button className="btn ghost small" onClick={handleFaucet}>
              Request funds
            </button>
            {faucetMsg && <span className="muted small">{faucetMsg}</span>}
          </div>
        </section>

        <TokenHoldings
          address={address}
          pathUsdBalance={balance}
          refreshKey={refreshKey}
        />

        <SendPanel
          credential={credential}
          address={address}
          pathUsdBalance={balance}
          onSent={() => {
            setRefreshKey((k) => k + 1)
            refresh()
          }}
        />

        <ActivityList result={history} address={address} onRefresh={refresh} />
          </>
        )}

        {tab === 'launch' && (
          <>
            <LaunchPanel credential={credential} address={address} />
            <MyTokens credential={credential} address={address} />
          </>
        )}

        {tab === 'swap' && (
          <SwapPanel credential={credential} address={address} />
        )}

        {tab === 'pool' && (
          <>
            <PoolPanel credential={credential} address={address} />
            <MyPositions address={address} />
          </>
        )}
      </main>
    </div>
  )
}
