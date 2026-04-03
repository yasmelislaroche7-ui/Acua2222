'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  TrendingUp, Coins, Loader2, ChevronRight,
  Lock, Unlock, Gift, RefreshCw, Users, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  STAKING_TOKENS, PERMIT_TUPLE_INPUT, PERMIT2_ADDRESS,
  fetchStakingInfo, StakingInfo, formatToken, bpsToPercent, formatAPY, randomNonce,
  getProvider, UNIVERSAL_STAKING_ABI, ERC20_ABI,
} from '@/lib/new-contracts'
import { ethers as ethersLib } from 'ethers'
import { cn } from '@/lib/utils'

// ─── MiniKit ABI fragments ────────────────────────────────────────────────────
const STAKE_ABI = [{
  name: 'stake', type: 'function', stateMutability: 'nonpayable',
  inputs: [PERMIT_TUPLE_INPUT, { name: 'signature', type: 'bytes', internalType: 'bytes' }],
  outputs: [],
}] as const

const UNSTAKE_ABI = [{
  name: 'unstake', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

const CLAIM_ABI = [{
  name: 'claimRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

// ─── Real-time pending ────────────────────────────────────────────────────────
function useRealtimePending(base: bigint, apyBps: bigint, staked: bigint, decimals: number): string {
  const [raw, setRaw] = useState(parseFloat(ethers.formatUnits(base, decimals)))
  useEffect(() => { setRaw(parseFloat(ethers.formatUnits(base, decimals))) }, [base, decimals])
  useEffect(() => {
    if (staked === 0n || apyBps === 0n) return
    // APY bps → per second rate
    const apyFloat = Number(apyBps) / 10000
    const stakedFloat = parseFloat(ethers.formatUnits(staked, decimals))
    const perSecond = (apyFloat * stakedFloat) / (365 * 24 * 3600)
    const id = setInterval(() => setRaw(p => p + perSecond), 1000)
    return () => clearInterval(id)
  }, [base, apyBps, staked, decimals])
  if (raw <= 0) return '0'
  if (raw < 0.000001) return '< 0.000001'
  return raw.toFixed(8)
}

// ─── Token Badge ──────────────────────────────────────────────────────────────
function TokenBadge({ symbol, color }: { symbol: string; color: string }) {
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
      style={{ backgroundColor: color + '33', border: `1.5px solid ${color}66`, color }}>
      {symbol.slice(0, 4)}
    </div>
  )
}

// ─── Stake Dialog ─────────────────────────────────────────────────────────────
interface StakeDialogProps {
  token: typeof STAKING_TOKENS[0]
  info: StakingInfo | null
  onClose: () => void
  onRefresh: () => void
}

function StakeDialog({ token, info, onClose, onRefresh }: StakeDialogProps) {
  const [tab, setTab] = useState<'stake' | 'unstake' | 'claim'>('stake')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const decimals = token.decimals

  async function doStake() {
    if (!amount || parseFloat(amount) <= 0) return setMsg('Enter a valid amount')
    setLoading(true); setMsg('')
    try {
      const amtWei = ethers.parseUnits(amount, decimals)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const nonce = randomNonce()
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: token.stakingContract,
          abi: STAKE_ABI,
          functionName: 'stake',
          args: [
            { permitted: { token: token.address, amount: amtWei.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
          ],
        }],
        permit2: [{
          permitted: { token: token.address, amount: amtWei.toString() },
          spender: token.stakingContract,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
        }],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ Staked! Refreshing...')
        setAmount('')
        setTimeout(onRefresh, 2000)
      } else {
        setMsg('Transaction rejected')
      }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  async function doUnstake() {
    setLoading(true); setMsg('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: token.stakingContract,
          abi: UNSTAKE_ABI,
          functionName: 'unstake',
          args: [],
        }],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ Unstaked! Refreshing...')
        setTimeout(onRefresh, 2000)
      } else {
        setMsg('Transaction rejected')
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
          abi: CLAIM_ABI,
          functionName: 'claimRewards',
          args: [],
        }],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ Claimed! Refreshing...')
        setTimeout(onRefresh, 2000)
      } else {
        setMsg('Transaction rejected')
      }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  const pending = info?.pendingRewards ?? 0n
  const staked = info?.stakedAmount ?? 0n
  const balance = info?.tokenBalance ?? 0n

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end justify-center">
      <div className="w-full max-w-md bg-background border-t border-border rounded-t-2xl p-4 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TokenBadge symbol={token.symbol} color={token.color} />
            <div>
              <p className="font-bold text-sm">{token.name}</p>
              <p className="text-xs text-muted-foreground">{token.symbol} Staking</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">✕ Cerrar</button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-surface-2 rounded-lg p-2 text-center border border-border">
            <p className="text-xs text-muted-foreground">APY</p>
            <p className="text-sm font-bold" style={{ color: token.color }}>{info ? formatAPY(info.apyBps) : '—'}</p>
          </div>
          <div className="bg-surface-2 rounded-lg p-2 text-center border border-border">
            <p className="text-xs text-muted-foreground">Staked</p>
            <p className="text-sm font-bold text-foreground">{info ? formatToken(info.stakedAmount, decimals) : '—'}</p>
          </div>
          <div className="bg-surface-2 rounded-lg p-2 text-center border border-border">
            <p className="text-xs text-muted-foreground">Rewards</p>
            <p className="text-sm font-bold text-green-400">{info ? formatToken(info.pendingRewards, decimals) : '—'}</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border border-border rounded-lg mb-4 overflow-hidden">
          {(['stake', 'unstake', 'claim'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
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
              <span>Balance: {formatToken(balance, decimals)} {token.symbol}</span>
              <button onClick={() => setAmount(ethers.formatUnits(balance, decimals))} className="text-primary">MAX</button>
            </div>
            <input
              type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder={`Cantidad de ${token.symbol}`}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
            <div className="text-xs text-muted-foreground">Fee: {info ? bpsToPercent(info.stakeFeeBps) : '2%'}</div>
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
              <p className="text-lg font-bold text-foreground">{formatToken(staked, decimals)} {token.symbol}</p>
            </div>
            <div className="text-xs text-muted-foreground">Fee: {info ? bpsToPercent(info.unstakeFeeBps) : '2%'} · Las rewards se reclaman automáticamente</div>
            <Button className="w-full" variant="destructive" onClick={doUnstake} disabled={loading || staked === 0n}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Unlock className="w-4 h-4 mr-2" />}
              Unstake {token.symbol}
            </Button>
          </div>
        )}

        {tab === 'claim' && (
          <div className="space-y-3">
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
              <p className="text-xs text-green-400 mb-1">Rewards pendientes</p>
              <p className="text-lg font-bold text-green-300">{formatToken(pending, decimals)} {token.symbol}</p>
              <p className="text-xs text-muted-foreground mt-1">Se acumulan cada segundo · 24/7</p>
            </div>
            <div className="text-xs text-muted-foreground">Fee: {info ? bpsToPercent(info.claimFeeBps) : '2%'}</div>
            <Button className="w-full bg-green-600 hover:bg-green-700" onClick={doClaim} disabled={loading || pending === 0n}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />}
              Reclamar {formatToken(pending, decimals)} {token.symbol}
            </Button>
          </div>
        )}

        {msg && (
          <p className={cn('text-xs mt-3 text-center', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>
            {msg}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
interface MultiStakingPanelProps {
  userAddress: string
}

export function MultiStakingPanel({ userAddress }: MultiStakingPanelProps) {
  const [selected, setSelected] = useState<typeof STAKING_TOKENS[0] | null>(null)
  const [infos, setInfos] = useState<Record<string, StakingInfo | null>>({})
  const [loading, setLoading] = useState(false)

  const loadInfos = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.allSettled(
        STAKING_TOKENS.map(t => fetchStakingInfo(t.stakingContract, userAddress, t.address))
      )
      const newInfos: Record<string, StakingInfo | null> = {}
      results.forEach((r, i) => {
        const key = STAKING_TOKENS[i].symbol
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
          <h2 className="text-base font-bold text-foreground">Multi-Staking</h2>
          <p className="text-xs text-muted-foreground">Staking con cualquier token · Rewards por segundo</p>
        </div>
        <button onClick={loadInfos} disabled={loading} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Token list */}
      <div className="space-y-2">
        {STAKING_TOKENS.map(token => (
          <TokenCard
            key={token.symbol}
            token={token}
            info={infos[token.symbol] ?? null}
            onClick={() => setSelected(token)}
          />
        ))}
      </div>

      {/* Fee info */}
      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <TrendingUp className="w-3.5 h-3.5 text-primary" />
          Fee 2% · Rewards en tiempo real · APY variable por contrato
        </div>
      </div>

      {/* Dialog */}
      {selected && (
        <StakeDialog
          token={selected}
          info={infos[selected.symbol]}
          onClose={() => setSelected(null)}
          onRefresh={() => { loadInfos(); setSelected(null) }}
        />
      )}
    </div>
  )
}
