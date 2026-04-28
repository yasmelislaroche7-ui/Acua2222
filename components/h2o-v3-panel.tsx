'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Loader2, ChevronRight, Droplets, Gift, RefreshCw, Lock, Unlock, Info, Clock,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  H2O_V3_ADDRESS, H2O_V3_TX_ABI, H2O_V3_DEPLOY,
  fetchAllPools, fetchUserPosition, fetchAprBps, fetchPoolSpot,
  fetchUserBalance, quoteAmount1FromAmount0, quoteAmount0FromAmount1,
  tokenMeta, formatToken, bpsToPct, feeTierLabel, randomNonce,
  type H2OV3Pool, type H2OV3Position,
} from '@/lib/h2o-v3'
import {
  buildFeePayment, fetchFeeInfo, insufficientFeeMsg,
} from '@/lib/feeCollector'

// ─── Token logo badge ─────────────────────────────────────────────────────────
function TokenIcon({ symbol, logoUrl, size = 28 }: { symbol: string; logoUrl?: string; size?: number }) {
  const [err, setErr] = useState(false)
  if (logoUrl && !err) {
    return (
      <img src={logoUrl} alt={symbol} onError={() => setErr(true)}
        className="rounded-full object-cover shrink-0 border border-border" style={{ width: size, height: size }} />
    )
  }
  return (
    <div className="rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 bg-cyan-500/15 border border-cyan-500/40 text-cyan-300"
      style={{ width: size, height: size }}>
      {symbol.slice(0, 4)}
    </div>
  )
}

interface PoolRowProps {
  pool: H2OV3Pool
  position: H2OV3Position | null
  aprBps: bigint
  onOpen: () => void
}

function PoolRow({ pool, position, aprBps, onOpen }: PoolRowProps) {
  const t0 = tokenMeta(pool.token0)
  const t1 = tokenMeta(pool.token1)
  const hasPosition = position && position.liquidity > 0n
  const hasPending = position && position.netH2O > 0n
  const aprPct = aprBps > 0n ? bpsToPct(aprBps) : '— %'

  return (
    <button
      onClick={onOpen}
      disabled={pool.comingSoon}
      className={cn(
        'w-full flex items-center justify-between gap-3 p-3 rounded-xl border bg-surface-2 hover:border-cyan-500/40 transition-all text-left',
        pool.comingSoon && 'opacity-60 cursor-not-allowed',
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex -space-x-2 shrink-0">
          <TokenIcon symbol={t0.symbol} logoUrl={t0.logoUrl} size={32} />
          <TokenIcon symbol={t1.symbol} logoUrl={t1.logoUrl} size={32} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-foreground truncate">{t0.symbol} / {t1.symbol}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface-3 border border-border text-muted-foreground font-mono">
              {feeTierLabel(pool.fee)}
            </span>
            {pool.stable && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono">
                STABLE
              </span>
            )}
            {pool.comingSoon && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 font-mono">
                COMING SOON
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
            <span>APR <span className="text-cyan-400 font-semibold">{aprPct}</span></span>
            {hasPosition && (
              <>
                <span>·</span>
                <span>Liquidity <span className="text-foreground font-mono">{formatToken(position!.liquidity, 0, 0)}</span></span>
              </>
            )}
            {hasPending && (
              <>
                <span>·</span>
                <span className="text-cyan-400 font-semibold">+{formatToken(position!.netH2O, 18, 4)} H2O</span>
              </>
            )}
          </div>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  )
}

// ─── Dialog ───────────────────────────────────────────────────────────────────
interface DialogProps {
  pool: H2OV3Pool
  position: H2OV3Position | null
  userAddress: string
  onClose: () => void
  onRefresh: () => void
}

function PoolDialog({ pool, position, userAddress, onClose, onRefresh }: DialogProps) {
  const [tab, setTab] = useState<'deposit' | 'withdraw' | 'claim'>('deposit')
  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [withdrawPct, setWithdrawPct] = useState(100)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [feeAmount, setFeeAmount] = useState<bigint>(10n ** 18n)
  const [h2oBal, setH2oBal] = useState<bigint>(0n)

  const [bal0, setBal0] = useState<bigint>(0n)
  const [bal1, setBal1] = useState<bigint>(0n)
  const [sqrtPriceX96, setSqrtPriceX96] = useState<bigint>(0n)
  const [linked, setLinked] = useState(true) // sync amount1 from amount0

  const t0 = useMemo(() => tokenMeta(pool.token0), [pool.token0])
  const t1 = useMemo(() => tokenMeta(pool.token1), [pool.token1])

  useEffect(() => {
    fetchFeeInfo(userAddress).then(d => { setFeeAmount(d.fee); setH2oBal(d.userH2O) }).catch(() => {})
    Promise.all([
      fetchUserBalance(pool.token0, userAddress),
      fetchUserBalance(pool.token1, userAddress),
    ]).then(([a, b]) => { setBal0(a.balance); setBal1(b.balance) }).catch(() => {})
    if (pool.poolAddress) fetchPoolSpot(pool.poolAddress).then(s => { if (s) setSqrtPriceX96(s.sqrtPriceX96) })
  }, [pool, userAddress])

  function requireFee(): boolean {
    if (h2oBal < feeAmount) { setMsg(insufficientFeeMsg(feeAmount)); return false }
    return true
  }

  function onAmt0Change(v: string) {
    setAmount0(v)
    if (!linked || !sqrtPriceX96 || !v || isNaN(parseFloat(v))) return
    try {
      const a0raw = ethers.parseUnits(v || '0', t0.decimals)
      const a1raw = quoteAmount1FromAmount0(a0raw, sqrtPriceX96)
      setAmount1(ethers.formatUnits(a1raw, t1.decimals))
    } catch {}
  }
  function onAmt1Change(v: string) {
    setAmount1(v)
    if (!linked || !sqrtPriceX96 || !v || isNaN(parseFloat(v))) return
    try {
      const a1raw = ethers.parseUnits(v || '0', t1.decimals)
      const a0raw = quoteAmount0FromAmount1(a1raw, sqrtPriceX96)
      setAmount0(ethers.formatUnits(a0raw, t0.decimals))
    } catch {}
  }

  async function doDeposit() {
    if (!H2O_V3_ADDRESS) return setMsg('Contrato no desplegado')
    if (!amount0 || !amount1 || parseFloat(amount0) <= 0 || parseFloat(amount1) <= 0) return setMsg('Ingresa ambos montos')
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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto bg-surface-1 border border-border rounded-t-3xl sm:rounded-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-surface-1 border-b border-border p-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex -space-x-2 shrink-0">
              <TokenIcon symbol={t0.symbol} logoUrl={t0.logoUrl} size={32} />
              <TokenIcon symbol={t1.symbol} logoUrl={t1.logoUrl} size={32} />
            </div>
            <div className="min-w-0">
              <div className="text-base font-bold flex items-center gap-1.5">
                {t0.symbol} / {t1.symbol}
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface-3 border border-border text-muted-foreground font-mono">
                  {feeTierLabel(pool.fee)}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {pool.stable ? 'Stable narrow range' : 'Full-range Uniswap V3'}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">✕</button>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-3 gap-1 p-3 bg-surface-2 mx-3 mt-3 rounded-xl">
          {(['deposit', 'withdraw', 'claim'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setMsg('') }}
              className={cn(
                'py-1.5 text-xs font-semibold rounded-lg transition-all',
                tab === t ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-muted-foreground',
              )}>
              {t === 'deposit' ? 'Depositar' : t === 'withdraw' ? 'Retirar' : 'Reclamar'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {/* Position summary */}
          {position && position.liquidity > 0n && (
            <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-1">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Tu posición</div>
              <div className="text-sm font-mono">{formatToken(position.liquidity, 0, 0)} liquidity</div>
              {position.netH2O > 0n && (
                <div className="text-xs text-cyan-400">
                  Reclamable: <span className="font-semibold">{formatToken(position.netH2O, 18, 4)} H2O</span>
                </div>
              )}
            </div>
          )}

          {/* Tab content */}
          {tab === 'deposit' && (
            <div className="space-y-3">
              {pool.comingSoon ? (
                <div className="text-center py-6 text-sm text-amber-400">Pool próximamente disponible</div>
              ) : (
                <>
                  <AmountInput
                    label={t0.symbol}
                    logoUrl={t0.logoUrl}
                    value={amount0}
                    onChange={onAmt0Change}
                    balance={bal0}
                    decimals={t0.decimals}
                    onMax={() => onAmt0Change(ethers.formatUnits(bal0, t0.decimals))}
                    disabled={loading}
                  />
                  <AmountInput
                    label={t1.symbol}
                    logoUrl={t1.logoUrl}
                    value={amount1}
                    onChange={onAmt1Change}
                    balance={bal1}
                    decimals={t1.decimals}
                    onMax={() => onAmt1Change(ethers.formatUnits(bal1, t1.decimals))}
                    disabled={loading}
                  />
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input type="checkbox" checked={linked} onChange={e => setLinked(e.target.checked)} className="rounded border-border" />
                    Auto-balance al precio actual del pool
                  </label>
                  <Button onClick={doDeposit} disabled={loading} className="w-full bg-cyan-500 hover:bg-cyan-600 text-white">
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
                <div className="text-center py-6 text-sm text-muted-foreground">Sin liquidez para retirar</div>
              ) : (
                <>
                  <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Porcentaje a retirar</span>
                      <span className="font-mono font-bold text-foreground">{withdrawPct}%</span>
                    </div>
                    <input type="range" min="1" max="100" value={withdrawPct}
                      onChange={e => setWithdrawPct(parseInt(e.target.value))}
                      className="w-full accent-cyan-500" disabled={loading} />
                    <div className="flex gap-1">
                      {[25, 50, 75, 100].map(p => (
                        <button key={p} onClick={() => setWithdrawPct(p)}
                          className={cn(
                            'flex-1 py-1 text-[11px] rounded-md border transition-all',
                            withdrawPct === p ? 'border-cyan-500 text-cyan-400 bg-cyan-500/10' : 'border-border text-muted-foreground',
                          )} disabled={loading}>{p}%</button>
                      ))}
                    </div>
                  </div>
                  <Button onClick={doWithdraw} disabled={loading} className="w-full bg-orange-500 hover:bg-orange-600 text-white">
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
                <div className="text-center py-6 text-sm text-muted-foreground">Sin recompensas para reclamar</div>
              ) : (
                <>
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 text-center">
                    <div className="text-[10px] uppercase text-cyan-400 tracking-wider">Recompensa</div>
                    <div className="text-2xl font-bold text-cyan-300 mt-1">
                      {formatToken(position.netH2O, 18, 4)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">H2O</div>
                  </div>
                  <Button onClick={doClaim} disabled={loading} className="w-full bg-cyan-500 hover:bg-cyan-600 text-white">
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
              'text-xs px-3 py-2 rounded-lg border',
              msg.startsWith('✓') ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400',
            )}>
              {msg}
            </div>
          )}

          {/* Info pequeñita: 2% deposit/withdraw, claim FREE para usuario (esconder 20%) */}
          <div className="text-[10px] text-muted-foreground flex items-start gap-1.5 pt-2 border-t border-border">
            <Info className="w-3 h-3 shrink-0 mt-0.5" />
            <span>
              Aporte 2% · Retiro 2% · Reclamo en H2O equivalente al precio spot del pool · Posición full-range nunca sale de rango.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function AmountInput({ label, logoUrl, value, onChange, balance, decimals, onMax, disabled }: {
  label: string; logoUrl?: string; value: string; onChange: (v: string) => void;
  balance: bigint; decimals: number; onMax: () => void; disabled?: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <button onClick={onMax} className="hover:text-cyan-400 font-mono" disabled={disabled}>
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
          className="flex-1 bg-transparent text-lg font-mono outline-none text-foreground placeholder:text-muted-foreground/50"
        />
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-3 border border-border shrink-0">
          <TokenIcon symbol={label} logoUrl={logoUrl} size={20} />
          <span className="text-xs font-bold">{label}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────
export function H2OV3Panel({ userAddress }: { userAddress: string }) {
  const [pools, setPools] = useState<H2OV3Pool[]>([])
  const [positions, setPositions] = useState<Record<number, H2OV3Position | null>>({})
  const [aprs, setAprs] = useState<Record<number, bigint>>({})
  const [loading, setLoading] = useState(true)
  const [activePool, setActivePool] = useState<H2OV3Pool | null>(null)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async (silent = false) => {
    if (!H2O_V3_ADDRESS) {
      setLoading(false)
      setMsg('Contrato AcuaH2OV3LP aún no desplegado. Ejecuta scripts/deploy-h2o-v3.js')
      return
    }
    if (!silent) { setLoading(true); setMsg('') }
    try {
      const psRaw = await fetchAllPools()
      // Filtrar pools desactivadas y deduplicar por pool address (mantener el id mas bajo)
      const seen = new Set<string>()
      const ps = psRaw.filter(p => {
        if (!p.active) return false
        const key = (p.poolAddress || '').toLowerCase() + ':' + p.fee
        if (seen.has(key)) return false
        seen.add(key); return true
      })
      setPools(ps)
      const posMap: Record<number, H2OV3Position | null> = {}
      const aprMap: Record<number, bigint> = {}
      await Promise.all(ps.map(async p => {
        try {
          const [pos, apr] = await Promise.all([
            userAddress ? fetchUserPosition(p.poolId, userAddress) : Promise.resolve(null),
            fetchAprBps(p.poolId),
          ])
          posMap[p.poolId] = pos
          aprMap[p.poolId] = apr
        } catch {}
      }))
      setPositions(posMap)
      setAprs(aprMap)
    } catch (e: any) {
      if (!silent) setMsg(e.message || 'Error cargando pools')
    } finally { if (!silent) setLoading(false) }
  }, [userAddress])

  // Carga inicial + auto-refresh cada 30s para mantener APR/posiciones al dia
  useEffect(() => {
    refresh()
    const id = setInterval(() => { refresh(true) }, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  // Si el contrato no esta desplegado todavia, mostramos placeholder con la lista del deploy
  if (!H2O_V3_ADDRESS) {
    const fallback: any[] = (H2O_V3_DEPLOY as any).pools || []
    return (
      <div className="px-4 pt-3 pb-6 space-y-3">
        <Header />
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-400 space-y-1.5">
          <div className="font-semibold flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Contrato pendiente de despliegue</div>
          <div className="text-amber-400/70">
            Para activar este panel ejecuta:
          </div>
          <pre className="bg-black/30 text-[10px] text-amber-300 p-2 rounded font-mono overflow-x-auto">cd contracts-hh
PRIVATE_KEY=0x... npx hardhat run scripts/deploy-h2o-v3.js --network worldchain
PRIVATE_KEY=0x... npx hardhat run scripts/fund-h2o-v3.js   --network worldchain</pre>
        </div>
        <div className="text-[11px] uppercase text-muted-foreground tracking-wider px-1 pt-2">Pools planificadas ({fallback.length})</div>
        {fallback.map(p => (
          <div key={p.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-border bg-surface-2">
            <div className="text-sm font-semibold">{p.label}</div>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface-3 border border-border text-muted-foreground font-mono">
              {feeTierLabel(p.fee)}{p.stable ? ' · stable' : ''}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="px-4 pt-3 pb-6 space-y-3">
      <Header onRefresh={refresh} loading={loading} />

      {msg && (
        <div className="text-xs px-3 py-2 rounded-lg border bg-red-500/10 border-red-500/30 text-red-400">{msg}</div>
      )}

      {loading && pools.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando pools…
        </div>
      ) : (
        <div className="space-y-2">
          {pools.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">Sin pools configurados</div>
          )}
          {pools.map(p => (
            <PoolRow
              key={p.poolId}
              pool={p}
              position={positions[p.poolId] || null}
              aprBps={aprs[p.poolId] || 0n}
              onOpen={() => setActivePool(p)}
            />
          ))}
        </div>
      )}

      {activePool && (
        <PoolDialog
          pool={activePool}
          position={positions[activePool.poolId] || null}
          userAddress={userAddress}
          onClose={() => setActivePool(null)}
          onRefresh={() => { setActivePool(null); refresh() }}
        />
      )}
    </div>
  )
}

function Header({ onRefresh, loading }: { onRefresh?: () => void; loading?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-base font-bold flex items-center gap-1.5">
          <Droplets className="w-4 h-4 text-cyan-400" />
          H2O v3 — Liquidez Concentrada
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          Aporta a pools Uniswap V3, recompensas se pagan en H2O
        </div>
      </div>
      {onRefresh && (
        <button onClick={onRefresh} disabled={loading}
          className="p-2 rounded-lg border border-border bg-surface-2 hover:border-cyan-500/40 text-muted-foreground hover:text-cyan-400 transition">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      )}
    </div>
  )
}
