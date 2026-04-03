'use client'

import { useState, useCallback, useEffect } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { Pickaxe, Loader2, Gift, RefreshCw, ChevronRight, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  MINING_UTH2_CONTRACT, PERMIT_TUPLE_INPUT, TOKENS,
  fetchMiningUTH2Info, MiningUTH2Info, MiningPackage, formatToken, randomNonce,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── MiniKit ABI for buyPackage ───────────────────────────────────────────────
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

// ─── Package names ────────────────────────────────────────────────────────────
const PKG_NAMES = ['Starter', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Elite']
const PKG_COLORS = ['#6b7280', '#b45309', '#94a3b8', '#f59e0b', '#e5e7eb', '#3b82f6', '#8b5cf6']

// ─── Package Card ─────────────────────────────────────────────────────────────
interface PackageCardProps {
  pkg: MiningPackage
  userUnits: bigint
  pendingRewards: bigint
  onBuy: (pkgId: number) => void
}

function PackageCard({ pkg, userUnits, pendingRewards, onBuy }: PackageCardProps) {
  const name = PKG_NAMES[pkg.id] || `Paquete ${pkg.id + 1}`
  const color = PKG_COLORS[pkg.id] || '#6b7280'
  const dailyH2O = ethers.formatUnits(pkg.dailyYield, 18)
  const priceUTH2 = ethers.formatUnits(pkg.priceUTH2, 18)

  return (
    <div className={cn(
      'border rounded-xl p-3 bg-surface-2 flex flex-col gap-2',
      !pkg.active && 'opacity-50 pointer-events-none',
      userUnits > 0n && 'border-primary/40'
    )} style={{ borderColor: userUnits > 0n ? color + '60' : undefined }}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: color + '22', border: `1.5px solid ${color}55` }}>
            <Pickaxe className="w-4 h-4" style={{ color }} />
          </div>
          <div>
            <p className="font-semibold text-sm text-foreground">{name}</p>
            {userUnits > 0n && (
              <p className="text-xs" style={{ color }}>×{userUnits.toString()} activos</p>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Precio</p>
          <p className="text-sm font-bold text-foreground">{parseFloat(priceUTH2).toLocaleString()} UTH₂</p>
        </div>
      </div>

      <div className="bg-background/40 rounded-lg px-3 py-2 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Producción diaria</p>
          <p className="text-sm font-bold text-green-400">+{parseFloat(dailyH2O).toLocaleString()} H2O/día</p>
        </div>
        <Zap className="w-5 h-5 text-green-500/60" />
      </div>

      {userUnits > 0n && pendingRewards > 0n && (
        <div className="text-xs text-green-400 text-center">
          Acumulado: {formatToken(pendingRewards, 18, 6)} H2O
        </div>
      )}

      <Button
        size="sm"
        className="w-full text-xs"
        style={{ background: color + '22', border: `1px solid ${color}55`, color }}
        onClick={() => onBuy(pkg.id)}
        disabled={!pkg.active}
      >
        Comprar paquete
      </Button>
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
  const [units, setUnits] = useState('1')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const totalCost = BigInt(parseInt(units) || 0) * pkg.priceUTH2
  const canAfford = uth2Balance >= totalCost && totalCost > 0n
  const name = PKG_NAMES[pkg.id] || `Paquete ${pkg.id + 1}`
  const dailyTotal = BigInt(parseInt(units) || 0) * pkg.dailyYield

  async function doBuy() {
    const u = parseInt(units)
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
            pkg.id.toString(),
            u.toString(),
            {
              permitted: { token: TOKENS.UTH2, amount: totalCost.toString() },
              nonce: nonce.toString(),
              deadline: deadline.toString(),
            },
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
        setMsg('✓ Paquete comprado exitosamente!')
        setTimeout(onSuccess, 1500)
      } else {
        setMsg('Transacción rechazada')
      }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end justify-center">
      <div className="w-full max-w-md bg-background border-t border-border rounded-t-2xl p-4 pb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-foreground">Comprar {name}</h3>
          <button onClick={onClose} className="text-muted-foreground text-xs">✕ Cerrar</button>
        </div>

        <div className="space-y-3">
          <div className="bg-surface-2 border border-border rounded-lg p-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Precio por paquete</span>
              <span className="text-foreground font-semibold">{formatToken(pkg.priceUTH2, 18)} UTH₂</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Producción diaria por paquete</span>
              <span className="text-green-400 font-semibold">+{formatToken(pkg.dailyYield, 18)} H2O</span>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Cantidad de paquetes</label>
            <input
              type="number" min="1" value={units}
              onChange={e => setUnits(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>

          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total a pagar</span>
              <span className="text-foreground font-bold">{formatToken(totalCost, 18)} UTH₂</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Producción diaria total</span>
              <span className="text-green-400 font-bold">+{formatToken(dailyTotal, 18)} H2O/día</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Tu saldo UTH₂</span>
              <span className={cn('font-medium', canAfford ? 'text-foreground' : 'text-red-400')}>{formatToken(uth2Balance, 18)}</span>
            </div>
          </div>

          <Button className="w-full" onClick={doBuy} disabled={loading || !canAfford}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Pickaxe className="w-4 h-4 mr-2" />}
            Comprar {units} paquete{parseInt(units) > 1 ? 's' : ''} — Minería permanente
          </Button>

          {msg && (
            <p className={cn('text-xs text-center', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{msg}</p>
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

  async function doClaimAll() {
    setClaiming(true); setMsg('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: MINING_UTH2_CONTRACT,
          abi: CLAIM_ABI,
          functionName: 'claimRewards',
          args: [],
        }],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ Rewards reclamadas!')
        setTimeout(load, 2000)
      } else setMsg('Transacción rechazada')
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setClaiming(false) }
  }

  const totalPending = info?.totalPending ?? 0n
  const dailyYield = info?.dailyYield ?? 0n

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Pickaxe className="w-4 h-4 text-blue-400" /> Minería H2O
          </h2>
          <p className="text-xs text-muted-foreground">Paga con UTH₂ · Mina H2O permanentemente</p>
        </div>
        <button onClick={load} disabled={loading} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Summary */}
      {(totalPending > 0n || dailyYield > 0n) && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">H2O acumulado</p>
              <p className="text-base font-bold text-green-300">{formatToken(totalPending, 18, 6)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Producción diaria</p>
              <p className="text-base font-bold text-green-300">+{formatToken(dailyYield, 18)} /día</p>
            </div>
          </div>
          {totalPending > 0n && (
            <Button size="sm" className="w-full mt-3 bg-green-600 hover:bg-green-700 text-white" onClick={doClaimAll} disabled={claiming}>
              {claiming ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />}
              Reclamar {formatToken(totalPending, 18, 4)} H2O
            </Button>
          )}
        </div>
      )}

      {/* Packages */}
      <div className="grid grid-cols-1 gap-2">
        {(info?.packages ?? Array(7).fill(null)).map((pkg, i) => {
          if (!pkg) return (
            <div key={i} className="h-24 bg-surface-2 border border-border rounded-xl animate-pulse" />
          )
          const userPkg = info?.userPackages[i]
          const pending = info?.pendingPerPkg[i] ?? 0n
          return (
            <PackageCard
              key={i}
              pkg={pkg}
              userUnits={userPkg?.units ?? 0n}
              pendingRewards={pending}
              onBuy={id => setBuyingPkg(info!.packages[id])}
            />
          )
        })}
      </div>

      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <p className="text-xs text-muted-foreground text-center">
          Minería permanente · Compra múltiples paquetes para mayor poder · El pago va directo a los dueños
        </p>
      </div>

      {msg && (
        <p className={cn('text-xs text-center', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{msg}</p>
      )}

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
