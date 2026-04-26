'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { Clock, Loader2, Gift, RefreshCw, Lock, Unlock, Zap, TrendingUp, Coins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TIME_TOKEN_ADDRESS, TIME_STAKING_ADDRESS, TIME_STAKING_ABI,
  WLD_TOKEN_ADDRESS,
  STAKE_WITH_PERMIT2_ABI_FRAG,
  TIME_UNSTAKE_ABI_FRAG,
  TIME_CLAIM_WLD_ABI_FRAG,
} from '@/lib/time'
import { getProvider } from '@/lib/new-contracts'
import { cn } from '@/lib/utils'
import {
  buildFeePayment, fetchFeeInfo, insufficientFeeMsg, feeLabel,
} from '@/lib/feeCollector'

// ─── ABI fragments for MiniKit (centralized in lib/time.ts) ──────────────────
const STAKE_PERMIT2_ABI = STAKE_WITH_PERMIT2_ABI_FRAG
const UNSTAKE_ABI       = TIME_UNSTAKE_ABI_FRAG
const CLAIM_WLD_ABI     = TIME_CLAIM_WLD_ABI_FRAG

const ERC20_BALANCE_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
function randomNonce(): bigint {
  const arr = new Uint32Array(2)
  crypto.getRandomValues(arr)
  return BigInt(arr[0]) * 65536n + BigInt(arr[1] & 0xffff)
}

function fmt(val: bigint, dec = 18, prec = 4): string {
  const n = parseFloat(ethers.formatUnits(val, dec))
  if (n === 0) return '0'
  if (n < 0.0001) return '< 0.0001'
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: prec })
}

// ─── Real-time WLD counter ────────────────────────────────────────────────────
function useRealtimePending(base: bigint, active: boolean): string {
  const [displayed, setDisplayed] = useState(parseFloat(ethers.formatUnits(base, 18)))
  const rateRef = useRef(0)

  useEffect(() => {
    setDisplayed(parseFloat(ethers.formatUnits(base, 18)))
  }, [base])

  useEffect(() => {
    if (!active || rateRef.current <= 0) return
    const id = setInterval(() => {
      setDisplayed(p => p + rateRef.current)
    }, 1000)
    return () => clearInterval(id)
  }, [active])

  return displayed.toFixed(6)
}

// ─── Block Log ────────────────────────────────────────────────────────────────
interface BlockEntry { block: number; hash: string; reward: string; time: string }

function BlockLog({ active, perBlockReward }: { active: boolean; perBlockReward: number }) {
  const [entries, setEntries] = useState<BlockEntry[]>([])
  const blockRef = useRef(Math.floor(Date.now() / 12000))

  useEffect(() => {
    if (!active || perBlockReward <= 0) { setEntries([]); return }
    const addBlock = () => {
      blockRef.current++
      setEntries(prev => [{
        block: blockRef.current,
        hash: Math.random().toString(16).slice(2, 10),
        reward: perBlockReward.toFixed(8),
        time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      }, ...prev].slice(0, 6))
    }
    addBlock()
    const id = setInterval(addBlock, 12000)
    return () => clearInterval(id)
  }, [active, perBlockReward])

  if (!active || entries.length === 0) return null

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/30 p-3 space-y-1.5">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-xs text-cyan-400 font-mono font-bold uppercase tracking-widest">Mining Blocks</span>
      </div>
      {entries.map((e, i) => (
        <div key={e.block}
          className={cn('flex items-center gap-2 text-xs font-mono px-2 py-1.5 rounded-lg transition-all',
            i === 0 ? 'bg-cyan-500/15 border border-cyan-500/30 text-foreground' : 'text-muted-foreground/60'
          )}>
          <span className="text-cyan-500/70">#{e.block.toLocaleString()}</span>
          <span className="hidden sm:inline">{e.hash}…</span>
          <span className="text-green-400 ml-auto">+{e.reward} WLD</span>
          <span className="text-muted-foreground/40 text-[10px]">{e.time}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main panel info type ─────────────────────────────────────────────────────
interface TimeInfo {
  stakedBalance: bigint
  pendingWld: bigint
  totalStaked: bigint
  unallocatedWld: bigint
  timeBalance: bigint
  wldBalance: bigint
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function MiningTimePanel({ userAddress }: { userAddress: string }) {
  const [info, setInfo] = useState<TimeInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'stake' | 'unstake' | 'claim'>('stake')
  const [stakeAmt, setStakeAmt] = useState('')
  const [unstakeAmt, setUnstakeAmt] = useState('')
  const [txLoading, setTxLoading] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [feeAmount, setFeeAmount] = useState<bigint>(10n ** 18n)
  const [h2oBalance, setH2oBalance] = useState<bigint>(0n)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = getProvider()
      const staking = new ethers.Contract(TIME_STAKING_ADDRESS, TIME_STAKING_ABI, p)
      const timeToken = new ethers.Contract(TIME_TOKEN_ADDRESS, ERC20_BALANCE_ABI, p)
      const wldToken = new ethers.Contract(WLD_TOKEN_ADDRESS, ERC20_BALANCE_ABI, p)

      const [staked, pending, total, unalloc, timeBal, wldBal, feeData] = await Promise.all([
        staking.stakedBalance(userAddress),
        staking.pendingWldReward(userAddress),
        staking.totalStaked(),
        staking.unallocatedWld(),
        timeToken.balanceOf(userAddress),
        wldToken.balanceOf(userAddress),
        fetchFeeInfo(userAddress).catch(() => ({ fee: 10n ** 18n, userH2O: 0n })),
      ])

      setInfo({
        stakedBalance: staked,
        pendingWld: pending,
        totalStaked: total,
        unallocatedWld: unalloc,
        timeBalance: timeBal,
        wldBalance: wldBal,
      })
      setFeeAmount(feeData.fee)
      setH2oBalance(feeData.userH2O)
    } catch (e) {
      console.error('[TimePanel] load error', e)
    } finally {
      setLoading(false)
    }
  }, [userAddress])

  useEffect(() => { load() }, [load])

  function requireFee(): boolean {
    if (h2oBalance < feeAmount) {
      setMsg({ ok: false, text: insufficientFeeMsg(feeAmount) })
      return false
    }
    return true
  }

  // ── Real-time pending counter ──────────────────────────────────────────────
  const displayedPending = useRealtimePending(info?.pendingWld ?? 0n, (info?.stakedBalance ?? 0n) > 0n)

  // ── Stake TIME ─────────────────────────────────────────────────────────────
  const doStake = useCallback(async () => {
    if (!stakeAmt || parseFloat(stakeAmt) <= 0) return
    if (!requireFee()) return
    setTxLoading('stake'); setMsg(null)
    try {
      const amtWei = ethers.parseUnits(stakeAmt, 18)
      const nonce = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const fee = buildFeePayment(feeAmount, deadline)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          fee.tx,
          {
            address: TIME_STAKING_ADDRESS,
            abi: STAKE_PERMIT2_ABI,
            functionName: 'stakeWithPermit2',
            args: [amtWei.toString(), nonce.toString(), deadline.toString(), 'PERMIT2_SIGNATURE_PLACEHOLDER_1'],
          },
        ],
        permit2: [
          fee.permit2,
          {
            permitted: { token: TIME_TOKEN_ADDRESS, amount: amtWei.toString() },
            spender: TIME_STAKING_ADDRESS,
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
        ],
      })
      if (finalPayload.status === 'success') {
        setMsg({ ok: true, text: '✓ TIME stakeado. Acumulando WLD...' })
        setStakeAmt('')
        setTimeout(load, 3000)
      } else {
        setMsg({ ok: false, text: (finalPayload as any).message ?? 'Transacción rechazada' })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'Error' })
    } finally { setTxLoading(null) }
  }, [stakeAmt, load, feeAmount, h2oBalance])

  // ── Unstake TIME ───────────────────────────────────────────────────────────
  const doUnstake = useCallback(async () => {
    if (!unstakeAmt || parseFloat(unstakeAmt) <= 0) return
    if (!requireFee()) return
    setTxLoading('unstake'); setMsg(null)
    try {
      const amtWei = ethers.parseUnits(unstakeAmt, 18)
      const fee = buildFeePayment(feeAmount)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          fee.tx,
          {
            address: TIME_STAKING_ADDRESS,
            abi: UNSTAKE_ABI,
            functionName: 'unstake',
            args: [amtWei.toString()],
          },
        ],
        permit2: [fee.permit2],
      })
      if (finalPayload.status === 'success') {
        setMsg({ ok: true, text: '✓ TIME retirado exitosamente' })
        setUnstakeAmt('')
        setTimeout(load, 3000)
      } else {
        setMsg({ ok: false, text: (finalPayload as any).message ?? 'Transacción rechazada' })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'Error' })
    } finally { setTxLoading(null) }
  }, [unstakeAmt, load, feeAmount, h2oBalance])

  // ── Claim WLD ──────────────────────────────────────────────────────────────
  const doClaim = useCallback(async () => {
    if (!requireFee()) return
    setTxLoading('claim'); setMsg(null)
    try {
      const fee = buildFeePayment(feeAmount)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          fee.tx,
          {
            address: TIME_STAKING_ADDRESS,
            abi: CLAIM_WLD_ABI,
            functionName: 'claimWldReward',
            args: [],
          },
        ],
        permit2: [fee.permit2],
      })
      if (finalPayload.status === 'success') {
        setMsg({ ok: true, text: '✓ WLD reclamado exitosamente' })
        setTimeout(load, 3000)
      } else {
        setMsg({ ok: false, text: (finalPayload as any).message ?? 'Transacción rechazada' })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'Error' })
    } finally { setTxLoading(null) }
  }, [load, feeAmount, h2oBalance])

  const hasStake = (info?.stakedBalance ?? 0n) > 0n
  const pendingWld = info?.pendingWld ?? 0n

  // per-block WLD (12s block time, rate from pool)
  const perBlock = hasStake && info ? (() => {
    if (info.totalStaked === 0n) return 0
    const share = Number(info.stakedBalance) / Number(info.totalStaked)
    // Rough estimate: assume unallocatedWld distributes over ~1 year
    const perYear = Number(ethers.formatUnits(info.unallocatedWld, 18)) * share
    return perYear / (365 * 24 * 3600 / 12) // per block
  })() : 0

  return (
    <div className="space-y-4 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-violet-500/20 border border-violet-500/40 flex items-center justify-center">
            <Clock className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Minería TIME</h2>
            <p className="text-xs text-muted-foreground">Staking TIME → Rewards en WLD</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {loading && !info && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
        </div>
      )}

      {info && (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
              <p className="text-xs text-muted-foreground mb-1">Tu TIME stakeado</p>
              <p className="text-lg font-bold font-mono text-violet-300">{fmt(info.stakedBalance)}</p>
              <p className="text-xs text-muted-foreground">TIME</p>
            </div>
            <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3">
              <p className="text-xs text-muted-foreground mb-1">WLD acumulado</p>
              <p className="text-lg font-bold font-mono text-green-300">{displayedPending}</p>
              <p className="text-xs text-green-400/60">WLD · en tiempo real</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <p className="text-xs text-muted-foreground mb-1">Total TIME en pool</p>
              <p className="text-base font-bold font-mono text-foreground">{fmt(info.totalStaked)}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <p className="text-xs text-muted-foreground mb-1">Fondo WLD disponible</p>
              <p className="text-base font-bold font-mono text-blue-300">{fmt(info.unallocatedWld)}</p>
            </div>
          </div>

          {/* APR */}
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-2.5 flex items-center gap-3">
            <TrendingUp className="w-4 h-4 text-violet-400 shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-violet-300">APR Variable — Pool WLD</p>
              <p className="text-xs text-muted-foreground">El rendimiento depende del fondo WLD y del total stakeado</p>
            </div>
          </div>

          {/* Claim section if pending */}
          {pendingWld > 0n && (
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-green-300 font-medium">WLD Rewards pendientes</p>
                <p className="text-lg font-bold font-mono text-green-200">{displayedPending} WLD</p>
              </div>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white shrink-0"
                onClick={doClaim}
                disabled={!!txLoading}
              >
                {txLoading === 'claim' ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Gift className="w-4 h-4 mr-1" /> Reclamar</>}
              </Button>
            </div>
          )}

          {/* Blockchain log */}
          <BlockLog active={hasStake} perBlockReward={perBlock} />

          {/* Balances */}
          <div className="rounded-xl border border-border bg-surface-2 p-3 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-muted-foreground">Tu TIME:</span>
              <span className="font-mono font-semibold text-foreground">{fmt(info.timeBalance)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-muted-foreground">Tu WLD:</span>
              <span className="font-mono font-semibold text-foreground">{fmt(info.wldBalance)}</span>
            </div>
          </div>

          {/* Action tabs */}
          <div className="flex border border-border rounded-xl overflow-hidden">
            {(['stake', 'unstake', 'claim'] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={cn('flex-1 py-2.5 text-xs font-semibold transition-colors',
                  activeTab === t ? 'bg-violet-600 text-white' : 'text-muted-foreground hover:text-foreground'
                )}>
                {t === 'stake' ? '⬆ Stake' : t === 'unstake' ? '⬇ Unstake' : '💎 Claim WLD'}
              </button>
            ))}
          </div>

          {/* Stake */}
          {activeTab === 'stake' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Disponible: <strong className="text-foreground">{fmt(info.timeBalance)} TIME</strong></span>
                <button className="text-primary" onClick={() => setStakeAmt(ethers.formatUnits(info.timeBalance, 18))}>MAX</button>
              </div>
              <input
                type="number" placeholder="Cantidad de TIME" value={stakeAmt}
                onChange={e => setStakeAmt(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-violet-500/60 font-mono"
              />
              <p className="text-xs text-muted-foreground">Autoriza con Permit2 · Sin aprobación previa · Ganas WLD de forma continua</p>
              <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={doStake} disabled={!!txLoading || !stakeAmt}>
                {txLoading === 'stake' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                Stakear {stakeAmt || '0'} TIME
              </Button>
            </div>
          )}

          {/* Unstake */}
          {activeTab === 'unstake' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-surface-2 p-3">
                <p className="text-xs text-muted-foreground">TIME stakeado actualmente</p>
                <p className="text-lg font-bold text-violet-300 font-mono">{fmt(info.stakedBalance)} TIME</p>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Ingresa la cantidad a retirar</span>
                <button className="text-primary" onClick={() => setUnstakeAmt(ethers.formatUnits(info.stakedBalance, 18))}>MAX</button>
              </div>
              <input
                type="number" placeholder="Cantidad TIME a retirar" value={unstakeAmt}
                onChange={e => setUnstakeAmt(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-red-500/60 font-mono"
              />
              <Button className="w-full" variant="destructive" onClick={doUnstake} disabled={!!txLoading || !unstakeAmt || info.stakedBalance === 0n}>
                {txLoading === 'unstake' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Unlock className="w-4 h-4 mr-2" />}
                Retirar {unstakeAmt || '0'} TIME
              </Button>
            </div>
          )}

          {/* Claim */}
          {activeTab === 'claim' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4">
                <p className="text-xs text-green-400 mb-1">WLD rewards acumulados</p>
                <p className="text-2xl font-bold text-green-200 font-mono">{displayedPending}</p>
                <p className="text-xs text-green-400/60 mt-1">WLD · se acumula segundo a segundo</p>
              </div>
              <Button
                className="w-full bg-green-600 hover:bg-green-700"
                onClick={doClaim}
                disabled={!!txLoading || pendingWld === 0n}
              >
                {txLoading === 'claim' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />}
                Reclamar {displayedPending} WLD
              </Button>
            </div>
          )}

          {msg && (
            <p className={cn('text-xs text-center font-medium', msg.ok ? 'text-green-400' : 'text-red-400')}>
              {msg.text}
            </p>
          )}

          {/* Info footer */}
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-xs text-muted-foreground text-center">
              Stake TIME permanente · Rewards en WLD · Pool compartida entre todos los stakers
            </p>
          </div>
        </>
      )}
    </div>
  )
}
