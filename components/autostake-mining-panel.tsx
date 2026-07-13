'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Cpu, Zap, RefreshCw, Loader2, Hash, BarChart3, AlertTriangle, Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ACUA_AUTOSTAKE_ADDRESS, DEPLOYED,
  CLAIM_FOR_ABI, CLAIM_BATCH_ABI,
  fetchContractStats, fetchClaimablePositions, fetchAllPositions,
  fmtToken, type ClaimablePosition, type TokenInfo,
} from '@/lib/autostake'
import { cn } from '@/lib/utils'

interface Props { userAddress: string }

const COOLDOWN_SEC = 600  // 10 minutes

function genHash() {
  const c = '0123456789abcdef'; let h = '0x'
  for (let i = 0; i < 16; i++) h += c[Math.floor(Math.random() * 16)]
  return h
}
function shortAddr(a: string) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '' }
function fmtElapsed(s: number) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

// ─── Single block card ────────────────────────────────────────────────────────
function BlockCard({ pos, idx, mining, mined, earned, onMine }: {
  pos: ClaimablePosition; idx: number; mining: boolean; mined: boolean
  earned: bigint | null; onMine: () => void
}) {
  const [hash, setHash] = useState(genHash())
  const iv = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (mining) iv.current = setInterval(() => setHash(genHash()), 100)
    else { if (iv.current) clearInterval(iv.current) }
    return () => { if (iv.current) clearInterval(iv.current) }
  }, [mining])

  return (
    <div className={cn(
      'rounded-xl border transition-all duration-200 overflow-hidden',
      mined ? 'border-emerald-500/50 bg-emerald-500/5'
            : mining ? 'border-[oklch(0.65_0.22_255)]/60 bg-[oklch(0.65_0.22_255)]/5 shadow-[0_0_12px_oklch(0.65_0.22_255)/20]'
                     : 'border-border bg-muted/10'
    )}>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 border-b border-border/40">
        <span className={cn('text-[9px] font-bold w-5 h-5 rounded flex items-center justify-center',
          mined ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted text-muted-foreground')}>
          {mined ? '✓' : `#${idx + 1}`}
        </span>
        <Hash className={cn('w-3 h-3', mining ? 'text-[oklch(0.65_0.22_255)] animate-pulse' : 'text-muted-foreground/30')} />
        <span className={cn('font-mono text-[9px] flex-1 truncate',
          mining ? 'text-[oklch(0.65_0.22_255)]' : 'text-muted-foreground/40')}>
          {mining ? hash : pos.user.slice(0, 14) + '…'}
        </span>
        <span className="text-[9px] text-muted-foreground/50">{fmtElapsed(pos.elapsed)}</span>
      </div>
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex justify-between text-[10px]">
          <span className="text-muted-foreground">Usuario</span>
          <span className="font-mono text-foreground">{shortAddr(pos.user)}</span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-muted-foreground">Stake</span>
          <span className="font-medium">{fmtToken(pos.stake, 18, 2)} {pos.symbol}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-muted-foreground">Reward</span>
          <span className={cn('text-sm font-bold', mined ? 'text-emerald-400' : 'text-amber-400')}>
            +{fmtToken(pos.reward, 18, 6)} {pos.symbol}
          </span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-muted-foreground">Tu ganancia (1%)</span>
          <span className="font-semibold text-[oklch(0.65_0.22_255)]">+{fmtToken(pos.processorEarns, 18, 8)}</span>
        </div>
        {mined && earned !== null ? (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2 py-1.5 text-center">
            <p className="text-[10px] text-emerald-400 font-semibold">⛏ BLOQUE MINADO · +{fmtToken(earned, 18, 8)} {pos.symbol}</p>
          </div>
        ) : (
          <Button size="sm" disabled={mining} onClick={onMine}
            className={cn('w-full h-8 text-xs font-bold',
              mining ? 'bg-[oklch(0.65_0.22_255)]/80 animate-pulse' : 'bg-muted/40 hover:bg-[oklch(0.65_0.22_255)] hover:text-white text-muted-foreground')}>
            {mining ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Minando…</> : <><Zap className="w-3 h-3 mr-1" />Minar bloque</>}
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── All-positions scoreboard ─────────────────────────────────────────────────
function ScoreboardRow({ user, stake, pending, countdown, symbol }: {
  user: string; stake: bigint; pending: bigint; countdown: number; symbol: string
}) {
  const [cd, setCd] = useState(countdown)
  useEffect(() => {
    const t = setInterval(() => setCd(p => Math.max(0, p - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/10 hover:bg-muted/20">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-mono text-foreground truncate">{shortAddr(user)}</p>
        <p className="text-[9px] text-muted-foreground">{fmtToken(stake, 18, 2)} {symbol}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] font-semibold text-amber-400">+{fmtToken(pending, 18, 6)}</p>
        {cd > 0
          ? <p className="text-[9px] text-muted-foreground">⏳ {fmtElapsed(cd)}</p>
          : <p className="text-[9px] text-emerald-400 font-medium">✓ Listo</p>
        }
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function AutoStakeMiningPanel({ userAddress }: Props) {
  const [tokens, setTokens]             = useState<TokenInfo[]>([])
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null)
  const [claimable, setClaimable]       = useState<ClaimablePosition[]>([])
  const [allPositions, setAllPositions] = useState<any[]>([])
  const [loading, setLoading]           = useState(false)
  const [tab, setTab]                   = useState<'mine' | 'all'>('mine')
  const [miningIdx, setMiningIdx]       = useState<number | null>(null)
  const [minedSet, setMinedSet]         = useState<Set<number>>(new Set())
  const [earnedMap, setEarnedMap]       = useState<Map<number, bigint>>(new Map())
  const [batchLoading, setBatchLoading] = useState(false)
  const [msg, setMsg]                   = useState<{ ok: boolean; text: string } | null>(null)
  const [totalEarned, setTotalEarned]   = useState(0n)

  // Countdown to next auto-refresh (10 min cycle)
  const [nextRefresh, setNextRefresh]   = useState(COOLDOWN_SEC)
  const [uptime, setUptime]             = useState(0)

  // Live clock
  useEffect(() => {
    const t = setInterval(() => {
      setUptime(p => p + 1)
      setNextRefresh(p => {
        if (p <= 1) {
          // Auto-reload claimable queue
          if (selectedToken) loadClaimable(selectedToken)
          return COOLDOWN_SEC
        }
        return p - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [selectedToken])

  async function loadClaimable(tk: TokenInfo) {
    try {
      const c = await fetchClaimablePositions(tk.address, tk.symbol, 100)
      setClaimable(c)
      setMinedSet(new Set())
      setEarnedMap(new Map())
    } catch (e) { console.error('[AutoStakeMining] loadClaimable', e) }
  }

  async function loadAllPositions(tk: TokenInfo) {
    try {
      const all = await fetchAllPositions(tk.address, tk.symbol, 200)
      setAllPositions(all)
    } catch (e) { console.error('[AutoStakeMining] loadAll', e) }
  }

  const initialLoad = useCallback(async () => {
    setLoading(true)
    try {
      const stats = await fetchContractStats()
      setTokens(stats.tokens)
      const tk = stats.tokens[0] ?? null
      if (tk) {
        setSelectedToken(tk)
        await Promise.all([loadClaimable(tk), loadAllPositions(tk)])
      }
    } catch (e) { console.error('[AutoStakeMining] init', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { initialLoad() }, [initialLoad])

  async function switchToken(tk: TokenInfo) {
    setSelectedToken(tk); setClaimable([]); setAllPositions([])
    setMinedSet(new Set()); setEarnedMap(new Map())
    setLoading(true)
    try { await Promise.all([loadClaimable(tk), loadAllPositions(tk)]) }
    finally { setLoading(false) }
  }

  async function doMine(pos: ClaimablePosition, idx: number) {
    setMiningIdx(idx); setMsg(null)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_AUTOSTAKE_ADDRESS, abi: CLAIM_FOR_ABI, functionName: 'claimFor', args: [pos.token, pos.user] }],
      })
      if (finalPayload.status === 'success') {
        const e = pos.processorEarns
        setMinedSet(prev => new Set([...prev, idx]))
        setEarnedMap(prev => new Map([...prev, [idx, e]]))
        setTotalEarned(prev => prev + e)
        setMsg({ ok: true, text: `⛏ Bloque #${idx + 1} minado · +${fmtToken(e, 18, 8)} ${pos.symbol}` })
      } else setMsg({ ok: false, text: (finalPayload as any).message ?? 'Rechazado' })
    } catch (e: any) { setMsg({ ok: false, text: e?.message ?? 'Error' }) }
    finally { setMiningIdx(null) }
  }

  async function doMineAll() {
    if (!selectedToken || claimable.length === 0) return
    setBatchLoading(true); setMsg(null)
    try {
      const eligible = claimable.filter((_, i) => !minedSet.has(i))
      if (!eligible.length) return setMsg({ ok: false, text: 'Sin posiciones disponibles' })
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_AUTOSTAKE_ADDRESS, abi: CLAIM_BATCH_ABI, functionName: 'claimForBatch', args: [selectedToken.address, eligible.map(p => p.user)] }],
      })
      if (finalPayload.status === 'success') {
        const totalE = eligible.reduce((a, p) => a + p.processorEarns, 0n)
        const newMined = new Set(minedSet); const newEarned = new Map(earnedMap)
        claimable.forEach((p, i) => { if (!minedSet.has(i)) { newMined.add(i); newEarned.set(i, p.processorEarns) } })
        setMinedSet(newMined); setEarnedMap(newEarned); setTotalEarned(prev => prev + totalE)
        setMsg({ ok: true, text: `✓ ${eligible.length} bloques minados · +${fmtToken(totalE, 18, 8)} ${selectedToken.symbol}` })
      } else setMsg({ ok: false, text: (finalPayload as any).message ?? 'Rechazado' })
    } catch (e: any) { setMsg({ ok: false, text: e?.message ?? 'Error' }) }
    finally { setBatchLoading(false) }
  }

  const pendingCount = claimable.filter((_, i) => !minedSet.has(i)).length

  if (!DEPLOYED) {
    return (
      <div className="flex flex-col items-center py-12 px-4 space-y-4">
        <AlertTriangle className="w-7 h-7 text-yellow-400" />
        <p className="font-semibold">Contrato en preparación</p>
        <p className="text-xs text-muted-foreground text-center">El panel de minería estará disponible tras el deploy.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-6 font-mono">
      {/* Terminal header */}
      <div className="rounded-xl border border-[oklch(0.65_0.22_255)]/40 bg-background overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-[oklch(0.65_0.22_255)]/10 border-b border-[oklch(0.65_0.22_255)]/20">
          <div className="flex gap-1">
            {['bg-red-500/70', 'bg-yellow-500/70', 'bg-green-500/70'].map(c => <div key={c} className={`w-2.5 h-2.5 rounded-full ${c}`} />)}
          </div>
          <span className="text-[10px] text-[oklch(0.65_0.22_255)] flex-1 text-center">ACUA_AUTOSTAKE :: MINING POOL v2.0</span>
          <button onClick={() => selectedToken && loadClaimable(selectedToken)} disabled={loading}>
            <RefreshCw className={cn('w-3 h-3 text-muted-foreground', loading && 'animate-spin')} />
          </button>
        </div>
        <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
          <div className="flex justify-between"><span className="text-muted-foreground">STATUS</span><span className="text-green-400">● ONLINE</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">UPTIME</span><span className="text-muted-foreground">{uptime}s</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">EN COLA</span><span className="text-amber-400">{pendingCount}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">PRÓX. CICLO</span><span className="text-[oklch(0.65_0.22_255)]">{fmtElapsed(nextRefresh)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">MINADOS</span><span className="text-[oklch(0.65_0.22_255)]">{minedSet.size}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">GANADO (1%)</span><span className="text-emerald-400">{fmtToken(totalEarned, 18, 8)} {selectedToken?.symbol ?? '?'}</span></div>
        </div>
      </div>

      {/* Token selector */}
      {tokens.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tokens.map(tk => (
            <button key={tk.address} onClick={() => switchToken(tk)}
              className={cn('flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                selectedToken?.address === tk.address ? 'bg-[oklch(0.65_0.22_255)] text-white border-transparent' : 'border-border text-muted-foreground')}>
              {tk.symbol} <span className="opacity-60 ml-1">{tk.aprPct.toFixed(0)}%</span>
            </button>
          ))}
        </div>
      )}

      {/* Tabs: Mine | All positions */}
      <div className="flex rounded-xl border border-border overflow-hidden">
        {(['mine', 'all'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('flex-1 py-2 text-[11px] font-semibold flex items-center justify-center gap-1.5',
              tab === t ? 'bg-[oklch(0.65_0.22_255)] text-white' : 'text-muted-foreground hover:bg-muted/40')}>
            {t === 'mine' ? <><Zap className="w-3 h-3" />Cola de minería ({pendingCount})</> : <><Users className="w-3 h-3" />Todos ({allPositions.length})</>}
          </button>
        ))}
      </div>

      {/* Mine tab */}
      {tab === 'mine' && (
        <>
          {pendingCount > 0 && (
            <Button disabled={batchLoading || loading} onClick={doMineAll}
              className="w-full h-11 font-bold text-sm bg-gradient-to-r from-[oklch(0.65_0.22_255)] to-purple-500 hover:opacity-90">
              {batchLoading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Procesando…</> : <><Zap className="w-4 h-4 mr-2" />Minar todos ({pendingCount} bloques)</>}
            </Button>
          )}
          {loading ? (
            <div className="flex flex-col items-center py-8 gap-2">
              <Cpu className="w-8 h-8 text-[oklch(0.65_0.22_255)] animate-pulse" />
              <p className="text-xs text-muted-foreground">Escaneando blockchain…</p>
            </div>
          ) : claimable.length === 0 ? (
            <div className="rounded-xl border border-border bg-muted/10 p-8 text-center space-y-2">
              <BarChart3 className="w-8 h-8 text-muted-foreground/40 mx-auto" />
              <p className="text-xs text-muted-foreground">Sin bloques pendientes</p>
              <p className="text-[10px] text-muted-foreground/60">Próximo ciclo en {fmtElapsed(nextRefresh)}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {claimable.map((pos, i) => (
                <BlockCard key={`${pos.user}-${i}`} pos={pos} idx={i}
                  mining={miningIdx === i} mined={minedSet.has(i)} earned={earnedMap.get(i) ?? null}
                  onMine={() => doMine(pos, i)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* All positions scoreboard */}
      {tab === 'all' && (
        <div className="space-y-1.5">
          {allPositions.length === 0 ? (
            <div className="rounded-xl border border-border bg-muted/10 p-8 text-center">
              <p className="text-xs text-muted-foreground">Sin posiciones registradas</p>
            </div>
          ) : (
            allPositions.map((p, i) => (
              <ScoreboardRow key={p.user + i} user={p.user} stake={p.stake} pending={p.pending}
                countdown={p.cooldownRemaining} symbol={p.symbol} />
            ))
          )}
        </div>
      )}

      {msg && (
        <p className={cn('text-xs text-center font-medium', msg.ok ? 'text-emerald-400' : 'text-red-400')}>
          {msg.text}
        </p>
      )}

      {/* How it works */}
      <div className="rounded-xl border border-border bg-muted/10 p-3 space-y-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">⛏ Cómo funciona</p>
        <ul className="space-y-1">
          {[
            '📋 Posiciones con ≥10 min aparecen en la cola automáticamente cada ciclo',
            '⚡ "Minar bloque" procesa el auto-reinvest del usuario en la blockchain',
            '💰 Ganas 1% del reward como incentivo por procesar la TX',
            '🚀 "Minar todos" procesa toda la cola en una TX',
            '👁 "Todos" muestra el marcador público de todas las posiciones',
            '🔁 Sin bots — cualquier usuario puede minar y ganar',
          ].map(t => <li key={t} className="text-[10px] text-muted-foreground">{t}</li>)}
        </ul>
      </div>
    </div>
  )
}
