'use client'

import { useState, useCallback, useEffect } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Shield, Loader2, RefreshCw, Plus, Trash2, Wallet, Settings,
  Star, TrendingUp, BarChart2, Users, Percent, Database,
  ChevronDown, ChevronUp, Copy, Check, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  STAKING_CONTRACTS, STAKING_TOKENS, UNIVERSAL_STAKING_ABI,
  getProvider, formatToken, bpsToPercent, shortenAddress,
  MINING_UTH2_CONTRACT, MINING_WLD_CONTRACT,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── ABIs ────────────────────────────────────────────────────────────────────
const ADD_OWNER_ABI    = [{ name: 'addOwner',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'addr', type: 'address', internalType: 'address' }], outputs: [] }]
const REMOVE_OWNER_ABI = [{ name: 'removeOwner', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'addr', type: 'address', internalType: 'address' }], outputs: [] }]
const SET_STAKE_FEE_ABI   = [{ name: 'setStakeFee',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bps', type: 'uint256' }], outputs: [] }]
const SET_UNSTAKE_FEE_ABI = [{ name: 'setUnstakeFee', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bps', type: 'uint256' }], outputs: [] }]
const SET_CLAIM_FEE_ABI   = [{ name: 'setClaimFee',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bps', type: 'uint256' }], outputs: [] }]
const PAUSE_ABI    = [{ name: 'pause',   type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }]
const UNPAUSE_ABI  = [{ name: 'unpause', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }]
const ERC20_BAL_ABI = ['function balanceOf(address) view returns (uint256)']

const VIP_CONTRACT = '0x4cA4073b15177A5c84635158Bc9D8B9698115184'
const VIP_ABI = [
  'function isVip(address) view returns (bool)',
  'function addVip(address) external',
  'function removeVip(address) external',
  'function getVipList() view returns (address[])',
]
const H2O_TOKEN = '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d'

async function sendTx(transactions: any[], onMsg: (m: string) => void) {
  try {
    onMsg('Enviando…')
    const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({ transaction: transactions })
    const ok = finalPayload.status === 'success'
    onMsg(ok ? '✓ Confirmado' : '✗ Rechazado')
    return ok
  } catch (e: any) { onMsg(e.message || 'Error'); return false }
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3 bg-[oklch(0.13_0.022_245)] hover:bg-[oklch(0.15_0.022_245)] transition-colors"
      >
        <span className="text-[oklch(0.65_0.22_255)]">{icon}</span>
        <span className="flex-1 text-left text-sm font-bold text-foreground">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-[oklch(0.45_0.01_230)]" /> : <ChevronDown className="w-4 h-4 text-[oklch(0.45_0.01_230)]" />}
      </button>
      {open && <div className="px-4 py-3 space-y-3">{children}</div>}
    </div>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', ok ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30')}>
      {label}
    </span>
  )
}

// ─── Contract status row ──────────────────────────────────────────────────────
interface ContractStatus {
  symbol: string
  address: string
  color: string
  paused: boolean
  totalStaked: bigint
  decimals: number
  stakeFee: bigint
  unstakeFee: bigint
  claimFee: bigint
  apyBps: bigint
  owners: string[]
  balance: bigint
}

function ContractRow({ cs, userAddress }: { cs: ContractStatus; userAddress: string }) {
  const [expanded, setExpanded] = useState(false)
  const [msg, setMsg]           = useState('')
  const [loading, setLoading]   = useState(false)
  const [stakeFeeInput, setStakeFeeInput]     = useState(String(Number(cs.stakeFee)))
  const [unstakeFeeInput, setUnstakeFeeInput] = useState(String(Number(cs.unstakeFee)))
  const [claimFeeInput, setClaimFeeInput]     = useState(String(Number(cs.claimFee)))
  const [newOwner, setNewOwner]               = useState('')

  const exec = async (txs: any[]) => {
    setLoading(true)
    await sendTx(txs, setMsg)
    setLoading(false)
  }

  const feeRow = (label: string, val: bigint, input: string, setInput: (v: string) => void, abi: any[], fnName: string) => (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[oklch(0.50_0.012_230)] w-20">{label}</span>
      <span className="text-[10px] font-mono text-foreground">{bpsToPercent(val)}%</span>
      <input
        className="flex-1 bg-[oklch(0.13_0.022_245)] border border-[oklch(0.22_0.025_245)] rounded px-2 py-0.5 text-[10px] font-mono text-foreground"
        value={input} onChange={e => setInput(e.target.value)}
        placeholder="bps"
      />
      <button
        className="text-[9px] px-2 py-0.5 rounded bg-[oklch(0.65_0.22_255)]/20 text-[oklch(0.65_0.22_255)] border border-[oklch(0.65_0.22_255)]/30 hover:bg-[oklch(0.65_0.22_255)]/30"
        onClick={() => exec([{ address: cs.address, abi, functionName: fnName, args: [BigInt(input || '0')] }])}
        disabled={loading}
      >
        Set
      </button>
    </div>
  )

  return (
    <div className="rounded-lg border border-[oklch(0.20_0.022_245)] bg-[oklch(0.12_0.02_245)] overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/3 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: cs.color }} />
        <span className="text-xs font-bold text-foreground">{cs.symbol}</span>
        <StatusBadge ok={!cs.paused} label={cs.paused ? 'PAUSED' : 'LIVE'} />
        <span className="text-[9px] font-mono text-[oklch(0.45_0.01_230)] ml-auto">{shortenAddress(cs.address)}</span>
        {expanded ? <ChevronUp className="w-3 h-3 text-[oklch(0.40_0.01_230)]" /> : <ChevronDown className="w-3 h-3 text-[oklch(0.40_0.01_230)]" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-[oklch(0.18_0.02_245)]">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            {[
              { label: 'Total Staked',  val: `${formatToken(cs.totalStaked, cs.decimals)} ${cs.symbol}` },
              { label: 'Balance pool',  val: `${formatToken(cs.balance, cs.decimals)} ${cs.symbol}` },
              { label: 'APY',           val: `${bpsToPercent(cs.apyBps)}%` },
              { label: 'Stake fee',     val: `${bpsToPercent(cs.stakeFee)}%` },
              { label: 'Unstake fee',   val: `${bpsToPercent(cs.unstakeFee)}%` },
              { label: 'Claim fee',     val: `${bpsToPercent(cs.claimFee)}%` },
            ].map(r => (
              <div key={r.label} className="bg-[oklch(0.10_0.018_245)] rounded px-2 py-1.5">
                <p className="text-[9px] text-[oklch(0.45_0.01_230)]">{r.label}</p>
                <p className="text-[10px] font-bold font-mono text-foreground">{r.val}</p>
              </div>
            ))}
          </div>

          {/* Owners */}
          <div>
            <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider mb-1">Owners ({cs.owners.filter(o => o !== ethers.ZeroAddress).length})</p>
            {cs.owners.filter(o => o !== ethers.ZeroAddress).map(o => (
              <div key={o} className="flex items-center gap-2 py-0.5">
                <span className="text-[10px] font-mono text-[oklch(0.60_0.01_230)]">{shortenAddress(o)}</span>
                {o.toLowerCase() === userAddress.toLowerCase() && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-400">TÚ</span>
                )}
              </div>
            ))}
          </div>

          {/* Fees panel */}
          <div className="space-y-1.5">
            <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Comisiones (bps = 100 → 1%)</p>
            {feeRow('Stake fee', cs.stakeFee, stakeFeeInput, setStakeFeeInput, SET_STAKE_FEE_ABI, 'setStakeFee')}
            {feeRow('Unstake fee', cs.unstakeFee, unstakeFeeInput, setUnstakeFeeInput, SET_UNSTAKE_FEE_ABI, 'setUnstakeFee')}
            {feeRow('Claim fee', cs.claimFee, claimFeeInput, setClaimFeeInput, SET_CLAIM_FEE_ABI, 'setClaimFee')}
          </div>

          {/* Add owner */}
          <div>
            <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider mb-1.5">Gestionar Owners</p>
            <div className="flex gap-1.5">
              <input
                className="flex-1 bg-[oklch(0.13_0.022_245)] border border-[oklch(0.22_0.025_245)] rounded px-2 py-1 text-[10px] font-mono text-foreground"
                value={newOwner} onChange={e => setNewOwner(e.target.value)}
                placeholder="0x dirección…"
              />
              <button
                className="flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
                onClick={() => exec([{ address: cs.address, abi: ADD_OWNER_ABI, functionName: 'addOwner', args: [newOwner] }])}
                disabled={loading || !newOwner}
              >
                <Plus className="w-3 h-3" /> Add
              </button>
              <button
                className="flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                onClick={() => exec([{ address: cs.address, abi: REMOVE_OWNER_ABI, functionName: 'removeOwner', args: [newOwner] }])}
                disabled={loading || !newOwner}
              >
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            </div>
          </div>

          {/* Pause/Unpause */}
          <div className="flex gap-2">
            <button
              className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1.5 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
              onClick={() => exec([{ address: cs.address, abi: cs.paused ? UNPAUSE_ABI : PAUSE_ABI, functionName: cs.paused ? 'unpause' : 'pause', args: [] }])}
              disabled={loading}
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {cs.paused ? '▶ Reanudar' : '⏸ Pausar'}
            </button>
          </div>

          {msg && (
            <p className={cn('text-[10px] text-center px-2 py-1 rounded', msg.startsWith('✓') ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10')}>
              {msg}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Owner Wallet Section ─────────────────────────────────────────────────────
function OwnerWalletSection({ userAddress }: { userAddress: string }) {
  const [h2oBal, setH2oBal] = useState<bigint | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied]   = useState(false)

  useEffect(() => {
    const p = getProvider()
    const c = new ethers.Contract(H2O_TOKEN, ERC20_BAL_ABI, p)
    c.balanceOf(userAddress).then(setH2oBal).catch(() => {})
  }, [userAddress])

  const copy = () => {
    navigator.clipboard.writeText(userAddress).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 p-3 rounded-lg bg-[oklch(0.12_0.02_245)] border border-[oklch(0.22_0.025_245)]">
        <Wallet className="w-4 h-4 text-[oklch(0.65_0.22_255)]" />
        <div className="flex-1 min-w-0">
          <p className="text-[9px] text-[oklch(0.45_0.01_230)]">Wallet Owner</p>
          <p className="text-[10px] font-mono text-foreground truncate">{userAddress}</p>
        </div>
        <button onClick={copy} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[oklch(0.50_0.012_230)]">
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-lg bg-[oklch(0.12_0.02_245)] border border-[oklch(0.22_0.025_245)]">
          <p className="text-[9px] text-[oklch(0.45_0.01_230)]">Balance H2O</p>
          <p className="text-sm font-bold font-mono text-cyan-400">
            {h2oBal !== null ? `${formatToken(h2oBal, 18)}` : '···'}
          </p>
        </div>
        <div className="p-2.5 rounded-lg bg-[oklch(0.12_0.02_245)] border border-[oklch(0.22_0.025_245)]">
          <p className="text-[9px] text-[oklch(0.45_0.01_230)]">Red</p>
          <p className="text-sm font-bold font-mono text-blue-400">World Chain 480</p>
        </div>
      </div>
    </div>
  )
}

// ─── VIP Section ──────────────────────────────────────────────────────────────
function VipSection() {
  const [vipList, setVipList]   = useState<string[]>([])
  const [newVip, setNewVip]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [msg, setMsg]           = useState('')

  const loadVip = useCallback(async () => {
    try {
      const p = getProvider()
      const c = new ethers.Contract(VIP_CONTRACT, VIP_ABI, p)
      const list = await c.getVipList()
      setVipList(list.filter((a: string) => a !== ethers.ZeroAddress))
    } catch { setVipList([]) }
  }, [])

  useEffect(() => { loadVip() }, [loadVip])

  const exec = async (fnName: string) => {
    if (!newVip) return
    setLoading(true)
    const abi = fnName === 'addVip'
      ? [{ name: 'addVip',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'addr', type: 'address' }], outputs: [] }]
      : [{ name: 'removeVip', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'addr', type: 'address' }], outputs: [] }]
    await sendTx([{ address: VIP_CONTRACT, abi, functionName: fnName, args: [newVip] }], setMsg)
    setLoading(false)
    loadVip()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-[oklch(0.50_0.012_230)]">
          {vipList.length} wallets VIP — contrato: <span className="font-mono">{shortenAddress(VIP_CONTRACT)}</span>
        </p>
        <button onClick={loadVip} className="p-1 rounded-lg bg-white/5 hover:bg-white/10">
          <RefreshCw className="w-3 h-3 text-[oklch(0.50_0.012_230)]" />
        </button>
      </div>

      {vipList.length > 0 && (
        <div className="max-h-32 overflow-y-auto space-y-1">
          {vipList.map(addr => (
            <div key={addr} className="flex items-center gap-2 px-2 py-1.5 rounded bg-[oklch(0.12_0.02_245)] border border-[oklch(0.20_0.022_245)]">
              <Star className="w-3 h-3 text-amber-400 shrink-0" />
              <span className="text-[10px] font-mono text-foreground flex-1">{addr}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          className="flex-1 bg-[oklch(0.13_0.022_245)] border border-[oklch(0.22_0.025_245)] rounded px-2 py-1.5 text-[10px] font-mono text-foreground"
          value={newVip} onChange={e => setNewVip(e.target.value)}
          placeholder="0x dirección wallet…"
        />
      </div>
      <div className="flex gap-2">
        <button
          className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1.5 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
          onClick={() => exec('addVip')}
          disabled={loading || !newVip}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Agregar VIP
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1.5 rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25"
          onClick={() => exec('removeVip')}
          disabled={loading || !newVip}
        >
          <Trash2 className="w-3 h-3" />
          Remover VIP
        </button>
      </div>
      {msg && (
        <p className={cn('text-[10px] text-center px-2 py-1 rounded', msg.startsWith('✓') ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10')}>{msg}</p>
      )}
    </div>
  )
}

// ─── Commission Overview ──────────────────────────────────────────────────────
function CommissionOverview({ contracts }: { contracts: ContractStatus[] }) {
  const totalStaked = contracts.reduce((s, c) => s + c.totalStaked, 0n)
  const avgStakeFee = contracts.length ? contracts.reduce((s, c) => s + Number(c.stakeFee), 0) / contracts.length : 0
  const avgClaimFee = contracts.length ? contracts.reduce((s, c) => s + Number(c.claimFee), 0) / contracts.length : 0

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="p-2.5 rounded-lg bg-[oklch(0.12_0.02_245)] border border-[oklch(0.22_0.025_245)] text-center">
          <p className="text-[9px] text-[oklch(0.45_0.01_230)]">Contratos</p>
          <p className="text-lg font-black text-foreground">{contracts.length}</p>
        </div>
        <div className="p-2.5 rounded-lg bg-[oklch(0.12_0.02_245)] border border-[oklch(0.22_0.025_245)] text-center">
          <p className="text-[9px] text-[oklch(0.45_0.01_230)]">Fee Stake Prom.</p>
          <p className="text-base font-black text-amber-400">{(avgStakeFee / 100).toFixed(2)}%</p>
        </div>
        <div className="p-2.5 rounded-lg bg-[oklch(0.12_0.02_245)] border border-[oklch(0.22_0.025_245)] text-center">
          <p className="text-[9px] text-[oklch(0.45_0.01_230)]">Fee Claim Prom.</p>
          <p className="text-base font-black text-cyan-400">{(avgClaimFee / 100).toFixed(2)}%</p>
        </div>
      </div>

      <div className="rounded-lg border border-[oklch(0.22_0.025_245)] overflow-hidden">
        <div className="grid grid-cols-5 gap-0 px-3 py-1.5 bg-[oklch(0.13_0.022_245)]">
          {['Token', 'Stake%', 'Unstake%', 'Claim%', 'APY%'].map(h => (
            <span key={h} className="text-[8px] font-bold text-[oklch(0.40_0.01_230)] uppercase">{h}</span>
          ))}
        </div>
        {contracts.map(c => (
          <div key={c.address} className="grid grid-cols-5 gap-0 px-3 py-1.5 border-t border-[oklch(0.16_0.02_245)] hover:bg-white/2 transition-colors">
            <span className="text-[10px] font-bold text-foreground">{c.symbol}</span>
            <span className="text-[10px] font-mono text-amber-400">{bpsToPercent(c.stakeFee)}%</span>
            <span className="text-[10px] font-mono text-orange-400">{bpsToPercent(c.unstakeFee)}%</span>
            <span className="text-[10px] font-mono text-cyan-400">{bpsToPercent(c.claimFee)}%</span>
            <span className="text-[10px] font-mono text-emerald-400">{bpsToPercent(c.apyBps)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Pool Balances / Fund Distribution ───────────────────────────────────────
function PoolBalances({ contracts }: { contracts: ContractStatus[] }) {
  const total = contracts.reduce((s, c) => s + Number(formatToken(c.balance, c.decimals)), 0)

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-[oklch(0.50_0.012_230)]">Fondos disponibles en cada pool de recompensas</p>
      {contracts.map(c => {
        const bal = Number(formatToken(c.balance, c.decimals))
        const pct = total > 0 ? (bal / total * 100).toFixed(1) : '0.0'
        return (
          <div key={c.address}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] font-bold" style={{ color: c.color }}>{c.symbol}</span>
              <span className="text-[10px] font-mono text-foreground">{bal.toFixed(4)} <span className="text-[oklch(0.45_0.01_230)]">({pct}%)</span></span>
            </div>
            <div className="h-1.5 rounded-full bg-[oklch(0.15_0.02_245)] overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: c.color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Owner Position Overview ──────────────────────────────────────────────────
function OwnerPositions({ userAddress, contracts }: { userAddress: string; contracts: ContractStatus[] }) {
  const ownedContracts = contracts.filter(c => c.owners.some(o => o.toLowerCase() === userAddress.toLowerCase()))

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
        <Shield className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-bold text-blue-400">
          Owner en {ownedContracts.length} de {contracts.length} contratos
        </span>
      </div>
      {ownedContracts.length === 0 && (
        <p className="text-[10px] text-[oklch(0.45_0.01_230)] text-center py-2">
          No eres owner de ningún contrato staking
        </p>
      )}
      {ownedContracts.map(c => (
        <div key={c.address} className="flex items-center gap-2 p-2.5 rounded-lg bg-[oklch(0.12_0.02_245)] border border-[oklch(0.22_0.025_245)]">
          <div className="w-2 h-2 rounded-full" style={{ background: c.color }} />
          <span className="text-xs font-bold text-foreground">{c.symbol}</span>
          <StatusBadge ok={!c.paused} label={c.paused ? 'PAUSED' : 'LIVE'} />
          <span className="ml-auto text-[10px] font-mono text-emerald-400">{bpsToPercent(c.apyBps)}% APY</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function ContractAdminPanel({ userAddress }: { userAddress: string }) {
  const [contracts, setContracts]   = useState<ContractStatus[]>([])
  const [loading, setLoading]       = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = getProvider()
      const results = await Promise.allSettled(
        STAKING_TOKENS.map(async t => {
          const c = new ethers.Contract(t.stakingContract, UNIVERSAL_STAKING_ABI, p)
          const [paused, totalStaked, stakeFee, unstakeFee, claimFee, apyBps, owners, balance] =
            await Promise.all([
              c.paused(),
              c.totalStaked(),
              c.stakeFeeBps(),
              c.unstakeFeeBps(),
              c.claimFeeBps(),
              c.apyBps(),
              c.getOwners(),
              c.contractTokenBalance(),
            ])
          return {
            symbol: t.symbol,
            address: t.stakingContract,
            color: t.color,
            decimals: t.decimals,
            paused,
            totalStaked,
            stakeFee,
            unstakeFee,
            claimFee,
            apyBps,
            owners: owners as string[],
            balance,
          } as ContractStatus
        })
      )
      const ok = results.filter(r => r.status === 'fulfilled').map(r => (r as any).value)
      setContracts(ok)
      setLastRefresh(new Date())
    } catch (e) { console.error('[admin-panel] load ERROR', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4 pb-24">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center">
            <Settings className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-black text-foreground">Admin Contratos</h2>
            <p className="text-[9px] text-[oklch(0.45_0.01_230)]">
              {lastRefresh ? `Actualizado ${lastRefresh.toLocaleTimeString()}` : 'Cargando…'}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-[10px] px-3 py-1.5 rounded-lg bg-[oklch(0.65_0.22_255)]/15 text-[oklch(0.65_0.22_255)] border border-[oklch(0.65_0.22_255)]/30 hover:bg-[oklch(0.65_0.22_255)]/25"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refrescar
        </button>
      </div>

      {loading && contracts.length === 0 && (
        <div className="flex items-center justify-center py-10 gap-2 text-[oklch(0.50_0.012_230)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Leyendo contratos on-chain…</span>
        </div>
      )}

      {/* Wallet owner */}
      <Section title="Wallet Owner" icon={<Wallet className="w-4 h-4" />}>
        <OwnerWalletSection userAddress={userAddress} />
      </Section>

      {/* Position owner */}
      <Section title="Posición del Owner" icon={<Shield className="w-4 h-4" />} defaultOpen={false}>
        <OwnerPositions userAddress={userAddress} contracts={contracts} />
      </Section>

      {/* Commission overview */}
      <Section title="Resumen de Comisiones" icon={<Percent className="w-4 h-4" />} defaultOpen={false}>
        {contracts.length > 0
          ? <CommissionOverview contracts={contracts} />
          : <p className="text-[10px] text-[oklch(0.45_0.01_230)]">Cargando datos…</p>}
      </Section>

      {/* Pool balances / fund distribution */}
      <Section title="Fondos de los Pools" icon={<BarChart2 className="w-4 h-4" />} defaultOpen={false}>
        {contracts.length > 0
          ? <PoolBalances contracts={contracts} />
          : <p className="text-[10px] text-[oklch(0.45_0.01_230)]">Cargando datos…</p>}
      </Section>

      {/* VIP */}
      <Section title="Gestión VIP" icon={<Star className="w-4 h-4" />} defaultOpen={false}>
        <VipSection />
      </Section>

      {/* Individual contracts */}
      <Section title="Administrar Contratos" icon={<Database className="w-4 h-4" />} defaultOpen={false}>
        <div className="space-y-2">
          {contracts.length === 0 && (
            <p className="text-[10px] text-[oklch(0.45_0.01_230)] text-center py-2">Cargando contratos…</p>
          )}
          {contracts.map(cs => (
            <ContractRow key={cs.address} cs={cs} userAddress={userAddress} />
          ))}
        </div>
      </Section>

      {/* Notice */}
      <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[9px] text-amber-400/80">
          Todas las transacciones se firman en tu World App wallet. Los cambios son irreversibles en la blockchain de World Chain (chainId 480).
        </p>
      </div>
    </div>
  )
}
