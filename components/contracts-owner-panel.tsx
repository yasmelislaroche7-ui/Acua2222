'use client'

import { useState, useCallback, useEffect } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { Shield, Loader2, RefreshCw, ChevronDown, ChevronUp, UserPlus, UserMinus, Pause, Play, ArrowDownToLine, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  STAKING_TOKENS, STAKING_CONTRACTS, MINING_UTH2_CONTRACT, MINING_WLD_CONTRACT,
  getProvider, UNIVERSAL_STAKING_ABI, MINING_UTH2_ABI, MINING_WLD_ABI,
  formatToken, bpsToPercent, shortenAddress,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── Generic ABI fragments ────────────────────────────────────────────────────
const SET_STAKE_FEE_ABI = [{ name: 'setStakeFee',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bps', type: 'uint256', internalType: 'uint256' }], outputs: [] }]
const SET_UNSTAKE_FEE_ABI = [{ name: 'setUnstakeFee', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bps', type: 'uint256', internalType: 'uint256' }], outputs: [] }]
const SET_CLAIM_FEE_ABI = [{ name: 'setClaimFee',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bps', type: 'uint256', internalType: 'uint256' }], outputs: [] }]
const ADD_OWNER_ABI = [{ name: 'addOwner',     type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'addr', type: 'address', internalType: 'address' }], outputs: [] }]
const REMOVE_OWNER_ABI = [{ name: 'removeOwner',  type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'addr', type: 'address', internalType: 'address' }], outputs: [] }]
const PAUSE_ABI = [{ name: 'pause',       type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }]
const UNPAUSE_ABI = [{ name: 'unpause',     type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }]
const EMERGENCY_ABI = [{ name: 'emergencyWithdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address', internalType: 'address' }, { name: 'amount', type: 'uint256', internalType: 'uint256' }, { name: 'to', type: 'address', internalType: 'address' }], outputs: [] }]
const DEPOSIT_REWARDS_ABI = [{ name: 'depositRewards', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }], outputs: [] }]

const SET_MINING_OWNER_ABI = [{ name: 'setOwner', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'index', type: 'uint256', internalType: 'uint256' }, { name: 'addr', type: 'address', internalType: 'address' }], outputs: [] }]
const SET_PACKAGE_ABI = [{ name: 'setPackage', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }, { name: 'price', type: 'uint256', internalType: 'uint256' }, { name: 'dailyYield', type: 'uint256', internalType: 'uint256' }, { name: 'active', type: 'bool', internalType: 'bool' }], outputs: [] }]

async function call(contractAddr: string, abi: any[], fn: string, args: any[], msg: () => void, done: (m: string) => void) {
  try {
    msg()
    const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
      transaction: [{ address: contractAddr, abi, functionName: fn, args }],
    })
    if (finalPayload.status === 'success') done('✓ Transacción confirmada')
    else done('Transacción rechazada')
  } catch (e: any) { done(e.message || 'Error') }
}

// ─── Staking Contract Section ─────────────────────────────────────────────────
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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = getProvider()
      const c = new ethers.Contract(contractAddr, UNIVERSAL_STAKING_ABI, p)
      const [owners, stakeFee, unstakeFee, claimFee, totalStaked, paused, apy, balance] = await Promise.all([
        c.getOwners(), c.stakeFeeBps(), c.unstakeFeeBps(), c.claimFeeBps(),
        c.totalStaked(), c.paused(), c.apyBps(), c.contractTokenBalance(),
      ])
      setInfo({ owners, stakeFee, unstakeFee, claimFee, totalStaked, paused, apy, balance })
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [contractAddr])

  useEffect(() => { if (isOpen) load() }, [isOpen, load])

  const act = (fn: string, abi: any[], args: any[]) =>
    call(contractAddr, abi, fn, args, () => setMsg('Enviando...'), (m) => { setMsg(m); load() })

  if (!isOpen) return (
    <button onClick={onToggle} className="w-full flex items-center justify-between p-3 bg-surface-2 border border-border rounded-xl text-left hover:border-primary/40">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: token.color + '22', color: token.color }}>{token.symbol.slice(0, 3)}</div>
        <span className="text-sm font-medium">{token.symbol} Staking</span>
      </div>
      <ChevronDown className="w-4 h-4 text-muted-foreground" />
    </button>
  )

  return (
    <div className="border border-primary/30 rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-3 bg-primary/10 text-left">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: token.color + '22', color: token.color }}>{token.symbol.slice(0, 3)}</div>
          <span className="text-sm font-bold">{token.symbol} Staking</span>
          {info?.paused && <span className="text-xs text-red-400 bg-red-400/20 px-1 rounded">PAUSED</span>}
        </div>
        <ChevronUp className="w-4 h-4 text-primary" />
      </button>

      <div className="p-3 space-y-4">
        {loading && <div className="flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}

        {info && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-surface-2 rounded-lg p-2">
                <p className="text-muted-foreground">APY</p>
                <p className="font-bold">{bpsToPercent(info.apy)}</p>
              </div>
              <div className="bg-surface-2 rounded-lg p-2">
                <p className="text-muted-foreground">Total Staked</p>
                <p className="font-bold">{formatToken(info.totalStaked, token.decimals, 2)}</p>
              </div>
              <div className="bg-surface-2 rounded-lg p-2">
                <p className="text-muted-foreground">Balance contrato</p>
                <p className="font-bold">{formatToken(info.balance, token.decimals, 2)}</p>
              </div>
              <div className="bg-surface-2 rounded-lg p-2">
                <p className="text-muted-foreground">Fees</p>
                <p className="font-bold">{bpsToPercent(info.stakeFee)} / {bpsToPercent(info.unstakeFee)} / {bpsToPercent(info.claimFee)}</p>
              </div>
            </div>

            {/* Owners */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Owners actuales</p>
              <div className="space-y-1">
                {(info.owners as string[]).filter(o => o !== ethers.ZeroAddress).map((o: string) => (
                  <div key={o} className="flex items-center justify-between bg-surface-2 rounded px-2 py-1">
                    <span className="text-xs font-mono">{shortenAddress(o)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Add/Remove owner */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <input value={newOwner} onChange={e => setNewOwner(e.target.value)} placeholder="Add owner address" className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <Button size="sm" className="w-full text-xs h-7" onClick={() => act('addOwner', ADD_OWNER_ABI, [newOwner])}>
                  <UserPlus className="w-3 h-3 mr-1" /> Agregar
                </Button>
              </div>
              <div className="space-y-1">
                <input value={rmOwner} onChange={e => setRmOwner(e.target.value)} placeholder="Remove owner address" className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <Button size="sm" variant="destructive" className="w-full text-xs h-7" onClick={() => act('removeOwner', REMOVE_OWNER_ABI, [rmOwner])}>
                  <UserMinus className="w-3 h-3 mr-1" /> Eliminar
                </Button>
              </div>
            </div>

            {/* Fees */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Configurar Fees (BPS)</p>
              <div className="grid grid-cols-3 gap-1">
                <div className="space-y-1">
                  <input value={stakeFee} onChange={e => setStakeFee(e.target.value)} placeholder="Stake fee" className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  <Button size="sm" className="w-full text-xs h-7" onClick={() => act('setStakeFee', SET_STAKE_FEE_ABI, [stakeFee])}>Set Stake</Button>
                </div>
                <div className="space-y-1">
                  <input value={unstakeFee} onChange={e => setUnstakeFee(e.target.value)} placeholder="Unstake fee" className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  <Button size="sm" className="w-full text-xs h-7" onClick={() => act('setUnstakeFee', SET_UNSTAKE_FEE_ABI, [unstakeFee])}>Set Unstake</Button>
                </div>
                <div className="space-y-1">
                  <input value={claimFee} onChange={e => setClaimFee(e.target.value)} placeholder="Claim fee" className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  <Button size="sm" className="w-full text-xs h-7" onClick={() => act('setClaimFee', SET_CLAIM_FEE_ABI, [claimFee])}>Set Claim</Button>
                </div>
              </div>
            </div>

            {/* Deposit Rewards */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Depositar Rewards</p>
              <div className="flex gap-2">
                <input value={depositAmt} onChange={e => setDepositAmt(e.target.value)} placeholder="Cantidad" className="flex-1 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <Button size="sm" className="text-xs h-8" onClick={() => {
                  const amt = ethers.parseUnits(depositAmt || '0', token.decimals).toString()
                  act('depositRewards', DEPOSIT_REWARDS_ABI, [amt])
                }}>
                  <Plus className="w-3 h-3 mr-1" /> Depositar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Primero aprueba el token, luego deposita</p>
            </div>

            {/* Pause/Unpause */}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => act('pause', PAUSE_ABI, [])}>
                <Pause className="w-3 h-3 mr-1" /> Pausar
              </Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => act('unpause', UNPAUSE_ABI, [])}>
                <Play className="w-3 h-3 mr-1" /> Reanudar
              </Button>
            </div>

            {/* Emergency Withdraw */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Emergency Withdraw</p>
              <div className="space-y-1">
                <input value={ewToken} onChange={e => setEwToken(e.target.value)} placeholder="Token address" className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <div className="grid grid-cols-2 gap-1">
                  <input value={ewAmount} onChange={e => setEwAmount(e.target.value)} placeholder="Amount (wei)" className="text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  <input value={ewTo} onChange={e => setEwTo(e.target.value)} placeholder="To address" className="text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                </div>
                <Button size="sm" variant="destructive" className="w-full text-xs h-7" onClick={() => act('emergencyWithdraw', EMERGENCY_ABI, [ewToken, ewAmount, ewTo])}>
                  <ArrowDownToLine className="w-3 h-3 mr-1" /> Emergency Withdraw
                </Button>
              </div>
            </div>
          </>
        )}

        {msg && <p className={cn('text-xs text-center', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{msg}</p>}
      </div>
    </div>
  )
}

// ─── Mining Admin (shared for UTH2 and WLD) ──────────────────────────────────
function MiningAdmin({ label, contractAddr, token0Symbol }: { label: string; contractAddr: string; token0Symbol: string }) {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [ownerIdx, setOwnerIdx] = useState('0')
  const [ownerAddr, setOwnerAddr] = useState('')
  const [pkgId, setPkgId] = useState('0')
  const [pkgPrice, setPkgPrice] = useState('')
  const [pkgYield, setPkgYield] = useState('')
  const [pkgActive, setPkgActive] = useState('true')
  const [ewToken, setEwToken] = useState('')
  const [ewAmount, setEwAmount] = useState('')
  const [ewTo, setEwTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = getProvider()
      const abi = contractAddr === MINING_UTH2_CONTRACT ? MINING_UTH2_ABI : MINING_WLD_ABI
      const c = new ethers.Contract(contractAddr, abi, p)
      const [pkgs, owner0, owner1, paused] = await Promise.all([
        c.getAllPackages(), c.owners(0), c.owners(1), c.paused(),
      ])
      setInfo({ pkgs, owners: [owner0, owner1], paused })
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [contractAddr])

  useEffect(() => { if (open) load() }, [open, load])

  const act = (fn: string, abi: any[], args: any[]) =>
    call(contractAddr, abi, fn, args, () => setMsg('Enviando...'), (m) => { setMsg(m); load() })

  if (!open) return (
    <button onClick={() => setOpen(true)} className="w-full flex items-center justify-between p-3 bg-surface-2 border border-border rounded-xl text-left hover:border-primary/40">
      <span className="text-sm font-medium">{label}</span>
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
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Owners</p>
              {info.owners.map((o: string, i: number) => (
                <p key={i} className="text-xs font-mono">{i}: {shortenAddress(o)}</p>
              ))}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Cambiar owner</p>
              <div className="flex gap-1">
                <input value={ownerIdx} onChange={e => setOwnerIdx(e.target.value)} placeholder="Idx (0/1)" className="w-16 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <input value={ownerAddr} onChange={e => setOwnerAddr(e.target.value)} placeholder="Nueva dirección" className="flex-1 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <Button size="sm" className="text-xs h-8" onClick={() => act('setOwner', SET_MINING_OWNER_ABI, [ownerIdx, ownerAddr])}>Set</Button>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Configurar Paquetes</p>
              <div className="space-y-1">
                <div className="flex gap-1">
                  <input value={pkgId} onChange={e => setPkgId(e.target.value)} placeholder="ID (0-6)" className="w-16 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  <input value={pkgPrice} onChange={e => setPkgPrice(e.target.value)} placeholder="Precio (ether)" className="flex-1 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                </div>
                <div className="flex gap-1">
                  <input value={pkgYield} onChange={e => setPkgYield(e.target.value)} placeholder="Yield diario (ether)" className="flex-1 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  <select value={pkgActive} onChange={e => setPkgActive(e.target.value)} className="text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground">
                    <option value="true">Activo</option>
                    <option value="false">Inactivo</option>
                  </select>
                  <Button size="sm" className="text-xs h-8" onClick={() => {
                    const price = ethers.parseUnits(pkgPrice || '0', 18).toString()
                    const yld = ethers.parseUnits(pkgYield || '0', 18).toString()
                    act('setPackage', SET_PACKAGE_ABI, [pkgId, price, yld, pkgActive === 'true'])
                  }}>Set</Button>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => act('pause', PAUSE_ABI, [])}>
                <Pause className="w-3 h-3 mr-1" /> Pausar
              </Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => act('unpause', UNPAUSE_ABI, [])}>
                <Play className="w-3 h-3 mr-1" /> Reanudar
              </Button>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Emergency Withdraw</p>
              <div className="space-y-1">
                <input value={ewToken} onChange={e => setEwToken(e.target.value)} placeholder="Token address" className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                <div className="flex gap-1">
                  <input value={ewAmount} onChange={e => setEwAmount(e.target.value)} placeholder="Amount (wei)" className="flex-1 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                  <input value={ewTo} onChange={e => setEwTo(e.target.value)} placeholder="To" className="flex-1 text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-none" />
                </div>
                <Button size="sm" variant="destructive" className="w-full text-xs h-7" onClick={() => act('emergencyWithdraw', EMERGENCY_ABI, [ewToken, ewAmount, ewTo])}>
                  <ArrowDownToLine className="w-3 h-3 mr-1" /> Emergency Withdraw
                </Button>
              </div>
            </div>
          </>
        )}
        {msg && <p className={cn('text-xs text-center', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{msg}</p>}
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

      <p className="text-xs text-muted-foreground">Gestiona todos los contratos de staking y minería.</p>

      <div className="space-y-2">
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

      <div className="space-y-2 pt-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mining Contracts</p>
        <MiningAdmin label="Minería H2O (UTH₂ → H2O)" contractAddr={MINING_UTH2_CONTRACT} token0Symbol="UTH2" />
        <MiningAdmin label="Minería Multi-Token (WLD → Varios)" contractAddr={MINING_WLD_CONTRACT} token0Symbol="WLD" />
      </div>

      <div className="rounded-xl border border-border bg-surface-2 p-3 mt-4">
        <p className="text-xs text-muted-foreground text-center">
          Desplegado por: 0x54F0…e5F4 · World Chain (480)
        </p>
      </div>
    </div>
  )
}
