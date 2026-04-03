'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { Pickaxe, Loader2, Gift, RefreshCw, Zap, Cpu, Gem, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  MINING_WLD_CONTRACT, PERMIT_TUPLE_INPUT, TOKENS,
  fetchMiningWLDInfo, MiningWLDInfo, formatToken, randomNonce,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const BUY_PKG_ABI = [{
  name: 'buyPackage', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'packageId', type: 'uint256', internalType: 'uint256' },
    { name: 'units', type: 'uint256', internalType: 'uint256' },
    PERMIT_TUPLE_INPUT,
    { name: 'signature', type: 'bytes', internalType: 'bytes' },
  ],
  outputs: [],
}] as const

const CLAIM_ALL_ABI = [{ name: 'claimAllRewards', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }] as const
const CLAIM_PKG_ABI = [{ name: 'claimPackageRewards', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'packageId', type: 'uint256', internalType: 'uint256' }], outputs: [] }] as const

// ─── Package config ────────────────────────────────────────────────────────────
const PKG_CFG = [
  { name: 'H2O Mine',   color: '#06b6d4', icon: '💧', bg: 'from-cyan-950/60 to-cyan-900/20',    rarity: 'Agua' },
  { name: 'Fire Mine',  color: '#f97316', icon: '🔥', bg: 'from-orange-950/60 to-orange-900/20', rarity: 'Fuego' },
  { name: 'BTC Mine',   color: '#f59e0b', icon: '₿',  bg: 'from-yellow-950/60 to-yellow-900/20', rarity: 'Bitcoin' },
  { name: 'WLD Mine',   color: '#3b82f6', icon: '🌐', bg: 'from-blue-950/60 to-blue-900/20',    rarity: 'World' },
  { name: 'ARS Mine',   color: '#10b981', icon: '🏛',  bg: 'from-emerald-950/60 to-emerald-900/20', rarity: 'Peso ARS' },
  { name: 'COP Mine',   color: '#fbbf24', icon: '🦅', bg: 'from-amber-950/60 to-amber-900/20',   rarity: 'Peso COP' },
  { name: 'UTH₂ Mine', color: '#8b5cf6', icon: '⚡', bg: 'from-violet-950/60 to-violet-900/20', rarity: 'Uranio' },
]

// ─── Real-time counter ────────────────────────────────────────────────────────
function useRealtimeRewards(base: bigint, perSecond: number): string {
  const [raw, setRaw] = useState(parseFloat(ethers.formatUnits(base, 18)))
  useEffect(() => { setRaw(parseFloat(ethers.formatUnits(base, 18))) }, [base])
  useEffect(() => {
    if (perSecond <= 0) return
    const id = setInterval(() => setRaw(p => p + perSecond), 1000)
    return () => clearInterval(id)
  }, [perSecond])
  if (raw === 0) return '0'
  if (raw < 0.000001) return '< 0.000001'
  return raw.toFixed(8)
}

// ─── Block Log ────────────────────────────────────────────────────────────────
interface Block { num: number; hash: string; reward: string; symbol: string; time: string }

function BlockLog({ active, perSecond, symbol }: { active: boolean; perSecond: number; symbol: string }) {
  const [blocks, setBlocks] = useState<Block[]>([])
  const blockNum = useRef(Math.floor(Date.now() / 12000) + Math.floor(Math.random() * 1000))

  useEffect(() => {
    if (!active || perSecond <= 0) { setBlocks([]); return }
    const add = () => {
      blockNum.current++
      setBlocks(prev => [{
        num: blockNum.current,
        hash: Math.random().toString(16).slice(2, 10),
        reward: (perSecond * 12).toFixed(8),
        symbol,
        time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      }, ...prev].slice(0, 6))
    }
    add()
    const id = setInterval(add, 12000)
    return () => clearInterval(id)
  }, [active, perSecond, symbol])

  if (!active || blocks.length === 0) return null

  return (
    <div className="rounded-xl border border-yellow-500/20 bg-gradient-to-b from-yellow-950/20 to-transparent p-3 space-y-1.5">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
        <Cpu className="w-3 h-3 text-yellow-400" />
        <span className="text-xs text-yellow-400 font-mono font-bold uppercase tracking-widest">Mining Blocks · {symbol}</span>
      </div>
      {blocks.map((b, i) => (
        <div key={b.num} className={cn(
          'flex items-center gap-2 text-xs font-mono px-2 py-1.5 rounded-lg',
          i === 0 ? 'bg-yellow-500/10 border border-yellow-500/20' : 'opacity-40'
        )}>
          <div className={cn('w-1 h-1 rounded-full shrink-0', i === 0 ? 'bg-green-400 animate-pulse' : 'bg-gray-600')} />
          <span className="text-yellow-500/70">#{b.num.toLocaleString()}</span>
          <span className="text-muted-foreground/50 hidden sm:inline">{b.hash}…</span>
          <span className="text-green-400 ml-auto font-semibold">+{b.reward} {b.symbol}</span>
          <span className="text-muted-foreground/30 text-[10px]">{b.time}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Package Card ─────────────────────────────────────────────────────────────
interface WLDCardProps {
  pkg: { id: number; priceWLD: bigint; dailyYield: bigint; active: boolean; rewardSymbol: string }
  userUnits: bigint
  pendingRewards: bigint
  userDailyYield: bigint
  wldBalance: bigint
  onBuy: () => void
  onClaim: () => void
  isClaiming: boolean
}

function WLDPackageCard({ pkg, userUnits, pendingRewards, userDailyYield, wldBalance, onBuy, onClaim, isClaiming }: WLDCardProps) {
  const cfg = PKG_CFG[pkg.id] || { name: `Mine ${pkg.id}`, color: '#6b7280', icon: '⛏', bg: 'from-gray-950/60', rarity: '' }
  const hasActive = userUnits > 0n
  const perSecond = hasActive ? Number(ethers.formatUnits(userDailyYield, 18)) / 86400 : 0
  const pendingDisplay = useRealtimeRewards(pendingRewards, perSecond)
  const dailyPerUnit = parseFloat(ethers.formatUnits(pkg.dailyYield, 18))
  const price = parseFloat(ethers.formatUnits(pkg.priceWLD, 18))

  return (
    <div className={cn(
      'relative rounded-2xl border overflow-hidden transition-all',
      `bg-gradient-to-br ${cfg.bg}`,
      hasActive ? 'shadow-lg border-2' : 'border-border/60',
      !pkg.active && 'opacity-40 pointer-events-none',
    )} style={{ borderColor: hasActive ? cfg.color + '70' : undefined }}>

      {/* Active badge */}
      {hasActive && (
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
          style={{ background: cfg.color + '22', color: cfg.color, border: `1px solid ${cfg.color}40` }}>
          <div className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
          ×{userUnits.toString()}
        </div>
      )}

      <div className="p-3 space-y-2.5">
        {/* Header */}
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: cfg.color + '18', border: `1.5px solid ${cfg.color}40` }}>
            {cfg.icon}
          </div>
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <p className="font-bold text-sm text-foreground">{cfg.name}</p>
              <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                style={{ background: cfg.color + '15', color: cfg.color }}>{cfg.rarity}</span>
            </div>
            <p className="text-xs text-muted-foreground">Mina <strong style={{ color: cfg.color }}>{pkg.rewardSymbol}</strong> · {price.toLocaleString()} WLD</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-1.5 text-xs">
          <div className="rounded-lg bg-background/40 p-2 text-center">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Diario</p>
            <p className="font-bold text-green-300 mt-0.5">+{dailyPerUnit.toFixed(2)}</p>
            <p className="text-muted-foreground text-[10px]">{pkg.rewardSymbol}</p>
          </div>
          <div className="rounded-lg bg-background/40 p-2 text-center">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Por seg</p>
            <p className="font-mono font-bold text-cyan-300 mt-0.5 text-[11px]">{(dailyPerUnit / 86400).toFixed(7)}</p>
            <p className="text-muted-foreground text-[10px]">{pkg.rewardSymbol}</p>
          </div>
          <div className="rounded-lg bg-background/40 p-2 text-center">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Anual</p>
            <p className="font-bold text-purple-300 mt-0.5">{(dailyPerUnit * 365).toFixed(1)}</p>
            <p className="text-muted-foreground text-[10px]">{pkg.rewardSymbol}</p>
          </div>
        </div>

        {/* Pending - real-time */}
        {hasActive && (
          <div className="rounded-xl border border-green-500/20 bg-green-500/5 px-3 py-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-green-400/60 uppercase tracking-wider">Acumulado</p>
                <p className="font-mono font-bold text-green-300 text-sm">{pendingDisplay}</p>
                <p className="text-green-400/40 text-[10px]">{pkg.rewardSymbol} · en tiempo real</p>
              </div>
              <div className="flex flex-col items-end">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-green-400 hover:text-green-300" onClick={onClaim} disabled={isClaiming || pendingRewards === 0n}>
                  {isClaiming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Gift className="w-3.5 h-3.5 mr-1" /> Claim</>}
                </Button>
                <Zap className="w-3 h-3 text-green-400/50 animate-pulse" />
              </div>
            </div>
          </div>
        )}

        <button
          onClick={onBuy}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition-all hover:scale-[1.02] active:scale-95"
          style={{ background: cfg.color + '22', border: `1px solid ${cfg.color}50`, color: cfg.color }}
        >
          <Pickaxe className="w-3.5 h-3.5" />
          {hasActive ? 'Comprar más' : 'Comprar paquete'}
        </button>
      </div>
    </div>
  )
}

// ─── Buy Dialog ───────────────────────────────────────────────────────────────
interface BuyDialogProps {
  pkgId: number; priceWLD: bigint; dailyYield: bigint; rewardSymbol: string; wldBalance: bigint
  onClose: () => void; onSuccess: () => void
}

function BuyDialog({ pkgId, priceWLD, dailyYield, rewardSymbol, wldBalance, onClose, onSuccess }: BuyDialogProps) {
  const cfg = PKG_CFG[pkgId] || { name: `Mine ${pkgId}`, color: '#6b7280', icon: '⛏', rarity: '' }
  const [units, setUnits] = useState('1')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const u = parseInt(units) || 0
  const totalCost = BigInt(u) * priceWLD
  const canAfford = wldBalance >= totalCost && totalCost > 0n
  const dailyTotal = BigInt(u) * dailyYield
  const annual = Number(ethers.formatUnits(dailyTotal, 18)) * 365

  async function doBuy() {
    if (!u || u <= 0) return setMsg('Ingresa una cantidad válida')
    if (!canAfford) return setMsg('Saldo WLD insuficiente')
    setLoading(true); setMsg('')
    try {
      const nonce = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: MINING_WLD_CONTRACT, abi: BUY_PKG_ABI, functionName: 'buyPackage',
          args: [
            pkgId.toString(), u.toString(),
            { permitted: { token: TOKENS.WLD, amount: totalCost.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
          ],
        }],
        permit2: [{
          permitted: { token: TOKENS.WLD, amount: totalCost.toString() },
          spender: MINING_WLD_CONTRACT,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
        }],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ ¡Paquete activado! Minería permanente')
        setTimeout(onSuccess, 2000)
      } else setMsg((finalPayload as any).message ?? 'Transacción rechazada')
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
              <h3 className="font-bold" style={{ color: cfg.color }}>{cfg.name}</h3>
              <p className="text-xs text-muted-foreground">Mina {rewardSymbol} · permanente</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground text-xs hover:text-foreground">✕</button>
        </div>
        <div className="space-y-3">
          <div className="bg-surface-2 border border-border rounded-xl p-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Precio por paquete</span>
              <span className="font-semibold text-foreground">{formatToken(priceWLD, 18)} WLD</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Diario por paquete</span>
              <span className="font-semibold text-green-400">+{formatToken(dailyYield, 18)} {rewardSymbol}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Por segundo</span>
              <span className="font-mono text-cyan-400">{(Number(ethers.formatUnits(dailyYield, 18)) / 86400).toFixed(8)} {rewardSymbol}</span>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Cantidad de paquetes</label>
            <input type="number" min="1" value={units} onChange={e => setUnits(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-xl px-3 py-3 text-sm text-foreground focus:outline-none focus:border-primary font-mono" />
          </div>

          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total WLD</span>
              <span className="font-bold text-foreground">{formatToken(totalCost, 18)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Producción diaria</span>
              <span className="font-bold text-green-400">+{formatToken(dailyTotal, 18)} {rewardSymbol}/día</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Producción anual</span>
              <span className="font-bold text-purple-400">+{annual.toFixed(2)} {rewardSymbol}/año</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Tu saldo WLD</span>
              <span className={cn('font-medium', canAfford ? 'text-foreground' : 'text-red-400')}>{formatToken(wldBalance, 18)}</span>
            </div>
          </div>

          <Button className="w-full h-12 text-sm font-semibold" onClick={doBuy} disabled={loading || !canAfford}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Pickaxe className="w-4 h-4 mr-2" />}
            Activar {u} paquete{u > 1 ? 's' : ''} · Minería permanente
          </Button>

          {msg && <p className={cn('text-xs text-center font-medium', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{msg}</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function MiningWLDPanel({ userAddress }: { userAddress: string }) {
  const [info, setInfo] = useState<MiningWLDInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [buyingPkgId, setBuyingPkgId] = useState<number | null>(null)
  const [claimingPkgId, setClaimingPkgId] = useState<number | null>(null)
  const [claimingAll, setClaimingAll] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setInfo(await fetchMiningWLDInfo(userAddress)) }
    catch (e) { console.error('MiningWLD load', e) }
    finally { setLoading(false) }
  }, [userAddress])

  useEffect(() => { load() }, [load])

  const totalPending = info?.pendingPerPkg.reduce((a, b) => a + b, 0n) ?? 0n
  const totalDailyYield = info?.dailyYields.reduce((a, b) => a + b, 0n) ?? 0n
  const totalPerSecond = Number(ethers.formatUnits(totalDailyYield, 18)) / 86400
  const totalActiveUnits = info?.userPackages.reduce((s, p) => s + Number(p.units), 0) ?? 0
  const activePkgCount = info?.userPackages.filter(p => p.units > 0n).length ?? 0

  // Primary reward symbol for block log (first active package)
  const primarySymbol = info?.packages.find((p, i) => (info.userPackages[i]?.units ?? 0n) > 0n)?.rewardSymbol ?? 'TOKEN'

  async function doClaimPkg(pkgId: number) {
    setClaimingPkgId(pkgId); setMsg('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: MINING_WLD_CONTRACT, abi: CLAIM_PKG_ABI, functionName: 'claimPackageRewards', args: [pkgId.toString()] }],
      })
      if (finalPayload.status === 'success') { setMsg('✓ Rewards reclamadas!'); setTimeout(load, 2000) }
      else setMsg('Transacción rechazada')
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setClaimingPkgId(null) }
  }

  async function doClaimAll() {
    setClaimingAll(true); setMsg('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: MINING_WLD_CONTRACT, abi: CLAIM_ALL_ABI, functionName: 'claimAllRewards', args: [] }],
      })
      if (finalPayload.status === 'success') { setMsg('✓ Todas las rewards reclamadas!'); setTimeout(load, 2000) }
      else setMsg('Transacción rechazada')
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setClaimingAll(false) }
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Acua mining header */}
      <div className="relative rounded-2xl overflow-hidden border border-yellow-500/20 bg-gradient-to-br from-yellow-950/30 via-background to-amber-950/20 p-4">
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: 'linear-gradient(rgba(255,196,0,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,196,0,0.3) 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }} />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center">
              <Gem className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Minería Multi-Token</h2>
              <p className="text-xs text-yellow-400/70">WLD → 7 tokens · Permanente</p>
            </div>
          </div>
          <button onClick={load} disabled={loading} className="text-muted-foreground hover:text-yellow-400 transition-colors">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>

        <div className="relative mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-background/50 p-2 text-center border border-yellow-500/10">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Mineros</p>
            <p className="font-bold text-yellow-300 text-sm">{totalActiveUnits}</p>
            <p className="text-[10px] text-muted-foreground">activos</p>
          </div>
          <div className="rounded-xl bg-background/50 p-2 text-center border border-yellow-500/10">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Paquetes</p>
            <p className="font-bold text-amber-300 text-sm">{activePkgCount}</p>
            <p className="text-[10px] text-muted-foreground">activos</p>
          </div>
          <div className="rounded-xl bg-background/50 p-2 text-center border border-yellow-500/10">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Por seg</p>
            <p className="font-bold text-green-300 text-sm font-mono text-xs">{totalPerSecond.toFixed(6)}</p>
            <p className="text-[10px] text-muted-foreground">total</p>
          </div>
        </div>
      </div>

      {/* Claim all */}
      {totalPending > 0n && (
        <div className="rounded-2xl border border-yellow-500/30 bg-gradient-to-br from-yellow-950/30 to-transparent p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                <p className="text-xs text-yellow-400/70 uppercase tracking-wider">Rewards pendientes</p>
              </div>
              <p className="text-sm font-bold text-yellow-200">{activePkgCount} paquetes con rewards</p>
              <p className="text-xs text-yellow-400/50 mt-0.5">en múltiples tokens</p>
            </div>
            <Button size="sm" className="bg-yellow-600 hover:bg-yellow-700 text-white shrink-0 h-10 px-4" onClick={doClaimAll} disabled={claimingAll}>
              {claimingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Gift className="w-4 h-4 mr-1.5" /> Reclamar todo</>}
            </Button>
          </div>
        </div>
      )}

      {/* Block log */}
      <BlockLog active={activePkgCount > 0} perSecond={totalPerSecond} symbol={primarySymbol} />

      {/* Package grid */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">7 Paquetes · Un token diferente cada uno</p>
        </div>
        {(info?.packages ?? Array(7).fill(null)).map((pkg, i) => {
          if (!pkg) return <div key={i} className="h-32 bg-surface-2 border border-border rounded-2xl animate-pulse" />
          const userPkg = info!.userPackages[i]
          const userUnits = userPkg?.units ?? 0n
          const userDaily = info!.dailyYields[i] ?? 0n
          return (
            <WLDPackageCard
              key={i}
              pkg={pkg}
              userUnits={userUnits}
              pendingRewards={info!.pendingPerPkg[i] ?? 0n}
              userDailyYield={userDaily}
              wldBalance={info!.wldBalance}
              onBuy={() => setBuyingPkgId(pkg.id)}
              onClaim={() => doClaimPkg(pkg.id)}
              isClaiming={claimingPkgId === pkg.id}
            />
          )
        })}
      </div>

      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Gem className="w-3.5 h-3.5 text-yellow-400" />
          Minería permanente · Stacks con múltiples paquetes · 7 tokens distintos
        </div>
      </div>

      {msg && <p className={cn('text-xs text-center font-medium', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{msg}</p>}

      {buyingPkgId !== null && info && (
        <BuyDialog
          pkgId={buyingPkgId}
          priceWLD={info.packages[buyingPkgId].priceWLD}
          dailyYield={info.packages[buyingPkgId].dailyYield}
          rewardSymbol={info.packages[buyingPkgId].rewardSymbol}
          wldBalance={info.wldBalance}
          onClose={() => setBuyingPkgId(null)}
          onSuccess={() => { setBuyingPkgId(null); load() }}
        />
      )}
    </div>
  )
}
