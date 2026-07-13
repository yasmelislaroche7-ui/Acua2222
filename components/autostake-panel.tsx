'use client'

import { useState, useEffect, useCallback } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { Layers, ArrowDownToLine, ArrowUpFromLine, RefreshCw, Loader2, AlertTriangle, TrendingUp, Coins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ACUA_AUTOSTAKE_ADDRESS, DEPLOYED, H2O_TOKEN,
  STAKE_ABI, UNSTAKE_ABI,
  fetchUserPositions, fetchContractStats,
  randomNonce, fmtToken, formatApr,
  type UserPosition, type TokenInfo,
} from '@/lib/autostake'
import {
  buildFeePayment, fetchFeeInfo, insufficientFeeMsg,
} from '@/lib/feeCollector'
import { cn } from '@/lib/utils'

interface Props { userAddress: string }

export function AutoStakePanel({ userAddress }: Props) {
  const [positions, setPositions]   = useState<UserPosition[]>([])
  const [tokens, setTokens]         = useState<TokenInfo[]>([])
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null)
  const [tab, setTab]               = useState<'stake' | 'unstake'>('stake')
  const [amount, setAmount]         = useState('')
  const [loading, setLoading]       = useState(false)
  const [txLoading, setTxLoading]   = useState(false)
  const [msg, setMsg]               = useState<{ ok: boolean; text: string } | null>(null)
  const [feeAmount, setFeeAmount]   = useState(0n)
  const [h2oBalance, setH2oBalance] = useState(0n)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [stats, pos, feeData] = await Promise.all([
        fetchContractStats(),
        fetchUserPositions(userAddress),
        fetchFeeInfo(userAddress).catch(() => ({ fee: 0n, userH2O: 0n })),
      ])
      setTokens(stats.tokens)
      setPositions(pos)
      setFeeAmount(feeData.fee)
      setH2oBalance(feeData.userH2O)
      if (!selectedToken && stats.tokens.length > 0) {
        setSelectedToken(stats.tokens[0])
      }
    } catch (e) { console.error('[AutoStake] load', e) }
    finally { setLoading(false) }
  }, [userAddress, selectedToken])

  useEffect(() => { load() }, [load])

  const userPos = positions.find(p => p.token === selectedToken?.address)

  async function doStake() {
    if (!selectedToken || !amount || parseFloat(amount) <= 0) return
    if (h2oBalance < feeAmount) return setMsg({ ok: false, text: insufficientFeeMsg(feeAmount) })
    setTxLoading(true); setMsg(null)
    try {
      const amtWei   = ethers.parseUnits(amount, 18)
      const nonce    = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const fee      = buildFeePayment(feeAmount, deadline)

      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          fee.tx,
          {
            address: ACUA_AUTOSTAKE_ADDRESS,
            abi: STAKE_ABI,
            functionName: 'stakeWithPermit2',
            args: [
              selectedToken.address,
              amtWei.toString(),
              {
                permitted: { token: selectedToken.address, amount: amtWei.toString() },
                nonce: nonce.toString(),
                deadline: deadline.toString(),
              },
              'PERMIT2_SIGNATURE_PLACEHOLDER_1',
            ],
          },
        ],
        permit2: [
          fee.permit2,
          {
            permitted: { token: selectedToken.address, amount: amtWei.toString() },
            spender: ACUA_AUTOSTAKE_ADDRESS,
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
        ],
      })

      if (finalPayload.status === 'success') {
        setMsg({ ok: true, text: `✓ ${amount} ${selectedToken.symbol} stakeado (5% fee aplicado)` })
        setAmount('')
        setTimeout(load, 3000)
      } else {
        setMsg({ ok: false, text: (finalPayload as any).message ?? 'Transacción rechazada' })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'Error' })
    } finally { setTxLoading(false) }
  }

  async function doUnstake() {
    if (!selectedToken || !amount || parseFloat(amount) <= 0) return
    if (h2oBalance < feeAmount) return setMsg({ ok: false, text: insufficientFeeMsg(feeAmount) })
    setTxLoading(true); setMsg(null)
    try {
      const amtWei = ethers.parseUnits(amount, 18)
      const fee    = buildFeePayment(feeAmount)

      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          fee.tx,
          {
            address: ACUA_AUTOSTAKE_ADDRESS,
            abi: UNSTAKE_ABI,
            functionName: 'unstake',
            args: [selectedToken.address, amtWei.toString()],
          },
        ],
        permit2: [fee.permit2],
      })

      if (finalPayload.status === 'success') {
        setMsg({ ok: true, text: `✓ ${amount} ${selectedToken.symbol} retirado (5% fee aplicado)` })
        setAmount('')
        setTimeout(load, 3000)
      } else {
        setMsg({ ok: false, text: (finalPayload as any).message ?? 'Transacción rechazada' })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'Error' })
    } finally { setTxLoading(false) }
  }

  if (!DEPLOYED) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-yellow-500/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-yellow-400" />
        </div>
        <div className="text-center space-y-1">
          <p className="font-semibold text-foreground">Contrato en preparación</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            AcuaAutoStake aún no ha sido desplegado. El panel estará disponible una vez que se complete el deploy.
          </p>
        </div>
        <div className="w-full max-w-sm rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 font-mono text-xs text-yellow-400/70 break-all">
          {ACUA_AUTOSTAKE_ADDRESS}
          <span className="ml-2 text-yellow-400/40">[PENDIENTE]</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-center gap-3 px-1">
        <div className="w-10 h-10 rounded-xl bg-[oklch(0.65_0.22_255)]/15 flex items-center justify-center">
          <Layers className="w-5 h-5 text-[oklch(0.65_0.22_255)]" />
        </div>
        <div>
          <h2 className="font-bold text-base text-foreground">AutoStake</h2>
          <p className="text-[10px] text-muted-foreground">Auto-compound · Rewards reinvertidos automáticamente</p>
        </div>
        <button onClick={load} disabled={loading} className="ml-auto p-2 rounded-lg hover:bg-muted/60">
          <RefreshCw className={cn('w-4 h-4 text-muted-foreground', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Token selector */}
      {tokens.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tokens.map(tk => (
            <button
              key={tk.address}
              onClick={() => setSelectedToken(tk)}
              className={cn(
                'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                selectedToken?.address === tk.address
                  ? 'bg-[oklch(0.65_0.22_255)] text-white border-transparent'
                  : 'border-border text-muted-foreground hover:border-[oklch(0.65_0.22_255)]/60'
              )}
            >
              {tk.symbol}
            </button>
          ))}
        </div>
      )}

      {/* Stats row */}
      {selectedToken && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'APR', value: formatApr(selectedToken.aprBps), color: 'text-emerald-400' },
            { label: 'Stakers', value: selectedToken.stakersCount.toString(), color: 'text-[oklch(0.65_0.22_255)]' },
            { label: 'Fondo', value: `${fmtToken(selectedToken.rewardFund, 18, 2)} ${selectedToken.symbol}`, color: 'text-amber-400' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-border bg-muted/20 p-3 text-center">
              <p className={cn('text-sm font-bold', s.color)}>{s.value}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* User position */}
      {userPos && (
        <div className="rounded-xl border border-[oklch(0.65_0.22_255)]/30 bg-[oklch(0.65_0.22_255)]/5 p-4 space-y-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Tu posición</p>
          <div className="flex justify-between items-end">
            <div>
              <p className="text-xl font-bold text-foreground">{fmtToken(userPos.amount)} <span className="text-sm text-muted-foreground">{userPos.symbol}</span></p>
              <p className="text-[10px] text-muted-foreground mt-0.5">En stake</p>
            </div>
            <div className="text-right">
              <p className="text-base font-semibold text-emerald-400">+{fmtToken(userPos.pendingReward, 18, 6)}</p>
              <p className="text-[10px] text-muted-foreground">Pendiente (auto-reinvierte)</p>
            </div>
          </div>
          {userPos.cooldownRemaining > 0 && (
            <p className="text-[10px] text-amber-400">
              ⏳ Próximo reinvest en {Math.ceil(userPos.cooldownRemaining / 60)} min
            </p>
          )}
        </div>
      )}

      {/* Deposit / Withdraw tabs */}
      <div className="flex rounded-xl border border-border overflow-hidden">
        {(['stake', 'unstake'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setAmount(''); setMsg(null) }}
            className={cn(
              'flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors',
              tab === t ? 'bg-[oklch(0.65_0.22_255)] text-white' : 'text-muted-foreground hover:bg-muted/40'
            )}
          >
            {t === 'stake'
              ? <><ArrowDownToLine className="w-3.5 h-3.5" /> Depositar</>
              : <><ArrowUpFromLine className="w-3.5 h-3.5" /> Retirar</>
            }
          </button>
        ))}
      </div>

      {selectedToken && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{tab === 'stake' ? 'Depositar' : 'Retirar'}</span>
              {tab === 'unstake' && userPos && (
                <button
                  onClick={() => setAmount(ethers.formatUnits(userPos.amount, 18))}
                  className="text-[10px] text-[oklch(0.65_0.22_255)] hover:underline"
                >
                  MAX: {fmtToken(userPos.amount)} {userPos.symbol}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 bg-transparent text-xl font-bold outline-none placeholder:text-muted-foreground/40"
              />
              <span className="font-semibold text-sm text-muted-foreground">{selectedToken.symbol}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {tab === 'stake' ? 'Fee 5%: 4% → owner · 1% → pool de recompensas' : 'Fee 5% al retirar · Proceso instantáneo'}
            </p>
          </div>

          <Button
            className="w-full h-12 font-bold text-sm bg-[oklch(0.65_0.22_255)] hover:bg-[oklch(0.60_0.22_255)]"
            disabled={txLoading || !amount || parseFloat(amount) <= 0}
            onClick={tab === 'stake' ? doStake : doUnstake}
          >
            {txLoading
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Procesando...</>
              : tab === 'stake'
                ? <><ArrowDownToLine className="w-4 h-4 mr-2" /> Depositar {selectedToken.symbol}</>
                : <><ArrowUpFromLine className="w-4 h-4 mr-2" /> Retirar {selectedToken.symbol}</>
            }
          </Button>
        </div>
      )}

      {msg && (
        <p className={cn('text-xs text-center font-medium', msg.ok ? 'text-emerald-400' : 'text-red-400')}>
          {msg.text}
        </p>
      )}

      {/* Info box */}
      <div className="rounded-xl border border-border bg-muted/10 p-3 space-y-1">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Cómo funciona</p>
        <ul className="space-y-1">
          {[
            '🔄 Los rewards se reinvierten automáticamente a tu posición cada 10 min',
            '💰 Cualquier usuario puede procesar tu reinvest y ganar 1% del reward',
            '📈 APR variable · máximo 100% · ajustable por owner',
            '🏦 5% fee en depósito y retiro · 10% en cada reinvest',
          ].map(t => <li key={t} className="text-[10px] text-muted-foreground">{t}</li>)}
        </ul>
      </div>
    </div>
  )
}
