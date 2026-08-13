import { useEffect, useState } from 'react'
import type { StoredCredential } from '../lib/keystore'
import {
  listMyTokens,
  removeMyToken,
  ASSETS_CHANGED,
  type MyToken,
} from '../lib/portfolio'
import {
  getTokenMeta,
  getTokenBalance,
  getTokenTotalSupply,
  type TokenMeta,
} from '../lib/tip20'
import { formatUnits, explorerAddressUrl, shortAddress } from '../chain'
import { TokenMint } from './TokenMint'

type Enriched = {
  meta: TokenMeta | null
  balance: bigint | null
  supply: bigint | null
}

export function MyTokens({
  credential,
  address,
}: {
  credential: StoredCredential
  address: string
}) {
  const [items, setItems] = useState<MyToken[]>([])
  const [data, setData] = useState<Record<string, Enriched>>({})
  const [openMint, setOpenMint] = useState<string | null>(null)

  useEffect(() => {
    const load = () => setItems(listMyTokens())
    load()
    window.addEventListener(ASSETS_CHANGED, load)
    return () => window.removeEventListener(ASSETS_CHANGED, load)
  }, [])

  useEffect(() => {
    let alive = true
    const entries = items.map(async (t) => {
      const [meta, balance, supply] = await Promise.all([
        getTokenMeta(t.token),
        getTokenBalance(t.token, address),
        getTokenTotalSupply(t.token),
      ])
      return [t.token, { meta, balance, supply }] as const
    })
    Promise.all(entries).then((rows) => {
      if (!alive) return
      const next: Record<string, Enriched> = {}
      for (const [token, d] of rows) next[token] = d
      setData(next)
    })
    return () => {
      alive = false
    }
  }, [items, address])

  if (items.length === 0) {
    return (
      <section className="card">
        <h2>My tokens</h2>
        <p className="muted small">
          Tokens you create will appear here (tracked locally in this browser).
        </p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>My tokens</h2>
      <ul className="asset-list">
        {items.map((t) => {
          const d = data[t.token]
          const name = d?.meta?.name ?? t.name ?? 'Token'
          const symbol = d?.meta?.symbol ?? t.symbol ?? ''
          const balance = d?.balance
          const supply = d?.supply
          return (
            <li key={t.token}>
              <div className="asset-row">
                <div className="asset-main">
                  <span className="asset-name">
                    {name}
                    {symbol && <span className="badge">{symbol}</span>}
                  </span>
                  <a
                    href={explorerAddressUrl(t.token)}
                    target="_blank"
                    rel="noreferrer"
                    className="mono asset-addr"
                  >
                    {shortAddress(t.token)} ↗
                  </a>
                  {d?.meta && (
                    <span className="muted small">
                      {d.meta.currency} · {d.meta.decimals} decimals
                    </span>
                  )}
                </div>
                <div className="asset-side">
                  <span className="muted small">
                    {balance == null ? '—' : formatUnits(balance)}
                    {balance != null && symbol ? ` ${symbol}` : ''}
                  </span>
                  <span className="muted small faint">
                    supply {supply == null ? '—' : formatUnits(supply)}
                  </span>
                </div>
                <div className="asset-actions">
                  <button
                    className="btn ghost tiny"
                    onClick={() => setOpenMint(openMint === t.token ? null : t.token)}
                  >
                    Mint
                  </button>
                  <button
                    className="btn ghost tiny remove-btn"
                    onClick={() => removeMyToken(t.token)}
                    title="Forget this token"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {openMint === t.token && (
                <div className="asset-mint">
                  <TokenMint
                    credential={credential}
                    address={address}
                    token={t.token}
                    onMinted={() => {
                      // refresh this row's balance/supply
                      Promise.all([
                        getTokenBalance(t.token, address),
                        getTokenTotalSupply(t.token),
                      ]).then(([b, s]) => {
                        setData((prev) => ({
                          ...prev,
                          [t.token]: { ...prev[t.token], balance: b, supply: s },
                        }))
                      })
                    }}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
