import { useEffect, useState } from 'react'
import { getTokenHoldings, type TokenHolding } from '../lib/client'
import { formatUnits, explorerAddressUrl, shortAddress, PATHUSD, feeTokenSymbol } from '../chain'

/**
 * All TIP-20 balances for the current account — the fee token first, then any
 * other non-zero holdings. Refreshed on an interval and whenever `refreshKey`
 * changes (e.g. after a send).
 */
export function TokenHoldings({
  address,
  pathUsdBalance,
  refreshKey,
}: {
  address: string
  pathUsdBalance: bigint | null
  refreshKey: number
}) {
  const [holdings, setHoldings] = useState<TokenHolding[] | null>(null)
  const feeSymbol = feeTokenSymbol()

  useEffect(() => {
    let alive = true
    const load = () => {
      getTokenHoldings(address).then((items) => {
        if (alive) setHoldings(items)
      })
    }
    load()
    const t = setInterval(load, 15_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [address, refreshKey])

  return (
    <section className="card">
      <h2>Tokens</h2>
      <ul className="asset-list">
        <li>
          <div className="asset-row">
            <div className="asset-main">
              <span className="asset-name">
                {feeSymbol}
                <span className="badge">fee token</span>
              </span>
              <span className="muted small">
                No native gas token — fees are paid in {feeSymbol} by default.
              </span>
            </div>
            <div className="asset-side">
              <span className="muted small">
                {formatUnits(pathUsdBalance)}
                <span className="balance-symbol"> {feeSymbol}</span>
              </span>
            </div>
          </div>
        </li>
        {holdings === null ? (
          <li>
            <div className="asset-row">
              <span className="muted small">Loading other tokens…</span>
            </div>
          </li>
        ) : holdings.length === 0 ? (
          <li>
            <div className="asset-row">
              <span className="muted small">No other token balances.</span>
            </div>
          </li>
        ) : (
          holdings.map((h) => (
            <li key={h.token}>
              <div className="asset-row">
                <div className="asset-main">
                  <span className="asset-name">
                    {h.name}
                    {h.symbol && <span className="badge">{h.symbol}</span>}
                  </span>
                  <a
                    href={explorerAddressUrl(h.token)}
                    target="_blank"
                    rel="noreferrer"
                    className="mono asset-addr"
                  >
                    {shortAddress(h.token)} ↗
                  </a>
                  {h.decimals !== 6 && (
                    <span className="muted small">{h.decimals} decimals</span>
                  )}
                </div>
                <div className="asset-side">
                  <span className="muted small">
                    {formatUnits(h.balance, h.decimals)}
                    {h.symbol ? ` ${h.symbol}` : ''}
                  </span>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
