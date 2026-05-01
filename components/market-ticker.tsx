'use client'

import { useState, useEffect, useMemo } from 'react'
import { getPrices, getCachedPrices, type PriceFeedSnapshot } from '@/lib/price-feed'

// ─── APR/Pool data for all stake pools ───────────────────────────────────────
const POOL_APYS = [
  { label: 'H2O APR',        value: '12.00%',  color: 'text-amber-400'  },
  { label: 'StakeV2 APR',    value: '8.50%',   color: 'text-violet-400' },
  { label: 'H2O v3 APR',     value: '14.20%',  color: 'text-cyan-400'   },
  { label: 'Stake+ H2O APR', value: '10.00%',  color: 'text-emerald-400'},
  { label: 'Stake+ WLD APR', value: '6.00%',   color: 'text-yellow-400' },
  { label: 'Stake+ UTH2 APR',value: '18.00%',  color: 'text-orange-400' },
  { label: 'Stake+ FIRE APR',value: '22.00%',  color: 'text-red-400'    },
  { label: 'Pool UTH2→H2O',  value: 'PERMA',   color: 'text-emerald-400'},
  { label: 'Pool WLD→7x',    value: 'MULTI',   color: 'text-yellow-400' },
  { label: 'Pool TIME→WLD',  value: 'POOL%',   color: 'text-purple-400' },
]

// ─── Candle data generator (deterministic seed by hour) ───────────────────────
function generateCandles(count = 48, basePrice = 0.0215, volatility = 0.06) {
  const seed = Math.floor(Date.now() / 3_600_000)
  let price = basePrice
  const candles = []
  for (let i = 0; i < count; i++) {
    const s  = Math.abs(Math.sin(seed * 9301 + i * 49297 + 233720923)) % 1
    const s2 = Math.abs(Math.sin(seed * 12345 + i * 67891 + 98765)) % 1
    const dir = s > 0.48 ? 1 : -1
    const move = (s2 * volatility * 0.4 + 0.002) * dir
    const open  = price
    const close = price * (1 + move)
    const high  = Math.max(open, close) * (1 + s  * volatility * 0.25)
    const low   = Math.min(open, close) * (1 - s2 * volatility * 0.25)
    candles.push({ open, high, low, close })
    price = close
  }
  return candles
}

// ─── SVG Candlestick Chart ────────────────────────────────────────────────────
export function CandlestickChart({
  height = 80, width = 320, candles: propCandles,
}: {
  height?: number; width?: number
  candles?: { open: number; high: number; low: number; close: number }[]
}) {
  const candles = useMemo(() => propCandles ?? generateCandles(42), [propCandles])
  const prices  = candles.flatMap(c => [c.high, c.low])
  const minP    = Math.min(...prices)
  const maxP    = Math.max(...prices)
  const range   = maxP - minP || 0.0001

  const pad = { top: 4, bottom: 4, left: 2, right: 2 }
  const chartW = width - pad.left - pad.right
  const chartH = height - pad.top - pad.bottom
  const candleW = Math.max(2, (chartW / candles.length) * 0.65)
  const gap     = chartW / candles.length

  const toY = (p: number) => pad.top + chartH - ((p - minP) / range) * chartH
  const toX = (i: number) => pad.left + i * gap + gap / 2

  const lastCandle = candles[candles.length - 1]
  const isUp = lastCandle.close >= candles[0].close

  const gridLines = [0.25, 0.5, 0.75].map(pct => ({
    y: pad.top + chartH * (1 - pct),
    price: minP + range * pct,
  }))

  return (
    <svg width={width} height={height} className="overflow-visible">
      {gridLines.map((g, i) => (
        <line key={i} x1={pad.left} y1={g.y} x2={width - pad.right} y2={g.y}
          stroke="rgba(99,120,180,0.12)" strokeWidth="0.5" strokeDasharray="3,4" />
      ))}
      {candles.map((c, i) => {
        const cx      = toX(i)
        const bodyTop = toY(Math.max(c.open, c.close))
        const bodyBot = toY(Math.min(c.open, c.close))
        const bodyH   = Math.max(1, bodyBot - bodyTop)
        const bullish = c.close >= c.open
        const clr     = bullish ? '#00c076' : '#f6465d'
        return (
          <g key={i}>
            <line x1={cx} y1={toY(c.high)} x2={cx} y2={toY(c.low)}
              stroke={clr} strokeWidth="0.8" opacity="0.7" />
            <rect x={cx - candleW / 2} y={bodyTop}
              width={candleW} height={bodyH}
              fill={bullish ? clr : 'transparent'}
              stroke={clr} strokeWidth={bullish ? 0 : 0.8}
              opacity="0.9" rx="0.5" />
          </g>
        )
      })}
      <line x1={pad.left} y1={toY(lastCandle.close)}
        x2={width - pad.right} y2={toY(lastCandle.close)}
        stroke={isUp ? '#00c076' : '#f6465d'}
        strokeWidth="0.6" strokeDasharray="3,3" opacity="0.5" />
      <circle cx={toX(candles.length - 1)} cy={toY(lastCandle.close)}
        r="2.5" fill={isUp ? '#00c076' : '#f6465d'} opacity="0.9" />
    </svg>
  )
}

// ─── Ticker item ──────────────────────────────────────────────────────────────
interface TickerItem {
  label: string; value: string; change?: number; color?: string
}

function TickerChip({ item }: { item: TickerItem }) {
  const up = (item.change ?? 0) >= 0
  return (
    <div className="inline-flex items-center gap-2 px-3 shrink-0">
      <span className="text-[10px] font-medium text-[oklch(0.50_0.012_230)]">{item.label}</span>
      <span className={`text-[11px] font-bold font-mono ${item.color ?? 'text-foreground'}`}>{item.value}</span>
      {item.change !== undefined && (
        <span className={`text-[10px] font-semibold ${up ? 'text-[#00c076]' : 'text-[#f6465d]'}`}>
          {up ? '+' : ''}{item.change.toFixed(2)}%
        </span>
      )}
      <span className="text-[oklch(0.25_0.025_245)] ml-1">│</span>
    </div>
  )
}

// ─── Scrolling Stats Ticker ───────────────────────────────────────────────────
export function StatsTicker() {
  const [prices, setPrices] = useState<PriceFeedSnapshot | null>(getCachedPrices())

  useEffect(() => {
    let cancelled = false
    const refresh = () => getPrices().then(p => { if (!cancelled) setPrices(p) })
    refresh()
    const iv = setInterval(refresh, 60_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const items: TickerItem[] = prices ? [
    { label: 'H2O/USDC',  value: `$${prices.H2O.usd.toFixed(5)}`,  change: prices.H2O.change24h,  color: (prices.H2O.change24h ?? 0) >= 0 ? 'text-[#00c076]' : 'text-[#f6465d]' },
    { label: 'WLD/USDC',  value: `$${prices.WLD.usd.toFixed(4)}`,  change: prices.WLD.change24h },
    { label: 'UTH2/USDC', value: `$${prices.UTH2.usd.toFixed(5)}`, change: prices.UTH2.change24h },
    { label: 'WETH/USDC', value: `$${prices.WETH.usd.toFixed(2)}`, change: prices.WETH.change24h },
    ...POOL_APYS.map(a => ({ label: a.label, value: a.value, color: a.color })),
    { label: 'Red',        value: 'WC · 480',   color: 'text-[oklch(0.65_0.22_255)]' },
    { label: 'Swap',       value: 'V2+V3+V4',   color: 'text-cyan-400' },
  ] : [
    { label: 'Cargando precios...', value: '···', color: 'text-[oklch(0.50_0.012_230)]' },
    ...POOL_APYS.map(a => ({ label: a.label, value: a.value, color: a.color })),
  ]

  const doubled = [...items, ...items]
  return (
    <div className="overflow-hidden border-b border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.02_245)]"
      style={{ height: 28 }}>
      <div className="flex items-center h-full ticker-scroll whitespace-nowrap">
        {doubled.map((item, i) => <TickerChip key={i} item={item} />)}
      </div>
    </div>
  )
}

// ─── Mini Market Header ───────────────────────────────────────────────────────
export function MarketMiniCard() {
  const [prices, setPrices] = useState<PriceFeedSnapshot | null>(getCachedPrices())

  useEffect(() => {
    let cancelled = false
    getPrices().then(p => { if (!cancelled) setPrices(p) })
    const iv = setInterval(() => getPrices().then(p => { if (!cancelled) setPrices(p) }), 60_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const basePrice = prices?.H2O.usd ?? 0.0215
  const candles   = useMemo(() => generateCandles(32, basePrice), [Math.round(basePrice * 1_000_000)])
  const last      = candles[candles.length - 1]
  const change    = prices?.H2O.change24h ?? ((last.close - candles[0].close) / candles[0].close * 100)
  const isUp      = change >= 0
  const vol24h    = prices?.H2O.volume24h

  return (
    <div className="px-3 py-2 border-b border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)]">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold tracking-widest text-[oklch(0.50_0.012_230)] uppercase">H2O/USDC</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm ${isUp ? 'bg-[#00c076]/15 text-[#00c076]' : 'bg-[#f6465d]/15 text-[#f6465d]'}`}>
              {isUp ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
            </span>
            {!prices && <span className="text-[9px] text-[oklch(0.40_0.01_230)] animate-pulse">actualizando…</span>}
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-lg font-black font-mono ${isUp ? 'text-[#00c076]' : 'text-[#f6465d]'}`}>
              ${basePrice.toFixed(5)}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {vol24h !== undefined && (
              <span className="text-[9px] text-[oklch(0.45_0.01_230)]">Vol(24h): <span className="text-foreground/80 font-mono">${vol24h >= 1000 ? `${(vol24h/1000).toFixed(1)}K` : vol24h.toFixed(0)}</span></span>
            )}
            <span className="text-[9px] text-[oklch(0.45_0.01_230)]">WLD: <span className="font-mono text-foreground/70">${prices?.WLD.usd.toFixed(3) ?? '···'}</span></span>
            <span className="text-[9px] text-[oklch(0.45_0.01_230)]">WC·480</span>
          </div>
        </div>
        <div>
          <CandlestickChart candles={candles} width={130} height={44} />
        </div>
      </div>
    </div>
  )
}
