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
  H2O_V3_ADDRESS, H2O_V3_TX_ABI, H2O_V3_DEPLOY,
  fetchAllPools, fetchUserPosition, fetchAprBps, fetchAllPoolsLive,
  fetchUserBalance, quoteAmount1FromAmount0, quoteAmount0FromAmount1,
  tokenMeta, formatToken, bpsToPct, feeTierLabel, randomNonce,
  fetchH2OUsdcRate, h2oToUsdc, formatUsd,
  type H2OV3Pool, type H2OV3Position, type PoolLiveData,
} from '@/lib/h2o-v3'
import {
  buildFeePayment, fetchFeeInfo, insufficientFeeMsg,
} from '@/lib/feeCollector'

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
  const hasPending = position && position.netH2O > 0n
  const aprPct = aprBps > 0n ? bpsToPct(aprBps) : '— %'
  const change = live?.priceChange24h
  const tvl = live?.tvlInH2O ?? 0n
  const price = live?.priceToken1PerToken0 ?? 0
  const tvlUsd = h2oToUsdc(tvl, usdcRate)
  const pendingUsd = position ? h2oToUsdc(position.netH2O, usdcRate) : 0n

  return (
    <button
      onClick={onOpen}
      disabled={pool.comingSoon}
      className={cn(
        'group w-full text-left rounded-2xl border bg-gradient-to-br from-cyan-950/20 via-slate-950/40 to-blue-950/20 transition-all',
        pool.comingSoon
          ? 'opacity-50 cursor-not-allowed border-amber-500/20'
          : 'border-cyan-500/15 hover:border-cyan-400/50 hover:shadow-[0_0_24px_-8px_rgba(34,211,238,0.4)]',
      )}
    >
      <div className="p-3 space-y-2.5">
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
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold">
                    STABLE
                  </span>
                )}
                {pool.needsInit && !pool.comingSoon && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold flex items-center gap-0.5">
                    <Sparkles className="w-2.5 h-2.5" /> NUEVO
                  </span>
                )}
                {pool.comingSoon && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold">
                    COMING SOON
                  </span>
                )}
              </div>
              <div className="text-[10px] text-cyan-400/60 mt-0.5 font-mono">
                {price > 0 ? `1 ${t0.symbol} ≈ ${price.toLocaleString('en-US', { maximumFractionDigits: price < 0.01 ? 8 : price < 1 ? 6 : 4 })} ${t1.symbol}` : '—'}
              </div>
            </div>
          </div>
          {/* Sparkline + 24h change */}
          {live && live.priceHistory.length >= 2 && (
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
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <div className="rounded-md bg-cyan-950/40 border border-cyan-500/10 px-2 py-1">
            <div className="text-cyan-500/60 uppercase tracking-wider text-[8px]">APR</div>
            <div className="text-cyan-200 font-bold font-mono">{aprPct}</div>
          </div>
          <div className="rounded-md bg-cyan-950/40 border border-cyan-500/10 px-2 py-1">
            <div className="text-cyan-500/60 uppercase tracking-wider text-[8px]">TVL</div>
            <div className="text-cyan-200 font-bold font-mono leading-tight">
              {tvlUsd > 0n ? formatUsd(tvlUsd) : (tvl > 0n ? `${formatToken(tvl, 18, 0)} H2O` : '—')}
            </div>
          </div>
          <div className="rounded-md bg-cyan-950/40 border border-cyan-500/10 px-2 py-1">
            <div className="text-cyan-500/60 uppercase tracking-wider text-[8px]">Liq</div>
            <div className="text-cyan-200 font-bold font-mono">{formatToken(pool.totalLiquidity, 0, 0)}</div>
          </div>
        </div>

        {/* User position bar */}
        {(hasPosition || hasPending) && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20">
            <Waves className="w-3 h-3 text-cyan-300 shrink-0" />
            <div className="text-[10px] text-cyan-100 flex-1 flex items-center gap-2 min-w-0">
              {hasPosition && (
                <span className="truncate">Tuyo <span className="text-cyan-300 font-mono font-bold">{formatToken(position!.liquidity, 0, 0)}L</span></span>
              )}
              {hasPending && (
                <span className="ml-auto text-cyan-300 font-bold whitespace-nowrap">
                  +{formatToken(position!.netH2O, 18, 4)} H2O
                  {pendingUsd > 0n && <span className="text-cyan-400/70 font-normal ml-1">({formatUsd(pendingUsd)})</span>}
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
        Sin historial de precio disponible (pool nuevo)
      </div>
    )
  }
  const W = 320, H = 90
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1
  const stepX = W / (data.length - 1)
  const points = data.map((v, i) => `${(i * stepX).toFixed(2)},${(H - ((v - min) / range) * (H - 8) - 4).toFixed(2)}`).join(' ')
  const isUp = (change ?? 0) >= 0
  const stroke = isUp ? '#22d3ee' : '#fb7185'
  const labels = ['24h', '18h', '12h', '6h', 'now']
  return (
    <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/30 to-blue-950/30 p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-cyan-500/70">Precio (24h)</div>
          <div className="text-lg font-bold text-cyan-100 font-mono">
            {data[data.length - 1].toLocaleString('en-US', { maximumFractionDigits: data[data.length - 1] < 1 ? 8 : 4 })}
            <span className="text-xs text-cyan-500/70 ml-1 font-normal">{t1Sym}/{t0Sym}</span>
          </div>
        </div>
        {change !== null && (
          <div className={cn('text-sm font-bold flex items-center gap-1', isUp ? 'text-cyan-300' : 'text-rose-300')}>
            {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {isUp ? '+' : ''}{change.toFixed(2)}%
          </div>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        <defs>
          <linearGradient id="bigChart" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* grid */}
        {[0.25, 0.5, 0.75].map(t => (
          <line key={t} x1="0" y1={H * t} x2={W} y2={H * t} stroke="#06b6d4" strokeOpacity="0.06" strokeDasharray="2 4" />
        ))}
        <polygon points={`0,${H} ${points} ${W},${H}`} fill="url(#bigChart)" />
        <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((_, i) => {
          const x = i * stepX
          const y = H - ((data[i] - min) / range) * (H - 8) - 4
          return <circle key={i} cx={x} cy={y} r={i === data.length - 1 ? 3 : 2} fill={stroke} />
        })}
      </svg>
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
  const [feeAmount, setFeeAmount] = useState<bigint>(10n ** 18n)
  const [h2oBal, setH2oBal] = useState<bigint>(0n)
  const [bal0, setBal0] = useState<bigint>(0n)
  const [bal1, setBal1] = useState<bigint>(0n)

  const t0 = useMemo(() => tokenMeta(pool.token0), [pool.token0])
  const t1 = useMemo(() => tokenMeta(pool.token1), [pool.token1])
  const sqrtPriceX96 = live?.sqrtPriceX96 ?? 0n

  useEffect(() => {
    fetchFeeInfo(userAddress).then(d => { setFeeAmount(d.fee); setH2oBal(d.userH2O) }).catch(() => {})
    Promise.all([
      fetchUserBalance(pool.token0, userAddress),
      fetchUserBalance(pool.token1, userAddress),
    ]).then(([a, b]) => { setBal0(a.balance); setBal1(b.balance) }).catch(() => {})
  }, [pool, userAddress])

  function requireFee(): boolean {
    if (h2oBal < feeAmount) { setMsg(insufficientFeeMsg(feeAmount)); return false }
    return true
  }

  function onAmt0Change(v: string) {
    setAmount0(v)
    setActiveInput('a')
    if (!sqrtPriceX96 || !v || isNaN(parseFloat(v))) { setAmount1(''); return }
    try {
      const a0raw = ethers.parseUnits(v || '0', t0.decimals)
      const a1raw = quoteAmount1FromAmount0(a0raw, sqrtPriceX96)
      setAmount1(ethers.formatUnits(a1raw, t1.decimals))
    } catch {}
  }
  function onAmt1Change(v: string) {
    setAmount1(v)
    setActiveInput('b')
    if (!sqrtPriceX96 || !v || isNaN(parseFloat(v))) { setAmount0(''); return }
    try {
      const a1raw = ethers.parseUnits(v || '0', t1.decimals)
      const a0raw = quoteAmount0FromAmount1(a1raw, sqrtPriceX96)
      setAmount0(ethers.formatUnits(a0raw, t0.decimals))
    } catch {}
  }

  async function doDeposit() {
    if (!H2O_V3_ADDRESS) return setMsg('Contrato no desplegado')
    if (!amount0 || !amount1 || parseFloat(amount0) <= 0 || parseFloat(amount1) <= 0) return setMsg('Ingresa un monto')
    if (!requireFee()) return
    setLoading(true); setMsg('')
    try {
      const a0Wei = ethers.parseUnits(amount0, t0.decimals)
      const a1Wei = ethers.parseUnits(amount1, t1.decimals)
      if (a0Wei > bal0) throw new Error(`Balance insuficiente de ${t0.symbol}`)
      if (a1Wei > bal1) throw new Error(`Balance insuficiente de ${t1.symbol}`)

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const nonce0 = randomNonce()
      const nonce1 = nonce0 + 1n
      const fee = buildFeePayment(feeAmount, deadline)

      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          fee.tx,
          {
            address: H2O_V3_ADDRESS,
            abi: H2O_V3_TX_ABI,
            functionName: 'deposit',
            args: [
              pool.poolId.toString(),
              { permitted: { token: pool.token0, amount: a0Wei.toString() }, nonce: nonce0.toString(), deadline: deadline.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_1',
              { permitted: { token: pool.token1, amount: a1Wei.toString() }, nonce: nonce1.toString(), deadline: deadline.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_2',
              '0',
              '0',
            ],
          },
        ],
        permit2: [
          fee.permit2,
          { permitted: { token: pool.token0, amount: a0Wei.toString() }, spender: H2O_V3_ADDRESS, nonce: nonce0.toString(), deadline: deadline.toString() },
          { permitted: { token: pool.token1, amount: a1Wei.toString() }, spender: H2O_V3_ADDRESS, nonce: nonce1.toString(), deadline: deadline.toString() },
        ],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ ¡Aporte enviado! Refrescando...')
        setAmount0(''); setAmount1('')
        setTimeout(onRefresh, 2500)
      } else {
        setMsg('Transacción rechazada')
      }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  async function doWithdraw() {
    if (!H2O_V3_ADDRESS) return setMsg('Contrato no desplegado')
    if (!position || position.liquidity === 0n) return setMsg('Sin liquidez para retirar')
    if (!requireFee()) return
    setLoading(true); setMsg('')
    try {
      const liqToWithdraw = (position.liquidity * BigInt(withdrawPct)) / 100n
      if (liqToWithdraw === 0n) throw new Error('Monto de retiro 0')
      const fee = buildFeePayment(feeAmount)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          fee.tx,
          {
            address: H2O_V3_ADDRESS,
            abi: H2O_V3_TX_ABI,
            functionName: 'withdraw',
            args: [pool.poolId.toString(), liqToWithdraw.toString(), '0', '0'],
          },
        ],
        permit2: [fee.permit2],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ Retiro hecho! Refrescando...')
        setTimeout(onRefresh, 2500)
      } else { setMsg('Transacción rechazada') }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  async function doClaim() {
    if (!H2O_V3_ADDRESS) return setMsg('Contrato no desplegado')
    if (!position || position.netH2O === 0n) return setMsg('Nada que reclamar')
    if (!requireFee()) return
    setLoading(true); setMsg('')
    try {
      const fee = buildFeePayment(feeAmount)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          fee.tx,
          {
            address: H2O_V3_ADDRESS,
            abi: H2O_V3_TX_ABI,
            functionName: 'claim',
            args: [pool.poolId.toString()],
          },
        ],
        permit2: [fee.permit2],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ Recompensa reclamada! Refrescando...')
        setTimeout(onRefresh, 2500)
      } else { setMsg('Transacción rechazada') }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  const aprPct = aprBps > 0n ? bpsToPct(aprBps) : '— %'
  const tvl = live?.tvlInH2O ?? 0n
  const tvlUsd = h2oToUsdc(tvl, usdcRate)
  const pendingUsd = position ? h2oToUsdc(position.netH2O, usdcRate) : 0n
  const h2oBalUsd = h2oToUsdc(h2oBal, usdcRate)

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
            <StatPill label="APR" value={aprPct} accent />
            <StatPill
              label="TVL"
              value={tvlUsd > 0n ? formatUsd(tvlUsd) : (tvl > 0n ? `${formatToken(tvl, 18, 0)} H2O` : '—')}
              sub={tvlUsd > 0n && tvl > 0n ? `${formatToken(tvl, 18, 0)} H2O` : undefined}
            />
            <StatPill label="Pool Liq" value={live ? formatToken(live.poolLiquidity, 0, 0) : '—'} />
          </div>

          {/* USDC equivalent of user H2O balance */}
          <div className="flex items-center justify-between rounded-xl border border-cyan-500/15 bg-cyan-950/30 px-3 py-2 text-xs">
            <span className="text-cyan-400/70 uppercase tracking-wider text-[10px] font-bold">Tu balance H2O</span>
            <div className="text-right">
              <div className="text-cyan-100 font-mono font-bold">{formatToken(h2oBal, 18, 4)} <span className="text-cyan-500/60 font-normal">H2O</span></div>
              {h2oBalUsd > 0n && <div className="text-[10px] text-cyan-400/70 font-mono">≈ {formatUsd(h2oBalUsd)}</div>}
            </div>
          </div>

          {/* Price chart */}
          {live && <PriceChart data={live.priceHistory} change={live.priceChange24h} t0Sym={t0.symbol} t1Sym={t1.symbol} />}

          {/* User position summary */}
          {position && position.liquidity > 0n && (
            <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-blue-500/5 p-3 space-y-1.5">
              <div className="text-[10px] uppercase text-cyan-300/80 tracking-wider font-bold flex items-center gap-1">
                <Waves className="w-3 h-3" /> Tu posición
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-cyan-500/60 text-[10px]">Liquidez</div>
                  <div className="text-cyan-100 font-mono font-bold">{formatToken(position.liquidity, 0, 0)}</div>
                </div>
                <div>
                  <div className="text-cyan-500/60 text-[10px]">Reclamable</div>
                  <div className="text-cyan-300 font-mono font-bold">{formatToken(position.netH2O, 18, 4)} H2O</div>
                  {pendingUsd > 0n && <div className="text-[9px] text-cyan-400/70 font-mono">≈ {formatUsd(pendingUsd)}</div>}
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
              ) : sqrtPriceX96 === 0n ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Esta pool aún no está inicializada en Uniswap. Espera a que tenga precio antes de depositar.</span>
                </div>
              ) : (
                <>
                  {pool.needsInit && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-300 flex items-start gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Serás de los primeros LPs en esta pool — precio basado en el spot actual de Uniswap.</span>
                    </div>
                  )}

                  <div className="text-[10px] uppercase tracking-wider text-cyan-400/70 font-bold">
                    Ingresa solo UN monto, calculamos el otro al precio del pool
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
                  <Button onClick={doDeposit} disabled={loading} className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold shadow-[0_0_24px_-4px_rgba(34,211,238,0.6)]">
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
              {!position || position.netH2O === 0n ? (
                <div className="text-center py-6 text-sm text-cyan-500/60">Sin recompensas para reclamar</div>
              ) : (
                <>
                  <div className="rounded-2xl border border-cyan-500/40 bg-gradient-to-br from-cyan-500/15 to-blue-500/10 p-5 text-center shadow-[0_0_24px_-8px_rgba(34,211,238,0.5)]">
                    <div className="text-[10px] uppercase text-cyan-300/80 tracking-wider font-bold">Recompensa neta</div>
                    <div className="text-3xl font-extrabold text-cyan-100 mt-1 font-mono">
                      {formatToken(position.netH2O, 18, 4)}
                    </div>
                    <div className="text-xs text-cyan-300/80 mt-1 font-bold">H2O</div>
                  </div>
                  <Button onClick={doClaim} disabled={loading} className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold shadow-[0_0_24px_-4px_rgba(34,211,238,0.6)]">
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Gift className="w-4 h-4 mr-2" />}
                    Reclamar H2O
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
              Aporte 2% · Retiro 2% · Recompensas en H2O equivalente al precio spot · Posición {pool.stable ? 'narrow range' : 'full-range'} {pool.stable ? '' : 'nunca sale de rango'}.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatPill({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={cn(
      'rounded-xl border px-2.5 py-2 min-w-0',
      accent
        ? 'bg-gradient-to-br from-cyan-500/15 to-blue-500/10 border-cyan-400/30'
        : 'bg-cyan-950/40 border-cyan-500/15',
    )}>
      <div className="text-[9px] uppercase tracking-wider text-cyan-500/70 font-bold">{label}</div>
      <div className={cn('font-mono font-bold text-sm truncate', accent ? 'text-cyan-200' : 'text-cyan-100')}>{value}</div>
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
type BaseFilter = 'all' | 'WLD' | 'USDC' | 'WETH' | 'WBTC' | 'mine'
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
  const [sortMode, setSortMode] = useState<SortMode>('tvl')
  const [search, setSearch] = useState('')
  const initialDoneRef = useRef(false)

  const refresh = useCallback(async (silent = false) => {
    if (!H2O_V3_ADDRESS) {
      setLoading(false)
      setMsg('Contrato AcuaH2OV3LP aún no desplegado.')
      return
    }
    if (!silent) { setLoading(true); setMsg('') }
    try {
      const psRaw = await fetchAllPools()
      const seen = new Set<string>()
      const ps = psRaw.filter(p => {
        if (!p.active) return false
        const key = (p.poolAddress || '').toLowerCase() + ':' + p.fee
        if (seen.has(key)) return false
        seen.add(key); return true
      })
      setPools(ps)

      // Cargar en paralelo: posiciones + APRs + datos vivos + tasa USDC
      const [, , live, rate] = await Promise.all([
        Promise.all(ps.map(async p => {
          try {
            if (userAddress) {
              const pos = await fetchUserPosition(p.poolId, userAddress)
              setPositions(prev => ({ ...prev, [p.poolId]: pos }))
            }
          } catch {}
        })),
        Promise.all(ps.map(async p => {
          try {
            const apr = await fetchAprBps(p.poolId)
            setAprs(prev => ({ ...prev, [p.poolId]: apr }))
          } catch {}
        })),
        fetchAllPoolsLive(ps),
        fetchH2OUsdcRate(),
      ])
      setLivePool(live)
      setUsdcRate(rate)
      setLastUpdate(Date.now())
    } catch (e: any) {
      if (!silent) setMsg(e.message || 'Error cargando pools')
    } finally { if (!silent) setLoading(false); initialDoneRef.current = true }
  }, [userAddress])

  useEffect(() => {
    refresh()
    const id = setInterval(() => { refresh(true) }, 30_000)
    return () => clearInterval(id)
  }, [refresh])

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
      <Header onRefresh={() => refresh(false)} loading={loading} lastUpdate={lastUpdate} />

      {/* Panel de totales — TVL y Pendiente con USDC */}
      <div className="grid grid-cols-3 gap-2">
        <BigStat
          label="TVL"
          value={totalTvlUsd > 0n ? formatUsd(totalTvlUsd) : `${formatToken(totals.totalTVL, 18, 0)} H2O`}
          sub={totalTvlUsd > 0n ? `${formatToken(totals.totalTVL, 18, 0)} H2O` : undefined}
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
          value={totalPendingUsd > 0n ? formatUsd(totalPendingUsd) : `${formatToken(totals.totalPending, 18, 4)} H2O`}
          sub={totalPendingUsd > 0n ? `${formatToken(totals.totalPending, 18, 4)} H2O` : undefined}
          icon={<Gift className="w-3.5 h-3.5" />}
          highlight={totals.totalPending > 0n}
        />
      </div>

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
          {(['all', 'mine', 'WLD', 'USDC', 'WETH', 'WBTC'] as BaseFilter[]).map(b => (
            <button key={b} onClick={() => setBaseFilter(b)}
              className={cn(
                'px-2 py-1 text-[10px] font-bold rounded-md border transition-all uppercase tracking-wider',
                baseFilter === b
                  ? 'bg-gradient-to-r from-cyan-500/30 to-blue-500/30 text-cyan-100 border-cyan-400/50 shadow-[0_0_8px_-2px_rgba(34,211,238,0.5)]'
                  : 'bg-cyan-950/40 text-cyan-400/70 border-cyan-500/15 hover:text-cyan-200',
              )}>
              {b === 'all' ? 'Todos' : b === 'mine' ? '⭐ Mías' : b}
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

function Header({ onRefresh, loading, lastUpdate }: { onRefresh?: () => void; loading?: boolean; lastUpdate?: number }) {
  const [secondsAgo, setSecondsAgo] = useState(0)
  useEffect(() => {
    if (!lastUpdate) return
    const tick = () => setSecondsAgo(Math.floor((Date.now() - lastUpdate) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lastUpdate])
  return (
    <div className="flex items-end justify-between">
      <div>
        <div className="text-base font-extrabold flex items-center gap-1.5 text-cyan-50">
          <Waves className="w-4 h-4 text-cyan-400" />
          H2O <span className="text-cyan-400">v3</span>
        </div>
        <div className="text-[10px] text-cyan-400/70">
          Liquidez concentrada Uniswap V3 · Recompensas en H2O
          {lastUpdate ? ` · auto-refresh cada 30s (hace ${secondsAgo}s)` : ''}
        </div>
      </div>
      {onRefresh && (
        <button onClick={onRefresh} disabled={loading}
          className="p-2 rounded-lg border border-cyan-500/20 bg-cyan-950/40 hover:border-cyan-400/40 text-cyan-400 hover:text-cyan-300 transition shrink-0">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      )}
    </div>
  )
}
