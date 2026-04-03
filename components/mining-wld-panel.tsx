'use client'

import { useState, useCallback, useEffect } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { Pickaxe, Loader2, Gift, RefreshCw, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  MINING_WLD_CONTRACT, PERMIT_TUPLE_INPUT, TOKENS,
  fetchMiningWLDInfo, MiningWLDInfo, formatToken, randomNonce, MINING_WLD_REWARD_NAMES,
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

const CLAIM_ALL_ABI = [{
  name: 'claimAllRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

const CLAIM_PKG_ABI = [{
  name: 'claimPackageRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'packageId', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// ─── Package metadata ─────────────────────────────────────────────────────────
const PKG_CONFIG = [
  { name: 'H2O Mine',    color: '#06b6d4', icon: '💧' },
  { name: 'Fire Mine',   color: '#f97316', icon: '🔥' },
  { name: 'BTC Mine',    color: '#f59e0b', icon: '₿'  },
  { name: 'WLD Mine',    color: '#3b82f6', icon: '🌐' },
  { name: 'ARS Mine',    color: '#10b981', icon: '🏛'  },
  { name: 'COP Mine',    color: '#fbbf24', icon: '🦅' },
  { name: 'UTH₂ Mine',  color: '#8b5cf6', icon: '⚡' },
]

// ─── Package Card ─────────────────────────────────────────────────────────────
interface WLDPackageCardProps {
  pkg: { id: number; priceWLD: bigint; dailyYield: bigint; active: boolean; rewardSymbol: string }
  userUnits: bigint
  pendingRewards: bigint
  dailyYield: bigint
  wldBalance: bigint
  onBuy: () => void
  onClaim: () => void
  isClaiming: boolean
}

function WLDPackageCard({ pkg, userUnits, pendingRewards, dailyYield, wldBalance, onBuy, onClaim, isClaiming }: WLDPackageCardProps) {
  const cfg = PKG_CONFIG[pkg.id] || { name: `Paquete ${pkg.id + 1}`, color: '#6b7280', icon: '⛏' }

  return (
    <div className={cn(
      'border rounded-xl p-3 bg-surface-2 space-y-2',
      userUnits > 0n ? 'border-primary/40' : 'border-border',
    )} style={{ borderColor: userUnits > 0n ? cfg.color + '60' : undefined }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm" style={{ background: cfg.color + '22', border: `1.5px solid ${cfg.color}55` }}>
            {cfg.icon}
          </div>
          <div>
            <p className="font-semibold text-sm text-foreground">{cfg.name}</p>
            <p className="text-xs text-muted-foreground">Rewards en {pkg.rewardSymbol}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold text-foreground">{formatToken(pkg.priceWLD, 18, 2)} WLD</p>
          {userUnits > 0n && <p className="text-xs" style={{ color: cfg.color }}>×{userUnits.toString()}</p>}
        </div>
      </div>

      <div className="bg-background/40 rounded-lg px-3 py-1.5 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Diario por paquete</p>
          <p className="text-sm font-bold text-green-400">+{formatToken(pkg.dailyYield, 18, 2)} {pkg.rewardSymbol}/día</p>
        </div>
        {userUnits > 0n && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Tu producción</p>
            <p className="text-xs font-bold text-green-300">+{formatToken(dailyYield, 18, 4)}/día</p>
          </div>
        )}
      </div>

      {pendingRewards > 0n && (
        <div className="flex items-center justify-between bg-green-500/10 rounded-lg px-2 py-1.5">
          <span className="text-xs text-green-400">Acumulado: {formatToken(pendingRewards, 18, 6)} {pkg.rewardSymbol}</span>
          <Button size="sm" variant="ghost" className="text-green-400 h-6 px-2 text-xs" onClick={onClaim} disabled={isClaiming}>
            {isClaiming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Gift className="w-3 h-3 mr-1" />}
            Reclamar
          </Button>
        </div>
      )}

      <Button
        size="sm" className="w-full text-xs"
        style={{ background: cfg.color + '22', border: `1px solid ${cfg.color}55`, color: cfg.color }}
        onClick={onBuy}
        disabled={!pkg.active}
      >
        <Pickaxe className="w-3 h-3 mr-1" />
        Comprar paquete
      </Button>
    </div>
  )
}

// ─── Buy Dialog ───────────────────────────────────────────────────────────────
interface BuyDialogProps {
  pkgId: number
  priceWLD: bigint
  dailyYield: bigint
  rewardSymbol: string
  wldBalance: bigint
  onClose: () => void
  onSuccess: () => void
}

function BuyDialog({ pkgId, priceWLD, dailyYield, rewardSymbol, wldBalance, onClose, onSuccess }: BuyDialogProps) {
  const [units, setUnits] = useState('1')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const u = parseInt(units) || 0
  const totalCost = BigInt(u) * priceWLD
  const canAfford = wldBalance >= totalCost && totalCost > 0n
  const cfg = PKG_CONFIG[pkgId] || { name: `Paquete ${pkgId + 1}`, color: '#6b7280', icon: '⛏' }

  async function doBuy() {
    if (!u || u <= 0) return setMsg('Ingresa una cantidad válida')
    if (!canAfford) return setMsg('Saldo WLD insuficiente')
    setLoading(true); setMsg('')
    try {
      const nonce = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: MINING_WLD_CONTRACT,
          abi: BUY_PKG_ABI,
          functionName: 'buyPackage',
          args: [
            pkgId.toString(),
            u.toString(),
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
        setMsg('✓ Paquete comprado!')
        setTimeout(onSuccess, 1500)
      } else setMsg('Transacción rechazada')
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end justify-center">
      <div className="w-full max-w-md bg-background border-t border-border rounded-t-2xl p-4 pb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold" style={{ color: cfg.color }}>{cfg.icon} {cfg.name}</h3>
          <button onClick={onClose} className="text-muted-foreground text-xs">✕ Cerrar</button>
        </div>
        <div className="space-y-3">
          <div className="bg-surface-2 border border-border rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Precio por paquete</span>
              <span className="font-semibold text-foreground">{formatToken(priceWLD, 18)} WLD</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Producción diaria por paquete</span>
              <span className="font-semibold text-green-400">+{formatToken(dailyYield, 18)} {rewardSymbol}</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Cantidad de paquetes</label>
            <input type="number" min="1" value={units} onChange={e => setUnits(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary" />
          </div>
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total WLD</span>
              <span className="font-bold text-foreground">{formatToken(totalCost, 18)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Producción diaria total</span>
              <span className="font-bold text-green-400">+{formatToken(BigInt(u) * dailyYield, 18)} {rewardSymbol}/día</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Tu saldo WLD</span>
              <span className={cn('font-medium', canAfford ? 'text-foreground' : 'text-red-400')}>{formatToken(wldBalance, 18)}</span>
            </div>
          </div>
          <Button className="w-full" onClick={doBuy} disabled={loading || !canAfford}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Pickaxe className="w-4 h-4 mr-2" />}
            Comprar {units} paquete{u > 1 ? 's' : ''} — Minería permanente
          </Button>
          {msg && <p className={cn('text-xs text-center', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{msg}</p>}
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
  const hasAnyMining = info?.userPackages.some(p => p.units > 0n) ?? false

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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Star className="w-4 h-4 text-yellow-400" /> Minería Multi-Token
          </h2>
          <p className="text-xs text-muted-foreground">Paga con WLD · Mina 7 tokens diferentes</p>
        </div>
        <button onClick={load} disabled={loading} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {hasAnyMining && totalPending > 0n && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
          <p className="text-xs text-yellow-300 mb-2">Tienes rewards pendientes en múltiples paquetes</p>
          <Button size="sm" className="w-full bg-yellow-600 hover:bg-yellow-700 text-white" onClick={doClaimAll} disabled={claimingAll}>
            {claimingAll ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />}
            Reclamar todas las rewards
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {(info?.packages ?? Array(7).fill(null)).map((pkg, i) => {
          if (!pkg) return <div key={i} className="h-28 bg-surface-2 border border-border rounded-xl animate-pulse" />
          const userPkg = info?.userPackages[i]
          return (
            <WLDPackageCard
              key={i}
              pkg={pkg}
              userUnits={userPkg?.units ?? 0n}
              pendingRewards={info?.pendingPerPkg[i] ?? 0n}
              dailyYield={info?.dailyYields[i] ?? 0n}
              wldBalance={info?.wldBalance ?? 0n}
              onBuy={() => setBuyingPkgId(pkg.id)}
              onClaim={() => doClaimPkg(pkg.id)}
              isClaiming={claimingPkgId === pkg.id}
            />
          )
        })}
      </div>

      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <p className="text-xs text-muted-foreground text-center">
          Minería permanente · Cada paquete mina un token diferente · Reclama individual o todo junto
        </p>
      </div>

      {msg && <p className={cn('text-xs text-center', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{msg}</p>}

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
