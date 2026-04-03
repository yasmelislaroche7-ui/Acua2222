'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { Pickaxe, Loader2, Gift, RefreshCw, Zap, Flame, Cpu, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  MINING_UTH2_CONTRACT, PERMIT_TUPLE_INPUT, TOKENS,
  fetchMiningUTH2Info, MiningUTH2Info, MiningPackage, formatToken, randomNonce,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── ABI ──────────────────────────────────────────────────────────────────────
const BUY_PACKAGE_ABI = [{
  name: 'buyPackage', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'packageId', type: 'uint256', internalType: 'uint256' },
    { name: 'units', type: 'uint256', internalType: 'uint256' },
    PERMIT_TUPLE_INPUT,
    { name: 'signature', type: 'bytes', internalType: 'bytes' },
  ],
  outputs: [],
}] as const

const CLAIM_ABI = [{
  name: 'claimRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

// ─── Package visual config ────────────────────────────────────────────────────
const PKG_CFG = [
  { name: 'Starter',  color: '#6b7280', glow: 'shadow-gray-500/20',  icon: '⛏️', bg: 'from-gray-900/60 to-gray-800/30',  rarity: 'Común' },
  { name: 'Bronce',   color: '#b45309', glow: 'shadow-amber-700/30', icon: '🥉', bg: 'from-amber-950/60 to-amber-900/20', rarity: 'Raro' },
  { name: 'Silver',   color: '#94a3b8', glow: 'shadow-slate-400/30', icon: '🥈', bg: 'from-slate-900/60 to-slate-800/20', rarity: 'Épico' },
  { name: 'Gold',     color: '#f59e0b', glow: 'shadow-yellow-500/40', icon: '🥇', bg: 'from-yellow-950/60 to-yellow-900/20', rarity: 'Legendario' },
  { name: 'Platinum', color: '#e2e8f0', glow: 'shadow-white/20',     icon: '💎', bg: 'from-slate-800/60 to-slate-700/20', rarity: 'Mítico' },
  { name: 'Diamond',  color: '#60a5fa', glow: 'shadow-blue-500/40',  icon: '🔷', bg: 'from-blue-950/60 to-blue-900/20',  rarity: 'Divino' },
  { name: 'Elite',    color: '#a78bfa', glow: 'shadow-violet-500/50', icon: '👑', bg: 'from-violet-950/60 to-violet-900/20', rarity: 'Supremo' },
]

// ─── Real-time reward counter ─────────────────────────────────────────────────
function useRealtimeRewards(base: bigint, perSecond: number): { display: string; raw: number } {
  const [raw, setRaw] = useState(parseFloat(ethers.formatUnits(base, 18)))
  useEffect(() => { setRaw(parseFloat(ethers.formatUnits(base, 18))) }, [base])
  useEffect(() => {
    if (perSecond <= 0) return
    const id = setInterval(() => setRaw(p => p + perSecond), 1000)
    return () => clearInterval(id)
  }, [perSecond])
  return { display: raw < 0.0001 ? '< 0.0001' : raw.toFixed(8), raw }
}

// ─── Block Log ────────────────────────────────────────────────────────────────
interface Block { num: number; hash: string; h2o: string; time: string }

function BlockLog({ active, perSecond }: { active: boolean; perSecond: number }) {
  const [blocks, setBlocks] = useState<Block[]>([])
  const blockNum = useRef(Math.floor(Date.now() / 12000) + Math.floor(Math.random() * 1000))

  useEffect(() => {
    if (!active || perSecond <= 0) { setBlocks([]); return }
    const add = () => {
      blockNum.current++
      setBlocks(prev => [{
        num: blockNum.current,
        hash: Math.random().toString(16).slice(2, 10),
        h2o: (perSecond * 12).toFixed(8),
        time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      }, ...prev].slice(0, 6))
    }
    add()
    const id = setInterval(add, 12000)
    return () => clearInterval(id)
  }, [active, perSecond])

  if (!active || blocks.length === 0) return null

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-b from-cyan-950/30 to-transparent p-3 space-y-1.5">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
        <Cpu className="w-3 h-3 text-cyan-400" />
        <span className="text-xs text-cyan-400 font-mono font-bold uppercase tracking-widest">Mining Blocks · H2O</span>
      </div>
      {blocks.map((b, i) => (
        <div key={b.num} className={cn(
          'flex items-center gap-2 text-xs font-mono px-2 py-1.5 rounded-lg transition-all',
          i === 0 ? 'bg-cyan-500/10 border border-cyan-500/20' : 'opacity-40'
        )}>
          <div className={cn('w-1 h-1 rounded-full shrink-0', i === 0 ? 'bg-green-400' : 'bg-gray-600')} />
          <span className="text-cyan-500/70">#{b.num.toLocaleString()}</span>
          <span className="text-muted-foreground/60 hidden sm:inline">{b.hash}…</span>
          <span className="text-green-400 ml-auto font-semibold">+{b.h2o} H2O</span>
          <span className="text-muted-foreground/30 text-[10px]">{b.time}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Package Card ─────────────────────────────────────────────────────────────
interface PackageCardProps {
  pkg: MiningPackage
  userUnits: bigint
  pendingH2O: bigint
  perSecond: number
  onBuy: (id: number) => void
}

function PackageCard({ pkg, userUnits, pendingH2O, perSecond, onBuy }: PackageCardProps) {
  const cfg = PKG_CFG[pkg.id] || PKG_CFG[0]
  const daily = parseFloat(ethers.formatUnits(pkg.dailyYield, 18))
  const price = parseFloat(ethers.formatUnits(pkg.priceUTH2, 18))
  const hasActive = userUnits > 0n
  const { display: pendingDisplay } = useRealtimeRewards(pendingH2O, hasActive ? perSecond : 0)

  const annualH2O = daily * 365
  const perSecDisplay = (daily / 86400).toFixed(8)

  return (
    <div className={cn(
      'relative rounded-2xl border overflow-hidden transition-all',
      `bg-gradient-to-br ${cfg.bg}`,
      hasActive ? `border-2 shadow-lg ${cfg.glow}` : 'border-border/60',
      !pkg.active && 'opacity-40 pointer-events-none',
    )} style={{ borderColor: hasActive ? cfg.color + '80' : undefined }}>

      {/* Active badge */}
      {hasActive && (
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
          style={{ background: cfg.color + '22', color: cfg.color, border: `1px solid ${cfg.color}40` }}>
          <div className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
          ×{userUnits.toString()} activo
        </div>
      )}

      <div className="p-3 space-y-2.5">
        {/* Header */}
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: cfg.color + '18', border: `1.5px solid ${cfg.color}40` }}>
            {cfg.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <p className="font-bold text-sm text-foreground">{cfg.name}</p>
              <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                style={{ background: cfg.color + '15', color: cfg.color }}>{cfg.rarity}</span>
            </div>
            <p className="text-xs text-muted-foreground">Precio: <strong className="text-foreground font-mono">{price.toLocaleString()} UTH₂</strong></p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-1.5 text-xs">
          <div className="rounded-lg bg-background/40 p-2 text-center">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Por día</p>
            <p className="font-bold text-green-300 mt-0.5">+{daily.toFixed(2)}</p>
            <p className="text-muted-foreground text-[10px]">H2O</p>
          </div>
          <div className="rounded-lg bg-background/40 p-2 text-center">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Por seg</p>
            <p className="font-bold text-cyan-300 mt-0.5 font-mono text-[11px]">{perSecDisplay}</p>
            <p className="text-muted-foreground text-[10px]">H2O</p>
          </div>
          <div className="rounded-lg bg-background/40 p-2 text-center">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Anual</p>
            <p className="font-bold text-purple-300 mt-0.5">{annualH2O.toFixed(0)}</p>
            <p className="text-muted-foreground text-[10px]">H2O</p>
          </div>
        </div>

        {/* Pending rewards - real-time counter */}
        {hasActive && (
          <div className="rounded-xl border border-green-500/20 bg-green-500/5 px-3 py-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-green-400/70 uppercase tracking-wider text-[10px]">Acumulado</p>
                <p className="font-mono font-bold text-green-300 text-sm">{pendingDisplay}</p>
                <p className="text-green-400/50 text-[10px]">H2O · tiempo real</p>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <Zap className="w-4 h-4 text-green-400 animate-pulse" />
                <p className="text-[10px] text-green-400/50">+{(perSecond * 3600).toFixed(4)}/hr</p>
              </div>
            </div>
          </div>
        )}

        {/* Buy button */}
        <button
          onClick={() => onBuy(pkg.id)}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition-all hover:scale-[1.02] active:scale-95"
          style={{ background: cfg.color + '22', border: `1px solid ${cfg.color}50`, color: cfg.color }}
        >
          <Pickaxe className="w-3.5 h-3.5" />
          {hasActive ? `Comprar más ${cfg.name}` : `Comprar ${cfg.name}`}
        </button>
      </div>
    </div>
  )
}

// ─── Buy Dialog ───────────────────────────────────────────────────────────────
interface BuyDialogProps {
  pkg: MiningPackage
  uth2Balance: bigint
  onClose: () => void
  onSuccess: () => void
}

function BuyDialog({ pkg, uth2Balance, onClose, onSuccess }: BuyDialogProps) {
  const cfg = PKG_CFG[pkg.id] || PKG_CFG[0]
  const [units, setUnits] = useState('1')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const u = parseInt(units) || 0
  const totalCost = BigInt(u) * pkg.priceUTH2
  const canAfford = uth2Balance >= totalCost && totalCost > 0n
  const dailyTotal = BigInt(u) * pkg.dailyYield
  const annualTotal = Number(ethers.formatUnits(dailyTotal, 18)) * 365

  async function doBuy() {
    if (!u || u <= 0) return setMsg('Ingresa una cantidad válida')
    if (!canAfford) return setMsg('Saldo UTH₂ insuficiente')
    setLoading(true); setMsg('')
    try {
      const nonce = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: MINING_UTH2_CONTRACT,
          abi: BUY_PACKAGE_ABI,
          functionName: 'buyPackage',
          args: [
            pkg.id.toString(), u.toString(),
            { permitted: { token: TOKENS.UTH2, amount: totalCost.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
          ],
        }],
        permit2: [{
          permitted: { token: TOKENS.UTH2, amount: totalCost.toString() },
          spender: MINING_UTH2_CONTRACT,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
        }],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ ¡Paquete comprado! Minería activada permanentemente')
        setTimeout(onSuccess, 2000)
      } else {
        setMsg((finalPayload as any).message ?? 'Transacción rechazada')
      }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end justify-center">
      <div className="w-full max-w-md bg-background border-t border-border rounded-t-2xl p-4 pb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">{cfg.icon}</span>
            <div>
              <h3 className="font-bold text-foreground" style={{ color: cfg.color }}>{cfg.name}</h3>
              <p className="text-xs text-muted-foreground">{cfg.rarity} · Minería H2O permanente</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground text-xs hover:text-foreground">✕</button>
        </div>

        <div className="space-y-3">
          {/* Info */}
          <div className="bg-surface-2 border border-border rounded-xl p-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Precio por paquete</span>
              <span className="font-semibold text-foreground">{formatToken(pkg.priceUTH2, 18)} UTH₂</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">H2O diario por paquete</span>
              <span className="font-semibold text-green-400">+{formatToken(pkg.dailyYield, 18, 4)} H2O</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">H2O por segundo</span>
              <span className="font-mono text-cyan-400">+{(Number(ethers.formatUnits(pkg.dailyYield, 18)) / 86400).toFixed(8)}</span>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Cantidad de paquetes</label>
            <input type="number" min="1" value={units} onChange={e => setUnits(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-xl px-3 py-3 text-sm text-foreground focus:outline-none focus:border-primary font-mono" />
          </div>

          {/* Summary */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total a pagar</span>
              <span className="font-bold text-foreground">{formatToken(totalCost, 18)} UTH₂</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Producción diaria</span>
              <span className="font-bold text-green-400">+{formatToken(dailyTotal, 18, 4)} H2O/día</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Producción anual</span>
              <span className="font-bold text-purple-400">+{annualTotal.toFixed(2)} H2O/año</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Tu saldo UTH₂</span>
              <span className={cn('font-medium', canAfford ? 'text-foreground' : 'text-red-400')}>{formatToken(uth2Balance, 18)}</span>
            </div>
          </div>

          <Button className="w-full h-12 text-sm font-semibold" onClick={doBuy} disabled={loading || !canAfford}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Pickaxe className="w-4 h-4 mr-2" />}
            Activar {u} paquete{u > 1 ? 's' : ''} · Minería permanente
          </Button>

          {msg && (
            <p className={cn('text-xs text-center font-medium', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{msg}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function MiningUTH2Panel({ userAddress }: { userAddress: string }) {
  const [info, setInfo] = useState<MiningUTH2Info | null>(null)
  const [loading, setLoading] = useState(false)
  const [buyingPkg, setBuyingPkg] = useState<MiningPackage | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setInfo(await fetchMiningUTH2Info(userAddress)) }
    catch (e) { console.error('MiningUTH2 load', e) }
    finally { setLoading(false) }
  }, [userAddress])

  useEffect(() => { load() }, [load])

  const totalPending = info?.totalPending ?? 0n
  const dailyYield = info?.dailyYield ?? 0n
  const perSecond = parseFloat(ethers.formatUnits(dailyYield, 18)) / 86400
  const { display: totalDisplay } = useRealtimeRewards(totalPending, perSecond)

  // Count active packages
  const activePkgCount = info?.userPackages.filter(p => p.units > 0n).length ?? 0
  const totalActiveUnits = info?.userPackages.reduce((s, p) => s + Number(p.units), 0) ?? 0

  async function doClaimAll() {
    setClaiming(true); setMsg('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: MINING_UTH2_CONTRACT, abi: CLAIM_ABI, functionName: 'claimRewards', args: [] }],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ H2O reclamado exitosamente!')
        setTimeout(load, 2000)
      } else setMsg('Transacción rechazada')
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setClaiming(false) }
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Acua mining header */}
      <div className="relative rounded-2xl overflow-hidden border border-cyan-500/20 bg-gradient-to-br from-cyan-950/40 via-background to-blue-950/20 p-4">
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: 'linear-gradient(rgba(0,212,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.3) 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }} />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
              <Pickaxe className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Minería H2O</h2>
              <p className="text-xs text-cyan-400/70">UTH₂ → H2O · Permanente</p>
            </div>
          </div>
          <button onClick={load} disabled={loading} className="text-muted-foreground hover:text-cyan-400 transition-colors">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>

        {/* Stats row */}
        <div className="relative mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-background/50 p-2 text-center border border-cyan-500/10">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Mineros</p>
            <p className="font-bold text-cyan-300 text-sm">{totalActiveUnits}</p>
            <p className="text-[10px] text-muted-foreground">activos</p>
          </div>
          <div className="rounded-xl bg-background/50 p-2 text-center border border-cyan-500/10">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Diario</p>
            <p className="font-bold text-green-300 text-sm">{parseFloat(ethers.formatUnits(dailyYield, 18)).toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground">H2O</p>
          </div>
          <div className="rounded-xl bg-background/50 p-2 text-center border border-cyan-500/10">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Por seg</p>
            <p className="font-bold text-purple-300 text-sm font-mono text-xs">{perSecond.toFixed(6)}</p>
            <p className="text-[10px] text-muted-foreground">H2O</p>
          </div>
        </div>
      </div>

      {/* Pending rewards + claim */}
      {totalPending > 0n && (
        <div className="rounded-2xl border border-green-500/30 bg-gradient-to-br from-green-950/40 to-transparent p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <p className="text-xs text-green-400/70 uppercase tracking-wider">H2O acumulado</p>
              </div>
              <p className="text-2xl font-bold text-green-200 font-mono">{totalDisplay}</p>
              <p className="text-xs text-green-400/50 mt-0.5">H2O · contador en tiempo real</p>
            </div>
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white shrink-0 h-10 px-4" onClick={doClaimAll} disabled={claiming}>
              {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Gift className="w-4 h-4 mr-1.5" /> Reclamar</>}
            </Button>
          </div>
        </div>
      )}

      {/* Block log */}
      <BlockLog active={activePkgCount > 0} perSecond={perSecond} />

      {/* Package grid */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Paquetes de Minería</p>
        </div>
        {(info?.packages ?? Array(7).fill(null)).map((pkg, i) => {
          if (!pkg) return <div key={i} className="h-32 bg-surface-2 border border-border rounded-2xl animate-pulse" />
          const userPkg = info!.userPackages[i]
          const pending = info!.pendingPerPkg[i] ?? 0n
          const pkgUnits = userPkg?.units ?? 0n
          const pkgPerSec = pkgUnits > 0n
            ? Number(ethers.formatUnits(pkg.dailyYield, 18)) / 86400 * Number(pkgUnits)
            : 0
          return (
            <PackageCard
              key={i}
              pkg={pkg}
              userUnits={pkgUnits}
              pendingH2O={pending}
              perSecond={pkgPerSec}
              onBuy={id => setBuyingPkg(info!.packages[id])}
            />
          )
        })}
      </div>

      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Flame className="w-3.5 h-3.5 text-orange-400" />
          Minería permanente · Stacks con múltiples paquetes · H2O se acumula sin interacción
        </div>
      </div>

      {msg && <p className={cn('text-xs text-center font-medium', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{msg}</p>}

      {buyingPkg && info && (
        <BuyDialog
          pkg={buyingPkg}
          uth2Balance={info.uth2Balance}
          onClose={() => setBuyingPkg(null)}
          onSuccess={() => { setBuyingPkg(null); load() }}
        />
      )}
    </div>
  )
}
