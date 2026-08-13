import { useEffect, useState } from 'react'
import {
  listMyPositions,
  removeMyPosition,
  ASSETS_CHANGED,
  type MyPosition,
} from '../lib/portfolio'
import {
  getPool,
  getTotalSupply,
  getLiquidityBalance,
  type Pool,
} from '../lib/feeamm'
import { getTokenMeta, type TokenMeta } from '../lib/tip20'
import { formatUnits, explorerAddressUrl, shortAddress } from '../chain'

type Enriched = {
  pool: Pool | null
  totalSupply: bigint | null
  lp: bigint | null
  userMeta: TokenMeta | null
  valMeta: TokenMeta | null
}

const fmtLp = (v: bigint) => v.toLocaleString('en-US')

export function MyPositions({ address }: { address: string }) {
  const [items, setItems] = useState<MyPosition[]>([])
  const [data, setData] = useState<Record<string, Enriched>>({})

  useEffect(() => {
    const load = () => setItems(listMyPositions())
    load()
    window.addEventListener(ASSETS_CHANGED, load)
    return () => window.removeEventListener(ASSETS_CHANGED, load)
  }, [])

  useEffect(() => {
    let alive = true
    const entries = items.map(async (p) => {
      const [pool, totalSupply, lp, userMeta, valMeta] = await Promise.all([
        getPool(p.userToken, p.validatorToken),
        getTotalSupply(p.poolId as `0x${string}`),
        getLiquidityBalance(p.poolId as `0x${string}`, address),
        getTokenMeta(p.userToken),
        getTokenMeta(p.validatorToken),
      ])
      return [p.poolId, { pool, totalSupply, lp, userMeta, valMeta }] as const
    })
    Promise.all(entries).then((rows) => {
      if (!alive) return
      const next: Record<string, Enriched> = {}
      for (const [poolId, d] of rows) next[poolId] = d
      setData(next)
    })
    return () => {
      alive = false
    }
  }, [items, address])

  if (items.length === 0) {
    return (
      <section className="card">
        <h2>My positions</h2>
        <p className="muted small">
          Liquidity you provide will appear here (tracked locally in this
          browser).
        </p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>My positions</h2>
      <ul className="asset-list">
        {items.map((p) => {
          const d = data[p.poolId]
          const uSym = d?.userMeta?.symbol ?? shortAddress(p.userToken)
          const vSym = d?.valMeta?.symbol ?? shortAddress(p.validatorToken)
          const share =
            d?.lp != null && d.totalSupply && d.totalSupply > 0n
              ? Number((d.lp * 10000n) / d.totalSupply) / 100
              : null
          return (
            <li key={p.poolId} className="asset-row">
              <div className="asset-main">
                <span className="asset-name">
                  {vSym} → {uSym}
                  <span className="badge">pool</span>
                </span>
                <span className="mono asset-addr">
                  {shortAddress(p.userToken)} / {shortAddress(p.validatorToken)}
                </span>
                {d?.pool && (
                  <span className="muted small">
                    reserves {formatUnits(d.pool.reserveUserToken)} {uSym} ·{' '}
                    {formatUnits(d.pool.reserveValidatorToken)} {vSym}
                  </span>
                )}
              </div>
              <div className="asset-side">
                <span className="muted small">
                  LP {d?.lp == null ? '—' : fmtLp(d.lp)}
                  {share !== null && (
                    <span className="muted small faint"> · {share}%</span>
                  )}
                </span>
                <a
                  className="muted small"
                  href={explorerAddressUrl(p.userToken)}
                  target="_blank"
                  rel="noreferrer"
                >
                  view ↗
                </a>
              </div>
              <button
                className="btn ghost tiny remove-btn"
                onClick={() => removeMyPosition(p.poolId)}
                title="Forget this position"
              >
                ✕
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
