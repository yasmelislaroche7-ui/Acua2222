'use client'

import { useState, useCallback } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { Droplets, TrendingUp, Clock, Loader2, ChevronRight, Coins, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  STAKING_CONTRACT,
  H2O_TOKEN,
  WLD_TOKEN,
  PERMIT_TUPLE_INPUT,
  SELL_H2O_ABI,
  StakeInfo,
  ContractConfig,
  formatToken,
  bpsToPercent,
  formatTimestamp,
} from '@/lib/contract'
import { cn } from '@/lib/utils'

// ─── Nonce ────────────────────────────────────────────────────────────────────

function randomNonce(): bigint {
  const arr = new Uint32Array(2)
  crypto.getRandomValues(arr)
  return BigInt(arr[0]) * 65536n + BigInt(arr[1] & 0xffff)
}

// ─── ABI fragments ────────────────────────────────────────────────────────────

const STAKE_ABI = [
  {
    name: 'stake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      PERMIT_TUPLE_INPUT,
      { name: 'signature', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
  },
] as const

const ADD_STAKE_ABI = [
  {
    name: 'addStake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      PERMIT_TUPLE_INPUT,
      { name: 'signature', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
  },
] as const

const BUY_AND_STAKE_ABI = [
  {
    name: 'buyAndStake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      PERMIT_TUPLE_INPUT,
      { name: 'signature', type: 'bytes', internalType: 'bytes' },
      { name: 'amountOutMin', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
  },
] as const

const ADD_STAKE_WITH_BUY_ABI = [
  {
    name: 'addStakeWithBuy',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      PERMIT_TUPLE_INPUT,
      { name: 'signature', type: 'bytes', internalType: 'bytes' },
      { name: 'amountOutMin', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
  },
] as const

const UNSTAKE_ABI = [
  {
    name: 'unstake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const

// nuevo en v9 ─────────────────────────────────────────────────────────────────
const UNSTAKE_AND_SELL_ABI = [
  {
    name: 'unstakeAndSell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
  },
] as const

const CLAIM_ABI = [
  {
    name: 'claimRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className={cn(
      'rounded-xl p-4 flex flex-col gap-1 border',
      accent ? 'bg-primary/10 border-primary/30' : 'bg-surface-2 border-border',
    )}>
      <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className={cn('text-2xl font-bold font-mono', accent ? 'text-primary' : 'text-foreground')}>
        {value}
      </span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  )
}

// ─── StakePanel ───────────────────────────────────────────────────────────────

interface StakePanelProps {
  stakeInfo: StakeInfo | null
  config: ContractConfig | null
  userAddress: string
  h2oBalance: bigint
  wldBalance: bigint
  onRefresh: () => void
}

export function StakePanel({
  stakeInfo,
  config,
  userAddress,
  h2oBalance,
  wldBalance,
  onRefresh,
}: StakePanelProps) {
  // ── Main mode: stake | sell ────────────────────────────────────────────────
  const [mode, setMode] = useState<'stake' | 'sell'>('stake')

  // ── Stake state ───────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'h2o' | 'wld'>('h2o')
  const [amount, setAmount] = useState('')

  // ── Add-to-existing-stake state ───────────────────────────────────────────
  const [addTab, setAddTab] = useState<'h2o' | 'wld'>('h2o')
  const [addAmount, setAddAmount] = useState('')

  // ── Sell state ────────────────────────────────────────────────────────────
  const [sellAmount, setSellAmount] = useState('')

  // ── Shared ────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const clearMessages = () => { setTxHash(null); setError(null) }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const buildPermit2Payload = (token: string, parsedAmount: bigint) => {
    const deadline = Math.floor(Date.now() / 1000) + 1800
    const nonce = randomNonce()
    const permitArg = {
      permitted: { token, amount: parsedAmount.toString() },
      nonce: nonce.toString(),
      deadline: deadline.toString(),
    }
    const permit2Entry = {
      permitted: { token, amount: parsedAmount.toString() },
      spender: STAKING_CONTRACT,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
    }
    return { permitArg, permit2Entry }
  }

  // ── sellH2O ───────────────────────────────────────────────────────────────
  const handleSellH2O = useCallback(async () => {
    if (!sellAmount || !userAddress) return
    clearMessages()
    setLoading('sell')
    try {
      const parsed = ethers.parseUnits(sellAmount, 18)
      const { permitArg, permit2Entry } = buildPermit2Payload(H2O_TOKEN, parsed)

      console.log('[sell-h2o] payload', { permitArg, contract: STAKING_CONTRACT })

      const result = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: STAKING_CONTRACT,
          abi: SELL_H2O_ABI,
          functionName: 'sellH2O',
          args: [permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0', '0'],
        }],
        permit2: [permit2Entry],
      })

      console.log('[sell-h2o] commandPayload', result.commandPayload)
      console.log('[sell-h2o] finalPayload', result.finalPayload)

      if (result.finalPayload.status === 'success') {
        setTxHash((result.finalPayload as any).transaction_id ?? 'ok')
        setSellAmount('')
        setTimeout(onRefresh, 3000)
      } else {
        setError((result.finalPayload as any).message ?? 'Transacción fallida')
      }
    } catch (e: any) {
      console.error('[sell-h2o] ERROR', e)
      setError(e?.message ?? 'Error desconocido')
    } finally {
      setLoading(null)
    }
  }, [sellAmount, userAddress, onRefresh])

  // ── addStake ──────────────────────────────────────────────────────────────
  const handleAddStake = useCallback(async () => {
    if (!addAmount || !userAddress) return
    clearMessages()
    setLoading('add-h2o')
    try {
      const parsed = ethers.parseUnits(addAmount, 18)
      const { permitArg, permit2Entry } = buildPermit2Payload(H2O_TOKEN, parsed)

      const result = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: STAKING_CONTRACT,
          abi: ADD_STAKE_ABI,
          functionName: 'addStake',
          args: [permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0'],
        }],
        permit2: [permit2Entry],
      })
      if (result.finalPayload.status === 'success') {
        setTxHash((result.finalPayload as any).transaction_id ?? 'ok')
        setAddAmount('')
        setTimeout(onRefresh, 3000)
      } else {
        setError((result.finalPayload as any).message ?? 'Transacción fallida')
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error desconocido')
    } finally {
      setLoading(null)
    }
  }, [addAmount, userAddress, onRefresh])

  // ── addStakeWithBuy ───────────────────────────────────────────────────────
  const handleAddStakeWithBuy = useCallback(async () => {
    if (!addAmount || !userAddress) return
    clearMessages()
    setLoading('add-wld')
    try {
      const parsed = ethers.parseUnits(addAmount, 18)
      const { permitArg, permit2Entry } = buildPermit2Payload(WLD_TOKEN, parsed)

      const result = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: STAKING_CONTRACT,
          abi: ADD_STAKE_WITH_BUY_ABI,
          functionName: 'addStakeWithBuy',
          args: [permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0', '0'],
        }],
        permit2: [permit2Entry],
      })
      if (result.finalPayload.status === 'success') {
        setTxHash((result.finalPayload as any).transaction_id ?? 'ok')
        setAddAmount('')
        setTimeout(onRefresh, 3000)
      } else {
        setError((result.finalPayload as any).message ?? 'Transacción fallida')
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error desconocido')
    } finally {
      setLoading(null)
    }
  }, [addAmount, userAddress, onRefresh])

  // ── stake (H2O) ───────────────────────────────────────────────────────────
  const handleStakeH2O = useCallback(async () => {
    if (!amount || !userAddress) return
    clearMessages()
    setLoading('stake-h2o')
    try {
      const parsed = ethers.parseUnits(amount, 18)
      const { permitArg, permit2Entry } = buildPermit2Payload(H2O_TOKEN, parsed)

      const result = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: STAKING_CONTRACT,
          abi: STAKE_ABI,
          functionName: 'stake',
          args: [permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0'],
        }],
        permit2: [permit2Entry],
      })
      if (result.finalPayload.status === 'success') {
        setTxHash((result.finalPayload as any).transaction_id ?? 'ok')
        setAmount('')
        setTimeout(onRefresh, 3000)
      } else {
        setError((result.finalPayload as any).message ?? 'Transacción fallida')
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error desconocido')
    } finally {
      setLoading(null)
    }
  }, [amount, userAddress, onRefresh])

  // ── buyAndStake (WLD→H2O→stake) ───────────────────────────────────────────
  const handleBuyAndStake = useCallback(async () => {
    if (!amount || !userAddress) return
    clearMessages()
    setLoading('stake-wld')
    try {
      const parsed = ethers.parseUnits(amount, 18)
      const { permitArg, permit2Entry } = buildPermit2Payload(WLD_TOKEN, parsed)

      const result = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: STAKING_CONTRACT,
          abi: BUY_AND_STAKE_ABI,
          functionName: 'buyAndStake',
          args: [permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0', '0'],
        }],
        permit2: [permit2Entry],
      })
      if (result.finalPayload.status === 'success') {
        setTxHash((result.finalPayload as any).transaction_id ?? 'ok')
        setAmount('')
        setTimeout(onRefresh, 3000)
      } else {
        setError((result.finalPayload as any).message ?? 'Transacción fallida')
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error desconocido')
    } finally {
      setLoading(null)
    }
  }, [amount, userAddress, onRefresh])

  // ── unstake ───────────────────────────────────────────────────────────────
  const handleUnstake = useCallback(async () => {
    clearMessages()
    setLoading('unstake')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: STAKING_CONTRACT, abi: UNSTAKE_ABI, functionName: 'unstake', args: [] }],
      })
      if (finalPayload.status === 'success') {
        setTxHash((finalPayload as any).transaction_id ?? 'ok')
        setTimeout(onRefresh, 3000)
      } else {
        setError((finalPayload as any).message ?? 'Transacción fallida')
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error desconocido')
    } finally {
      setLoading(null)
    }
  }, [onRefresh])

  // ── unstakeAndSell (nuevo v9) ─────────────────────────────────────────────
  const handleUnstakeAndSell = useCallback(async () => {
    clearMessages()
    setLoading('unstake-sell')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: STAKING_CONTRACT,
          abi: UNSTAKE_AND_SELL_ABI,
          functionName: 'unstakeAndSell',
          args: ['0'],          // amountOutMin = 0 (sin slippage guard en UI)
        }],
      })
      if (finalPayload.status === 'success') {
        setTxHash((finalPayload as any).transaction_id ?? 'ok')
        setTimeout(onRefresh, 3000)
      } else {
        setError((finalPayload as any).message ?? 'Transacción fallida')
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error desconocido')
    } finally {
      setLoading(null)
    }
  }, [onRefresh])

  // ── claimRewards ──────────────────────────────────────────────────────────
  const handleClaim = useCallback(async () => {
    clearMessages()
    setLoading('claim')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: STAKING_CONTRACT, abi: CLAIM_ABI, functionName: 'claimRewards', args: [] }],
      })
      if (finalPayload.status === 'success') {
        setTxHash((finalPayload as any).transaction_id ?? 'ok')
        setTimeout(onRefresh, 3000)
      } else {
        setError((finalPayload as any).message ?? 'Transacción fallida')
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error desconocido')
    } finally {
      setLoading(null)
    }
  }, [onRefresh])

  // ── Derived values ────────────────────────────────────────────────────────
  const apy = config ? bpsToPercent(config.apyBps) : '—'
  const fee = config ? bpsToPercent(config.stakingFeeBps) : '—'
  const swapFee = config ? bpsToPercent(config.swapFeeBps) : '—'
  const hasStake = stakeInfo?.active ?? false

  const maxH2O = formatToken(h2oBalance, 18, 6).replace(/,/g, '')
  const maxWLD = formatToken(wldBalance, 18, 6).replace(/,/g, '')

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="APY" value={apy} accent />
        <StatCard label="Fee de staking" value={fee} />
        <StatCard label="H2O en cartera" value={formatToken(h2oBalance)} sub="H2O disponible" />
        <StatCard label="WLD en cartera" value={formatToken(wldBalance)} sub="Para comprar + stake" />
      </div>

      {/* ── Mode selector: Stake / Sell ── */}
      <div className="flex rounded-xl overflow-hidden border border-border">
        <button
          onClick={() => { setMode('stake'); clearMessages() }}
          className={cn(
            'flex-1 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors',
            mode === 'stake'
              ? 'bg-primary text-primary-foreground'
              : 'bg-surface-1 text-muted-foreground hover:text-foreground',
          )}
        >
          <Droplets className="w-4 h-4" /> Stake H2O
        </button>
        <button
          onClick={() => { setMode('sell'); clearMessages() }}
          className={cn(
            'flex-1 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors',
            mode === 'sell'
              ? 'bg-amber-500 text-white'
              : 'bg-surface-1 text-muted-foreground hover:text-foreground',
          )}
        >
          <ArrowLeftRight className="w-4 h-4" /> Vender H2O
        </button>
      </div>

      {/* ══════════════════════════════════════════ STAKE MODE ══════════════════════════════════════════ */}
      {mode === 'stake' && (
        <>
          {/* Stake activo */}
          {hasStake && stakeInfo && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Droplets className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-primary">Stake activo</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Stakeado</p>
                  <p className="font-mono font-bold text-foreground">{formatToken(stakeInfo.stakedAmount)} H2O</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Rewards pendientes</p>
                  <p className="font-mono font-bold text-primary">{formatToken(stakeInfo.pending)} H2O</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Stakeado el</p>
                  <p className="text-sm text-foreground">{formatTimestamp(stakeInfo.stakedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Último claim</p>
                  <p className="text-sm text-foreground">{formatTimestamp(stakeInfo.lastClaimAt)}</p>
                </div>
              </div>

              {/* Acciones principales */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline" size="sm"
                  className="flex-1 border-primary/40 text-primary hover:bg-primary/10"
                  onClick={handleClaim}
                  disabled={!!loading || stakeInfo.pending === 0n}
                >
                  {loading === 'claim'
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <><TrendingUp className="w-4 h-4 mr-1" /> Reclamar</>
                  }
                </Button>
                <Button
                  variant="outline" size="sm"
                  className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={handleUnstake}
                  disabled={!!loading}
                >
                  {loading === 'unstake'
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <><Clock className="w-4 h-4 mr-1" /> Retirar H2O</>
                  }
                </Button>
              </div>

              {/* Comunity Acua — Telegram */}
              <Button
                variant="outline" size="sm"
                className="w-full border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10"
                onClick={() => window.open('https://t.me/+DFj-rZvWDgw0YjNh', '_blank')}
              >
                <MessageCircle className="w-4 h-4 mr-1" /> Comunity Acua
              </Button>

              {/* Agregar al stake existente */}
              <div className="border-t border-primary/20 pt-3 flex flex-col gap-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agregar al stake</p>
                <div className="flex rounded-lg overflow-hidden border border-border">
                  <button
                    onClick={() => { setAddTab('h2o'); setAddAmount('') }}
                    className={cn(
                      'flex-1 py-1.5 text-xs font-medium transition-colors',
                      addTab === 'h2o' ? 'bg-primary text-primary-foreground' : 'bg-surface-1 text-muted-foreground hover:text-foreground',
                    )}
                  >H2O</button>
                  <button
                    onClick={() => { setAddTab('wld'); setAddAmount('') }}
                    className={cn(
                      'flex-1 py-1.5 text-xs font-medium transition-colors',
                      addTab === 'wld' ? 'bg-primary text-primary-foreground' : 'bg-surface-1 text-muted-foreground hover:text-foreground',
                    )}
                  >WLD → H2O</button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder={addTab === 'h2o' ? 'Cantidad H2O' : 'Cantidad WLD'}
                    value={addAmount}
                    onChange={e => setAddAmount(e.target.value)}
                    className="flex-1 min-w-0 rounded-lg border border-border bg-surface-1 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors font-mono"
                  />
                  <button
                    onClick={() => setAddAmount(addTab === 'h2o' ? maxH2O : maxWLD)}
                    className="text-xs text-primary hover:text-primary/80 transition-colors font-medium px-2"
                  >MAX</button>
                  <Button
                    size="sm"
                    className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={addTab === 'h2o' ? handleAddStake : handleAddStakeWithBuy}
                    disabled={!!loading || !addAmount || parseFloat(addAmount) <= 0}
                  >
                    {loading === 'add-h2o' || loading === 'add-wld'
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : 'Agregar'
                    }
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Nuevo stake */}
          {!hasStake && (
            <div className="rounded-xl border border-border bg-surface-2 p-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-foreground">Hacer stake</p>

              <div className="flex rounded-lg overflow-hidden border border-border">
                <button
                  onClick={() => { setTab('h2o'); setAmount('') }}
                  className={cn(
                    'flex-1 py-2 text-sm font-medium transition-colors',
                    tab === 'h2o' ? 'bg-primary text-primary-foreground' : 'bg-surface-1 text-muted-foreground hover:text-foreground',
                  )}
                >Stake H2O</button>
                <button
                  onClick={() => { setTab('wld'); setAmount('') }}
                  className={cn(
                    'flex-1 py-2 text-sm font-medium transition-colors',
                    tab === 'wld' ? 'bg-primary text-primary-foreground' : 'bg-surface-1 text-muted-foreground hover:text-foreground',
                  )}
                >WLD → H2O</button>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 focus-within:border-primary/60 transition-colors">
                <Coins className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  type="number"
                  placeholder={tab === 'h2o' ? 'Cantidad H2O' : 'Cantidad WLD'}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-foreground placeholder:text-muted-foreground text-sm outline-none font-mono"
                />
                <button
                  onClick={() => setAmount(tab === 'h2o' ? maxH2O : maxWLD)}
                  className="text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                >MAX</button>
              </div>

              {tab === 'wld' && (
                <p className="text-xs text-muted-foreground">
                  Fee de swap del {swapFee} sobre WLD antes del swap.
                </p>
              )}

              <Button
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={tab === 'h2o' ? handleStakeH2O : handleBuyAndStake}
                disabled={!amount || parseFloat(amount) <= 0 || !!loading}
              >
                {loading === 'stake-h2o' || loading === 'stake-wld'
                  ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  : <ChevronRight className="w-4 h-4 mr-2" />
                }
                {tab === 'h2o' ? 'Stakear H2O' : 'Comprar y Stakear'}
              </Button>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════ SELL MODE ══════════════════════════════════════════ */}
      {mode === 'sell' && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-amber-500">Vender H2O → WLD</span>
          </div>

          <p className="text-xs text-muted-foreground">
            Intercambia H2O de tu cartera por WLD a través del pool. Se aplica un fee de swap del{' '}
            <span className="text-foreground font-medium">{swapFee}</span>.
          </p>

          {/* Balance display */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>H2O disponible</span>
            <span className="font-mono text-foreground">{formatToken(h2oBalance)} H2O</span>
          </div>

          {/* Amount input */}
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-surface-1 px-3 py-2 focus-within:border-amber-500/60 transition-colors">
            <Coins className="w-4 h-4 text-amber-500 shrink-0" />
            <input
              type="number"
              placeholder="Cantidad H2O a vender"
              value={sellAmount}
              onChange={e => setSellAmount(e.target.value)}
              className="flex-1 min-w-0 bg-transparent text-foreground placeholder:text-muted-foreground text-sm outline-none font-mono"
            />
            <button
              onClick={() => setSellAmount(maxH2O)}
              className="text-xs text-amber-500 hover:text-amber-400 transition-colors font-medium"
            >MAX</button>
          </div>

          {/* Fee note */}
          {sellAmount && parseFloat(sellAmount) > 0 && config && (
            <div className="rounded-lg bg-surface-1 border border-border px-3 py-2 text-xs space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>H2O a vender</span>
                <span className="font-mono text-foreground">{sellAmount} H2O</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Fee de swap ({swapFee})</span>
                <span className="font-mono text-amber-500">
                  −{(parseFloat(sellAmount) * Number(config.swapFeeBps) / 10000).toFixed(6)} H2O
                </span>
              </div>
              <div className="flex justify-between font-medium border-t border-border pt-1">
                <span className="text-muted-foreground">H2O neto al pool</span>
                <span className="font-mono text-foreground">
                  {(parseFloat(sellAmount) * (1 - Number(config.swapFeeBps) / 10000)).toFixed(6)} H2O
                </span>
              </div>
              <p className="text-muted-foreground pt-0.5">
                Recibirás WLD según el precio del pool en el momento de la transacción.
              </p>
            </div>
          )}

          <Button
            className="w-full bg-amber-500 hover:bg-amber-600 text-white"
            onClick={handleSellH2O}
            disabled={!sellAmount || parseFloat(sellAmount) <= 0 || !!loading || h2oBalance === 0n}
          >
            {loading === 'sell'
              ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
              : <ArrowLeftRight className="w-4 h-4 mr-2" />
            }
            Vender {sellAmount || '0'} H2O por WLD
          </Button>
        </div>
      )}

      {/* ── Feedback ── */}
      {txHash && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          Tx enviada: <span className="font-mono break-all">{txHash}</span>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}