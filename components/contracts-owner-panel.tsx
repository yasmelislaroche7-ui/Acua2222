'use client'

import { useState, useCallback, useEffect } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Shield, Loader2, RefreshCw, ChevronDown, ChevronUp, UserPlus, UserMinus,
  Pause, Play, ArrowDownToLine, Plus, Database, Wallet, Package,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  STAKING_TOKENS, MINING_UTH2_CONTRACT, MINING_WLD_CONTRACT,
  getProvider, UNIVERSAL_STAKING_ABI, MINING_UTH2_ABI, MINING_WLD_ABI,
  formatToken, bpsToPercent, shortenAddress,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── ABI fragments ────────────────────────────────────────────────────────────
const SET_STAKE_FEE_ABI   = [{ name: 'setStakeFee',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bps', type: 'uint256', internalType: 'uint256' }], outputs: [] }]
const SET_UNSTAKE_FEE_ABI = [{ name: 'setUnstakeFee', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bps', type: 'uint256', internalType: 'uint256' }], outputs: [] }]
const SET_CLAIM_FEE_ABI   = [{ name: 'setClaimFee',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bps', type: 'uint256', internalType: 'uint256' }], outputs: [] }]
const ADD_OWNER_ABI       = [{ name: 'addOwner',       type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'addr', type: 'address', internalType: 'address' }], outputs: [] }]
const REMOVE_OWNER_ABI    = [{ name: 'removeOwner',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'addr', type: 'address', internalType: 'address' }], outputs: [] }]
const PAUSE_ABI           = [{ name: 'pause',          type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }]
const UNPAUSE_ABI         = [{ name: 'unpause',        type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }]
const EMERGENCY_ABI       = [{ name: 'emergencyWithdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address', internalType: 'address' }, { name: 'amount', type: 'uint256', internalType: 'uint256' }, { name: 'to', type: 'address', internalType: 'address' }], outputs: [] }]
const DEPOSIT_REWARDS_ABI = [{ name: 'depositRewards', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }], outputs: [] }]
const ERC20_APPROVE_ABI   = [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address', internalType: 'address' }, { name: 'value', type: 'uint256', internalType: 'uint256' }], outputs: [{ name: '', type: 'bool', internalType: 'bool' }] }]
const SET_MINING_OWNER_ABI = [{ name: 'setOwner', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'index', type: 'uint256', internalType: 'uint256' }, { name: 'addr', type: 'address', internalType: 'address' }], outputs: [] }]
const SET_PACKAGE_ABI     = [{ name: 'setPackage', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }, { name: 'price', type: 'uint256', internalType: 'uint256' }, { name: 'dailyYield', type: 'uint256', internalType: 'uint256' }, { name: 'active', type: 'bool', internalType: 'bool' }], outputs: [] }]

// ─── Generic send helper ──────────────────────────────────────────────────────
async function sendTx(transactions: any[], onMsg: (m: string) => void) {
  try {
    onMsg('Enviando...')
    const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({ transaction: transactions })
    onMsg(finalPayload.status === 'success' ? '✓ Confirmado' : 'Rechazado')
    return finalPayload.status === 'success'
  } catch (e: any) { onMsg(e.message || 'Error'); return false }
}

// ─── Global Summary ───────────────────────────────────────────────────────────
function GlobalSummary() {
  const [balances, setBalances] = useState<{ symbol: string; balance: bigint; decimals: number; color: string }[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = getProvider()
      const results = await Promise.allSettled(
        STAKING_TOKENS.map(async t => {
          const c = new ethers.Contract(t.stakingContract, UNIVERSAL_STAKING_ABI, p)
          const bal = await c.contractTokenBalance()
          return { symbol: t.symbol, balance: bal, decimals: t.decimals, color: t.color }
        })
      )
      setBalances(results.filter(r => r.status === 'fulfilled').map(r => (r as any).value))
    } catch { }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <p className="text-xs font-bold text-foreground uppercase tracking-wider">Saldos de Contratos</p>
        </div>
        <button onClick={load} disabled={loading} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {balances.map(b => (
          <div key={b.symbol} className="flex items-center justify-between bg-background/50 rounded-lg px-2 py-1.5">
            <span className="text-xs font-semibold" style={{ color: b.color }}>{b.symbol}</span>
            <span className="text-xs font-mono text-foreground">{formatToken(b.balance, b.decimals, 2)}</span>
          </div>
        ))}
        {balances.length === 0 && loading && (
          <div className="col-span-2 flex justify-center py-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Staking Contract Admin ───────────────────────────────────────────────────
function StakingContractAdmin({ token, contractAddr, isOpen, onToggle }: {
  token: typeof STAKING_TOKENS[0]
  contractAddr: string
  isOpen: boolean
  onToggle: () => void
}) {
  const [info, setInfo] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [newOwner, setNewOwner] = useState('')
  const [rmOwner, setRmOwner] = useState('')
  const [stakeFee, setStakeFee] = useState('')
  const [unstakeFee, setUnstakeFee] = useState('')
  const [claimFee, setClaimFee] = useState('')
  const [ewToken, setEwToken] = useState('')
  const [ewAmount, setEwAmount] = useState('')
  const [ewTo, setEwTo] = useState('')
  const [depositAmt, setDepositAmt] = useState('')
  const [depositing, setDepositing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = getProvider()
      const c = new ethers.Contract(contractAddr, UNIVERSAL_STAKING_ABI, p)
      const [owners, sf, uf, cf, totalStaked, paused, apy, balance] = await Promise.all([
        c.getOwners(), c.stakeFeeBps(), c.unstakeFeeBps(), c.claimFeeBps(),
        c.totalStaked(), c.paused(), c.apyBps(), c.contractTokenBalance(),
      ])
      setInfo({ owners, stakeFee: sf, unstakeFee: uf, claimFee: cf, totalStaked, paused, apy, balance })
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [contractAddr])

  useEffect(() => { if (isOpen) load() }, [isOpen, load])

  const act = (fn: string, abi: any[], args: any[]) =>
    sendTx([{ address: contractAddr, abi, functionName: fn, args }], m => { setMsg(m); if (m.startsWith('✓')) load() })

  // Fund with approve + depositRewards in one batch
  const doFund = async () => {
    if (!depositAmt) return setMsg('Ingresa monto')
    setDepositing(true); setMsg('')
    try {
      const amtWei = ethers.parseUnits(depositAmt, token.decimals).toString()
      const ok = await sendTx([
        { address: token.address, abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [contractAddr, amtWei] },
        { address: contractAddr, abi: DEPOSIT_REWARDS_ABI, functionName: 'depositRewards', args: [amtWei] },
      ], m => setMsg(m))
      if (ok) { setDepositAmt(''); load() }
    } finally { setDepositing(false) }
  }

  if (!isOpen) return (
    <button onClick={onToggle} className="w-full flex items-center justify-between p-3 bg-surface-2 border border-border rounded-xl text-left hover:border-primary/40 transition-colors">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ background: token.color + '22', color: token.color }}>{token.symbol.slice(0, 3)}</div>
        <span className="text-sm font-medium">{token.symbol} Staking</span>
      </div>
      <ChevronDown className="w-4 h-4 text-muted-foreground" />
    </button>
  )

  return (
    <div className="border border-primary/30 rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-3 bg-primary/10 text-left">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: token.color + '22', color: token.color }}>{token.symbol.slice(0, 3)}</div>
          <span className="text-sm font-bold">{token.symbol} Staking</span>
          {info?.paused && <span className="text-xs text-red-400 bg-red-400/20 px-1.5 rounded">PAUSADO</span>}
        </div>
        <ChevronUp className="w-4 h-4 text-primary" />
      </button>

      <div className="p-3 space-y-4">
        {loading && <div className="flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}

        {info && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div className="bg-surface-2 rounded-lg p-2">
                <p className="text-muted-foreground">APY actual</p>
                <p className="font-bold text-primary">{bpsToPercent(info.apy)}</p>
              </div>
              <div className="bg-surface-2 rounded-lg p-2">
                <p className="text-muted-foreground">Total staked</p>
                <p className="font-bold">{formatToken(info.totalStaked, token.decimals, 2)} {token.symbol}</p>
              </div>
              <div className="bg-surface-2 rounded-lg p-2">
                <p className="text-muted-foreground">Saldo fondo</p>
                <p className="font-bold text-green-400">{formatToken(info.balance, token.decimals, 4)} {token.symbol}</p>
              </div>
              <div className="bg-surface-2 rounded-lg p-2">
                <p className="text-muted-foreground">Fees S/U/C</p>
                <p className="font-bold text-xs">{bpsToPercent(info.stakeFee)} · {bpsToPercent(info.unstakeFee)} · {bpsToPercent(info.claimFee)}</p>
              </div>
            </div>

            {/* Owners */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Owners</p>
              <div className="space-y-1">
                {(info.owners as string[]).filter(o => o !== ethers.ZeroAddress).map((o: string, i: number) => (
                  <div key={o} className="flex items-center gap-2 bg-surface-2 rounded px-2 py-1">
                    <span className="text-xs text-muted-foreground">[{i}]</span>
                    <span className="text-xs font-mono flex-1">{shortenAddress(o)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Add/Remove owner */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <input value={newOwner} onChange={e => setNewOwner(e.target.value)} placeholder="Add owner address"
                  className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <Button size="sm" className="w-full text-xs h-7" onClick={() => act('addOwner', ADD_OWNER_ABI, [newOwner])}>
                  <UserPlus className="w-3 h-3 mr-1" /> Agregar
                </Button>
              </div>
              <div className="space-y-1">
                <input value={rmOwner} onChange={e => setRmOwner(e.target.value)} placeholder="Remove owner address"
                  className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <Button size="sm" variant="destructive" className="w-full text-xs h-7" onClick={() => act('removeOwner', REMOVE_OWNER_ABI, [rmOwner])}>
                  <UserMinus className="w-3 h-3 mr-1" /> Eliminar
                </Button>
              </div>
            </div>

            {/* Fund contract */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                <Wallet className="w-3 h-3" /> Fondear contrato (approve + deposit)
              </p>
              <div className="flex gap-2">
                <input value={depositAmt} onChange={e => setDepositAmt(e.target.value)} placeholder={`Cantidad ${token.symbol}`}
                  className="flex-1 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <Button size="sm" className="text-xs h-8 bg-green-700 hover:bg-green-600" onClick={doFund} disabled={depositing}>
                  {depositing ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Plus className="w-3 h-3 mr-1" /> Fondear</>}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Aprueba + deposita en una sola transacción</p>
            </div>

            {/* Fees */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Fees (BPS)</p>
              <div className="grid grid-cols-3 gap-1">
                <div className="space-y-1">
                  <input value={stakeFee} onChange={e => setStakeFee(e.target.value)} placeholder="Stake BPS"
                    className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  <Button size="sm" className="w-full text-xs h-7" onClick={() => act('setStakeFee', SET_STAKE_FEE_ABI, [stakeFee])}>Stake</Button>
                </div>
                <div className="space-y-1">
                  <input value={unstakeFee} onChange={e => setUnstakeFee(e.target.value)} placeholder="Unstake BPS"
                    className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  <Button size="sm" className="w-full text-xs h-7" onClick={() => act('setUnstakeFee', SET_UNSTAKE_FEE_ABI, [unstakeFee])}>Unstake</Button>
                </div>
                <div className="space-y-1">
                  <input value={claimFee} onChange={e => setClaimFee(e.target.value)} placeholder="Claim BPS"
                    className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  <Button size="sm" className="w-full text-xs h-7" onClick={() => act('setClaimFee', SET_CLAIM_FEE_ABI, [claimFee])}>Claim</Button>
                </div>
              </div>
            </div>

            {/* Pause */}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => act('pause', PAUSE_ABI, [])}>
                <Pause className="w-3 h-3 mr-1" /> Pausar
              </Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => act('unpause', UNPAUSE_ABI, [])}>
                <Play className="w-3 h-3 mr-1" /> Reanudar
              </Button>
            </div>

            {/* Emergency */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Emergency Withdraw</p>
              <div className="space-y-1">
                <input value={ewToken} onChange={e => setEwToken(e.target.value)} placeholder="Token address"
                  className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <div className="grid grid-cols-2 gap-1">
                  <input value={ewAmount} onChange={e => setEwAmount(e.target.value)} placeholder="Amount (wei)"
                    className="text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  <input value={ewTo} onChange={e => setEwTo(e.target.value)} placeholder="To address"
                    className="text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                </div>
                <Button size="sm" variant="destructive" className="w-full text-xs h-7" onClick={() => act('emergencyWithdraw', EMERGENCY_ABI, [ewToken, ewAmount, ewTo])}>
                  <ArrowDownToLine className="w-3 h-3 mr-1" /> Emergency Withdraw
                </Button>
              </div>
            </div>
          </>
        )}
        {msg && <p className={cn('text-xs text-center font-medium', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{msg}</p>}
      </div>
    </div>
  )
}

// ─── Mining Contract Admin ────────────────────────────────────────────────────
const MINING_PKG_NAMES_UTH2 = ['Starter', 'Bronce', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Elite']
const MINING_PKG_NAMES_WLD  = ['H2O Mine', 'Fire Mine', 'BTC Mine', 'WLD Mine', 'ARS Mine', 'COP Mine', 'UTH₂ Mine']

function MiningAdmin({ label, contractAddr, token0Symbol, isUTH2 }: { label: string; contractAddr: string; token0Symbol: string; isUTH2: boolean }) {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [ownerIdx, setOwnerIdx] = useState('0')
  const [ownerAddr, setOwnerAddr] = useState('')
  const [pkgId, setPkgId] = useState('0')
  const [pkgPrice, setPkgPrice] = useState('')
  const [pkgAnnualYield, setPkgAnnualYield] = useState('')
  const [pkgActive, setPkgActive] = useState('true')
  const [ewToken, setEwToken] = useState('')
  const [ewAmount, setEwAmount] = useState('')
  const [ewTo, setEwTo] = useState('')

  const pkgNames = isUTH2 ? MINING_PKG_NAMES_UTH2 : MINING_PKG_NAMES_WLD

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = getProvider()
      const abi = isUTH2 ? MINING_UTH2_ABI : MINING_WLD_ABI
      const c = new ethers.Contract(contractAddr, abi, p)
      const [pkgs, owner0, owner1, paused] = await Promise.all([
        c.getAllPackages(), c.owners(0), c.owners(1), c.paused(),
      ])
      setInfo({ pkgs, owners: [owner0, owner1], paused })
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [contractAddr, isUTH2])

  useEffect(() => { if (open) load() }, [open, load])

  const act = (fn: string, abi: any[], args: any[]) =>
    sendTx([{ address: contractAddr, abi, functionName: fn, args }], m => { setMsg(m); if (m.startsWith('✓')) load() })

  // Package info display
  const getPkgInfo = (pkg: any, i: number) => {
    if (!pkg) return null
    const isUTH2pkg = isUTH2
    const price = parseFloat(ethers.formatUnits(isUTH2pkg ? pkg.priceUTH2 : pkg.priceWLD, 18))
    const daily = parseFloat(ethers.formatUnits(isUTH2pkg ? pkg.dailyH2OYield : pkg.dailyYield, 18))
    const annual = daily * 365
    return { price, daily, annual, active: pkg.active, name: pkgNames[i] || `Pkg ${i}` }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="w-full flex items-center justify-between p-3 bg-surface-2 border border-border rounded-xl text-left hover:border-primary/40 transition-colors">
      <div className="flex items-center gap-2">
        <Package className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <ChevronDown className="w-4 h-4 text-muted-foreground" />
    </button>
  )

  return (
    <div className="border border-primary/30 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(false)} className="w-full flex items-center justify-between p-3 bg-primary/10 text-left">
        <span className="text-sm font-bold">{label}</span>
        <ChevronUp className="w-4 h-4 text-primary" />
      </button>
      <div className="p-3 space-y-4">
        {loading && <div className="flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}
        {info && (
          <>
            {/* Owners */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Owners</p>
              {info.owners.map((o: string, i: number) => (
                <div key={i} className="flex items-center gap-2 bg-surface-2 rounded px-2 py-1 mb-1">
                  <span className="text-xs text-muted-foreground">[{i}]</span>
                  <span className="text-xs font-mono">{shortenAddress(o)}</span>
                </div>
              ))}
            </div>

            {/* Change owner */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Cambiar owner</p>
              <div className="flex gap-1">
                <input value={ownerIdx} onChange={e => setOwnerIdx(e.target.value)} placeholder="Idx (0/1)"
                  className="w-16 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <input value={ownerAddr} onChange={e => setOwnerAddr(e.target.value)} placeholder="Nueva dirección"
                  className="flex-1 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <Button size="sm" className="text-xs h-8" onClick={() => act('setOwner', SET_MINING_OWNER_ABI, [ownerIdx, ownerAddr])}>Set</Button>
              </div>
            </div>

            {/* Current packages table */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                <Package className="w-3 h-3" /> Paquetes actuales
              </p>
              <div className="space-y-1.5">
                {(info.pkgs as any[]).map((pkg: any, i: number) => {
                  const d = getPkgInfo(pkg, i)
                  if (!d) return null
                  return (
                    <div key={i} className={cn('flex items-center justify-between text-xs px-2 py-1.5 rounded-lg bg-surface-2 border',
                      d.active ? 'border-green-500/20' : 'border-red-500/20 opacity-60')}>
                      <div className="flex items-center gap-2">
                        <span className={cn('w-1.5 h-1.5 rounded-full', d.active ? 'bg-green-400' : 'bg-red-400')} />
                        <span className="font-semibold">{d.name}</span>
                      </div>
                      <div className="flex gap-3 text-muted-foreground">
                        <span>{d.price.toLocaleString()} {token0Symbol}</span>
                        <span className="text-green-400">+{d.daily.toFixed(4)}/día</span>
                        <span className="text-purple-400">≈{d.annual.toFixed(0)}/año</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Set package */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Configurar paquete</p>
              <div className="space-y-1.5">
                <div className="grid grid-cols-3 gap-1">
                  <div>
                    <label className="text-[10px] text-muted-foreground">ID (0-6)</label>
                    <input value={pkgId} onChange={e => setPkgId(e.target.value)}
                      className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Precio ({token0Symbol})</label>
                    <input value={pkgPrice} onChange={e => setPkgPrice(e.target.value)} placeholder="ej: 100"
                      className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Estado</label>
                    <select value={pkgActive} onChange={e => setPkgActive(e.target.value)}
                      className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground">
                      <option value="true">Activo</option>
                      <option value="false">Inactivo</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-1 items-end">
                  <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground">Yield ANUAL (se divide /365 para diario)</label>
                    <input value={pkgAnnualYield} onChange={e => setPkgAnnualYield(e.target.value)} placeholder="ej: 365 = 1/día"
                      className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  </div>
                  <div className="text-[10px] text-muted-foreground pb-1.5 shrink-0">
                    {pkgAnnualYield ? `→ ${(parseFloat(pkgAnnualYield) / 365).toFixed(6)}/día` : ''}
                  </div>
                </div>
                <Button size="sm" className="w-full text-xs" onClick={() => {
                  const price = ethers.parseUnits(pkgPrice || '0', 18).toString()
                  const annualFloat = parseFloat(pkgAnnualYield || '0')
                  const dailyYield = ethers.parseUnits((annualFloat / 365).toFixed(18).slice(0, 20), 18).toString()
                  act('setPackage', SET_PACKAGE_ABI, [pkgId, price, dailyYield, pkgActive === 'true'])
                }}>
                  <Package className="w-3 h-3 mr-1" /> Actualizar paquete
                </Button>
              </div>
            </div>

            {/* Pause */}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => act('pause', PAUSE_ABI, [])}>
                <Pause className="w-3 h-3 mr-1" /> Pausar
              </Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => act('unpause', UNPAUSE_ABI, [])}>
                <Play className="w-3 h-3 mr-1" /> Reanudar
              </Button>
            </div>

            {/* Emergency */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Emergency Withdraw</p>
              <div className="space-y-1">
                <input value={ewToken} onChange={e => setEwToken(e.target.value)} placeholder="Token address"
                  className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <div className="flex gap-1">
                  <input value={ewAmount} onChange={e => setEwAmount(e.target.value)} placeholder="Amount (wei)"
                    className="flex-1 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  <input value={ewTo} onChange={e => setEwTo(e.target.value)} placeholder="To"
                    className="flex-1 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                </div>
                <Button size="sm" variant="destructive" className="w-full text-xs h-7" onClick={() => act('emergencyWithdraw', EMERGENCY_ABI, [ewToken, ewAmount, ewTo])}>
                  <ArrowDownToLine className="w-3 h-3 mr-1" /> Emergency Withdraw
                </Button>
              </div>
            </div>
          </>
        )}
        {msg && <p className={cn('text-xs text-center font-medium', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{msg}</p>}
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function ContractsOwnerPanel({ userAddress }: { userAddress: string }) {
  const [openContract, setOpenContract] = useState<string | null>(null)
  const toggle = (key: string) => setOpenContract(prev => prev === key ? null : key)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="w-5 h-5 text-primary" />
        <h2 className="text-base font-bold text-foreground">Panel de Admin</h2>
      </div>

      {/* Global summary */}
      <GlobalSummary />

      {/* Staking contracts */}
      <div className="space-y-2 pt-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Staking Contracts</p>
        {STAKING_TOKENS.map(token => (
          <StakingContractAdmin
            key={token.symbol}
            token={token}
            contractAddr={token.stakingContract}
            isOpen={openContract === token.symbol}
            onToggle={() => toggle(token.symbol)}
          />
        ))}
      </div>

      {/* Mining contracts */}
      <div className="space-y-2 pt-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mining Contracts</p>
        <MiningAdmin label="Minería H2O (UTH₂ → H2O)" contractAddr={MINING_UTH2_CONTRACT} token0Symbol="UTH2" isUTH2={true} />
        <MiningAdmin label="Minería Multi-Token (WLD → Varios)" contractAddr={MINING_WLD_CONTRACT} token0Symbol="WLD" isUTH2={false} />
      </div>

      <div className="rounded-xl border border-border bg-surface-2 p-3 mt-4">
        <p className="text-xs text-muted-foreground text-center">
          Contratos TIME: no se puede fondear directamente (solo vía miningAddress) · World Chain (480)
        </p>
      </div>
    </div>
  )
}
