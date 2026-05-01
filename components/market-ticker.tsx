'use client'

import { useState, useEffect, useMemo } from 'react'
import { TrendingUp, TrendingDown, Activity } from 'lucide-react'

// ─── Candle data generator (deterministic seed by hour) ───────────────────────
function generateCandles(count = 48, basePrice = 0.0215, volatility = 0.06) {
  const seed = Math.floor(Date.now() / 3_600_000) // changes each hour
  let price = basePrice
  const candles = []
  for (let i = 0; i < count; i++) {
    const s = Math.sin(seed * 9301 + i * 49297 + 233720923) * 0.5 + 0.5
    const s2 = Math.sin(seed * 12345 + i * 67891 + 98765) * 0.5 + 0.5
    const dir = s > 0.48 ? 1 : -1
    const move = (s2 * volatility * 0.4 + 0.002) * dir
    const open = price
    const close = price * (1 + move)
    const high = Math.max(open, close) * (1 + s * volatility * 0.25)
    const low = Math.min(open, close) * (1 - s2 * volatility * 0.25)
    candles.push({ open, high, low, close })
    price = close
  }
  return candles
}

// ─── SVG Candlestick Chart ────────────────────────────────────────────────────
export function CandlestickChart({
  height = 80,
  width = 320,
  candles: propCandles,
}: {
  height?: number
  width?: number
  candles?: { open: number; high: number; low: number; close: number }[]
}) {
  const candles = useMemo(() => propCandles ?? generateCandles(42), [propCandles])
  const prices = candles.flatMap(c => [c.high, c.low])
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const range = maxP - minP || 0.0001

  const pad = { top: 4, bottom: 4, left: 2, right: 2 }
  const chartW = width - pad.left - pad.right
  const chartH = height - pad.top - pad.bottom
  const candleW = Math.max(2, (chartW / candles.length) * 0.65)
  const gap = chartW / candles.length

  const toY = (p: number) => pad.top + chartH - ((p - minP) / range) * chartH
  const toX = (i: number) => pad.left + i * gap + gap / 2

  const lastCandle = candles[candles.length - 1]
  const firstClose = candles[0].close
  const priceChange = ((lastCandle.close - firstClose) / firstClose) * 100
  const isUp = priceChange >= 0

  // Grid lines
  const gridLines = [0.25, 0.5, 0.75].map(pct => ({
    y: pad.top + chartH * (1 - pct),
    price: minP + range * pct,
  }))

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="cgUp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="cgDown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {gridLines.map((g, i) => (
        <line key={i} x1={pad.left} y1={g.y} x2={width - pad.right} y2={g.y}
          stroke="rgba(99,120,180,0.12)" strokeWidth="0.5" strokeDasharray="3,4" />
      ))}

      {/* Candles */}
      {candles.map((c, i) => {
        const cx = toX(i)
        const bodyTop = toY(Math.max(c.open, c.close))
        const bodyBot = toY(Math.min(c.open, c.close))
        const bodyH = Math.max(1, bodyBot - bodyTop)
        const wickTop = toY(c.high)
        const wickBot = toY(c.low)
        const bullish = c.close >= c.open
        const fill = bullish ? '#00c076' : '#f6465d'
        const stroke = bullish ? '#00c076' : '#f6465d'
        return (
          <g key={i}>
            {/* Wick */}
            <line x1={cx} y1={wickTop} x2={cx} y2={wickBot}
              stroke={stroke} strokeWidth="0.8" opacity="0.7" />
            {/* Body */}
            <rect x={cx - candleW / 2} y={bodyTop}
              width={candleW} height={bodyH}
              fill={bullish ? fill : 'transparent'}
              stroke={stroke}
              strokeWidth={bullish ? 0 : 0.8}
              opacity="0.9"
              rx="0.5"
            />
          </g>
        )
      })}

      {/* Price line (last close) */}
      <line
        x1={pad.left} y1={toY(lastCandle.close)}
        x2={width - pad.right} y2={toY(lastCandle.close)}
        stroke={isUp ? '#00c076' : '#f6465d'}
        strokeWidth="0.6" strokeDasharray="3,3" opacity="0.5"
      />

      {/* Last price dot */}
      <circle cx={toX(candles.length - 1)} cy={toY(lastCandle.close)}
        r="2.5" fill={isUp ? '#00c076' : '#f6465d'} opacity="0.9" />
    </svg>
  )
}

// ─── Stat Ticker Item ─────────────────────────────────────────────────────────
interface TickerItem {
  label: string
  value: string
  change?: number
  color?: string
}

function TickerChip({ item }: { item: TickerItem }) {
  const hasChange = item.change !== undefined
  const up = (item.change ?? 0) >= 0
  return (
    <div className="inline-flex items-center gap-2 px-3 shrink-0">
      <span className="text-[10px] font-medium text-[oklch(0.50_0.012_230)]">{item.label}</span>
      <span className={`text-[11px] font-bold font-mono ${item.color ?? 'text-foreground'}`}>{item.value}</span>
      {hasChange && (
        <span className={`text-[10px] font-semibold ${up ? 'text-[#00c076]' : 'text-[#f6465d]'}`}>
          {up ? '+' : ''}{item.change!.toFixed(2)}%
        </span>
      )}
      <span className="text-[oklch(0.25_0.025_245)] ml-1">│</span>
    </div>
  )
}

// ─── Scrolling Stats Ticker ───────────────────────────────────────────────────
export function StatsTicker({ items }: { items: TickerItem[] }) {
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

// ─── Mini Market Header (H2O price + 24h chart) ───────────────────────────────
export function MarketMiniCard({ basePrice = 0.0215 }: { basePrice?: number }) {
  const candles = useMemo(() => generateCandles(32, basePrice), [basePrice])
  const last = candles[candles.length - 1]
  const first = candles[0]
  const change = ((last.close - first.close) / first.close) * 100
  const isUp = change >= 0
  const vol24h = candles.slice(-8).reduce((s, c) => s + Math.abs(c.close - c.open) * 180_000, 0)

  return (
    <div className="px-3 py-2 border-b border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)]">
      <div className="flex items-center justify-between">
        {/* Left: price info */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold tracking-widest text-[oklch(0.50_0.012_230)] uppercase">H2O/USDC</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm ${isUp ? 'bg-[#00c076]/15 text-[#00c076]' : 'bg-[#f6465d]/15 text-[#f6465d]'}`}>
              {isUp ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-lg font-black font-mono ${isUp ? 'text-[#00c076]' : 'text-[#f6465d]'}`}>
              ${last.close.toFixed(5)}
            </span>
            <span className="text-[10px] text-[oklch(0.50_0.012_230)] font-mono">≈ ${last.close.toFixed(4)}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[9px] text-[oklch(0.45_0.01_230)]">Vol(24h): <span className="text-foreground/80 font-mono">${(vol24h).toFixed(0)}</span></span>
            <span className="text-[9px] text-[oklch(0.45_0.01_230)]">WC·480</span>
          </div>
        </div>
        {/* Right: chart */}
        <div>
          <CandlestickChart candles={candles} width={130} height={44} />
        </div>
      </div>
    </div>
  )
}
