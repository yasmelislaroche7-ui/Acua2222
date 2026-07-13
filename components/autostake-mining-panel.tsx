'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  Cpu, Zap, Loader2, Activity, AlertTriangle, ChevronRight,
  Hash, Clock, Users, CheckCircle2, RefreshCw,
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
  type: 'mine' | 'batch' | 'refresh' | 'scan'
  text: string
  timestamp: number
  ok: boolean
}

// ─── Block card (blockchain style) ───────────────────────────────────────────
function BlockCard({ pos, idx, mining, mined, earned, onMine, blockNum }: {
  pos: ClaimablePosition; idx: number; mining: boolean; mined: boolean
  earned: bigint | null; onMine: () => void; blockNum: number
}) {
  const [fakeHash, setFakeHash] = useState(hashOf(pos.user + idx))
  const iv = useRef<ReturnType<typeof setInterval>>()
  useEffect(() => {
    if (mining) {
      iv.current = setInterval(() => {
        const r = Math.random().toString(16).slice(2, 14)
        setFakeHash('0x' + r)
      }, 80)
    } else {
      clearInterval(iv.current)
      setFakeHash(hashOf(pos.user + idx + (mined ? 'mined' : '')))
    }
    return () => clearInterval(iv.current)
  }, [mining, mined])

  const prevHash = hashOf(pos.user + (idx - 1))
  const mineColor = mined ? '#10b981' : mining ? '#3b82f6' : '#6366f1'

  return (
    <div className={cn(
      'rounded-2xl border overflow-hidden transition-all duration-300 font-mono',
      mined ? 'border-emerald-500/60' : mining ? 'border-blue-500/80 shadow-[0_0_20px_#3b82f640]' : 'border-border/60'
    )} style={{ background: mined ? '#10b98108' : mining ? '#3b82f608' : '#0a0a0f' }}>

      {/* ── Block header ── */}
      <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2"
        style={{ background: mineColor + '14' }}>
        <div className="flex gap-1">
          {['#ef4444','#f59e0b','#10b981'].map(c=><div key={c} className="w-2 h-2 rounded-full" style={{ background: c + 'bb' }}/>)}
        </div>
        <span className="text-[9px] text-muted-foreground flex-1 text-center">BLOCK #{blockNum + idx}</span>
        {mined && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
        {mining && <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />}
      </div>

      {/* ── Hash chain ── */}
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

      {/* ── Tx data ── */}
      <div className="px-3 py-2.5 space-y-1.5">
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
          <span className="text-sm font-black" style={{ color: mined ? '#10b981' : '#f59e0b' }}>
            +{fmtToken(pos.reward, 18, 6)} {pos.symbol}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-muted-foreground/50">YOUR 1%</span>
          <span className="text-[10px] font-bold text-[oklch(0.65_0.22_255)]">+{fmtToken(pos.processorEarns, 18, 8)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-muted-foreground/50">ELAPSED</span>
          <span className="text-[9px] text-muted-foreground">{fmtElapsed(pos.elapsed)}</span>
        </div>
      </div>

      {/* ── Mine button / Mined badge ── */}
      <div className="px-3 pb-3">
        {mined ? (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 py-2 text-center">
            <p className="text-[10px] text-emerald-400 font-bold">
              ⛏ BLOQUE CONFIRMADO · +{fmtToken(earned ?? 0n, 18, 8)} {pos.symbol}
            </p>
          </div>
        ) : (
          <Button size="sm" disabled={mining} onClick={onMine}
            className={cn('w-full h-9 text-xs font-bold tracking-wide border-0 transition-all',
              mining ? 'opacity-70 cursor-not-allowed' : 'hover:shadow-[0_0_12px_#6366f160]')}
            style={{ background: mining ? '#6366f180' : 'linear-gradient(135deg, #6366f1, #3b82f6)' }}>
            {mining
              ? <><Loader2 className="w-3 h-3 animate-spin mr-1.5" />MINANDO TX...</>
              : <><Zap className="w-3 h-3 mr-1.5" />MINAR BLOQUE</>}
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Live log row ─────────────────────────────────────────────────────────────
function LogRow({ entry }: { entry: LogEntry }) {
  const icons: Record<string, string> = { mine: '⛏', batch: '🚀', refresh: '🔄', scan: '🔍' }
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
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null)
  const [claimable, setClaimable]   = useState<ClaimablePosition[]>([])
  const [allPos, setAllPos]         = useState<any[]>([])
  const [loading, setLoading]       = useState(false)
  const [tab, setTab]               = useState<'mine' | 'all' | 'log'>('mine')
  const [miningIdx, setMiningIdx]   = useState<number | null>(null)
  const [minedSet, setMinedSet]     = useState<Set<number>>(new Set())
  const [earnedMap, setEarnedMap]   = useState<Map<number, bigint>>(new Map())
  const [batchLoading, setBatch]    = useState(false)
  const [totalEarned, setTotal]     = useState(0n)
  const [logs, setLogs]             = useState<LogEntry[]>([])
  const [nextRefresh, setNext]      = useState(COOLDOWN_SEC)
  const [uptime, setUptime]         = useState(0)
  const [baseBlock]                 = useState(() => pseudoHeight(userAddress || '0x1234'))
  const logRef = useRef<HTMLDivElement>(null)

  function addLog(type: LogEntry['type'], text: string, ok = true) {
    setLogs(prev => [{ id: crypto.randomUUID?.() ?? Math.random().toString(), type, text, timestamp: Date.now(), ok }, ...prev].slice(0, 50))
  }

  async function loadClaimable(tk: TokenInfo, silent = false) {
    if (!silent) setLoading(true)
    try {
      const c = await fetchClaimablePositions(tk.address, tk.symbol, 100)
      setClaimable(c)
      setMinedSet(new Set()); setEarnedMap(new Map())
      addLog('scan', `Scan: ${c.length} bloques en cola · token ${tk.symbol}`)
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
      const tk = stats.tokens[0] ?? null
      if (tk) { setSelectedToken(tk); await Promise.all([loadClaimable(tk), loadAll(tk)]) }
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { init() }, [init])

  // Clock + auto-refresh
  useEffect(() => {
    const t = setInterval(() => {
      setUptime(p => p + 1)
      setNext(p => {
        if (p <= 1) {
          if (selectedToken) {
            loadClaimable(selectedToken, true)
            addLog('refresh', `Auto-refresh ciclo ${Math.floor(uptime / COOLDOWN_SEC) + 1}`)
          }
          return COOLDOWN_SEC
        }
        return p - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [selectedToken, uptime])

  async function switchToken(tk: TokenInfo) {
    setSelectedToken(tk); setClaimable([]); setAllPos([])
    setLoading(true)
    try { await Promise.all([loadClaimable(tk), loadAll(tk)]) }
    finally { setLoading(false) }
  }

  async function doMine(pos: ClaimablePosition, idx: number) {
    setMiningIdx(idx)
    addLog('mine', `Minando bloque #${baseBlock + idx} · user ${shortAddr(pos.user)}`)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_AUTOSTAKE_ADDRESS, abi: CLAIM_FOR_ABI, functionName: 'claimFor', args: [pos.token, pos.user] }],
      })
      if (finalPayload.status === 'success') {
        const e = pos.processorEarns
        setMinedSet(prev => new Set([...prev, idx]))
        setEarnedMap(prev => new Map([...prev, [idx, e]]))
        setTotal(prev => prev + e)
        addLog('mine', `✓ Bloque #${baseBlock + idx} minado · +${fmtToken(e, 18, 8)} ${pos.symbol}`)
      } else {
        addLog('mine', `✗ Rechazado: ${(finalPayload as any).message ?? 'user rejected'}`, false)
      }
    } catch (e: any) {
      addLog('mine', `✗ Error: ${e?.message ?? 'unknown'}`, false)
    } finally { setMiningIdx(null) }
  }

  async function doMineAll() {
    if (!selectedToken || !claimable.length) return
    setBatch(true)
    const eligible = claimable.filter((_, i) => !minedSet.has(i))
    if (!eligible.length) { setBatch(false); return }
    addLog('batch', `Iniciando batch: ${eligible.length} bloques`)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_AUTOSTAKE_ADDRESS, abi: CLAIM_BATCH_ABI, functionName: 'claimForBatch', args: [selectedToken.address, eligible.map(p => p.user)] }],
      })
      if (finalPayload.status === 'success') {
        const totalE = eligible.reduce((a, p) => a + p.processorEarns, 0n)
        const nm = new Set(minedSet); const ne = new Map(earnedMap)
        claimable.forEach((p, i) => { if (!minedSet.has(i)) { nm.add(i); ne.set(i, p.processorEarns) } })
        setMinedSet(nm); setEarnedMap(ne); setTotal(prev => prev + totalE)
        addLog('batch', `✓ Batch confirmado · ${eligible.length} bloques · +${fmtToken(totalE, 18, 8)} ${selectedToken.symbol}`)
      } else addLog('batch', `✗ Batch rechazado`, false)
    } catch (e: any) { addLog('batch', `✗ Batch error: ${e?.message ?? 'unknown'}`, false) }
    finally { setBatch(false) }
  }

  const pendingCount = claimable.filter((_, i) => !minedSet.has(i)).length

  if (!DEPLOYED) {
    return (
      <div className="flex flex-col items-center py-12 px-4 space-y-4">
        <AlertTriangle className="w-7 h-7 text-yellow-400" />
        <p className="font-semibold text-center">Contrato en preparación</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-6">

      {/* ── Terminal header ── */}
      <div className="rounded-2xl border border-[oklch(0.65_0.22_255)]/40 overflow-hidden font-mono"
        style={{ background: 'linear-gradient(180deg, #0a0a14 0%, #080810 100%)' }}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[oklch(0.65_0.22_255)]/20"
          style={{ background: 'oklch(0.65 0.22 255)/10' }}>
          <div className="flex gap-1">
            {['#ef4444','#f59e0b','#10b981'].map(c=><div key={c} className="w-2 h-2 rounded-full" style={{ background: c }}/>)}
          </div>
          <span className="text-[9px] text-[oklch(0.65_0.22_255)] flex-1 text-center tracking-widest">ACUA_AUTOSTAKE :: MINING NODE v2.0</span>
          <button onClick={() => selectedToken && loadClaimable(selectedToken)} disabled={loading}>
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
            <div className="flex justify-between"><span className="text-muted-foreground">MINADOS</span><span className="text-[oklch(0.65_0.22_255)]">{minedSet.size}</span></div>
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

      {/* ── Buy Token + Vote WDD ── */}
      <div className="grid grid-cols-2 gap-2">
        <a
          href="https://world.org/mini-app?app_id=app_4593f73390a9843503ec096086b43612&path=/launchpad/token/0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd"
          target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-[11px] font-bold py-2.5 px-2 hover:bg-cyan-500/20 transition-colors text-center"
        >
          🛒 Comprar H2O
        </a>
        <a
          href="https://www.worldrepublic.org/es/govern/parties/a6a92b4e-986f-4fe0-8bce-2b0cd8898775?ref=BWRGUDHS"
          target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-violet-500/40 bg-violet-500/10 text-violet-300 text-[11px] font-bold py-2.5 px-2 hover:bg-violet-500/20 transition-colors text-center"
        >
          🗳️ Votar +5 WDD
        </a>
      </div>

      {/* Token selector */}
      {tokens.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {tokens.map(tk => (
            <button key={tk.address} onClick={() => switchToken(tk)}
              className={cn('flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all font-mono',
                selectedToken?.address === tk.address
                  ? 'bg-[oklch(0.65_0.22_255)] text-white border-transparent'
                  : 'border-border/60 text-muted-foreground')}>
              {tk.symbol}
            </button>
          ))}
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

      {/* ── Mine tab ── */}
      {tab === 'mine' && (
        <div className="space-y-3">
          {pendingCount > 0 && (
            <Button disabled={batchLoading} onClick={doMineAll}
              className="w-full h-12 font-black text-sm tracking-wide border-0"
              style={{ background: 'linear-gradient(135deg, oklch(0.55 0.25 290), oklch(0.55 0.25 255))' }}>
              {batchLoading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />PROCESANDO BATCH...</>
                : <><Zap className="w-4 h-4 mr-2" />MINAR TODOS ({pendingCount} BLOQUES)</>}
            </Button>
          )}
          {loading ? (
            <div className="flex flex-col items-center py-10 gap-3">
              <Cpu className="w-10 h-10 text-[oklch(0.65_0.22_255)] animate-pulse" />
              <p className="text-xs font-mono text-muted-foreground">Escaneando blockchain...</p>
            </div>
          ) : claimable.length === 0 ? (
            <div className="rounded-2xl border border-border/40 bg-muted/5 p-8 text-center font-mono space-y-2">
              <Activity className="w-8 h-8 text-muted-foreground/30 mx-auto" />
              <p className="text-xs text-muted-foreground">Sin bloques pendientes</p>
              <p className="text-[9px] text-muted-foreground/50">Próximo ciclo en {fmtElapsed(nextRefresh)}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {claimable.map((pos, i) => (
                <BlockCard key={`${pos.user}-${i}`} pos={pos} idx={i} blockNum={baseBlock}
                  mining={miningIdx === i} mined={minedSet.has(i)} earned={earnedMap.get(i) ?? null}
                  onMine={() => doMine(pos, i)} />
              ))}
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
