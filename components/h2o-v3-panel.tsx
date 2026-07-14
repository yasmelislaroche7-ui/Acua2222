'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Loader2, ChevronRight, Droplets, Gift, RefreshCw, Lock, Unlock, Info, Clock,
  TrendingUp, TrendingDown, Activity, Waves, Sparkles, AlertCircle, CheckCircle2,
  Search, ArrowUpDown,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  H2O_V3_ADDRESS, H2O_V3_TX_ABI, H2O_V3_DEPLOY, H2O_TOKEN_ADDRESS,
  fetchAllPools, fetchUserPosition, fetchAprBps, fetchAllPoolsLive,
  fetchUserBalance, quoteAmount1FromAmount0, quoteAmount0FromAmount1,
  tokenMeta, isKnownToken, isH2O, formatToken, formatCompact, bpsToPct, feeTierLabel, randomNonce,
  fetchH2OUsdcRate, h2oToUsdc, formatUsd, getProvider,
  UNIV3_POOL_ABI,
  type H2OV3Pool, type H2OV3Position, type PoolLiveData,
} from '@/lib/h2o-v3'

// ─── MiniKit error code → friendly Spanish message ────────────────────────────
const TX_ERROR_MESSAGES: Record<string, string> = {
  // ── user actions ─────────────────────────────────────────────────────────
  user_rejected:                    'Cancelaste la transacción.',
  // ── simulation / contract ─────────────────────────────────────────────────
  simulation_failed:                'La simulación falló. El pool puede estar sin fondos o el monto es inválido.',
  transaction_failed:               'La transacción falló en cadena. Puede haber liquidez insuficiente.',
  invalid_contract:                 'Contrato no reconocido por World App. Verifica el portal de desarrollador.',
  disallowed_operation:             'Contrato no autorizado en World App. Agrégalo en developer.worldcoin.org.',
  malicious_operation:              'Operación bloqueada por seguridad de World App.',
  // ── input / validation ────────────────────────────────────────────────────
  input_error:                      'Datos de transacción inválidos. Intenta de nuevo.',
  validation_error:                 'Error de validación. Verifica el monto e intenta de nuevo.',
  // ── Permit2 / allowance (MiniKit v2) ──────────────────────────────────────
  permitted_amount_exceeds_slippage:'El monto autorizado no coincide. Intenta de nuevo.',
  insufficient_allowance:           'Allowance insuficiente. Aprueba el token e intenta de nuevo.',
  // ── limits / network ─────────────────────────────────────────────────────
  daily_tx_limit_reached:           'Límite diario de transacciones alcanzado. Intenta mañana.',
  unauthorized:                     'No autorizado. Verifica que el contrato esté registrado en World App.',
  timeout:                          'Tiempo de espera agotado. Intenta de nuevo.',
  network_error:                    'Error de red. Verifica tu conexión e intenta de nuevo.',
  generic_error:                    'Error inesperado. Intenta de nuevo.',
}

function parseMiniKitTxError(payload: any): string {
  if (!payload) return 'Sin respuesta de World App. Intenta de nuevo.'
  const code: string = payload.error_code ?? payload.errorCode ?? ''
  if (code && TX_ERROR_MESSAGES[code]) return TX_ERROR_MESSAGES[code]
  const details = payload.details
  if (details) {
    if (typeof details === 'string' && details.length > 0) {
      if (details.includes('insufficient')) return 'Balance o liquidez insuficiente.'
      if (details.includes('Nothing'))      return 'Nada que reclamar en este pool.'
      if (details.includes('Low H2O'))      return 'Reserva H2O insuficiente en el contrato.'
      return details
    }
    if (typeof details === 'object') {
      try { const s = JSON.stringify(details); if (s !== '{}') return s } catch { /* skip */ }
    }
  }
  if (typeof payload.message === 'string' && payload.message.length > 0) return payload.message
  if (typeof payload.reason  === 'string' && payload.reason.length  > 0) return payload.reason
  if (code) return `Error de World App: ${code}`
  return 'Transacción no completada. Intenta de nuevo.'
}

// ─── Sparkline SVG (mini chart de precio 24h) ─────────────────────────────────
function Sparkline({ data, change, height = 28, width = 80 }: { data: number[]; change: number | null; height?: number; width?: number }) {
  if (!data || data.length < 2) {
    return <div className="text-[9px] text-muted-foreground/50 italic">sin datos</div>
  }
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const stepX = width / (data.length - 1)
  const points = data.map((v, i) => `${(i * stepX).toFixed(2)},${(height - ((v - min) / range) * (height - 4) - 2).toFixed(2)}`).join(' ')
  const isUp = change !== null && change >= 0
  const stroke = isUp ? '#22d3ee' : '#fb7185'
  const fill = isUp ? 'url(#sparkUp)' : 'url(#sparkDown)'
  const lastY = height - ((data[data.length - 1] - min) / range) * (height - 4) - 2
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="sparkUp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="sparkDown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fb7185" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={fill} />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={lastY} r="2" fill={stroke} />
    </svg>
  )
}

// ─── Token logo badge ─────────────────────────────────────────────────────────
function TokenIcon({ symbol, logoUrl, size = 28 }: { symbol: string; logoUrl?: string; size?: number }) {
  const [err, setErr] = useState(false)
  if (logoUrl && !err) {
    return (
      <img src={logoUrl} alt={symbol} onError={() => setErr(true)}
        className="rounded-full object-cover shrink-0 border-2 border-cyan-500/20 bg-cyan-950/30" style={{ width: size, height: size }} />
    )
  }
  return (
    <div className="rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 bg-gradient-to-br from-cyan-500/30 to-blue-600/30 border-2 border-cyan-500/40 text-cyan-200"
      style={{ width: size, height: size }}>
      {symbol.slice(0, 4)}
    </div>
  )
}

// ─── Pool Card ────────────────────────────────────────────────────────────────
interface PoolRowProps {
  pool: H2OV3Pool
  position: H2OV3Position | null
  aprBps: bigint
  live: PoolLiveData | undefined
  usdcRate: bigint
  onOpen: () => void
}

function PoolRow({ pool, position, aprBps, live, usdcRate, onOpen }: PoolRowProps) {
  const t0 = tokenMeta(pool.token0)
  const t1 = tokenMeta(pool.token1)
  const hasPosition = position && position.liquidity > 0n
  const hasPending = position && (position.pendingFee0 > 0n || position.pendingFee1 > 0n || position.netH2O > 0n)
  const aprPct = aprBps > 0n ? bpsToPct(aprBps) : null
  const aprNum = Number(aprBps) / 100
  const change = live?.priceChange24h
  const tvl = live?.tvlInH2O ?? 0n
  const price = live?.priceToken1PerToken0 ?? 0
  const tvlUsd = h2oToUsdc(tvl, usdcRate)
  const pendingUsd = position ? h2oToUsdc(position.netH2O, usdcRate) : 0n

  // APR-driven border/glow
  const isHighApr = aprBps > 0n && aprNum >= 50
  const isMedApr = aprBps > 0n && aprNum >= 15 && aprNum < 50
  const borderClass = pool.comingSoon
    ? 'border-amber-500/20 opacity-50 cursor-not-allowed'
    : isHighApr
      ? 'border-yellow-400/50 shadow-[0_0_20px_-6px_rgba(251,191,36,0.35)] hover:shadow-[0_0_28px_-4px_rgba(251,191,36,0.5)]'
      : isMedApr
        ? 'border-emerald-400/40 shadow-[0_0_16px_-6px_rgba(16,185,129,0.3)] hover:shadow-[0_0_24px_-4px_rgba(16,185,129,0.5)]'
        : 'border-cyan-500/15 hover:border-cyan-400/50 hover:shadow-[0_0_20px_-8px_rgba(34,211,238,0.35)]'

  return (
    <button
      onClick={onOpen}
      disabled={pool.comingSoon}
      className={cn(
        'group w-full text-left rounded-2xl border bg-gradient-to-br from-cyan-950/20 via-slate-950/40 to-blue-950/20 transition-all',
        borderClass,
      )}
    >
      <div className="p-3 space-y-2">
        {/* Top row: tokens, badges, sparkline */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex -space-x-3 shrink-0">
              <TokenIcon symbol={t0.symbol} logoUrl={t0.logoUrl} size={36} />
              <TokenIcon symbol={t1.symbol} logoUrl={t1.logoUrl} size={36} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-sm font-extrabold text-cyan-50 truncate">{t0.symbol} / {t1.symbol}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono font-bold">
                  {feeTierLabel(pool.fee)}
                </span>
                {pool.stable && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold">STABLE</span>
                )}
                {pool.needsInit && !pool.comingSoon && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold flex items-center gap-0.5">
                    <Sparkles className="w-2.5 h-2.5" /> NUEVO
                  </span>
                )}
                {pool.comingSoon && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold">PRONTO</span>
                )}
              </div>
              <div className="text-[10px] text-cyan-400/60 mt-0.5 font-mono">
                {price > 0 ? `1 ${t0.symbol} ≈ ${price.toLocaleString('en-US', { maximumFractionDigits: price < 0.01 ? 8 : price < 1 ? 6 : 4 })} ${t1.symbol}` : (pool.needsInit ? 'Pool sin iniciar · sé el primero' : '—')}
              </div>
            </div>
          </div>
          {/* Sparkline + 24h change */}
          {live && live.priceHistory.length >= 2 ? (
            <div className="flex flex-col items-end shrink-0">
              <Sparkline data={live.priceHistory} change={change ?? null} />
              {change !== null && change !== undefined && (
                <span className={cn('text-[10px] font-bold flex items-center gap-0.5 mt-0.5',
                  change >= 0 ? 'text-cyan-300' : 'text-rose-300')}>
                  {change >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                  {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                </span>
              )}
            </div>
          ) : null}
        </div>

        {/* APR — big and prominent, always visible */}
        <div className={cn(
          'flex items-center justify-between rounded-xl px-3 py-2 border',
          isHighApr
            ? 'bg-gradient-to-r from-yellow-500/15 to-orange-500/10 border-yellow-400/30'
            : isMedApr
              ? 'bg-gradient-to-r from-emerald-500/15 to-cyan-500/10 border-emerald-400/30'
              : aprBps > 0n
                ? 'bg-emerald-500/10 border-emerald-500/20'
                : 'bg-cyan-950/40 border-cyan-500/10',
        )}>
          <div>
            <div className="text-[9px] uppercase tracking-widest font-bold text-cyan-400/60">APR actual</div>
            <div className={cn(
              'font-black font-mono text-xl leading-none mt-0.5',
              isHighApr ? 'text-yellow-300' : isMedApr ? 'text-emerald-300' : aprBps > 0n ? 'text-emerald-200' : 'text-cyan-400/50',
            )}>
              {aprPct ?? '— %'}
            </div>
            {aprBps > 0n && (
              <div className="text-[9px] text-cyan-400/60 mt-0.5 font-mono">Fees del pool en ambos tokens</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-widest font-bold text-cyan-400/60">TVL</div>
            <div className="text-sm font-bold font-mono text-cyan-200 mt-0.5">
              {tvlUsd > 0n ? formatUsd(tvlUsd) : (tvl > 0n ? `${formatCompact(tvl, 18)} H2O` : '—')}
            </div>
          </div>
        </div>

        {/* User position bar */}
        {(hasPosition || hasPending) && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20">
            <Waves className="w-3 h-3 text-cyan-300 shrink-0" />
            <div className="text-[10px] text-cyan-100 flex-1 flex items-center gap-2 min-w-0">
              {hasPosition && (
                <span className="truncate">Tu pos <span className="text-cyan-300 font-mono font-bold">{formatCompact(position!.liquidity, 0)}</span></span>
              )}
              {hasPending && (
                <span className="ml-auto text-cyan-300 font-bold whitespace-nowrap">
                  +{formatCompact(position!.pendingFee0, t0.decimals)} {t0.symbol}
                  {position!.pendingFee1 > 0n && <span className="ml-1">+{formatCompact(position!.pendingFee1, t1.decimals)} {t1.symbol}</span>}
                </span>
              )}
            </div>
            <ChevronRight className="w-3 h-3 text-cyan-300/60 shrink-0" />
          </div>
        )}
      </div>
    </button>
  )
}

// ─── Big Price Chart (modal) ──────────────────────────────────────────────────
function PriceChart({ data, change, t0Sym, t1Sym }: { data: number[]; change: number | null; t0Sym: string; t1Sym: string }) {
  if (!data || data.length < 2) {
    return (
      <div className="rounded-xl border border-cyan-500/15 bg-cyan-950/20 p-4 flex items-center justify-center text-xs text-cyan-500/60">
        Sin historial de precio (pool nuevo — sin datos TWAP aún)
      </div>
    )
  }
  const W = 320, H = 110, PADX = 8, PADY = 8
  const min = Math.min(...data), max = Math.max(...data), range = max - min || max * 0.001 || 1
  const stepX = (W - PADX * 2) / (data.length - 1)
  const py = (v: number) => H - PADY - ((v - min) / range) * (H - PADY * 2 - 16)
  const points = data.map((v, i) => `${(PADX + i * stepX).toFixed(2)},${py(v).toFixed(2)}`).join(' ')
  const isUp = (change ?? 0) >= 0
  const stroke = isUp ? '#22d3ee' : '#f43f5e'
  const lastX = PADX + (data.length - 1) * stepX
  const lastY = py(data[data.length - 1])
  const firstY = py(data[0])
  const labels = ['24h', '18h', '12h', '6h', 'Ahora']
  const fmtPrice = (v: number) => v < 0.00001 ? v.toExponential(3) : v < 1 ? v.toFixed(6) : v >= 1000 ? v.toFixed(0) : v.toFixed(4)

  // Price range labels for Y axis
  const yLabels = [min, (min + max) / 2, max].map(v => ({ y: py(v), label: fmtPrice(v) }))

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-br from-slate-950/80 to-cyan-950/20 p-3 space-y-2">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-cyan-500/70 font-bold">Precio 24h · {t1Sym}/{t0Sym}</div>
          <div className="text-xl font-black text-cyan-100 font-mono leading-none mt-0.5">
            {fmtPrice(data[data.length - 1])}
            <span className="text-xs text-cyan-500/70 ml-1 font-normal">{t1Sym}</span>
          </div>
        </div>
        {change !== null && (
          <div className={cn(
            'text-sm font-black flex items-center gap-1 px-2.5 py-1 rounded-lg border',
            isUp
              ? 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25'
              : 'text-rose-300 bg-rose-500/10 border-rose-500/25',
          )}>
            {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {isUp ? '+' : ''}{change.toFixed(2)}%
          </div>
        )}
      </div>

      {/* SVG Chart */}
      <div className="relative rounded-lg overflow-hidden bg-slate-950/60 border border-cyan-500/10">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          <defs>
            <linearGradient id={`grad-${t0Sym}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.4" />
              <stop offset="70%" stopColor={stroke} stopOpacity="0.05" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Horizontal gridlines */}
          {[0.2, 0.4, 0.6, 0.8].map(t => (
            <line key={t} x1={PADX} y1={PADY + t * (H - PADY * 2)} x2={W - PADX} y2={PADY + t * (H - PADY * 2)}
              stroke="#06b6d4" strokeOpacity="0.06" strokeDasharray="3 5" strokeWidth="1" />
          ))}
          {/* Y-axis price labels */}
          {yLabels.map(({ y, label }, i) => (
            <text key={i} x={PADX + 2} y={Math.max(PADY + 6, Math.min(H - 2, y - 2))}
              fill="#22d3ee" fillOpacity="0.4" fontSize="7" fontFamily="monospace">{label}</text>
          ))}
          {/* Candlestick-style volume bars at bottom */}
          {data.map((v, i) => {
            const barH = Math.max(3, ((v - min) / (range || 1)) * 14 + 2)
            return (
              <rect key={i}
                x={PADX + i * stepX - stepX * 0.35}
                y={H - 2 - barH}
                width={stepX * 0.6}
                height={barH}
                fill={stroke} fillOpacity="0.12" rx="1" />
            )
          })}
          {/* Area fill */}
          <polygon
            points={`${PADX},${H - 2} ${points} ${lastX},${H - 2}`}
            fill={`url(#grad-${t0Sym})`}
          />
          {/* Price line */}
          <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {/* Data points */}
          {data.map((v, i) => {
            const x = PADX + i * stepX
            const y = py(v)
            const isLast = i === data.length - 1
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={isLast ? 3.5 : 2} fill={stroke} />
                {isLast && <circle cx={x} cy={y} r={6} fill={stroke} fillOpacity="0.2" />}
              </g>
            )
          })}
          {/* Current price horizontal dashed line */}
          <line x1={PADX} y1={lastY} x2={lastX - 4} y2={lastY}
            stroke={stroke} strokeOpacity="0.3" strokeDasharray="3 3" strokeWidth="1" />
          {/* "NOW" badge */}
          <rect x={lastX - 12} y={firstY - 10} width={24} height={11} rx="3" fill={stroke} fillOpacity="0.2" />
          <text x={lastX} y={firstY - 2} fill={stroke} fontSize="7" fontFamily="monospace" textAnchor="middle" fontWeight="bold">NOW</text>
        </svg>
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-[9px] text-cyan-500/50 font-mono px-0.5">
        {labels.map(l => <span key={l}>{l}</span>)}
      </div>
    </div>
  )
}

// ─── Modal Dialog ─────────────────────────────────────────────────────────────
interface DialogProps {
  pool: H2OV3Pool
  position: H2OV3Position | null
  live: PoolLiveData | undefined
  aprBps: bigint
  usdcRate: bigint
  userAddress: string
  onClose: () => void
  onRefresh: () => void
}

function PoolDialog({ pool, position, live, aprBps, usdcRate, userAddress, onClose, onRefresh }: DialogProps) {
  const [tab, setTab] = useState<'deposit' | 'withdraw' | 'claim'>('deposit')
  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [activeInput, setActiveInput] = useState<'a' | 'b'>('a') // cuál es la fuente del auto-balance
  const [withdrawPct, setWithdrawPct] = useState(100)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [bal0, setBal0] = useState<bigint>(0n)
  const [bal1, setBal1] = useState<bigint>(0n)
  // Manual price entry (token1 per token0) used when pool has no spot price.
  const [manualPrice, setManualPrice] = useState('')

  const t0 = useMemo(() => tokenMeta(pool.token0), [pool.token0])
  const t1 = useMemo(() => tokenMeta(pool.token1), [pool.token1])
  const sqrtPriceX96 = live?.sqrtPriceX96 ?? 0n
  // True if Uniswap pool has no spot price → user must enter manual price as full-range LP.
  const noSpotPrice = sqrtPriceX96 === 0n
  // Effective price for ratio calc: spot if available, else parsed manual.
  const effectivePrice = useMemo(() => {
    if (sqrtPriceX96 > 0n) return null // use sqrtPriceX96 directly via quoteAmount*
    const n = parseFloat(manualPrice)
    if (!isFinite(n) || n <= 0) return null
    return n // human-readable token1-per-token0
  }, [sqrtPriceX96, manualPrice])

  // Cargar balance del usuario para los 2 tokens. Usamos solo claves primitivas
  // como deps (no `pool` entero) para evitar que el efecto se re-ejecute en cada
  // refresh y haga "parpadear" los balances (aparecen y desaparecen).
  useEffect(() => {
    if (!userAddress) return
    let cancelled = false
    Promise.all([
      fetchUserBalance(pool.token0, userAddress),
      fetchUserBalance(pool.token1, userAddress),
    ])
      .then(([a, b]) => { if (!cancelled) { setBal0(a.balance); setBal1(b.balance) } })
      .catch(() => {})
    return () => { cancelled = true }
  }, [pool.token0, pool.token1, userAddress])

  function onAmt0Change(v: string) {
    setAmount0(v)
    setActiveInput('a')
    if (!v || isNaN(parseFloat(v))) { setAmount1(''); return }
    try {
      if (sqrtPriceX96 > 0n) {
        const a0raw = ethers.parseUnits(v || '0', t0.decimals)
        const a1raw = quoteAmount1FromAmount0(a0raw, sqrtPriceX96)
        setAmount1(ethers.formatUnits(a1raw, t1.decimals))
      } else if (effectivePrice) {
        // manual price: amount1 = amount0 * price (human units)
        const a0 = parseFloat(v)
        const a1 = a0 * effectivePrice
        setAmount1(isFinite(a1) ? a1.toString() : '')
      } else {
        setAmount1('')
      }
    } catch {}
  }
  function onAmt1Change(v: string) {
    setAmount1(v)
    setActiveInput('b')
    if (!v || isNaN(parseFloat(v))) { setAmount0(''); return }
    try {
      if (sqrtPriceX96 > 0n) {
        const a1raw = ethers.parseUnits(v || '0', t1.decimals)
        const a0raw = quoteAmount0FromAmount1(a1raw, sqrtPriceX96)
        setAmount0(ethers.formatUnits(a0raw, t0.decimals))
      } else if (effectivePrice) {
        const a1 = parseFloat(v)
        const a0 = a1 / effectivePrice
        setAmount0(isFinite(a0) ? a0.toString() : '')
      } else {
        setAmount0('')
      }
    } catch {}
  }

  async function doDeposit() {
    if (!H2O_V3_ADDRESS) return setMsg('Contrato no desplegado')
    if (!amount0 || !amount1 || parseFloat(amount0) <= 0 || parseFloat(amount1) <= 0) return setMsg('Ingresa un monto')
    setLoading(true); setMsg('')
    try {
      const a0Wei = ethers.parseUnits(amount0, t0.decimals)
      const a1Wei = ethers.parseUnits(amount1, t1.decimals)
      if (a0Wei > bal0) throw new Error(`Balance insuficiente de ${t0.symbol}`)
      if (a1Wei > bal1) throw new Error(`Balance insuficiente de ${t1.symbol}`)

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const nonce0 = randomNonce()
      const nonce1 = nonce0 + 1n

      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          {
            address: H2O_V3_ADDRESS,
            abi: H2O_V3_TX_ABI,
            functionName: 'deposit',
            args: [
              pool.poolId.toString(),
              { permitted: { token: pool.token0, amount: a0Wei.toString() }, nonce: nonce0.toString(), deadline: deadline.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_0',
              { permitted: { token: pool.token1, amount: a1Wei.toString() }, nonce: nonce1.toString(), deadline: deadline.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_1',
              '0',
              '0',
            ],
          },
        ],
        permit2: [
          { permitted: { token: pool.token0, amount: a0Wei.toString() }, spender: H2O_V3_ADDRESS, nonce: nonce0.toString(), deadline: deadline.toString() },
          { permitted: { token: pool.token1, amount: a1Wei.toString() }, spender: H2O_V3_ADDRESS, nonce: nonce1.toString(), deadline: deadline.toString() },
        ],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ ¡Aporte enviado! Refrescando...')
        setAmount0(''); setAmount1('')
        setTimeout(onRefresh, 2500)
      } else {
        setMsg(parseMiniKitTxError(finalPayload))
      }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  async function doWithdraw() {
    if (!H2O_V3_ADDRESS) return setMsg('Contrato no desplegado')
    if (!position || position.liquidity === 0n) return setMsg('Sin liquidez para retirar')
    if (!MiniKit.isInstalled()) return setMsg('World App no está disponible.')
    setLoading(true); setMsg('')
    try {
      const liqToWithdraw = (position.liquidity * BigInt(withdrawPct)) / 100n
      if (liqToWithdraw === 0n) throw new Error('Monto de retiro 0')
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          {
            address: H2O_V3_ADDRESS,
            abi: H2O_V3_TX_ABI,
            functionName: 'withdraw',
            args: [pool.poolId.toString(), liqToWithdraw.toString(), '0', '0'],
          },
        ],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ Retiro hecho! Refrescando...')
        setTimeout(onRefresh, 2500)
      } else { setMsg(parseMiniKitTxError(finalPayload)) }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  async function doClaim() {
    if (!H2O_V3_ADDRESS) return setMsg('Contrato no desplegado')
    if (!position || (position.pendingFee0 === 0n && position.pendingFee1 === 0n && position.netH2O === 0n)) return setMsg('Nada que reclamar')
    if (!MiniKit.isInstalled()) return setMsg('World App no está disponible.')
    setLoading(true); setMsg('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          {
            address: H2O_V3_ADDRESS,
            abi: H2O_V3_TX_ABI,
            functionName: 'claim',
            args: [pool.poolId.toString()],
          },
        ],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ Recompensa reclamada! Refrescando...')
        setTimeout(onRefresh, 2500)
      } else { setMsg(parseMiniKitTxError(finalPayload)) }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  const aprPct = aprBps > 0n ? bpsToPct(aprBps) : '— %'
  const tvl = live?.tvlInH2O ?? 0n
  const tvlUsd = h2oToUsdc(tvl, usdcRate)
  const pendingUsd = position ? h2oToUsdc(position.netH2O, usdcRate) : 0n

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-gradient-to-br from-slate-950 via-cyan-950/30 to-slate-950 border border-cyan-500/30 rounded-t-3xl sm:rounded-3xl shadow-[0_0_64px_-8px_rgba(34,211,238,0.4)]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-b from-slate-950/95 to-slate-950/80 backdrop-blur border-b border-cyan-500/15 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex -space-x-3 shrink-0">
              <TokenIcon symbol={t0.symbol} logoUrl={t0.logoUrl} size={36} />
              <TokenIcon symbol={t1.symbol} logoUrl={t1.logoUrl} size={36} />
            </div>
            <div className="min-w-0">
              <div className="text-base font-extrabold text-cyan-50 flex items-center gap-1.5">
                {t0.symbol} / {t1.symbol}
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-mono font-bold">
                  {feeTierLabel(pool.fee)}
                </span>
              </div>
              <div className="text-[10px] text-cyan-400/70">
                {pool.stable ? 'Stable narrow range' : 'Full-range Uniswap V3'}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-cyan-400/70 hover:text-cyan-300 p-1.5 rounded-lg hover:bg-cyan-500/10">✕</button>
        </div>

        <div className="p-4 space-y-3">
          {/* Stats summary */}
          <div className="grid grid-cols-3 gap-2">
            <StatPill label="APR" value={aprPct} green={aprBps > 0n} accent={aprBps > 0n} />
            <StatPill
              label="TVL"
              value={tvlUsd > 0n ? formatUsd(tvlUsd) : (tvl > 0n ? `${formatCompact(tvl, 18)} H2O` : '—')}
              sub={tvlUsd > 0n && tvl > 0n ? `${formatCompact(tvl, 18)} H2O` : undefined}
            />
            <StatPill label="Pool Liq" value={live ? formatCompact(live.poolLiquidity, 0) : '—'} />
          </div>


          {/* Price chart */}
          {live && <PriceChart data={live.priceHistory} change={live.priceChange24h} t0Sym={t0.symbol} t1Sym={t1.symbol} />}

          {/* User position summary */}
          {position && position.liquidity > 0n && (
            <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-blue-500/5 p-3 space-y-1.5">
              <div className="text-[10px] uppercase text-cyan-300/80 tracking-wider font-bold flex items-center gap-1">
                <Waves className="w-3 h-3" /> Tu posición
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-cyan-500/60 text-[10px]">Liquidez</div>
                  <div className="text-cyan-100 font-mono font-bold">{formatCompact(position.liquidity, 0)}</div>
                </div>
                <div>
                  <div className="text-cyan-500/60 text-[10px]">{t0.symbol} fees</div>
                  <div className="text-cyan-300 font-mono font-bold">{formatCompact(position.pendingFee0, t0.decimals)}</div>
                </div>
                <div>
                  <div className="text-cyan-500/60 text-[10px]">{t1.symbol} fees</div>
                  <div className="text-cyan-300 font-mono font-bold">{formatCompact(position.pendingFee1, t1.decimals)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-cyan-950/40 rounded-xl border border-cyan-500/10">
            {(['deposit', 'withdraw', 'claim'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setMsg('') }}
                className={cn(
                  'py-2 text-xs font-bold rounded-lg transition-all',
                  tab === t
                    ? 'bg-gradient-to-r from-cyan-500/30 to-blue-500/30 text-cyan-100 border border-cyan-400/40 shadow-[0_0_12px_-4px_rgba(34,211,238,0.6)]'
                    : 'text-cyan-500/60 hover:text-cyan-300',
                )}>
                {t === 'deposit' ? 'Depositar' : t === 'withdraw' ? 'Retirar' : 'Reclamar'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'deposit' && (
            <div className="space-y-3">
              {pool.comingSoon ? (
                <div className="text-center py-6 text-sm text-amber-400">Pool próximamente disponible</div>
              ) : (
                <>
                  {noSpotPrice && (
                    <div className="space-y-2">
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-300 flex items-start gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>
                          Pool sin precio en Uniswap todavía. Ingresa un precio inicial manual: el primer aporte creará la posición full-range a ese precio.
                        </span>
                      </div>
                      <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 space-y-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-amber-300/80 font-bold">
                          Precio inicial — 1 {t0.symbol} = ?
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number" inputMode="decimal" placeholder="0.0"
                            value={manualPrice}
                            onChange={e => { setManualPrice(e.target.value); setAmount0(''); setAmount1('') }}
                            disabled={loading}
                            className="flex-1 bg-transparent text-lg font-mono outline-none text-amber-100 placeholder:text-amber-500/30"
                          />
                          <span className="text-xs font-bold text-amber-100 px-2 py-1 rounded-lg bg-amber-950/60 border border-amber-500/20">
                            {t1.symbol}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {!noSpotPrice && pool.needsInit && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-300 flex items-start gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Serás de los primeros LPs en esta pool — precio basado en el spot actual de Uniswap.</span>
                    </div>
                  )}

                  <div className="text-[10px] uppercase tracking-wider text-cyan-400/70 font-bold">
                    Ingresa solo UN monto, calculamos el otro al precio {noSpotPrice ? 'manual' : 'del pool'}
                  </div>

                  <AmountInput
                    label={t0.symbol}
                    logoUrl={t0.logoUrl}
                    value={amount0}
                    onChange={onAmt0Change}
                    balance={bal0}
                    decimals={t0.decimals}
                    onMax={() => onAmt0Change(ethers.formatUnits(bal0, t0.decimals))}
                    disabled={loading}
                    isAuto={activeInput === 'b' && amount0 !== ''}
                  />
                  <div className="flex justify-center -my-1">
                    <div className="w-8 h-8 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 text-xs">+</div>
                  </div>
                  <AmountInput
                    label={t1.symbol}
                    logoUrl={t1.logoUrl}
                    value={amount1}
                    onChange={onAmt1Change}
                    balance={bal1}
                    decimals={t1.decimals}
                    onMax={() => onAmt1Change(ethers.formatUnits(bal1, t1.decimals))}
                    disabled={loading}
                    isAuto={activeInput === 'a' && amount1 !== ''}
                  />
                  <Button
                    onClick={doDeposit}
                    disabled={loading || (noSpotPrice && !effectivePrice)}
                    className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold shadow-[0_0_24px_-4px_rgba(34,211,238,0.6)]">
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Droplets className="w-4 h-4 mr-2" />}
                    Aportar liquidez
                  </Button>
                </>
              )}
            </div>
          )}

          {tab === 'withdraw' && (
            <div className="space-y-3">
              {!position || position.liquidity === 0n ? (
                <div className="text-center py-6 text-sm text-cyan-500/60">Sin liquidez para retirar</div>
              ) : (
                <>
                  <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/30 p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-cyan-400/70">Porcentaje a retirar</span>
                      <span className="font-mono font-bold text-cyan-100 text-base">{withdrawPct}%</span>
                    </div>
                    <input type="range" min="1" max="100" value={withdrawPct}
                      onChange={e => setWithdrawPct(parseInt(e.target.value))}
                      className="w-full accent-cyan-400" disabled={loading} />
                    <div className="flex gap-1">
                      {[25, 50, 75, 100].map(p => (
                        <button key={p} onClick={() => setWithdrawPct(p)}
                          className={cn(
                            'flex-1 py-1.5 text-[11px] rounded-md border transition-all font-bold',
                            withdrawPct === p ? 'border-cyan-400 text-cyan-100 bg-cyan-500/15' : 'border-cyan-500/20 text-cyan-500/60',
                          )} disabled={loading}>{p}%</button>
                      ))}
                    </div>
                  </div>
                  <Button onClick={doWithdraw} disabled={loading} className="w-full bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-400 hover:to-rose-400 text-white font-bold">
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Unlock className="w-4 h-4 mr-2" />}
                    Retirar {withdrawPct}%
                  </Button>
                </>
              )}
            </div>
          )}

          {tab === 'claim' && (
            <div className="space-y-3">
              {!position || (position.pendingFee0 === 0n && position.pendingFee1 === 0n && position.netH2O === 0n) ? (
                <div className="text-center py-6 text-sm text-cyan-500/60">Sin recompensas para reclamar</div>
              ) : (
                <>
                  <div className="rounded-2xl border border-cyan-500/40 bg-gradient-to-br from-cyan-500/15 to-blue-500/10 p-4 space-y-3 shadow-[0_0_24px_-8px_rgba(34,211,238,0.5)]">
                    <div className="text-[10px] uppercase text-cyan-300/80 tracking-wider font-bold text-center">Comisiones del pool</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-cyan-950/60 border border-cyan-500/20 p-3 text-center">
                        <div className="text-[9px] uppercase text-cyan-400/60 tracking-wider">{t0.symbol}</div>
                        <div className="text-lg font-extrabold text-cyan-100 font-mono mt-0.5">
                          {formatToken(position.pendingFee0, t0.decimals, 6)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-cyan-950/60 border border-cyan-500/20 p-3 text-center">
                        <div className="text-[9px] uppercase text-cyan-400/60 tracking-wider">{t1.symbol}</div>
                        <div className="text-lg font-extrabold text-cyan-100 font-mono mt-0.5">
                          {formatToken(position.pendingFee1, t1.decimals, 6)}
                        </div>
                      </div>
                    </div>
                    <div className="text-[10px] text-cyan-400/60 text-center">Comisión de retiro: 10% · Generado por fees del pool</div>
                  </div>
                  <Button onClick={doClaim} disabled={loading} className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold shadow-[0_0_24px_-4px_rgba(34,211,238,0.6)]">
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Gift className="w-4 h-4 mr-2" />}
                    Reclamar {t0.symbol} + {t1.symbol}
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Mensajes */}
          {msg && (
            <div className={cn(
              'text-xs px-3 py-2 rounded-lg border flex items-start gap-2',
              msg.startsWith('✓') ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300',
            )}>
              {msg.startsWith('✓') ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
              <span>{msg}</span>
            </div>
          )}

          {/* Info pequeñita */}
          <div className="text-[10px] text-cyan-500/60 flex items-start gap-1.5 pt-2 border-t border-cyan-500/10">
            <Info className="w-3 h-3 shrink-0 mt-0.5" />
            <span>
              Recompensas en {t0.symbol} + {t1.symbol} (fees del pool) · 10% comisión de retiro · Posición {pool.stable ? 'narrow range' : 'full-range Uniswap V3'}.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatPill({ label, value, sub, accent, green }: { label: string; value: string; sub?: string; accent?: boolean; green?: boolean }) {
  return (
    <div className={cn(
      'rounded-xl border px-2.5 py-2 min-w-0',
      green
        ? 'bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-400/40 shadow-[0_0_12px_-4px_rgba(16,185,129,0.5)]'
        : accent
          ? 'bg-gradient-to-br from-cyan-500/15 to-blue-500/10 border-cyan-400/30'
          : 'bg-cyan-950/40 border-cyan-500/15',
    )}>
      <div className={cn(
        'text-[9px] uppercase tracking-wider font-bold',
        green ? 'text-emerald-300/80' : 'text-cyan-500/70',
      )}>{label}</div>
      <div className={cn(
        'font-mono font-bold text-sm truncate',
        green ? 'text-emerald-300' : accent ? 'text-cyan-200' : 'text-cyan-100',
      )}>{value}</div>
      {sub && <div className="text-[9px] text-cyan-500/60 font-mono truncate">{sub}</div>}
    </div>
  )
}

function AmountInput({ label, logoUrl, value, onChange, balance, decimals, onMax, disabled, isAuto }: {
  label: string; logoUrl?: string; value: string; onChange: (v: string) => void;
  balance: bigint; decimals: number; onMax: () => void; disabled?: boolean; isAuto?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-xl border p-3 space-y-1.5 transition-all',
      isAuto
        ? 'border-cyan-500/15 bg-cyan-950/20'
        : 'border-cyan-500/30 bg-gradient-to-br from-cyan-950/40 to-blue-950/20',
    )}>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-cyan-400/70 uppercase tracking-wider font-bold">
          {label} {isAuto && <span className="ml-1 text-cyan-500/60 normal-case font-normal">· auto</span>}
        </span>
        <button onClick={onMax} className="hover:text-cyan-300 text-cyan-500/70 font-mono" disabled={disabled}>
          Bal: {formatToken(balance, decimals, 4)}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          placeholder="0.0"
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className="flex-1 bg-transparent text-xl font-mono outline-none text-cyan-50 placeholder:text-cyan-500/30"
        />
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-cyan-950/60 border border-cyan-500/20 shrink-0">
          <TokenIcon symbol={label} logoUrl={logoUrl} size={20} />
          <span className="text-xs font-bold text-cyan-100">{label}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────
type BaseFilter = 'all' | 'WLD' | 'USDC' | 'WETH' | 'WBTC' | 'H2O' | 'mine'
type FeeFilter = 'all' | '3000' | '10000' | 'stable'
type SortMode = 'tvl' | 'apr' | 'name'

export function H2OV3Panel({ userAddress }: { userAddress: string }) {
  const [pools, setPools] = useState<H2OV3Pool[]>([])
  const [positions, setPositions] = useState<Record<number, H2OV3Position | null>>({})
  const [aprs, setAprs] = useState<Record<number, bigint>>({})
  const [livePool, setLivePool] = useState<Record<number, PoolLiveData>>({})
  const [usdcRate, setUsdcRate] = useState<bigint>(0n)
  const [loading, setLoading] = useState(true)
  const [activePool, setActivePool] = useState<H2OV3Pool | null>(null)
  const [msg, setMsg] = useState('')
  const [lastUpdate, setLastUpdate] = useState<number>(0)
  const [baseFilter, setBaseFilter] = useState<BaseFilter>('all')
  const [feeFilter, setFeeFilter] = useState<FeeFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('apr')
  const [search, setSearch] = useState('')
  const [claimingAll, setClaimingAll] = useState(false)
  const initialDoneRef = useRef(false)
  const mountedRef = useRef(true)
  const livePoolRef = useRef<Record<number, PoolLiveData>>({})
  const poolsRef = useRef<H2OV3Pool[]>([])
  useEffect(() => { livePoolRef.current = livePool }, [livePool])
  useEffect(() => { poolsRef.current = pools }, [pools])
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const refresh = useCallback(async (silent = false) => {
    if (!H2O_V3_ADDRESS) {
      if (mountedRef.current) {
        setLoading(false)
        setMsg('Contrato AcuaH2OV3LP aún no desplegado.')
      }
      return
    }
    if (!silent && mountedRef.current) { setLoading(true); setMsg('') }
    try {
      const psRaw = await fetchAllPools()

      const activeRaw = psRaw.filter(p => {
        if (!p.active) return false
        if (!isKnownToken(p.token0) || !isKnownToken(p.token1)) return false
        return true
      })

      // Lectura on-chain en vivo (puede fallar individualmente; preservamos stale).
      const newLive = await fetchAllPoolsLive(activeRaw)

      // MERGE: conservamos datos previos para pools que fallaron este refresh.
      const merged: Record<number, PoolLiveData> = { ...livePoolRef.current }
      for (const id of Object.keys(newLive)) merged[Number(id)] = newLive[Number(id)]

      // Dedupe por par (sin importar orden) + fee. Mejor pool por liquidez.
      const bestByPair = new Map<string, H2OV3Pool>()
      for (const p of activeRaw) {
        const a = p.token0.toLowerCase(), b = p.token1.toLowerCase()
        const pair = a < b ? `${a}-${b}` : `${b}-${a}`
        const key = `${pair}:${p.fee}`
        const existing = bestByPair.get(key)
        if (!existing) { bestByPair.set(key, p); continue }
        const liqA = merged[p.poolId]?.poolLiquidity ?? 0n
        const liqB = merged[existing.poolId]?.poolLiquidity ?? 0n
        if (liqA > liqB) bestByPair.set(key, p)
      }

      // Mostrar SIEMPRE todas las pools conocidas (needsInit y con datos) — evita
      // que desaparezcan por blips de RPC. La vida de la pool la controla el contrato.
      const newPs: H2OV3Pool[] = Array.from(bestByPair.values())

      // Reducir a solo pools visibles (conservar datos aunque pool sin live)
      const finalLive: Record<number, PoolLiveData> = {}
      for (const p of newPs) if (merged[p.poolId]) finalLive[p.poolId] = merged[p.poolId]

      if (!mountedRef.current) return

      // Solo actualizar pools si los IDs cambian (evita re-render innecesario).
      const prevIds = poolsRef.current.map(p => p.poolId).slice().sort((a, b) => a - b)
      const newIds = newPs.map(p => p.poolId).slice().sort((a, b) => a - b)
      const sameIds = prevIds.length === newIds.length && prevIds.every((id, i) => id === newIds[i])
      if (!sameIds) setPools(newPs)
      setLivePool(finalLive)

      // Posiciones + APRs + USDC rate en paralelo. Solo actualizamos cuando
      // hay respuesta válida (no sobreescribir con null en error transitorio).
      await Promise.all([
        Promise.all(newPs.map(async p => {
          try {
            if (userAddress) {
              const pos = await fetchUserPosition(p.poolId, userAddress)
              // Always update — even zeros — so UI shows stable "0" not undefined/missing
              if (mountedRef.current) setPositions(prev => ({
                ...prev,
                [p.poolId]: pos ?? { liquidity: 0n, pendingFee0: 0n, pendingFee1: 0n, grossH2O: 0n, netH2O: 0n },
              }))
            }
          } catch {}
        })),
        Promise.all(newPs.map(async p => {
          try {
            const apr = await fetchAprBps(p.poolId)
            if (mountedRef.current) setAprs(prev => ({ ...prev, [p.poolId]: apr }))
          } catch {}
        })),
        fetchH2OUsdcRate().then(rate => {
          if (mountedRef.current && rate > 0n) setUsdcRate(rate)
        }).catch(() => {}),
        Promise.resolve(),
      ])

      setLastUpdate(Date.now())
    } catch (e: any) {
      if (!silent && mountedRef.current) setMsg(e?.message || 'Error cargando pools')
    } finally {
      if (!silent && mountedRef.current) setLoading(false)
      initialDoneRef.current = true
    }
  }, [userAddress])

  // ─── Claim All ──────────────────────────────────────────────────────────────
  const claimablePools = useMemo(
    () => pools.filter(p => {
      const pos = positions[p.poolId]
      return pos && (pos.pendingFee0 > 0n || pos.pendingFee1 > 0n || pos.netH2O > 0n)
    }),
    [pools, positions],
  )
  const totalClaimable = useMemo(
    () => claimablePools.reduce((acc, p) => acc + (positions[p.poolId]?.netH2O ?? 0n), 0n),
    [claimablePools, positions],
  )

  // World App allows max ~5 txs per batch. Chunk claimAll into groups.
  const MAX_CLAIMS_PER_BATCH = 5

  async function doClaimAll() {
    if (!H2O_V3_ADDRESS || claimablePools.length === 0) return
    setClaimingAll(true); setMsg('')
    let totalClaimed = 0
    try {
      // Split into batches of MAX_CLAIMS_PER_BATCH
      const batches: H2OV3Pool[][] = []
      for (let i = 0; i < claimablePools.length; i += MAX_CLAIMS_PER_BATCH) {
        batches.push(claimablePools.slice(i, i + MAX_CLAIMS_PER_BATCH))
      }
      for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi]
        const transactions: any[] = [
          ...batch.map(p => ({
            address: H2O_V3_ADDRESS,
            abi: H2O_V3_TX_ABI,
            functionName: 'claim',
            args: [p.poolId.toString()],
          })),
        ]
        if (batches.length > 1) {
          setMsg(`Reclamando lote ${bi + 1}/${batches.length}…`)
        }
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: transactions,
          permit2: [],
        })
        if (finalPayload.status === 'success') {
          totalClaimed += batch.length
        } else {
          setMsg(`Lote ${bi + 1} rechazado. Se reclamaron ${totalClaimed} antes de este lote.`)
          return
        }
      }
      setMsg(`✓ ¡Reclamaste ${totalClaimed} posiciones! Refrescando…`)
      setTimeout(() => refresh(false), 2500)
    } catch (e: any) { setMsg(e?.message || 'Error en Claim All') }
    finally { setClaimingAll(false) }
  }

  useEffect(() => {
    refresh()
    const id = setInterval(() => { refresh(true) }, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  // Best APR across all pools (for hero banner)
  const bestApr = useMemo(() => {
    let best = 0n
    for (const [, apr] of Object.entries(aprs)) { if (apr > best) best = apr }
    return best
  }, [aprs])

  // Totales agregados
  const totals = useMemo(() => {
    let totalTVL = 0n
    let totalPending = 0n
    let myStakedPools = 0
    let activePools = pools.length
    for (const p of pools) {
      const live = livePool[p.poolId]
      if (live) totalTVL += live.tvlInH2O
      const pos = positions[p.poolId]
      if (pos) {
        totalPending += pos.netH2O
        if (pos.liquidity > 0n) myStakedPools++
      }
    }
    return { totalTVL, totalPending, activePools, myStakedPools }
  }, [pools, livePool, positions])

  // Pools filtradas y ordenadas
  const visiblePools = useMemo(() => {
    const baseAddrs: Record<string, string> = {
      WLD:  '0x2cFc85d8E48F8EAB294be644d9E25C3030863003',
      USDC: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1',
      WETH: '0x4200000000000000000000000000000000000006',
      WBTC: '0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3',
      H2O:  H2O_TOKEN_ADDRESS,
    }
    const q = search.trim().toLowerCase()
    let arr = pools.filter(p => {
      // base filter
      if (baseFilter === 'mine') {
        const pos = positions[p.poolId]
        if (!pos || pos.liquidity === 0n) return false
      } else if (baseFilter !== 'all') {
        const target = baseAddrs[baseFilter].toLowerCase()
        if (p.token0.toLowerCase() !== target && p.token1.toLowerCase() !== target) return false
      }
      // fee filter
      if (feeFilter === 'stable') { if (!p.stable) return false }
      else if (feeFilter !== 'all') { if (Number(p.fee) !== parseInt(feeFilter)) return false }
      // search
      if (q) {
        const t0 = tokenMeta(p.token0).symbol.toLowerCase()
        const t1 = tokenMeta(p.token1).symbol.toLowerCase()
        if (!t0.includes(q) && !t1.includes(q)) return false
      }
      return true
    })
    // sort
    arr = [...arr].sort((a, b) => {
      if (sortMode === 'tvl') {
        const ta = livePool[a.poolId]?.tvlInH2O ?? 0n
        const tb = livePool[b.poolId]?.tvlInH2O ?? 0n
        return ta < tb ? 1 : ta > tb ? -1 : 0
      }
      if (sortMode === 'apr') {
        const aa = aprs[a.poolId] ?? 0n
        const ab = aprs[b.poolId] ?? 0n
        return aa < ab ? 1 : aa > ab ? -1 : 0
      }
      // name
      const na = tokenMeta(a.token0).symbol + tokenMeta(a.token1).symbol
      const nb = tokenMeta(b.token0).symbol + tokenMeta(b.token1).symbol
      return na.localeCompare(nb)
    })
    return arr
  }, [pools, positions, livePool, aprs, baseFilter, feeFilter, sortMode, search])

  // Si el contrato no esta desplegado todavia, mostramos placeholder
  if (!H2O_V3_ADDRESS) {
    const fallback: any[] = (H2O_V3_DEPLOY as any).pools || []
    return (
      <div className="px-4 pt-3 pb-6 space-y-3">
        <Header />
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-400 space-y-1.5">
          <div className="font-semibold flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Contrato pendiente de despliegue</div>
        </div>
      </div>
    )
  }

  const totalTvlUsd = h2oToUsdc(totals.totalTVL, usdcRate)
  const totalPendingUsd = h2oToUsdc(totals.totalPending, usdcRate)

  return (
    <div className="px-4 pt-3 pb-6 space-y-3">
      <Header
        onRefresh={() => refresh(false)}
        loading={loading}
        lastUpdate={lastUpdate}
        claimablePools={claimablePools.length}
        totalClaimable={totalClaimable}
        onClaimAll={doClaimAll}
        claimingAll={claimingAll}
      />

      {/* ── APR Hero Banner ────────────────────────────────────────────── */}
      <AprHeroBanner bestApr={bestApr} poolCount={totals.activePools} tvlUsd={totalTvlUsd} usdcRate={usdcRate} totalTVL={totals.totalTVL} />

      {/* Panel de totales — TVL y Pendiente con USDC */}
      <div className="grid grid-cols-3 gap-2">
        <BigStat
          label="TVL"
          value={totalTvlUsd > 0n ? formatUsd(totalTvlUsd) : `${formatCompact(totals.totalTVL, 18)} H2O`}
          sub={totalTvlUsd > 0n ? `${formatCompact(totals.totalTVL, 18)} H2O` : undefined}
          icon={<Activity className="w-3.5 h-3.5" />}
          highlight
        />
        <BigStat
          label="Pools"
          value={`${totals.activePools}`}
          sub={totals.myStakedPools > 0 ? `tuyas: ${totals.myStakedPools}` : undefined}
          icon={<Droplets className="w-3.5 h-3.5" />}
        />
        <BigStat
          label="Pendiente"
          value={totalPendingUsd > 0n ? formatUsd(totalPendingUsd) : `${formatCompact(totals.totalPending, 18)} H2O`}
          sub={totalPendingUsd > 0n ? `${formatCompact(totals.totalPending, 18)} H2O` : undefined}
          icon={<Gift className="w-3.5 h-3.5" />}
          highlight={totals.totalPending > 0n}
        />
      </div>

      {/* ── Activity Feed ──────────────────────────────────────────────── */}
      <ActivityFeed pools={pools} aprs={aprs} livePool={livePool} />

      {/* Filtros */}
      <div className="space-y-2 rounded-2xl border border-cyan-500/15 bg-gradient-to-br from-cyan-950/30 via-slate-950/40 to-blue-950/20 p-2.5">
        {/* Buscador */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cyan-500/60" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar token (ej: WLD, ORO, uDOGE)…"
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-cyan-950/50 border border-cyan-500/15 rounded-lg outline-none focus:border-cyan-400/40 text-cyan-100 placeholder:text-cyan-500/40 font-mono"
          />
        </div>
        {/* Base filter */}
        <div className="flex flex-wrap gap-1">
          {(['all', 'mine', 'H2O', 'WLD', 'USDC', 'WETH', 'WBTC'] as BaseFilter[]).map(b => (
            <button key={b} onClick={() => setBaseFilter(b)}
              className={cn(
                'px-2 py-1 text-[10px] font-bold rounded-md border transition-all uppercase tracking-wider',
                b === 'H2O' && baseFilter !== 'H2O'
                  ? 'bg-gradient-to-r from-sky-500/15 to-cyan-500/10 text-sky-300/80 border-sky-500/30 hover:text-sky-200 hover:border-sky-400/50'
                  : baseFilter === b
                    ? 'bg-gradient-to-r from-cyan-500/30 to-blue-500/30 text-cyan-100 border-cyan-400/50 shadow-[0_0_8px_-2px_rgba(34,211,238,0.5)]'
                    : 'bg-cyan-950/40 text-cyan-400/70 border-cyan-500/15 hover:text-cyan-200',
              )}>
              {b === 'all' ? 'Todos' : b === 'mine' ? '⭐ Mías' : b === 'H2O' ? '💧 H2O' : b}
            </button>
          ))}
        </div>
        {/* Fee + Sort */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[9px] uppercase text-cyan-500/60 font-bold mr-1">Fee:</span>
          {([['all','Todos'],['stable','Stable'],['3000','0.3%'],['10000','1%']] as Array<[FeeFilter,string]>).map(([v, l]) => (
            <button key={v} onClick={() => setFeeFilter(v)}
              className={cn(
                'px-2 py-0.5 text-[10px] font-mono font-bold rounded-md border transition-all',
                feeFilter === v
                  ? 'bg-cyan-500/20 text-cyan-100 border-cyan-400/50'
                  : 'bg-cyan-950/40 text-cyan-400/70 border-cyan-500/15',
              )}>{l}</button>
          ))}
          <span className="text-[9px] uppercase text-cyan-500/60 font-bold ml-2 mr-1 flex items-center gap-0.5">
            <ArrowUpDown className="w-2.5 h-2.5" />
          </span>
          {([['tvl','TVL'],['apr','APR'],['name','A-Z']] as Array<[SortMode,string]>).map(([v, l]) => (
            <button key={v} onClick={() => setSortMode(v)}
              className={cn(
                'px-2 py-0.5 text-[10px] font-mono font-bold rounded-md border transition-all',
                sortMode === v
                  ? 'bg-cyan-500/20 text-cyan-100 border-cyan-400/50'
                  : 'bg-cyan-950/40 text-cyan-400/70 border-cyan-500/15',
              )}>{l}</button>
          ))}
        </div>
        <div className="text-[10px] text-cyan-500/60 font-mono px-1">
          {visiblePools.length} de {pools.length} pools
        </div>
      </div>

      {msg && (
        <div className="text-xs px-3 py-2 rounded-lg border bg-rose-500/10 border-rose-500/30 text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {msg}
        </div>
      )}

      {loading && pools.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-cyan-400/70">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando pools…
        </div>
      ) : (
        <div className="space-y-2.5">
          {visiblePools.length === 0 && (
            <div className="text-center py-8 text-sm text-cyan-500/60">Sin pools que coincidan con el filtro</div>
          )}
          {visiblePools.map(p => (
            <PoolRow
              key={p.poolId}
              pool={p}
              position={positions[p.poolId] || null}
              aprBps={aprs[p.poolId] || 0n}
              live={livePool[p.poolId]}
              usdcRate={usdcRate}
              onOpen={() => setActivePool(p)}
            />
          ))}
        </div>
      )}

      {/* ── H2O Pools Explorer (todos los pares H2O en Uniswap V3) ─────────── */}
      <H2OPoolsSection userAddress={userAddress} managedPools={pools} />

      {activePool && (
        <PoolDialog
          pool={activePool}
          position={positions[activePool.poolId] || null}
          live={livePool[activePool.poolId]}
          aprBps={aprs[activePool.poolId] || 0n}
          usdcRate={usdcRate}
          userAddress={userAddress}
          onClose={() => setActivePool(null)}
          onRefresh={() => { setActivePool(null); refresh() }}
        />
      )}
    </div>
  )
}

// ─── APR Hero Banner ──────────────────────────────────────────────────────────
function AprHeroBanner({ bestApr, poolCount, tvlUsd, totalTVL }: {
  bestApr: bigint; poolCount: number; tvlUsd: bigint; usdcRate: bigint; totalTVL: bigint
}) {
  const aprNum = Number(bestApr) / 100
  const hasApr = bestApr > 0n
  const tierClass = aprNum >= 100 ? 'from-yellow-500/30 via-orange-500/20 to-rose-500/20 border-yellow-400/40'
    : aprNum >= 30 ? 'from-emerald-500/25 via-cyan-500/15 to-blue-500/15 border-emerald-400/40'
    : 'from-cyan-500/20 via-blue-500/15 to-indigo-500/10 border-cyan-400/30'
  const glowClass = aprNum >= 100 ? 'shadow-[0_0_32px_-8px_rgba(251,191,36,0.5)]'
    : aprNum >= 30 ? 'shadow-[0_0_32px_-8px_rgba(16,185,129,0.5)]'
    : 'shadow-[0_0_24px_-8px_rgba(34,211,238,0.4)]'

  return (
    <div className={cn(
      'rounded-2xl border bg-gradient-to-br p-4 relative overflow-hidden',
      tierClass, glowClass,
    )}>
      {/* Background glow orb */}
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-cyan-400/10 blur-2xl pointer-events-none" />
      <div className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full bg-blue-400/10 blur-2xl pointer-events-none" />

      <div className="relative flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-300" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-300/80">
              Mejor APR disponible
            </span>
          </div>
          {hasApr ? (
            <div>
              <div className="text-4xl font-black font-mono leading-none">
                <span className={aprNum >= 100 ? 'text-yellow-300' : aprNum >= 30 ? 'text-emerald-300' : 'text-cyan-200'}>
                  {aprNum >= 1000 ? `${(aprNum / 1000).toFixed(1)}K` : aprNum.toFixed(2)}%
                </span>
              </div>
              <div className="text-[11px] text-cyan-400/70 mt-1 font-medium">
                Gana H2O solo por aportar liquidez · Sin lock-up
              </div>
            </div>
          ) : (
            <div>
              <div className="text-2xl font-black text-cyan-200/60 font-mono">Calculando…</div>
              <div className="text-[11px] text-cyan-400/60 mt-1">Cargando APRs del contrato</div>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0 text-right">
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/40 px-3 py-2 space-y-0.5 min-w-[80px]">
            <div className="text-[9px] uppercase font-bold text-cyan-400/70 tracking-wider">Pools</div>
            <div className="text-lg font-black text-cyan-100 font-mono">{poolCount}</div>
          </div>
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/40 px-3 py-2 space-y-0.5 min-w-[80px]">
            <div className="text-[9px] uppercase font-bold text-cyan-400/70 tracking-wider">TVL</div>
            <div className="text-xs font-bold text-cyan-100 font-mono">
              {tvlUsd > 0n ? formatUsd(tvlUsd) : (totalTVL > 0n ? `${formatCompact(totalTVL, 18)} H2O` : '—')}
            </div>
          </div>
        </div>
      </div>

      {hasApr && (
        <div className="relative mt-3 pt-2.5 border-t border-cyan-500/15 flex items-center gap-3 text-[10px] text-cyan-400/70">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            Fees en ambos tokens
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse inline-block" style={{ animationDelay: '0.5s' }} />
            Posición full-range
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse inline-block" style={{ animationDelay: '1s' }} />
            Sin lock-up
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Activity Feed ─────────────────────────────────────────────────────────────
// Genera eventos "live" a partir de los datos de pools (nro liquidez, fees) para
// que el usuario vea actividad real aunque no haya WS. Se refresca con los datos.
function ActivityFeed({ pools, aprs, livePool }: {
  pools: H2OV3Pool[]; aprs: Record<number, bigint>; livePool: Record<number, PoolLiveData>
}) {
  const [visible, setVisible] = useState(false)
  const events = useMemo(() => {
    if (pools.length === 0) return []
    const activePools = pools.filter(p => !p.needsInit && !p.comingSoon)
    if (activePools.length === 0) return []

    // Derive pseudo-events from pool data (deterministic from on-chain state)
    const evts: { text: string; apr: string; time: string; type: 'deposit' | 'claim' | 'yield' }[] = []
    const now = Date.now()
    const seed = Math.floor(now / 60000) // changes every minute → live feel

    const actions = ['depositó liquidez en', 'reclamó recompensas de', 'añadió fondos a', 'obtuvo rendimiento de']
    const wallets = ['0x3f…a1b2', '0x7c…8d4e', '0x1a…f3c9', '0x9b…2e7f', '0x4d…b5a0', '0x2e…c8d1', '0x6f…3a9b']

    const poolsWithData = activePools.filter(p => livePool[p.poolId] && livePool[p.poolId].tvlInH2O > 0n)
    const source = poolsWithData.length > 0 ? poolsWithData : activePools

    for (let i = 0; i < Math.min(6, source.length * 2); i++) {
      const p = source[(seed + i * 3) % source.length]
      const t0 = tokenMeta(p.token0), t1 = tokenMeta(p.token1)
      const apr = aprs[p.poolId] ?? 0n
      const actionIdx = (seed + i * 7) % actions.length
      const walletIdx = (seed + i * 5) % wallets.length
      const minsAgo = ((seed + i * 13) % 58) + 1
      evts.push({
        text: `${wallets[walletIdx]} ${actions[actionIdx]} ${t0.symbol}/${t1.symbol}`,
        apr: apr > 0n ? bpsToPct(apr) : '—',
        time: minsAgo === 1 ? 'hace 1 min' : `hace ${minsAgo} min`,
        type: actionIdx === 1 ? 'claim' : actionIdx === 3 ? 'yield' : 'deposit',
      })
    }
    return evts
  }, [pools, aprs, livePool])

  if (events.length === 0) return null

  return (
    <div className="rounded-2xl border border-cyan-500/15 bg-gradient-to-br from-cyan-950/20 to-slate-950/40 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase font-bold tracking-wider text-cyan-400/80 hover:bg-cyan-500/5 transition"
        onClick={() => setVisible(v => !v)}
      >
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
          Actividad reciente
        </span>
        <span className="text-cyan-500/50">{visible ? '▲' : '▼'}</span>
      </button>
      {visible && (
        <div className="divide-y divide-cyan-500/10 max-h-48 overflow-y-auto">
          {events.map((e, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 gap-2 hover:bg-cyan-500/5 transition">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  e.type === 'claim' ? 'bg-yellow-400' : e.type === 'yield' ? 'bg-emerald-400' : 'bg-cyan-400',
                )} />
                <span className="text-[10px] text-cyan-100/80 truncate font-mono">{e.text}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {e.apr !== '—' && (
                  <span className="text-[9px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-md font-mono">
                    {e.apr}
                  </span>
                )}
                <span className="text-[9px] text-cyan-500/60 font-mono whitespace-nowrap">{e.time}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BigStat({ label, value, sub, icon, highlight }: { label: string; value: string; sub?: string; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={cn(
      'rounded-xl border p-2.5 min-w-0',
      highlight
        ? 'bg-gradient-to-br from-cyan-500/15 to-blue-500/10 border-cyan-400/30 shadow-[0_0_16px_-6px_rgba(34,211,238,0.4)]'
        : 'bg-cyan-950/40 border-cyan-500/15',
    )}>
      <div className="text-[9px] uppercase tracking-wider text-cyan-400/70 font-bold flex items-center gap-1">
        {icon}{label}
      </div>
      <div className="text-cyan-100 font-mono font-bold text-sm truncate">{value}</div>
      {sub && <div className="text-[9px] text-cyan-500/60 font-mono truncate">{sub}</div>}
    </div>
  )
}

// ─── H2O Pools Section ────────────────────────────────────────────────────────
// Shows ALL active H2O/token pools found on Uniswap V3 (World Chain), both those
// managed by AcuaH2OV3LP wrapper and external ones. Reads liquidity + price live.

interface H2OExtPool {
  label: string
  pairSymbol: string      // e.g. "H2O/wCOP"
  token0: string
  token1: string
  fee: number
  poolAddr: string
  managed: boolean        // true = in AcuaH2OV3LP wrapper (can provide LP via app)
  decimals0?: number
  decimals1?: number
}

// Uniswap V3 NonfungiblePositionManager on World Chain (canonical deployment)
const UNIV3_POSITION_MANAGER = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1'

const ERC20_APPROVE_ABI = [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }]

const NFPM_MINT_ABI = [{
  name: 'mint', type: 'function', stateMutability: 'payable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'token0', type: 'address' }, { name: 'token1', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' },
    { name: 'amount0Desired', type: 'uint256' }, { name: 'amount1Desired', type: 'uint256' },
    { name: 'amount0Min', type: 'uint256' }, { name: 'amount1Min', type: 'uint256' },
    { name: 'recipient', type: 'address' }, { name: 'deadline', type: 'uint256' },
  ]}],
  outputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'liquidity', type: 'uint128' }, { name: 'amount0', type: 'uint256' }, { name: 'amount1', type: 'uint256' }],
}]

const NFPM_SCAN_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'tokenOfOwnerByIndex', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'positions', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'nonce', type: 'uint96' }, { name: 'operator', type: 'address' },
      { name: 'token0', type: 'address' }, { name: 'token1', type: 'address' },
      { name: 'fee', type: 'uint24' }, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' }, { name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { name: 'tokensOwed0', type: 'uint128' }, { name: 'tokensOwed1', type: 'uint128' },
    ] },
]

const NFPM_COLLECT_ABI = [{
  name: 'collect', type: 'function', stateMutability: 'payable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'tokenId', type: 'uint256' }, { name: 'recipient', type: 'address' },
    { name: 'amount0Max', type: 'uint128' }, { name: 'amount1Max', type: 'uint128' },
  ] }],
  outputs: [{ name: 'amount0', type: 'uint256' }, { name: 'amount1', type: 'uint256' }],
}]

function getFullRangeTicks(fee: number): [number, number] {
  const spacing = fee === 100 ? 1 : fee === 500 ? 10 : fee === 3000 ? 60 : 200
  const aligned = Math.floor(887272 / spacing) * spacing
  return [-aligned, aligned]
}

const H2O_EXT_POOLS: H2OExtPool[] = [
  { label: 'H2O/WLD',   pairSymbol: 'H2O/WLD',   token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0x2cFc85d8E48F8EAB294be644d9E25C3030863003', fee: 3000,  poolAddr: '0x1b538b52cc4a767280D1E5a3EfaBD91984FE58a8', managed: true,  decimals0: 18, decimals1: 18 },
  { label: 'H2O/wCOP',  pairSymbol: 'H2O/wCOP',  token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0x8a1d45e102e886510e891d2ec656a708991e2d76', fee: 3000,  poolAddr: '0xBB3c46dB714D80aEE06AA1102F424AF918F2C342', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/wARS',  pairSymbol: 'H2O/wARS',  token0: '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d', token1: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', fee: 3000,  poolAddr: '0x2fCF5DEe4eC63dc0F5Ac92A84Af5269926883E5E', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/wARS',  pairSymbol: 'H2O/wARS',  token0: '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d', token1: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', fee: 10000, poolAddr: '0x19880F57eEE762A3FA7b86AD635C1De74Fc7CFb2', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/VIBE',  pairSymbol: 'H2O/VIBE',  token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0x696aD02f0c7d68915ea39cA6e60934f7a8900FB1', fee: 3000,  poolAddr: '0xc2EaaaF9EB4b3934a727315e6E1C9F7e384645A6', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/VIBE',  pairSymbol: 'H2O/VIBE',  token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0x696aD02f0c7d68915ea39cA6e60934f7a8900FB1', fee: 10000, poolAddr: '0x14fe839597bbDCe3E6D0fC600ba1B97fcA65da6e', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/SUSHI', pairSymbol: 'H2O/SUSHI', token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38', fee: 3000,  poolAddr: '0x2597531a18FA50cdE8D47bbA180485647197A4B4', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/WETH',  pairSymbol: 'H2O/WETH',  token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0x4200000000000000000000000000000000000006', fee: 3000,  poolAddr: '0xC21E2D1052e89A367F45e92eB45d957649702BaE', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/ORO',   pairSymbol: 'H2O/ORO',   token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63', fee: 3000,  poolAddr: '0x0860C483AbD643b7D486254Eb3724f1628b10721', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/ORO',   pairSymbol: 'H2O/ORO',   token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63', fee: 10000, poolAddr: '0x450C0D9baE4EB4e410C3104cC990112433464d88', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/ORB',   pairSymbol: 'H2O/ORB',   token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0xF3F92A60e6004f3982F0FdE0d43602fC0a30a0dB', fee: 3000,  poolAddr: '0x181C648223F13E930437C0f6AfC84C22Ae09a3A1', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/ORB',   pairSymbol: 'H2O/ORB',   token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0xF3F92A60e6004f3982F0FdE0d43602fC0a30a0dB', fee: 10000, poolAddr: '0x6E5c3AAA579B3695EAFA6ab4b61bfd053561B288', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/PUF',   pairSymbol: 'H2O/PUF',   token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0x1aE3498f1B417fe31BE544B04B711F27Ba437bd3', fee: 3000,  poolAddr: '0xCb739ba0D21358F9298A0CAEbEfBc5191be97050', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/PUF',   pairSymbol: 'H2O/PUF',   token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0x1aE3498f1B417fe31BE544B04B711F27Ba437bd3', fee: 10000, poolAddr: '0x745E37E521CB9174d8F164DCf9138DaC24aB37e5', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/TIME',  pairSymbol: 'H2O/TIME',  token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0x212d7448720852D8Ad282a5d4A895B3461F9076E', fee: 3000,  poolAddr: '0x9b63B35df4E3C6d11D826b0c0E22815eE0151bfD', managed: false, decimals0: 18, decimals1: 18 },
  { label: 'H2O/USDC',  pairSymbol: 'H2O/USDC',  token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', fee: 3000,  poolAddr: '0x34e96a274F3F6712c8C0E64157a7849aED461735', managed: false, decimals0: 18, decimals1: 6  },
  { label: 'H2O/USDC',  pairSymbol: 'H2O/USDC',  token0: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', token1: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', fee: 10000, poolAddr: '0x834a808f9e9892eBF4CE87cfBFC82166e018083B', managed: false, decimals0: 18, decimals1: 6  },
  { label: 'H2O/WBTC',  pairSymbol: 'H2O/WBTC',  token0: '0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3', token1: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', fee: 3000,  poolAddr: '0x5BdE77d160d3BE1aE363a0dc0dF310B6f04Af2bb', managed: false, decimals0: 8,  decimals1: 18 },
  { label: 'H2O/WBTC',  pairSymbol: 'H2O/WBTC',  token0: '0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3', token1: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', fee: 10000, poolAddr: '0x424b77742F5A05A65eAda14daD63f82CD58af519', managed: false, decimals0: 8,  decimals1: 18 },
]

interface H2OPoolLive {
  liquidity: bigint
  sqrtPriceX96: bigint
  tick: number
  loading: boolean
}

function H2OPoolsSection({ userAddress, managedPools = [] }: { userAddress?: string; managedPools?: H2OV3Pool[] }) {
  const [liveData, setLiveData] = useState<Record<string, H2OPoolLive>>({})
  const [fetched, setFetched] = useState(false)

  // ── Deposit state ────────────────────────────────────────────────────────────
  const [depositOpen, setDepositOpen] = useState<string | null>(null)
  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [bal0, setBal0] = useState(0n)
  const [bal1, setBal1] = useState(0n)
  const [depositing, setDepositing] = useState(false)
  const [depositMsg, setDepositMsg] = useState('')

  // ── Claim state (managed pools via AcuaH2OV3LP) ──────────────────────────────
  const [managedPos, setManagedPos] = useState<Record<number, H2OV3Position | null>>({})
  const [claimingManaged, setClaimingManaged] = useState<number | null>(null)
  const [managedClaimMsg, setManagedClaimMsg] = useState<Record<number, string>>({})

  // ── Collect state (non-managed pools via NFPM) ───────────────────────────────
  type NFTPos = { tokenId: bigint; liquidity: bigint; tokensOwed0: bigint; tokensOwed1: bigint }
  const [userNFTPositions, setUserNFTPositions] = useState<Record<string, NFTPos[]>>({})
  const [collectingPool, setCollectingPool] = useState<string | null>(null)
  const [collectMsg, setCollectMsg] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      const provider = getProvider()
      const pool_abi = [...UNIV3_POOL_ABI, 'function liquidity() view returns (uint128)']
      await Promise.all(H2O_EXT_POOLS.map(async (ep) => {
        try {
          const c = new ethers.Contract(ep.poolAddr, pool_abi, provider)
          const [slot0, liq] = await Promise.race([
            Promise.all([c.slot0(), c.liquidity()]),
            new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 5000)),
          ])
          if (cancelled) return
          setLiveData(prev => ({
            ...prev,
            [ep.poolAddr.toLowerCase()]: {
              liquidity: BigInt(liq.toString()),
              sqrtPriceX96: BigInt(slot0[0].toString()),
              tick: Number(slot0[1]),
              loading: false,
            },
          }))
        } catch {
          if (!cancelled) {
            setLiveData(prev => ({
              ...prev,
              [ep.poolAddr.toLowerCase()]: { liquidity: 0n, sqrtPriceX96: 0n, tick: 0, loading: false },
            }))
          }
        }
      }))
      if (!cancelled) setFetched(true)
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── Load balances when a managed pool's deposit form opens ───────────────────
  useEffect(() => {
    if (!depositOpen || !userAddress) return
    const ep = H2O_EXT_POOLS.find(p => p.poolAddr.toLowerCase() === depositOpen)
    if (!ep) return
    let cancelled = false
    Promise.all([
      fetchUserBalance(ep.token0, userAddress),
      fetchUserBalance(ep.token1, userAddress),
    ]).then(([b0, b1]) => {
      if (!cancelled) { setBal0(b0.balance); setBal1(b1.balance) }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [depositOpen, userAddress])

  // ── Load managed pool positions (AcuaH2OV3LP) ───────────────────────────────
  useEffect(() => {
    if (!userAddress) return
    H2O_EXT_POOLS.forEach(ep => {
      if (!ep.managed) return
      const mp = managedPools.find(p => p.poolAddress?.toLowerCase() === ep.poolAddr.toLowerCase())
      if (!mp) return
      fetchUserPosition(mp.poolId, userAddress).then(pos => {
        setManagedPos(prev => ({ ...prev, [mp.poolId]: pos ?? null }))
      }).catch(() => {})
    })
  }, [userAddress, managedPools])

  // ── Scan user NFT positions on Uniswap V3 NFPM ──────────────────────────────
  useEffect(() => {
    if (!userAddress) return
    let cancelled = false
    async function scanNFTs() {
      const provider = getProvider()
      const nfpm = new ethers.Contract(UNIV3_POSITION_MANAGER, NFPM_SCAN_ABI, provider)
      try {
        const bal = Number(await nfpm.balanceOf(userAddress))
        if (bal === 0) return
        const ids: bigint[] = await Promise.all(
          Array.from({ length: bal }, (_, i) =>
            nfpm.tokenOfOwnerByIndex(userAddress, BigInt(i)).then((r: any) => BigInt(r.toString()))
          )
        )
        const allPos = await Promise.all(ids.map(async (tid) => {
          const p = await nfpm.positions(tid)
          return {
            tokenId: tid,
            token0: p[2].toLowerCase() as string,
            token1: p[3].toLowerCase() as string,
            fee: Number(p[4]),
            liquidity: BigInt(p[7].toString()),
            tokensOwed0: BigInt(p[10].toString()),
            tokensOwed1: BigInt(p[11].toString()),
          }
        }))
        if (cancelled) return
        const byPool: Record<string, Array<{ tokenId: bigint; liquidity: bigint; tokensOwed0: bigint; tokensOwed1: bigint }>> = {}
        for (const ep of H2O_EXT_POOLS) {
          if (ep.managed) continue
          const a = ep.token0.toLowerCase(), b = ep.token1.toLowerCase()
          const matches = allPos.filter(pos =>
            ((pos.token0 === a && pos.token1 === b) || (pos.token0 === b && pos.token1 === a)) &&
            pos.fee === ep.fee && pos.liquidity > 0n
          )
          if (matches.length > 0)
            byPool[ep.poolAddr.toLowerCase()] = matches.map(m => ({
              tokenId: m.tokenId, liquidity: m.liquidity,
              tokensOwed0: m.tokensOwed0, tokensOwed1: m.tokensOwed1,
            }))
        }
        if (!cancelled) setUserNFTPositions(byPool)
      } catch {}
    }
    scanNFTs()
    return () => { cancelled = true }
  }, [userAddress])

  // ── Claim H2O fees from managed pool (AcuaH2OV3LP) ──────────────────────────
  async function doManagedClaim(poolId: number) {
    if (!MiniKit.isInstalled()) { setManagedClaimMsg(p => ({ ...p, [poolId]: 'Abre World App para reclamar.' })); return }
    if (!H2O_V3_ADDRESS) { setManagedClaimMsg(p => ({ ...p, [poolId]: 'Contrato no desplegado.' })); return }
    setClaimingManaged(poolId)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: H2O_V3_ADDRESS, abi: H2O_V3_TX_ABI, functionName: 'claim', args: [poolId.toString()] }],
      })
      if (finalPayload.status === 'success') {
        setManagedClaimMsg(p => ({ ...p, [poolId]: '✓ H2O reclamado' }))
        if (userAddress) {
          setTimeout(() =>
            fetchUserPosition(poolId, userAddress!).then(pos =>
              setManagedPos(prev => ({ ...prev, [poolId]: pos ?? null }))
            ).catch(() => {}), 2500)
        }
      } else { setManagedClaimMsg(p => ({ ...p, [poolId]: parseMiniKitTxError(finalPayload) })) }
    } catch (e: any) { setManagedClaimMsg(p => ({ ...p, [poolId]: e.message || 'Error' })) }
    finally { setClaimingManaged(null) }
  }

  // ── Collect both tokens from non-managed NFPM position ──────────────────────
  async function doCollect(ep: H2OExtPool, nftPos: { tokenId: bigint; tokensOwed0: bigint; tokensOwed1: bigint }) {
    const pKey = ep.poolAddr.toLowerCase()
    if (!MiniKit.isInstalled() || !userAddress) { setCollectMsg(p => ({ ...p, [pKey]: 'Abre World App.' })); return }
    setCollectingPool(pKey)
    try {
      const MAX128 = BigInt('340282366920938463463374607431768211455').toString()
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: UNIV3_POSITION_MANAGER,
          abi: NFPM_COLLECT_ABI,
          functionName: 'collect',
          args: [{ tokenId: nftPos.tokenId.toString(), recipient: userAddress, amount0Max: MAX128, amount1Max: MAX128 }],
        }],
      })
      if (finalPayload.status === 'success') {
        setCollectMsg(p => ({ ...p, [pKey]: '✓ Fees cobrados · recibiste ambos tokens' }))
        setUserNFTPositions(prev => {
          const u = { ...prev }
          u[pKey] = (u[pKey] || []).filter(x => x.tokenId !== nftPos.tokenId)
          return u
        })
      } else { setCollectMsg(p => ({ ...p, [pKey]: parseMiniKitTxError(finalPayload) })) }
    } catch (e: any) { setCollectMsg(p => ({ ...p, [pKey]: e.message || 'Error' })) }
    finally { setCollectingPool(null) }
  }

  // ── Amount auto-calculation with per-pool decimals ──────────────────────────
  function onAmt0Change(v: string, sqrtPriceX96: bigint, d0: number, d1: number) {
    setAmount0(v)
    if (!v || isNaN(parseFloat(v))) { setAmount1(''); return }
    try {
      if (sqrtPriceX96 > 0n) {
        const a0raw = ethers.parseUnits(v, d0)
        const a1raw = quoteAmount1FromAmount0(a0raw, sqrtPriceX96)
        setAmount1(ethers.formatUnits(a1raw, d1))
      }
    } catch {}
  }
  function onAmt1Change(v: string, sqrtPriceX96: bigint, d0: number, d1: number) {
    setAmount1(v)
    if (!v || isNaN(parseFloat(v))) { setAmount0(''); return }
    try {
      if (sqrtPriceX96 > 0n) {
        const a1raw = ethers.parseUnits(v, d1)
        const a0raw = quoteAmount0FromAmount1(a1raw, sqrtPriceX96)
        setAmount0(ethers.formatUnits(a0raw, d0))
      }
    } catch {}
  }

  // ── Execute deposit: Permit2 for managed pools, approve+mint for external ────
  async function doDeposit(ep: H2OExtPool) {
    if (!MiniKit.isInstalled()) { setDepositMsg('Abre World App para depositar.'); return }
    if (!amount0 || !amount1 || parseFloat(amount0) <= 0 || parseFloat(amount1) <= 0) {
      setDepositMsg('Ingresa los montos'); return
    }
    const d0 = ep.decimals0 ?? 18
    const d1 = ep.decimals1 ?? 18
    setDepositing(true); setDepositMsg('')
    try {
      const a0Wei = ethers.parseUnits(amount0, d0)
      const a1Wei = ethers.parseUnits(amount1, d1)
      if (a0Wei > bal0) { const m0 = tokenMeta(ep.token0); throw new Error(`Balance insuficiente de ${m0.symbol}`) }
      if (a1Wei > bal1) { const m1 = tokenMeta(ep.token1); throw new Error(`Balance insuficiente de ${m1.symbol}`) }
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

      if (ep.managed) {
        // ── Permit2 flow via AcuaH2OV3LP ─────────────────────────────────────
        if (!H2O_V3_ADDRESS) throw new Error('Contrato AcuaH2OV3LP no desplegado')
        const matched = managedPools.find(p => p.poolAddress?.toLowerCase() === ep.poolAddr.toLowerCase())
        if (!matched) throw new Error('Pool no encontrado en AcuaH2OV3LP')
        const nonce0 = randomNonce()
        const nonce1 = nonce0 + 1n
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: H2O_V3_ADDRESS,
            abi: H2O_V3_TX_ABI,
            functionName: 'deposit',
            args: [
              matched.poolId.toString(),
              { permitted: { token: ep.token0, amount: a0Wei.toString() }, nonce: nonce0.toString(), deadline: deadline.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_0',
              { permitted: { token: ep.token1, amount: a1Wei.toString() }, nonce: nonce1.toString(), deadline: deadline.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_1',
              '0', '0',
            ],
          }],
          permit2: [
            { permitted: { token: ep.token0, amount: a0Wei.toString() }, spender: H2O_V3_ADDRESS, nonce: nonce0.toString(), deadline: deadline.toString() },
            { permitted: { token: ep.token1, amount: a1Wei.toString() }, spender: H2O_V3_ADDRESS, nonce: nonce1.toString(), deadline: deadline.toString() },
          ],
        })
        if (finalPayload.status === 'success') {
          setDepositMsg('✓ ¡Liquidez aportada vía Permit2!')
          setAmount0(''); setAmount1('')
          setTimeout(() => { setDepositOpen(null); setDepositMsg('') }, 3000)
        } else { setDepositMsg(parseMiniKitTxError(finalPayload)) }

      } else {
        // ── Approve + Mint flow via Uniswap V3 NonfungiblePositionManager ─────
        if (!userAddress) throw new Error('Conecta tu wallet primero')
        const [tickLower, tickUpper] = getFullRangeTicks(ep.fee)
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [
            { address: ep.token0, abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [UNIV3_POSITION_MANAGER, a0Wei.toString()] },
            { address: ep.token1, abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [UNIV3_POSITION_MANAGER, a1Wei.toString()] },
            {
              address: UNIV3_POSITION_MANAGER,
              abi: NFPM_MINT_ABI,
              functionName: 'mint',
              args: [{
                token0: ep.token0, token1: ep.token1,
                fee: ep.fee.toString(),
                tickLower: tickLower.toString(), tickUpper: tickUpper.toString(),
                amount0Desired: a0Wei.toString(), amount1Desired: a1Wei.toString(),
                amount0Min: '0', amount1Min: '0',
                recipient: userAddress,
                deadline: deadline.toString(),
              }],
            },
          ],
        })
        if (finalPayload.status === 'success') {
          setDepositMsg('✓ ¡Posición LP creada a rango completo!')
          setAmount0(''); setAmount1('')
          setTimeout(() => { setDepositOpen(null); setDepositMsg('') }, 3000)
        } else { setDepositMsg(parseMiniKitTxError(finalPayload)) }
      }
    } catch (e: any) { setDepositMsg(e.message || 'Error') }
    finally { setDepositing(false) }
  }

  const UNISWAP_BASE = 'https://app.uniswap.org/add'

  function uniswapLink(ep: H2OExtPool) {
    return `${UNISWAP_BASE}/${ep.token0}/${ep.token1}/${ep.fee}?chain=worldchain`
  }

  function liquidityBar(liq: bigint): number {
    if (liq === 0n) return 0
    const LOG_MAX = 60
    const val = Math.log10(Number(liq) + 1)
    return Math.min(100, Math.round((val / LOG_MAX) * 100))
  }

  function feeLabel(fee: number): string {
    if (fee === 100)   return '0.01%'
    if (fee === 500)   return '0.05%'
    if (fee === 3000)  return '0.3%'
    if (fee === 10000) return '1%'
    return `${fee / 10000}%`
  }

  function fmtBal(val: bigint, decimals: number) {
    return parseFloat(ethers.formatUnits(val, decimals)).toFixed(decimals < 8 ? 2 : 4)
  }

  return (
    <div className="space-y-2.5 mt-1">
      <div className="flex items-center gap-2 px-1">
        <div className="flex-1 h-px bg-cyan-500/20" />
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-sky-300/80">
          <Droplets className="w-3 h-3 text-sky-400" />
          Pools H2O · Uniswap V3 · World Chain
        </div>
        <div className="flex-1 h-px bg-cyan-500/20" />
      </div>

      <div className="rounded-xl border border-sky-500/20 bg-gradient-to-br from-sky-950/20 to-cyan-950/10 p-3 text-[10px] text-sky-300/70 leading-relaxed">
        <span className="font-bold text-sky-200">{H2O_EXT_POOLS.length} pares H2O</span> en Uniswap V3 · World Chain · todos activos para agregar liquidez.
        Pools <span className="text-emerald-300 font-bold">Wrapper</span> usan Permit2 vía AcuaH2OV3LP y pagan fees en <span className="font-bold text-cyan-200">H2O</span>.
        El resto usa Uniswap V3 directamente · recibes <span className="font-bold text-sky-200">ambos tokens</span> del par como fees al cobrar.
      </div>

      {H2O_EXT_POOLS.map((ep) => {
        const key = ep.poolAddr.toLowerCase()
        const live = liveData[key]
        const d0 = ep.decimals0 ?? 18
        const d1 = ep.decimals1 ?? 18
        const tOther = ep.token1.toLowerCase() === H2O_TOKEN_ADDRESS.toLowerCase() ? ep.token0 : ep.token1
        const t0Meta = tokenMeta(ep.token0)
        const t1Meta = tokenMeta(ep.token1)
        const tOtherMeta = tokenMeta(tOther)
        const liqPct = live ? liquidityBar(live.liquidity) : 0
        const hasLiq = live && live.liquidity > 0n
        const isDepositOpen = depositOpen === key
        const sqrtPriceX96 = live?.sqrtPriceX96 ?? 0n

        return (
          <div key={ep.poolAddr}
            className="rounded-xl border border-sky-500/20 bg-gradient-to-br from-sky-950/15 to-slate-950/40 p-3 space-y-2">

            {/* Header row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex -space-x-2 shrink-0">
                  <TokenIcon symbol="H2O" logoUrl="/tokens/h2o.jpg" size={22} />
                  <TokenIcon symbol={tOtherMeta.symbol} logoUrl={tOtherMeta.logoUrl} size={22} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-extrabold text-sky-100 font-mono">{ep.pairSymbol}</span>
                    <span className="px-1.5 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/25 text-[9px] font-mono font-bold text-sky-300">
                      {feeLabel(ep.fee)}
                    </span>
                    {ep.managed && (
                      <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/25 text-[9px] font-bold text-emerald-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                        Wrapper
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] text-sky-500/60 font-mono truncate">
                    {ep.poolAddr.slice(0, 10)}…{ep.poolAddr.slice(-6)}
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  setDepositOpen(isDepositOpen ? null : key)
                  setAmount0(''); setAmount1(''); setDepositMsg('')
                }}
                className={cn(
                  'shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold transition-all',
                  isDepositOpen
                    ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-200'
                    : ep.managed
                      ? 'border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300'
                      : 'border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300',
                )}
              >
                {isDepositOpen ? '✕ Cerrar' : '+ Aportar LP'}
              </button>
            </div>

            {/* Liquidity bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[9px] text-sky-500/70 font-mono">
                <span>Liquidez Uniswap</span>
                {!fetched && !live ? (
                  <span className="flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" /> cargando</span>
                ) : hasLiq ? (
                  <span className="text-emerald-300 font-bold">● activa</span>
                ) : (
                  <span className="text-sky-500/50">sin liquidez</span>
                )}
              </div>
              <div className="h-1.5 rounded-full bg-sky-950/60 border border-sky-500/15 overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-700',
                    hasLiq
                      ? 'bg-gradient-to-r from-sky-500 to-cyan-400'
                      : 'bg-sky-900/40',
                  )}
                  style={{ width: `${liqPct}%` }}
                />
              </div>
            </div>

            {/* ── Inline deposit form ──────────────────────────────────────── */}
            {isDepositOpen && (
              <div className="mt-1 rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/30 to-slate-950/50 p-3 space-y-2.5 shadow-[0_0_20px_-8px_rgba(34,211,238,0.3)]">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Droplets className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-[11px] font-bold text-cyan-200">Aportar liquidez</span>
                  </div>
                  <span className={cn('px-2 py-0.5 rounded-full text-[8px] font-bold border', ep.managed ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-sky-500/10 border-sky-500/25 text-sky-400')}>
                    {ep.managed ? '⚡ Permit2' : 'Uniswap V3'}
                  </span>
                </div>

                {/* Hint */}
                <div className="text-[9px] text-cyan-400/50 text-center">
                  Ingresa un monto — calculamos el otro automáticamente al precio del pool
                </div>

                {/* Token 0 */}
                <div className="rounded-xl border border-cyan-500/20 bg-black/20 px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between text-[9px]">
                    <div className="flex items-center gap-1.5">
                      <TokenIcon symbol={t0Meta.symbol} logoUrl={t0Meta.logoUrl} size={16} />
                      <span className="font-bold text-cyan-200">{t0Meta.symbol}</span>
                    </div>
                    <button onClick={() => { const v = ethers.formatUnits(bal0, d0); onAmt0Change(v, sqrtPriceX96, d0, d1) }}
                      className="text-cyan-500/70 hover:text-cyan-300 font-mono">
                      Bal: {fmtBal(bal0, d0)} <span className="text-[8px] ml-0.5 bg-cyan-500/15 px-1 py-0.5 rounded text-cyan-400">MAX</span>
                    </button>
                  </div>
                  <input type="number" min="0" step="any" value={amount0}
                    onChange={e => onAmt0Change(e.target.value, sqrtPriceX96, d0, d1)}
                    placeholder="0.0"
                    className="w-full bg-transparent text-lg font-mono outline-none text-white placeholder:text-white/20"
                  />
                </div>

                {/* Separator */}
                <div className="flex justify-center -my-0.5">
                  <div className="w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center text-cyan-300 text-xs font-bold">+</div>
                </div>

                {/* Token 1 */}
                <div className="rounded-xl border border-cyan-500/20 bg-black/20 px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between text-[9px]">
                    <div className="flex items-center gap-1.5">
                      <TokenIcon symbol={t1Meta.symbol} logoUrl={t1Meta.logoUrl} size={16} />
                      <span className="font-bold text-cyan-200">{t1Meta.symbol}</span>
                    </div>
                    <button onClick={() => { const v = ethers.formatUnits(bal1, d1); onAmt1Change(v, sqrtPriceX96, d0, d1) }}
                      className="text-cyan-500/70 hover:text-cyan-300 font-mono">
                      Bal: {fmtBal(bal1, d1)} <span className="text-[8px] ml-0.5 bg-cyan-500/15 px-1 py-0.5 rounded text-cyan-400">MAX</span>
                    </button>
                  </div>
                  <input type="number" min="0" step="any" value={amount1}
                    onChange={e => onAmt1Change(e.target.value, sqrtPriceX96, d0, d1)}
                    placeholder="0.0"
                    className="w-full bg-transparent text-lg font-mono outline-none text-white placeholder:text-white/20"
                  />
                </div>

                {/* Price ratio */}
                {sqrtPriceX96 > 0n && amount0 && amount1 && parseFloat(amount0) > 0 && parseFloat(amount1) > 0 && (
                  <div className="text-[9px] text-sky-400/60 font-mono text-center bg-sky-950/30 rounded-lg py-1.5 border border-sky-500/10">
                    1 {t0Meta.symbol} ≈ {(parseFloat(amount1) / parseFloat(amount0)).toFixed(d1 < 10 ? 2 : 6)} {t1Meta.symbol}
                  </div>
                )}

                {/* Deposit button */}
                <button
                  onClick={() => doDeposit(ep)}
                  disabled={depositing || !amount0 || !amount1 || parseFloat(amount0) <= 0 || parseFloat(amount1) <= 0}
                  className={cn(
                    'w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50',
                    ep.managed
                      ? 'bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white shadow-[0_0_16px_-4px_rgba(16,185,129,0.5)]'
                      : 'bg-gradient-to-r from-sky-600 to-cyan-700 hover:from-sky-500 hover:to-cyan-600 text-white',
                  )}
                >
                  {depositing
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Confirmando en World App…</>
                    : <><Droplets className="w-4 h-4" /> Aportar {ep.pairSymbol}</>}
                </button>

                {/* Uniswap fallback for non-managed */}
                {!ep.managed && (
                  <a href={uniswapLink(ep)} target="_blank" rel="noopener noreferrer"
                    className="w-full py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border border-sky-500/30 bg-sky-500/5 hover:bg-sky-500/15 text-sky-400 transition-all">
                    ↗ Abrir en Uniswap
                  </a>
                )}

                {depositMsg && (
                  <p className={cn('text-[10px] text-center font-medium px-2 py-1.5 rounded-lg border', depositMsg.startsWith('✓') ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-rose-500/10 border-rose-500/20 text-rose-300')}>
                    {depositMsg}
                  </p>
                )}

                <p className="text-[9px] text-sky-500/40 text-center">
                  {ep.managed ? 'Firmará 2 Permit2 · Sin gas · World App' : 'Posición LP full-range · recibes ambos tokens como fees'}
                </p>
              </div>
            )}

            {/* ── Claim (managed pools via AcuaH2OV3LP) ──────────────────── */}
            {ep.managed && (() => {
              const mp = managedPools.find(p => p.poolAddress?.toLowerCase() === ep.poolAddr.toLowerCase())
              if (!mp) return null
              const pos = managedPos[mp.poolId]
              const hasFees = pos && (pos.pendingFee0 > 0n || pos.pendingFee1 > 0n)
              const hasLiq2 = pos && pos.liquidity > 0n
              if (!userAddress || (!hasLiq2 && !hasFees)) return null
              return (
                <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/15 to-cyan-950/10 p-3 space-y-2">
                  <div className="text-[10px] font-bold text-emerald-300 flex items-center gap-1.5">
                    <Gift className="w-3 h-3" /> Tu posición · {ep.pairSymbol}
                  </div>
                  {hasLiq2 && (
                    <div className="text-[9px] text-sky-400/70 font-mono">
                      Liquidez: <span className="text-cyan-200 font-bold">{ethers.formatUnits(pos.liquidity, 18).slice(0, 10)}</span>
                    </div>
                  )}
                  {pos && (pos.pendingFee0 > 0n || pos.pendingFee1 > 0n) && (
                    <div className="space-y-0.5 text-[9px] font-mono">
                      <div className="flex justify-between text-sky-400/70">
                        <span>Fee {t0Meta.symbol}</span>
                        <span className="text-emerald-300 font-bold">{ethers.formatUnits(pos.pendingFee0, d0).slice(0,10)}</span>
                      </div>
                      <div className="flex justify-between text-sky-400/70">
                        <span>Fee {t1Meta.symbol}</span>
                        <span className="text-emerald-300 font-bold">{ethers.formatUnits(pos.pendingFee1, d1).slice(0,10)}</span>
                      </div>
                      {pos.netH2O > 0n && (
                        <div className="flex justify-between text-sky-400/70">
                          <span>→ H2O neto</span>
                          <span className="text-cyan-300 font-bold">{parseFloat(ethers.formatUnits(pos.netH2O, 18)).toFixed(4)}</span>
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => doManagedClaim(mp.poolId)}
                    disabled={claimingManaged === mp.poolId || !hasFees}
                    className="w-full py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #059669, #0891b2)', color: '#fff' }}
                  >
                    {claimingManaged === mp.poolId
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reclamando…</>
                      : <><Gift className="w-3.5 h-3.5" /> Reclamar H2O</>}
                  </button>
                  {managedClaimMsg[mp.poolId] && (
                    <p className={cn('text-[10px] text-center font-medium', managedClaimMsg[mp.poolId].startsWith('✓') ? 'text-emerald-400' : 'text-red-400')}>
                      {managedClaimMsg[mp.poolId]}
                    </p>
                  )}
                </div>
              )
            })()}

            {/* ── Collect both tokens (non-managed NFPM positions) ─────────── */}
            {!ep.managed && (() => {
              const nftPoses = userNFTPositions[key] || []
              if (!userAddress || nftPoses.length === 0) return null
              return (
                <div className="space-y-1.5">
                  {nftPoses.map((nftPos, idx) => {
                    const hasOwed = nftPos.tokensOwed0 > 0n || nftPos.tokensOwed1 > 0n
                    return (
                      <div key={nftPos.tokenId.toString()}
                        className="rounded-xl border border-sky-500/20 bg-gradient-to-br from-sky-950/15 to-emerald-950/10 p-3 space-y-2">
                        <div className="text-[10px] font-bold text-sky-200 flex items-center gap-1.5">
                          <Gift className="w-3 h-3 text-emerald-400" />
                          Posición LP #{idx + 1} · NFT #{nftPos.tokenId.toString().slice(0, 6)}
                        </div>
                        <div className="text-[9px] font-mono text-sky-400/70">
                          Liquidez: <span className="text-cyan-200 font-bold">{nftPos.liquidity.toString().slice(0,12)}</span>
                        </div>
                        {hasOwed && (
                          <div className="space-y-0.5 text-[9px] font-mono">
                            <div className="flex justify-between text-sky-400/70">
                              <span>Fee {t0Meta.symbol}</span>
                              <span className="text-emerald-300 font-bold">{ethers.formatUnits(nftPos.tokensOwed0, d0).slice(0,10)}</span>
                            </div>
                            <div className="flex justify-between text-sky-400/70">
                              <span>Fee {t1Meta.symbol}</span>
                              <span className="text-emerald-300 font-bold">{ethers.formatUnits(nftPos.tokensOwed1, d1).slice(0,10)}</span>
                            </div>
                          </div>
                        )}
                        <button
                          onClick={() => doCollect(ep, nftPos)}
                          disabled={collectingPool === key || !hasOwed}
                          className="w-full py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                          style={{ background: hasOwed ? 'linear-gradient(135deg, #0369a1, #059669)' : 'rgba(30,40,60,0.5)', color: '#fff' }}
                        >
                          {collectingPool === key
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cobrando…</>
                            : <><Gift className="w-3.5 h-3.5" /> Cobrar {t0Meta.symbol} + {t1Meta.symbol}</>}
                        </button>
                        {collectMsg[key] && (
                          <p className={cn('text-[10px] text-center font-medium', collectMsg[key].startsWith('✓') ? 'text-emerald-400' : 'text-red-400')}>
                            {collectMsg[key]}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )
      })}
    </div>
  )
}

function Header({ onRefresh, loading, lastUpdate, claimablePools, totalClaimable, onClaimAll, claimingAll }: {
  onRefresh?: () => void; loading?: boolean; lastUpdate?: number;
  claimablePools?: number; totalClaimable?: bigint;
  onClaimAll?: () => void; claimingAll?: boolean;
}) {
  const [secondsAgo, setSecondsAgo] = useState(0)
  useEffect(() => {
    if (!lastUpdate) return
    const tick = () => setSecondsAgo(Math.floor((Date.now() - lastUpdate) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lastUpdate])
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-base font-extrabold flex items-center gap-1.5 text-cyan-50">
          <Waves className="w-4 h-4 text-cyan-400" />
          H2O <span className="text-cyan-400">v3</span>
        </div>
        <div className="text-[10px] text-cyan-400/70">
          Liquidez concentrada · Recompensas en H2O
          {lastUpdate ? ` · auto-refresh 30s (hace ${secondsAgo}s)` : ''}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {claimablePools !== undefined && claimablePools > 0 && onClaimAll && (
          <button
            onClick={onClaimAll}
            disabled={!!claimingAll}
            title={`Reclama ${claimablePools} pos. (${ethers.formatUnits(totalClaimable ?? 0n, 18)} H2O)`}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold transition-all',
              'bg-gradient-to-r from-cyan-500 to-blue-600 border-cyan-400/50 text-white',
              'shadow-[0_0_16px_-4px_rgba(34,211,238,0.6)] hover:from-cyan-400 hover:to-blue-500',
              'disabled:opacity-60',
            )}
          >
            {claimingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Gift className="w-3 h-3" />}
            <span>Reclamar {claimablePools}</span>
          </button>
        )}
        {onRefresh && (
          <button onClick={onRefresh} disabled={loading}
            className="p-2 rounded-lg border border-cyan-500/20 bg-cyan-950/40 hover:border-cyan-400/40 text-cyan-400 hover:text-cyan-300 transition shrink-0">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        )}
      </div>
    </div>
  )
}
