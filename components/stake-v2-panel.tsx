'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  TrendingUp, Coins, Loader2, ChevronRight,
  Lock, Unlock, Gift, RefreshCw, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getProvider, PERMIT2_ADDRESS } from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── Stake V2 Contract ABI ───────────────────────────────────────────────────
const STAKE_V2_ABI = [
  'function stakedBalance(address) view returns (uint256)',
  'function pendingWldReward(address staker) view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function unallocatedWld() view returns (uint256)',
  'function accWldPerShare() view returns (uint256)',
  'function timeToken() view returns (address)',
  'function wldToken() view returns (address)',
  'function stake(uint256 amount)',
  'function stakeWithPermit2(uint256 amount, uint256 nonce, uint256 deadline, bytes signature)',
  'function unstake(uint256 amount)',
  'function claimWldReward()',
]

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
]

// ─── PERMIT2 ABI for MiniKit ─────────────────────────────────────────────────
const STAKE_PERMIT2_ABI = [{
  name: 'stakeWithPermit2',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
    { name: 'nonce', type: 'uint256', internalType: 'uint256' },
    { name: 'deadline', type: 'uint256', internalType: 'uint256' },
    { name: 'signature', type: 'bytes', internalType: 'bytes' },
  ],
  outputs: [],
}] as const

const UNSTAKE_ABI = [{
  name: 'unstake',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

const CLAIM_WLD_ABI = [{
  name: 'claimWldReward',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [],
  outputs: [],
}] as const

// ─── V2 Staking Contracts Configuration ──────────────────────────────────────
export interface StakeV2Token {
  id: string
  name: string
  symbol: string
  tokenAddress: string
  stakingContract: string
  rewardSymbol: string
  color: string
  decimals: number
  logoUrl?: string
}

// Universal V2 Staking Contracts - TIME token staking for WLD rewards
export const STAKE_V2_TOKENS: StakeV2Token[] = [
  {
    id: 'time-wld',
    name: 'TIME Staking V2',
    symbol: 'TIME',
    tokenAddress: '0x212d7448720852D8Ad282a5d4A895B3461F9076E',
    stakingContract: '0x44a8EbCB9a5eDD4A907510F8E791a5F7bd865244',
    rewardSymbol: 'WLD',
    color: '#8b5cf6',
    decimals: 18,
    logoUrl: '/tokens/time.jpg',
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
function randomNonce(): bigint {
  const arr = new Uint32Array(2)
  crypto.getRandomValues(arr)
  return BigInt(arr[0]) * 65536n + BigInt(arr[1] & 0xffff)
}

function fmt(val: bigint, dec = 18, prec = 6): string {
  const n = parseFloat(ethers.formatUnits(val, dec))
  if (n === 0) return '0'
  if (n < 0.000001) return '< 0.000001'
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: prec })
}

// ─── Token Badge ──────────────────────────────────────────────────────────────
function TokenBadge({ symbol, color, logoUrl }: { symbol: string; color: string; logoUrl?: string }) {
  const [imgError, setImgError] = useState(false)
  
  if (logoUrl && !imgError) {
    return (
      <img 
        src={logoUrl} 
        alt={symbol}
        onError={() => setImgError(true)}
        className="w-10 h-10 rounded-full object-cover shrink-0"
      />
    )
  }
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
      style={{ backgroundColor: color + '33', border: `1.5px solid ${color}66`, color }}>
      {symbol.slice(0, 4)}
    </div>
  )
}

// ─── Stake Info Type ──────────────────────────────────────────────────────────
interface StakeV2Info {
  stakedBalance: bigint
  pendingReward: bigint
  totalStaked: bigint
  unallocatedWld: bigint
  tokenBalance: bigint
}

// ─── Stake V2 Dialog ──────────────────────────────────────────────────────────
interface StakeV2DialogProps {
  token: StakeV2Token
  info: StakeV2Info | null
  onClose: () => void
  onRefresh: () => void
}

function StakeV2Dialog({ token, info, onClose, onRefresh }: StakeV2DialogProps) {
  const [tab, setTab] = useState<'stake' | 'unstake' | 'claim'>('stake')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const decimals = token.decimals

  async function doStake() {
    if (!amount || parseFloat(amount) <= 0) return setMsg('Ingresa una cantidad valida')
    setLoading(true); setMsg('')
    try {
      const amtWei = ethers.parseUnits(amount, decimals)
      const nonce = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: token.stakingContract,
          abi: STAKE_PERMIT2_ABI,
          functionName: 'stakeWithPermit2',
          args: [amtWei.toString(), nonce.toString(), deadline.toString(), 'PERMIT2_SIGNATURE_PLACEHOLDER_0'],
        }],
        permit2: [{
          permitted: { token: token.tokenAddress, amount: amtWei.toString() },
          spender: token.stakingContract,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
        }],
      })
      
      if (finalPayload.status === 'success') {
        setMsg('Stake exitoso! Actualizando...')
        setAmount('')
        setTimeout(onRefresh, 2000)
      } else {
        setMsg('Transaccion rechazada')
      }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  async function doUnstake() {
    if (!amount || parseFloat(amount) <= 0) return setMsg('Ingresa una cantidad valida')
    setLoading(true); setMsg('')
    try {
      const amtWei = ethers.parseUnits(amount, decimals)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: token.stakingContract,
          abi: UNSTAKE_ABI,
          functionName: 'unstake',
          args: [amtWei.toString()],
        }],
      })
      if (finalPayload.status === 'success') {
        setMsg('Unstake exitoso! Actualizando...')
        setAmount('')
        setTimeout(onRefresh, 2000)
      } else {
        setMsg('Transaccion rechazada')
      }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  async function doClaim() {
    setLoading(true); setMsg('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: token.stakingContract,
          abi: CLAIM_WLD_ABI,
          functionName: 'claimWldReward',
          args: [],
        }],
      })
      if (finalPayload.status === 'success') {
        setMsg('Rewards reclamados! Actualizando...')
        setTimeout(onRefresh, 2000)
      } else {
        setMsg('Transaccion rechazada')
      }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  const pending = info?.pendingReward ?? 0n
  const staked = info?.stakedBalance ?? 0n
  const balance = info?.tokenBalance ?? 0n

  // Calculate estimated APR based on pool data
  const estimatedAPR = info && info.totalStaked > 0n && info.unallocatedWld > 0n 
    ? (() => {
        const totalStakedFloat = parseFloat(ethers.formatUnits(info.totalStaked, 18))
        const unallocFloat = parseFloat(ethers.formatUnits(info.unallocatedWld, 18))
        // Assuming unallocated distributes over 1 year
        if (totalStakedFloat === 0) return '—'
        const apr = (unallocFloat / totalStakedFloat) * 100
        return apr > 1000 ? '> 1000%' : apr.toFixed(1) + '%'
      })()
    : '—'

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end justify-center">
      <div className="w-full max-w-md bg-background border-t border-border rounded-t-2xl p-4 pb-8 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TokenBadge symbol={token.symbol} color={token.color} logoUrl={token.logoUrl} />
            <div>
              <p className="font-bold text-sm">{token.name}</p>
              <p className="text-xs text-muted-foreground">{token.symbol} → {token.rewardSymbol} Rewards</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">Cerrar</button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-surface-2 rounded-lg p-2 text-center border border-border">
            <p className="text-xs text-muted-foreground">APR Est.</p>
            <p className="text-sm font-bold" style={{ color: token.color }}>{estimatedAPR}</p>
          </div>
          <div className="bg-surface-2 rounded-lg p-2 text-center border border-border">
            <p className="text-xs text-muted-foreground">Staked</p>
            <p className="text-sm font-bold text-foreground">{info ? fmt(info.stakedBalance, decimals, 4) : '—'}</p>
          </div>
          <div className="bg-surface-2 rounded-lg p-2 text-center border border-border">
            <p className="text-xs text-muted-foreground">Rewards</p>
            <p className="text-sm font-bold text-green-400">{info ? fmt(info.pendingReward, 18, 6) : '—'}</p>
          </div>
        </div>

        {/* Pool Stats */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-surface-2 rounded-lg p-2 text-center border border-border">
            <p className="text-xs text-muted-foreground">Total Pool</p>
            <p className="text-sm font-bold text-foreground">{info ? fmt(info.totalStaked, decimals, 2) : '—'} {token.symbol}</p>
          </div>
          <div className="bg-surface-2 rounded-lg p-2 text-center border border-border">
            <p className="text-xs text-muted-foreground">Fondo {token.rewardSymbol}</p>
            <p className="text-sm font-bold text-blue-400">{info ? fmt(info.unallocatedWld, 18, 2) : '—'}</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border border-border rounded-lg mb-4 overflow-hidden">
          {(['stake', 'unstake', 'claim'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setAmount('') }}
              className={cn('flex-1 py-2 text-xs font-medium capitalize transition-colors',
                tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {t === 'stake' ? 'Stake' : t === 'unstake' ? 'Unstake' : 'Claim'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'stake' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Balance: {fmt(balance, decimals, 4)} {token.symbol}</span>
              <button onClick={() => setAmount(ethers.formatUnits(balance, decimals))} className="text-primary">MAX</button>
            </div>
            <input
              type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder={`Cantidad de ${token.symbol}`}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
            <div className="text-xs text-muted-foreground">Sin fees - Rewards en {token.rewardSymbol}</div>
            <Button className="w-full" onClick={doStake} disabled={loading || !amount}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
              Stake {token.symbol}
            </Button>
          </div>
        )}

        {tab === 'unstake' && (
          <div className="space-y-3">
            <div className="bg-surface-2 border border-border rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Tu stake</p>
              <p className="text-lg font-bold text-foreground">{fmt(staked, decimals, 4)} {token.symbol}</p>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Cantidad a retirar</span>
              <button onClick={() => setAmount(ethers.formatUnits(staked, decimals))} className="text-primary">MAX</button>
            </div>
            <input
              type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder={`Cantidad de ${token.symbol}`}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
            <Button className="w-full" variant="destructive" onClick={doUnstake} disabled={loading || staked === 0n || !amount}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Unlock className="w-4 h-4 mr-2" />}
              Unstake {token.symbol}
            </Button>
          </div>
        )}

        {tab === 'claim' && (
          <div className="space-y-3">
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
              <p className="text-xs text-green-400 mb-1">Rewards pendientes</p>
              <p className="text-lg font-bold text-green-300">{fmt(pending, 18, 6)} {token.rewardSymbol}</p>
              <p className="text-xs text-muted-foreground mt-1">Se acumulan continuamente</p>
            </div>
            <Button className="w-full bg-green-600 hover:bg-green-700" onClick={doClaim} disabled={loading || pending === 0n}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />}
              Reclamar {fmt(pending, 18, 4)} {token.rewardSymbol}
            </Button>
          </div>
        )}

        {msg && (
          <p className={cn('text-xs mt-3 text-center', msg.includes('exitoso') || msg.includes('reclamados') ? 'text-green-400' : 'text-red-400')}>
            {msg}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Token Card ───────────────────────────────────────────────────────────────
function TokenCard({ token, info, onClick }: {
  token: StakeV2Token
  info: StakeV2Info | null
  onClick: () => void
}) {
  const isStaked = (info?.stakedBalance ?? 0n) > 0n
  const pendingReward = info?.pendingReward ?? 0n

  // Calculate estimated APR
  const estimatedAPR = info && info.totalStaked > 0n && info.unallocatedWld > 0n 
    ? (() => {
        const totalStakedFloat = parseFloat(ethers.formatUnits(info.totalStaked, 18))
        const unallocFloat = parseFloat(ethers.formatUnits(info.unallocatedWld, 18))
        if (totalStakedFloat === 0) return '—'
        const apr = (unallocFloat / totalStakedFloat) * 100
        return apr > 1000 ? '> 1000%' : apr.toFixed(1) + '%'
      })()
    : '—'

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-surface-2 hover:border-primary/30 transition-colors text-left"
    >
      <TokenBadge symbol={token.symbol} color={token.color} logoUrl={token.logoUrl} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">{token.symbol}</span>
          <span className="text-[10px] text-muted-foreground bg-surface-1 px-1.5 py-0.5 rounded">V2</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-muted-foreground">
            APR: <span style={{ color: token.color }}>{estimatedAPR}</span>
          </span>
          {isStaked && (
            <span className="text-xs text-muted-foreground">
              Staked: {fmt(info!.stakedBalance, token.decimals, 2)}
            </span>
          )}
        </div>
        {isStaked && pendingReward > 0n && (
          <p className="text-xs text-green-400 mt-0.5 font-mono">
            +{fmt(pendingReward, 18, 6)} {token.rewardSymbol}
          </p>
        )}
      </div>

      <div className="shrink-0 flex flex-col items-end gap-1">
        {info === null ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <span className="text-xs font-mono text-foreground">
              {fmt(info.totalStaked, token.decimals, 2)}
              <span className="text-muted-foreground"> pool</span>
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </>
        )}
      </div>
    </button>
  )
}

// ─── Fetch Stake V2 Info ──────────────────────────────────────────────────────
async function fetchStakeV2Info(token: StakeV2Token, userAddr: string): Promise<StakeV2Info> {
  const provider = getProvider()
  const contract = new ethers.Contract(token.stakingContract, STAKE_V2_ABI, provider)
  const tokenContract = new ethers.Contract(token.tokenAddress, ERC20_ABI, provider)

  const [stakedBalance, pendingReward, totalStaked, unallocatedWld, tokenBalance] = await Promise.all([
    contract.stakedBalance(userAddr),
    contract.pendingWldReward(userAddr),
    contract.totalStaked(),
    contract.unallocatedWld(),
    tokenContract.balanceOf(userAddr),
  ])

  return {
    stakedBalance,
    pendingReward,
    totalStaked,
    unallocatedWld,
    tokenBalance,
  }
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
interface StakeV2PanelProps {
  userAddress: string
}

export function StakeV2Panel({ userAddress }: StakeV2PanelProps) {
  const [selected, setSelected] = useState<StakeV2Token | null>(null)
  const [infos, setInfos] = useState<Record<string, StakeV2Info | null>>({})
  const [loading, setLoading] = useState(false)

  const loadInfos = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.allSettled(
        STAKE_V2_TOKENS.map(t => fetchStakeV2Info(t, userAddress))
      )
      const newInfos: Record<string, StakeV2Info | null> = {}
      results.forEach((r, i) => {
        const key = STAKE_V2_TOKENS[i].id
        newInfos[key] = r.status === 'fulfilled' ? r.value : null
      })
      setInfos(newInfos)
    } catch (e) { console.error('loadInfos', e) }
    finally { setLoading(false) }
  }, [userAddress])

  useEffect(() => { loadInfos() }, [loadInfos])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-foreground">Stake V2</h2>
            <span className="text-[10px] bg-violet-500/20 text-violet-400 px-2 py-0.5 rounded-full font-medium">Universal</span>
          </div>
          <p className="text-xs text-muted-foreground">Nuevo contrato universal - Rewards en WLD</p>
        </div>
        <button onClick={loadInfos} disabled={loading} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Info Card */}
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
        <div className="flex items-center gap-2 text-xs">
          <Zap className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-violet-300 font-medium">Nuevo Sistema V2</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Staking con rewards compartidos del pool de WLD. Sin bloqueos, retira cuando quieras.
        </p>
      </div>

      {/* Token list */}
      <div className="space-y-2">
        {STAKE_V2_TOKENS.map(token => (
          <TokenCard
            key={token.id}
            token={token}
            info={infos[token.id] ?? null}
            onClick={() => setSelected(token)}
          />
        ))}
      </div>

      {/* Info footer */}
      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <TrendingUp className="w-3.5 h-3.5 text-primary" />
          Sin fees - Rewards en WLD - Pool compartido
        </div>
      </div>

      {/* Dialog */}
      {selected && (
        <StakeV2Dialog
          token={selected}
          info={infos[selected.id]}
          onClose={() => setSelected(null)}
          onRefresh={() => { loadInfos(); setSelected(null) }}
        />
      )}
    </div>
  )
}
