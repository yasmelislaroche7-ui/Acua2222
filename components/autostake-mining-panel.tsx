'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Cpu, Zap, Loader2, Activity, AlertTriangle,
  CheckCircle2, RefreshCw, Shield, Sparkles, Coins,
} from 'lucide-react'
import {
  ACUA_AUTOSTAKE_ADDRESS, DEPLOYED,
  CLAIM_FOR_ABI, CLAIM_BATCH_ABI, READ_ABI,
  fetchContractStats, fetchClaimablePositions, fetchAllPositions,
  fmtToken, type ClaimablePosition, type TokenInfo,
} from '@/lib/autostake'
import { getProvider } from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

interface Props { userAddress: string }

const COOLDOWN_SEC = 600

// ─── Helpers ─────────────────────────────────────────────────────────────────
function shortAddr(a: string) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '' }
function fmtElapsed(s: number) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
function hashOf(s: string) {
  let h = 0n
  for (let i = 0; i < s.length; i++) h = (h * 31n + BigInt(s.charCodeAt(i))) & 0xFFFFFFFFFFFFFFFFn
  return '0x' + h.toString(16).padStart(16, '0').slice(0, 12)
}
function pseudoHeight(addr: string) {
  let n = 0
  for (const c of addr.slice(2, 8)) n = n * 16 + parseInt(c, 16)
  return 4_200_000 + (n % 800_000)
}

// ─── Log entry ───────────────────────────────────────────────────────────────
interface LogEntry {
  id: string
  type: 'mine' | 'refresh' | 'scan'
  text: string
  timestamp: number
  ok: boolean
}

// ─── Block card ───────────────────────────────────────────────────────────────
function BlockCard({ pos, idx, mining, onMine, blockNum }: {
  pos: ClaimablePosition; idx: number; mining: boolean
  onMine: () => void; blockNum: number
}) {
  const [fakeHash, setFakeHash] = useState(hashOf(pos.user + idx))
  const iv = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => {
    if (mining) {
      iv.current = setInterval(() => setFakeHash('0x' + Math.random().toString(16).slice(2, 14)), 80)
    } else {
      clearInterval(iv.current)
      setFakeHash(hashOf(pos.user + idx))
    }
    return () => clearInterval(iv.current)
  }, [mining])

  const prevHash = hashOf(pos.user + (idx - 1))
  const mineColor = mining ? '#3b82f6' : '#6366f1'

  return (
    <div className={cn(
      'rounded-2xl border overflow-hidden transition-all duration-300 font-mono',
      mining ? 'border-blue-500/80 shadow-[0_0_20px_#3b82f640]' : 'border-border/60'
    )} style={{ background: mining ? '#3b82f608' : '#0a0a0f' }}>

      {/* Block header */}
      <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2"
        style={{ background: mineColor + '14' }}>
        <div className="flex gap-1">
          {['#ef4444','#f59e0b','#10b981'].map(c => <div key={c} className="w-2 h-2 rounded-full" style={{ background: c + 'bb' }}/>)}
        </div>
        <span className="text-[9px] text-muted-foreground flex-1 text-center">BLOCK #{blockNum + idx}</span>
        {mining && <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />}
      </div>

      {/* Hash chain */}
      <div className="px-3 py-2 border-b border-border/30 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-muted-foreground/50">PREV HASH</span>
          <span className="text-[9px]" style={{ color: mineColor + 'aa' }}>{prevHash}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-muted-foreground/50">BLOCK HASH</span>
          <span className={cn('text-[9px] tabular-nums', mining ? 'text-blue-400 animate-pulse' : '')}
            style={!mining ? { color: mineColor } : undefined}>{fakeHash}</span>
        </div>
      </div>

      {/* Tx data */}
      <div className="px-3 py-2.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-muted-foreground/50">TOKEN</span>
          <span className="text-[10px] font-bold text-[oklch(0.65_0.22_255)]">{pos.symbol}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-muted-foreground/50">FROM</span>
          <span className="text-[10px] text-foreground/80">{shortAddr(pos.user)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-muted-foreground/50">STAKED</span>
          <span className="text-[10px] font-bold text-foreground">{fmtToken(pos.stake, 18, 2)} {pos.symbol}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-muted-foreground/50">REWARD</span>
          <span className="text-sm font-black text-amber-400">+{fmtToken(pos.reward, 18, 6)} {pos.symbol}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-muted-foreground/50">TU 1%</span>
          <span className="text-[10px] font-bold text-[oklch(0.65_0.22_255)]">+{fmtToken(pos.processorEarns, 18, 8)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-muted-foreground/50">ELAPSED</span>
          <span className="text-[9px] text-muted-foreground">{fmtElapsed(pos.elapsed)}</span>
        </div>
      </div>

      {/* Mine button */}
      <div className="px-3 pb-3">
        <button disabled={mining} onClick={onMine}
          className={cn('w-full h-9 text-xs font-bold tracking-wide rounded-xl border-0 transition-all flex items-center justify-center gap-1.5',
            mining ? 'opacity-70 cursor-not-allowed' : 'hover:shadow-[0_0_12px_#6366f160]')}
          style={{ background: mining ? '#6366f180' : 'linear-gradient(135deg, #6366f1, #3b82f6)', color: '#fff' }}>
          {mining
            ? <><Loader2 className="w-3 h-3 animate-spin" />MINANDO TX...</>
            : <><Zap className="w-3 h-3" />PROCESAR TX</>}
        </button>
      </div>
    </div>
  )
}

// ─── Live log row ─────────────────────────────────────────────────────────────
function LogRow({ entry }: { entry: LogEntry }) {
  const icons: Record<string, string> = { mine: '⛏', refresh: '🔄', scan: '🔍' }
  const ts = new Date(entry.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div className="flex items-start gap-2 py-1 border-b border-border/20 last:border-0">
      <span className="text-[10px] shrink-0">{icons[entry.type]}</span>
      <span className={cn('text-[9px] font-mono flex-1', entry.ok ? 'text-muted-foreground' : 'text-red-400/70')}>{entry.text}</span>
      <span className="text-[8px] font-mono text-muted-foreground/40 shrink-0">{ts}</span>
    </div>
  )
}

// ─── Scoreboard row ───────────────────────────────────────────────────────────
function ScoreRow({ user, stake, pending, countdown, symbol, i }: {
  user: string; stake: bigint; pending: bigint; countdown: number; symbol: string; i: number
}) {
  const [cd, setCd] = useState(countdown)
  useEffect(() => { const t = setInterval(() => setCd(p => Math.max(0, p - 1)), 1000); return () => clearInterval(t) }, [])
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 font-mono border-b border-border/20 last:border-0">
      <span className="text-[9px] text-muted-foreground/40 w-5 shrink-0">{String(i + 1).padStart(2, '0')}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-foreground truncate">{shortAddr(user)}</p>
        <p className="text-[8px] text-muted-foreground">{fmtToken(stake, 18, 2)} {symbol}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] font-bold text-amber-400">+{fmtToken(pending, 18, 6)}</p>
        {cd > 0
          ? <p className="text-[8px] text-muted-foreground">⏳ {fmtElapsed(cd)}</p>
          : <p className="text-[8px] text-emerald-400">● READY</p>}
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function AutoStakeMiningPanel({ userAddress }: Props) {
  const [tokens, setTokens]         = useState<TokenInfo[]>([])
  const [firstToken, setFirstToken] = useState<TokenInfo | null>(null)
  const [claimable, setClaimable]   = useState<ClaimablePosition[]>([])
  const [allPos, setAllPos]         = useState<any[]>([])
  const [loading, setLoading]       = useState(false)
  const [tab, setTab]               = useState<'mine' | 'all' | 'log'>('mine')
  const [miningKey, setMiningKey]   = useState<string | null>(null)
  const [totalEarned, setTotal]     = useState(0n)
  const [logs, setLogs]             = useState<LogEntry[]>([])
  const [nextRefresh, setNext]      = useState(COOLDOWN_SEC)
  const [uptime, setUptime]         = useState(0)
  const [baseBlock]                 = useState(() => pseudoHeight(userAddress || '0x1234'))
  const [isOwner, setIsOwner]       = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [claimFeeLoading, setClaimFeeLoading] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const tokensRef = useRef<TokenInfo[]>([])

  function addLog(type: LogEntry['type'], text: string, ok = true) {
    setLogs(prev => [{ id: crypto.randomUUID?.() ?? Math.random().toString(), type, text, timestamp: Date.now(), ok }, ...prev].slice(0, 50))
  }

  // ── Cargar posiciones reclamables de TODOS los tokens ───────────────────────
  async function loadClaimableAll(tks: TokenInfo[], silent = false) {
    if (!silent) setLoading(true)
    try {
      const results = await Promise.all(
        tks.map(tk => fetchClaimablePositions(tk.address, tk.symbol, 100).catch(() => [] as ClaimablePosition[]))
      )
      const combined = results.flat()
      setClaimable(combined)
      addLog('scan', `Scan: ${combined.length} TX listas · ${tks.length} token(s)`)
    } catch (e: any) {
      addLog('scan', `Error scan: ${e?.message ?? 'unknown'}`, false)
    } finally { if (!silent) setLoading(false) }
  }

  async function loadAll(tk: TokenInfo) {
    try {
      const all = await fetchAllPositions(tk.address, tk.symbol, 200)
      setAllPos(all)
    } catch { /* silent */ }
  }

  const init = useCallback(async () => {
    setLoading(true)
    try {
      const stats = await fetchContractStats()
      setTokens(stats.tokens)
      tokensRef.current = stats.tokens
      const tk = stats.tokens[0] ?? null
      setFirstToken(tk)
      // Check if current user is owner
      if (userAddress) {
        try {
          const c = new ethers.Contract(ACUA_AUTOSTAKE_ADDRESS, READ_ABI, getProvider())
          const ownerCheck = await c.isOwner(userAddress)
          setIsOwner(!!ownerCheck)
        } catch { setIsOwner(false) }
      }
      if (stats.tokens.length > 0) {
        await Promise.all([
          loadClaimableAll(stats.tokens),
          tk ? loadAll(tk) : Promise.resolve(),
        ])
      }
    } finally { setLoading(false) }
  }, [userAddress])

  useEffect(() => { init() }, [init])
  useEffect(() => { tokensRef.current = tokens }, [tokens])

  // Auto-refresh + uptime clock
  useEffect(() => {
    const t = setInterval(() => {
      setUptime(p => p + 1)
      setNext(p => {
        if (p <= 1) {
          if (tokensRef.current.length > 0) {
            loadClaimableAll(tokensRef.current, true)
            addLog('refresh', `Auto-refresh · ${tokensRef.current.length} token(s) escaneados`)
          }
          return COOLDOWN_SEC
        }
        return p - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [])

  // ── Procesar TODAS las TX (owner only) — claimForBatch por token ─────────────
  async function doMineAll() {
    if (!claimable.length) return
    setBatchLoading(true)
    addLog('mine', `Procesando TODAS: ${claimable.length} TX en ${tokens.length} token(s)…`)
    try {
      // Agrupar por token
      const byToken = new Map<string, string[]>()
      for (const pos of claimable) {
        if (!byToken.has(pos.token)) byToken.set(pos.token, [])
        byToken.get(pos.token)!.push(pos.user)
      }
      // Construir lista de transacciones para MiniKit
      const txList = Array.from(byToken.entries()).map(([token, users]) => ({
        address: ACUA_AUTOSTAKE_ADDRESS,
        abi: CLAIM_BATCH_ABI as any,
        functionName: 'claimForBatch',
        args: [token, users],
      }))
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({ transaction: txList })
      if (finalPayload.status === 'success') {
        const totalEarns = claimable.reduce((acc, p) => acc + p.processorEarns, 0n)
        setClaimable([])
        setTotal(prev => prev + totalEarns)
        addLog('mine', `✓ TODAS procesadas · +${fmtToken(totalEarns, 18, 6)} ganados`)
      } else {
        addLog('mine', `✗ Error batch: ${(finalPayload as any).message ?? 'rechazado'}`, false)
      }
    } catch (e: any) {
      addLog('mine', `✗ Error: ${e?.message ?? 'unknown'}`, false)
    } finally { setBatchLoading(false) }
  }

  // ── "Reclamar tokens gratis" — minar primeras TX disponibles (cualquier usuario)
  async function doClaimFreeTokens(tokenGroup: ClaimablePosition[]) {
    if (!tokenGroup.length) return
    setClaimFeeLoading(true)
    const sym = tokenGroup[0].symbol
    addLog('mine', `Reclamando comisiones ${sym}: ${tokenGroup.length} TX…`)
    try {
      const users = tokenGroup.map(p => p.user)
      const token = tokenGroup[0].token
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_AUTOSTAKE_ADDRESS, abi: CLAIM_BATCH_ABI as any, functionName: 'claimForBatch', args: [token, users] }],
      })
      if (finalPayload.status === 'success') {
        const earned = tokenGroup.reduce((acc, p) => acc + p.processorEarns, 0n)
        setClaimable(prev => prev.filter(p => p.token !== token))
        setTotal(prev => prev + earned)
        addLog('mine', `✓ ${sym} reclamados · +${fmtToken(earned, 18, 6)}`)
      } else {
        addLog('mine', `✗ Rechazado: ${(finalPayload as any).message ?? '—'}`, false)
      }
    } catch (e: any) {
      addLog('mine', `✗ Error: ${e?.message ?? 'unknown'}`, false)
    } finally { setClaimFeeLoading(false) }
  }

  // ── Minar TX individual — al confirmar, la quita de la cola ─────────────────
  async function doMine(pos: ClaimablePosition, key: string) {
    setMiningKey(key)
    addLog('mine', `Minando TX · user ${shortAddr(pos.user)} · ${pos.symbol}`)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_AUTOSTAKE_ADDRESS, abi: CLAIM_FOR_ABI, functionName: 'claimFor', args: [pos.token, pos.user] }],
      })
      if (finalPayload.status === 'success') {
        const e = pos.processorEarns
        // Remover de la cola — desaparece tras ser procesada
        setClaimable(prev => prev.filter(p => !(p.token === pos.token && p.user === pos.user)))
        setTotal(prev => prev + e)
        addLog('mine', `✓ TX procesada · +${fmtToken(e, 18, 8)} ${pos.symbol}`)
      } else {
        addLog('mine', `✗ Rechazado: ${(finalPayload as any).message ?? 'user rejected'}`, false)
      }
    } catch (e: any) {
      addLog('mine', `✗ Error: ${e?.message ?? 'unknown'}`, false)
    } finally { setMiningKey(null) }
  }

  if (!DEPLOYED) {
    return (
      <div className="flex flex-col items-center py-12 px-4 space-y-4">
        <AlertTriangle className="w-7 h-7 text-yellow-400" />
        <p className="font-semibold text-center">Contrato en preparación</p>
      </div>
    )
  }

  const pendingCount = claimable.length

  // Agrupar claimable por token para los botones de "reclamar gratis"
  const byTokenMap = new Map<string, ClaimablePosition[]>()
  for (const pos of claimable) {
    if (!byTokenMap.has(pos.token)) byTokenMap.set(pos.token, [])
    byTokenMap.get(pos.token)!.push(pos)
  }
  const tokenGroups = Array.from(byTokenMap.values())
  // Tomar hasta 2 grupos para los dos botones de "reclamar gratis"
  const freeGroup1 = tokenGroups[0] ?? []
  const freeGroup2 = tokenGroups[1] ?? []
  const totalFreeEarning1 = freeGroup1.reduce((a, p) => a + p.processorEarns, 0n)
  const totalFreeEarning2 = freeGroup2.reduce((a, p) => a + p.processorEarns, 0n)

  return (
    <div className="space-y-4 pb-6">

      {/* ── Terminal header ── */}
      <div className="rounded-2xl border border-[oklch(0.65_0.22_255)]/40 overflow-hidden font-mono"
        style={{ background: 'linear-gradient(180deg, #0a0a14 0%, #080810 100%)' }}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[oklch(0.65_0.22_255)]/20"
          style={{ background: 'oklch(0.65 0.22 255)/10' }}>
          <div className="flex gap-1">
            {['#ef4444','#f59e0b','#10b981'].map(c => <div key={c} className="w-2 h-2 rounded-full" style={{ background: c }}/>)}
          </div>
          <span className="text-[9px] text-[oklch(0.65_0.22_255)] flex-1 text-center tracking-widest">ACUA_AUTOSTAKE :: MINING NODE v2.0</span>
          <button onClick={() => tokensRef.current.length > 0 && loadClaimableAll(tokensRef.current)} disabled={loading}>
            <RefreshCw className={cn('w-3 h-3 text-muted-foreground', loading && 'animate-spin')} />
          </button>
        </div>
        <div className="px-3 py-2.5 grid grid-cols-3 gap-2 text-[9px]">
          <div className="space-y-1.5">
            <div className="flex justify-between"><span className="text-muted-foreground">STATUS</span><span className="text-emerald-400">● ONLINE</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">UPTIME</span><span className="text-muted-foreground">{uptime}s</span></div>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between"><span className="text-muted-foreground">EN COLA</span><span className="text-amber-400">{pendingCount}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">TOKENS</span><span className="text-[oklch(0.65_0.22_255)]">{tokens.length}</span></div>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between"><span className="text-muted-foreground">CICLO</span><span className="text-[oklch(0.65_0.22_255)]">{fmtElapsed(nextRefresh)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">GANADO</span><span className="text-emerald-400">{fmtToken(totalEarned, 18, 6)}</span></div>
          </div>
        </div>
        {/* refresh bar */}
        <div className="mx-3 mb-3 h-1 rounded-full bg-muted/20 overflow-hidden">
          <div className="h-full rounded-full bg-[oklch(0.65_0.22_255)]/60 transition-all"
            style={{ width: `${((COOLDOWN_SEC - nextRefresh) / COOLDOWN_SEC) * 100}%` }} />
        </div>
      </div>

      {/* ── Botones: Reclamar Tokens Gratis (comisiones de TX procesadas) ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 px-1">
          <Sparkles className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] font-bold text-amber-400/80 uppercase tracking-wider">Reclamar Tokens Gratis</span>
          <span className="text-[9px] text-muted-foreground ml-1">(comisiones 1% de TX procesadas)</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {/* Botón 1 — primer grupo de tokens */}
          <button
            onClick={() => doClaimFreeTokens(freeGroup1)}
            disabled={claimFeeLoading || freeGroup1.length === 0}
            className={cn(
              'flex flex-col items-center justify-center gap-1 rounded-xl border py-3 px-2 text-center transition-all',
              freeGroup1.length > 0
                ? 'border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300'
                : 'border-border/30 bg-muted/5 text-muted-foreground/40 cursor-not-allowed',
            )}>
            {claimFeeLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}
            <span className="text-[11px] font-black">
              {freeGroup1.length > 0 ? `+${fmtToken(totalFreeEarning1, 18, 6)} ${freeGroup1[0].symbol}` : '— Sin TX —'}
            </span>
            <span className="text-[9px] opacity-70">
              {freeGroup1.length > 0 ? `${freeGroup1.length} TX · Reclamar` : 'esperando…'}
            </span>
          </button>

          {/* Botón 2 — segundo grupo de tokens */}
          <button
            onClick={() => doClaimFreeTokens(freeGroup2)}
            disabled={claimFeeLoading || freeGroup2.length === 0}
            className={cn(
              'flex flex-col items-center justify-center gap-1 rounded-xl border py-3 px-2 text-center transition-all',
              freeGroup2.length > 0
                ? 'border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300'
                : 'border-border/30 bg-muted/5 text-muted-foreground/40 cursor-not-allowed',
            )}>
            {claimFeeLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}
            <span className="text-[11px] font-black">
              {freeGroup2.length > 0 ? `+${fmtToken(totalFreeEarning2, 18, 6)} ${freeGroup2[0].symbol}` : '— Sin TX —'}
            </span>
            <span className="text-[9px] opacity-70">
              {freeGroup2.length > 0 ? `${freeGroup2.length} TX · Reclamar` : 'esperando…'}
            </span>
          </button>
        </div>
      </div>

      {/* ── Botón Owner: Procesar TODAS las TX (solo visible al owner) ── */}
      {isOwner && (
        <div className="rounded-2xl border border-violet-500/40 bg-gradient-to-r from-violet-950/60 to-indigo-950/60 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <span className="text-[11px] font-black text-violet-300">Panel Owner — Procesar en Lote</span>
          </div>
          <button
            onClick={doMineAll}
            disabled={batchLoading || claimable.length === 0}
            className={cn(
              'w-full flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-black transition-all',
              claimable.length > 0
                ? 'border-violet-400/60 bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 hover:shadow-[0_0_20px_#7c3aed40]'
                : 'border-border/30 text-muted-foreground/40 cursor-not-allowed',
            )}>
            {batchLoading
              ? <><Loader2 className="w-4 h-4 animate-spin" />Procesando todas las TX…</>
              : <><Zap className="w-4 h-4" />⚡ PROCESAR TODAS LAS TX ({claimable.length})</>}
          </button>
          <p className="text-[9px] text-muted-foreground/60 font-mono text-center">
            claimForBatch · {tokens.length} token(s) · solo visible al owner
          </p>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex rounded-xl border border-border/50 overflow-hidden font-mono">
        {([['mine', `⛏ COLA (${pendingCount})`], ['all', `👥 TODOS (${allPos.length})`], ['log', `📋 LOG (${logs.length})`]] as const).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('flex-1 py-2 text-[10px] font-bold transition-all',
              tab === t ? 'bg-[oklch(0.65_0.22_255)] text-white' : 'text-muted-foreground hover:bg-muted/20')}>
            {l}
          </button>
        ))}
      </div>

      {/* ── Cola unificada ── */}
      {tab === 'mine' && (
        <div className="space-y-3">
          {loading ? (
            <div className="flex flex-col items-center py-10 gap-3">
              <Cpu className="w-10 h-10 text-[oklch(0.65_0.22_255)] animate-pulse" />
              <p className="text-xs font-mono text-muted-foreground">Escaneando blockchain...</p>
            </div>
          ) : claimable.length === 0 ? (
            <div className="rounded-2xl border border-border/40 bg-muted/5 p-8 text-center font-mono space-y-2">
              <Activity className="w-8 h-8 text-muted-foreground/30 mx-auto" />
              <p className="text-xs text-muted-foreground">Sin TX pendientes en ningún token</p>
              <p className="text-[9px] text-muted-foreground/50">Próximo escaneo en {fmtElapsed(nextRefresh)}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Info de la cola */}
              <div className="rounded-xl border border-[oklch(0.65_0.22_255)]/30 bg-[oklch(0.65_0.22_255)]/5 px-3 py-2 flex items-center justify-between font-mono">
                <div>
                  <p className="text-[11px] font-bold text-[oklch(0.65_0.22_255)]">
                    {pendingCount} TX listas para procesar
                  </p>
                  <p className="text-[9px] text-muted-foreground/60">
                    {tokens.map(t => t.symbol).join(' · ')} · cola unificada · escaneo en {fmtElapsed(nextRefresh)}
                  </p>
                </div>
                <CheckCircle2 className="w-4 h-4 text-[oklch(0.65_0.22_255)]/60 shrink-0" />
              </div>

              {/* Block cards — desaparecen al ser procesadas */}
              {claimable.map((pos, i) => {
                const key = `${pos.token}-${pos.user}`
                return (
                  <BlockCard key={key} pos={pos} idx={i} blockNum={baseBlock}
                    mining={miningKey === key}
                    onMine={() => doMine(pos, key)} />
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── All positions scoreboard ── */}
      {tab === 'all' && (
        <div className="rounded-2xl border border-border/40 overflow-hidden font-mono">
          <div className="px-3 py-2 border-b border-border/30 text-[8px] grid grid-cols-3 text-muted-foreground/60">
            <span>#&nbsp;&nbsp;WALLET</span><span className="text-center">STAKE</span><span className="text-right">REWARD · COOLDOWN</span>
          </div>
          <div>
            {allPos.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">Sin posiciones</p>
            ) : (
              allPos.map((p, i) => (
                <ScoreRow key={p.user + i} user={p.user} stake={p.stake} pending={p.pending}
                  countdown={p.cooldownRemaining} symbol={p.symbol} i={i} />
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Event log ── */}
      {tab === 'log' && (
        <div className="rounded-2xl border border-border/40 overflow-hidden font-mono"
          style={{ background: '#05050a' }}>
          <div className="px-3 py-2 border-b border-border/30 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] text-emerald-400">LIVE EVENT LOG</span>
            <span className="ml-auto text-[8px] text-muted-foreground/40">{logs.length} events</span>
          </div>
          <div ref={logRef} className="px-3 py-2 max-h-80 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-[10px] text-muted-foreground/40 py-4 text-center">Esperando eventos...</p>
            ) : logs.map(l => <LogRow key={l.id} entry={l} />)}
          </div>
        </div>
      )}
    </div>
  )
}
