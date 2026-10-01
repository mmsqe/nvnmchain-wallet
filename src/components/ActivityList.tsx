import { useState } from 'react'
import { shortAddress, explorerTxUrl, explorerAddressUrl, feeTokenSymbol } from '../chain'
import type { HistoryResult } from '../lib/client'

export function ActivityList({
  result,
  address,
  onRefresh,
}: {
  result: HistoryResult
  address: string
  onRefresh: () => void
}) {
  const [copied, setCopied] = useState(false)
  const items = result.items

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
    <section className="card activity-card">
      <div className="activity-head">
        <h2>Activity</h2>
        <button className="btn ghost tiny" onClick={onRefresh} title="Refresh">
          ↻ Refresh
        </button>
      </div>

      {!result.ok ? (
        <div className="activity-empty">
          <p className="muted">
            Couldn't load activity from the explorer right now.
          </p>
          <button className="btn ghost small" onClick={onRefresh}>
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="activity-empty">
          <p className="muted">
            <strong>No activity yet</strong> — this is a brand-new address.
          </p>
          <p className="muted small">
            Send {feeTokenSymbol()} to this address to receive funds, then transfers and
            payments will show up here automatically:
          </p>
          <div className="receive-row">
            <code className="receive-address">{address}</code>
            <button className="btn ghost small" onClick={copyAddress}>
              {copied ? 'Copied ✓' : 'Copy address'}
            </button>
          </div>
          <a
            className="btn ghost small"
            href={explorerAddressUrl(address)}
            target="_blank"
            rel="noreferrer"
          >
            View on explorer ↗
          </a>
        </div>
      ) : (
        <ul className="activity">
          {items.map((t) => {
            const incoming = t.from.toLowerCase() !== address.toLowerCase()
            return (
              <li key={t.hash}>
                <span
                  className={`dir ${incoming ? 'in' : 'out'}`}
                  title={incoming ? 'Received' : 'Sent'}
                />
                <div className="row-main">
                  <a
                    href={explorerTxUrl(t.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="mono"
                  >
                    {shortAddress(t.hash)}
                  </a>
                  <span className="muted small">
                    {incoming ? 'from' : 'to'}{' '}
                    <span className="mono">
                      {shortAddress(
                        t.from === address ? t.to : t.from,
                      )}
                    </span>
                  </span>
                </div>
                <div className="row-side">
                  <span className={`status ${t.status}`}>{t.status}</span>
                  <span className="muted small">{fmtTime(t.timestamp)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function fmtTime(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
