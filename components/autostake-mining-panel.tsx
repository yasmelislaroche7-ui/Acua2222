'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Cpu, Zap, RefreshCw, Loader2, ChevronRight,
  Hash, BarChart3, Trophy, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ACUA_AUTOSTAKE_ADDRESS, DEPLOYED,
  CLAIM_FOR_ABI, CLAIM_BATCH_ABI,
  fetchContractStats, fetchClaimablePositions,
  fmtToken,
  type ClaimablePosition, type TokenInfo,
} from '@/lib/autostake'
import { cn } from '@/lib/utils'

interface Props { userAddress: string }

// ─── Fake hash generator ──────────────────────────────────────────────────────
function genHash(): string {
  const chars = '0123456789abcdef'
  let h = '0x'
  for (let i = 0; i < 16; i++) h += chars[Math.floor(Math.random() * 16)]
  return h
}

function shortAddr(addr: string): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : ''
}

function fmtElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

// ─── Mining Block Card ────────────────────────────────────────────────────────
interface BlockCardProps {
  pos: ClaimablePosition
  index: number
  mining: boolean
  mined: boolean
  earned: bigint | null
  onMine: (pos: ClaimablePosition) => void
}

function BlockCard({ pos, index, mining, mined, earned, onMine }: BlockCardProps) {
  const [hash, setHash] = useState(genHash())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (mining) {
      intervalRef.current = setInterval(() => setHash(genHash()), 120)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [mining])

  return (
    <div className={cn(
      'rounded-xl border transition-all duration-300 overflow-hidden',
      mined
        ? 'border-emerald-500/50 bg-emerald-500/5'
        : mining
          ? 'border-[oklch(0.65_0.22_255)]/60 bg-[oklch(0.65_0.22_255)]/5 shadow-[0_0_12px_oklch(0.65_0.22_255)/20]'
          : 'border-border bg-muted/10 hover:border-border/80'
    )}>
      {/* Block header */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 border-b border-border/40">
        <div className={cn(
          'w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold',
          mined ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted text-muted-foreground'
        )}>
          {mined ? '✓' : `#${index + 1}`}
        </div>
        <Hash className={cn('w-3 h-3', mining ? 'text-[oklch(0.65_0.22_255)] animate-pulse' : 'text-muted-foreground/40')} />
        <span className={cn(
          'font-mono text-[9px] flex-1 truncate',
          mining ? 'text-[oklch(0.65_0.22_255)]' : 'text-muted-foreground/50'
        )}>
          {mining ? hash : `${pos.user.slice(0, 12)}…`}
        </span>
        <span className="text-[9px] text-muted-foreground/50">{fmtElapsed(pos.elapsed)}</span>
      </div>

      {/* Block body */}
      <div className="px-3 py-2.5 space-y-1.5">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-[10px] text-muted-foreground">Usuario</p>
            <p className="text-xs font-mono font-medium text-foreground">{shortAddr(pos.user)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Stake</p>
            <p className="text-xs font-medium text-foreground">{fmtToken(pos.stake, 18, 2)} <span className="text-muted-foreground">{pos.symbol}</span></p>
          </div>
        </div>

        <div className="flex justify-between items-center">
          <div>
            <p className="text-[10px] text-muted-foreground">Reward pendiente</p>
            <p className={cn('text-sm font-bold', mined ? 'text-emerald-400' : 'text-amber-400')}>
              +{fmtToken(pos.reward, 18, 6)} {pos.symbol}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Tu ganancia (1%)</p>
            <p className="text-xs font-semibold text-[oklch(0.65_0.22_255)]">
              +{fmtToken(pos.processorEarns, 18, 8)} {pos.symbol}
            </p>
          </div>
        </div>

        {mined && earned !== null && (
          <div className="mt-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2 py-1.5 text-center">
            <p className="text-[10px] text-emerald-400 font-semibold">
              ⛏ BLOQUE MINADO · Ganaste {fmtToken(earned, 18, 8)} {pos.symbol}
            </p>
          </div>
        )}

        {!mined && (
          <Button
            size="sm"
            className={cn(
              'w-full h-8 text-xs font-bold mt-1 transition-all',
              mining
                ? 'bg-[oklch(0.65_0.22_255)]/80 text-white animate-pulse'
                : 'bg-muted/40 hover:bg-[oklch(0.65_0.22_255)] hover:text-white text-muted-foreground'
            )}
            disabled={mining}
            onClick={() => onMine(pos)}
          >
            {mining
              ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Minando...</>
              : <><Zap className="w-3 h-3 mr-1" /> Minar bloque</>
            }
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function AutoStakeMiningPanel({ userAddress }: Props) {
  const [tokens, setTokens]               = useState<TokenInfo[]>([])
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null)
  const [positions, setPositions]         = useState<ClaimablePosition[]>([])
  const [loading, setLoading]             = useState(false)
  const [miningIdx, setMiningIdx]         = useState<number | null>(null)
  const [minedSet, setMinedSet]           = useState<Set<number>>(new Set())
  const [earnedMap, setEarnedMap]         = useState<Map<number, bigint>>(new Map())
  const [batchLoading, setBatchLoading]   = useState(false)
  const [msg, setMsg]                     = useState<{ ok: boolean; text: string } | null>(null)
  const [totalEarned, setTotalEarned]     = useState(0n)

  // Live block counter
  const [blockTime, setBlockTime] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setBlockTime(p => p + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const stats = await fetchContractStats()
      setTokens(stats.tokens)
      const tk = selectedToken ?? stats.tokens[0] ?? null
      if (tk) {
        setSelectedToken(tk)
        const claimable = await fetchClaimablePositions(tk.address, tk.symbol)
        setPositions(claimable)
      }
    } catch (e) { console.error('[AutoStakeMining] load', e) }
    finally { setLoading(false) }
  }, [selectedToken])

  useEffect(() => { load() }, [])

  async function doMine(pos: ClaimablePosition, idx: number) {
    setMiningIdx(idx); setMsg(null)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: ACUA_AUTOSTAKE_ADDRESS,
          abi: CLAIM_FOR_ABI,
          functionName: 'claimFor',
          args: [pos.token, pos.user],
        }],
      })

      if (finalPayload.status === 'success') {
        const earned = pos.processorEarns
        setMinedSet(prev => new Set([...prev, idx]))
        setEarnedMap(prev => new Map([...prev, [idx, earned]]))
        setTotalEarned(prev => prev + earned)
        setMsg({ ok: true, text: `✓ Bloque minado · Ganaste ${fmtToken(earned, 18, 8)} ${pos.symbol}` })
      } else {
        setMsg({ ok: false, text: (finalPayload as any).message ?? 'Rechazado' })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'Error' })
    } finally { setMiningIdx(null) }
  }

  async function doMineAll() {
    if (!selectedToken || positions.length === 0) return
    setBatchLoading(true); setMsg(null)
    try {
      const eligible = positions.filter((_, i) => !minedSet.has(i))
      if (eligible.length === 0) return setMsg({ ok: false, text: 'No hay posiciones disponibles' })

      const users = eligible.map(p => p.user)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: ACUA_AUTOSTAKE_ADDRESS,
          abi: CLAIM_BATCH_ABI,
          functionName: 'claimForBatch',
          args: [selectedToken.address, users],
        }],
      })

      if (finalPayload.status === 'success') {
        const totalEarn = eligible.reduce((acc, p) => acc + p.processorEarns, 0n)
        const newMined = new Set(minedSet)
        const newEarned = new Map(earnedMap)
        positions.forEach((p, i) => {
          if (!minedSet.has(i)) {
            newMined.add(i)
            newEarned.set(i, p.processorEarns)
          }
        })
        setMinedSet(newMined)
        setEarnedMap(newEarned)
        setTotalEarned(prev => prev + totalEarn)
        setMsg({ ok: true, text: `✓ ${eligible.length} bloques minados · Ganaste ${fmtToken(totalEarn, 18, 8)} ${selectedToken.symbol}` })
      } else {
        setMsg({ ok: false, text: (finalPayload as any).message ?? 'Rechazado' })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'Error' })
    } finally { setBatchLoading(false) }
  }

  const pendingCount = positions.filter((_, i) => !minedSet.has(i)).length

  if (!DEPLOYED) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-yellow-500/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-yellow-400" />
        </div>
        <p className="font-semibold text-foreground">Contrato en preparación</p>
        <p className="text-xs text-muted-foreground text-center max-w-xs">
          El panel de minería estará disponible una vez que AcuaAutoStake sea desplegado en World Chain.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-6 font-mono">
      {/* Mining terminal header */}
      <div className="rounded-xl border border-[oklch(0.65_0.22_255)]/40 bg-background overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-[oklch(0.65_0.22_255)]/10 border-b border-[oklch(0.65_0.22_255)]/30">
          <div className="flex gap-1">
            {['bg-red-500', 'bg-yellow-500', 'bg-green-500'].map(c => (
              <div key={c} className={`w-2.5 h-2.5 rounded-full ${c}/70`} />
            ))}
          </div>
          <span className="text-[10px] text-[oklch(0.65_0.22_255)] flex-1 text-center">
            ACUA_AUTOSTAKE :: MINING POOL v1.0
          </span>
          <button onClick={load} disabled={loading} className="ml-auto">
            <RefreshCw className={cn('w-3 h-3 text-muted-foreground', loading && 'animate-spin')} />
          </button>
        </div>

        <div className="p-3 space-y-1 text-[10px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">STATUS</span>
            <span className="text-green-400">● ONLINE</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">BLOQUES EN COLA</span>
            <span className="text-amber-400">{pendingCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">MINADOS ESTA SESIÓN</span>
            <span className="text-[oklch(0.65_0.22_255)]">{minedSet.size}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">GANADO (1% reward)</span>
            <span className="text-emerald-400">{fmtToken(totalEarned, 18, 8)} {selectedToken?.symbol ?? '?'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">UPTIME</span>
            <span className="text-muted-foreground">{blockTime}s</span>
          </div>
        </div>
      </div>

      {/* Token selector */}
      {tokens.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tokens.map(tk => (
            <button
              key={tk.address}
              onClick={async () => {
                setSelectedToken(tk)
                setPositions([])
                setMinedSet(new Set())
                setEarnedMap(new Map())
                setLoading(true)
                try {
                  const claimable = await fetchClaimablePositions(tk.address, tk.symbol)
                  setPositions(claimable)
                } finally { setLoading(false) }
              }}
              className={cn(
                'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                selectedToken?.address === tk.address
                  ? 'bg-[oklch(0.65_0.22_255)] text-white border-transparent'
                  : 'border-border text-muted-foreground hover:border-[oklch(0.65_0.22_255)]/60'
              )}
            >
              {tk.symbol} <span className="opacity-60 ml-1">{tk.aprPct.toFixed(0)}% APR</span>
            </button>
          ))}
        </div>
      )}

      {/* Mine All button */}
      {pendingCount > 0 && (
        <Button
          className="w-full h-11 font-bold text-sm bg-gradient-to-r from-[oklch(0.65_0.22_255)] to-purple-500 hover:opacity-90"
          disabled={batchLoading || loading}
          onClick={doMineAll}
        >
          {batchLoading
            ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Procesando {pendingCount} bloques...</>
            : <><Zap className="w-4 h-4 mr-2" /> Minar todos ({pendingCount} bloques)</>
          }
        </Button>
      )}

      {/* Claimable blocks list */}
      {loading ? (
        <div className="flex flex-col items-center py-10 gap-3">
          <Cpu className="w-8 h-8 text-[oklch(0.65_0.22_255)] animate-pulse" />
          <p className="text-xs text-muted-foreground">Escaneando blockchain...</p>
        </div>
      ) : positions.length === 0 ? (
        <div className="rounded-xl border border-border bg-muted/10 p-8 text-center space-y-2">
          <BarChart3 className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">Sin bloques pendientes</p>
          <p className="text-[10px] text-muted-foreground/60">
            Las posiciones elegibles aparecen aquí cada 10 minutos
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {positions.map((pos, i) => (
            <BlockCard
              key={`${pos.user}-${i}`}
              pos={pos}
              index={i}
              mining={miningIdx === i}
              mined={minedSet.has(i)}
              earned={earnedMap.get(i) ?? null}
              onMine={p => doMine(p, i)}
            />
          ))}
        </div>
      )}

      {msg && (
        <p className={cn('text-xs text-center font-medium', msg.ok ? 'text-emerald-400' : 'text-red-400')}>
          {msg.text}
        </p>
      )}

      {/* How it works */}
      <div className="rounded-xl border border-border bg-muted/10 p-3 space-y-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          ⛏ Cómo funciona el mining
        </p>
        <ul className="space-y-1">
          {[
            '📋 Las posiciones elegibles (≥10 min) aparecen como bloques en cola',
            '⚡ Haz clic en "Minar bloque" para procesar el auto-reinvest del usuario',
            '💰 Ganas el 1% del reward como recompensa por procesar la TX',
            '🚀 "Minar todos" procesa toda la cola en una sola transacción',
            '🔁 No necesitas bots — cualquier usuario puede minar bloques',
          ].map(t => <li key={t} className="text-[10px] text-muted-foreground">{t}</li>)}
        </ul>
      </div>
    </div>
  )
}
