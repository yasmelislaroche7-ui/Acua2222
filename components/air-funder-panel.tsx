'use client'

import { useState, useCallback, useEffect } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { Wind, Loader2, ArrowDownToLine, RefreshCw, Coins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  STAKING_CONTRACTS, TOKENS, getProvider, UNIVERSAL_STAKING_ABI, ERC20_ABI,
  formatToken, shortenAddress,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── ABIs for deposit flow ────────────────────────────────────────────────────
const ERC20_APPROVE_ABI = [{
  name: 'approve',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address', internalType: 'address' },
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
}] as const

const DEPOSIT_REWARDS_ABI = [{
  name: 'depositRewards',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// ─── Info types ───────────────────────────────────────────────────────────────
interface AirInfo {
  contractBalance: bigint
  userBalance: bigint
  totalStaked: bigint
  apyBps: bigint
  paused: boolean
  owners: string[]
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function AirFunderPanel({ userAddress }: { userAddress: string }) {
  const [info, setInfo] = useState<AirInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [amount, setAmount] = useState('')
  const [depositing, setDepositing] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = getProvider()
      const contract = new ethers.Contract(STAKING_CONTRACTS.AIR, UNIVERSAL_STAKING_ABI, p)
      const airToken = new ethers.Contract(TOKENS.AIR, ERC20_ABI, p)

      const [balance, userBal, totalStaked, apyBps, paused, owners] = await Promise.all([
        contract.contractTokenBalance(),
        airToken.balanceOf(userAddress),
        contract.totalStaked(),
        contract.apyBps(),
        contract.paused(),
        contract.getOwners(),
      ])

      setInfo({
        contractBalance: balance,
        userBalance: userBal,
        totalStaked,
        apyBps,
        paused,
        owners: (owners as string[]).filter(o => o !== ethers.ZeroAddress),
      })
    } catch (e) {
      console.error('[AirFunder] load error', e)
    } finally {
      setLoading(false)
    }
  }, [userAddress])

  useEffect(() => { load() }, [load])

  const handleDeposit = useCallback(async () => {
    const trimmed = amount.trim()
    if (!trimmed || isNaN(Number(trimmed)) || Number(trimmed) <= 0) return
    setDepositing(true)
    setMsg(null)
    try {
      const amountWei = ethers.parseUnits(trimmed, 18).toString()

      const result = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          {
            address: TOKENS.AIR,
            abi: ERC20_APPROVE_ABI,
            functionName: 'approve',
            args: [STAKING_CONTRACTS.AIR, amountWei],
          },
          {
            address: STAKING_CONTRACTS.AIR,
            abi: DEPOSIT_REWARDS_ABI,
            functionName: 'depositRewards',
            args: [amountWei],
          },
        ],
      })

      const { finalPayload } = result
      if (finalPayload.status === 'success') {
        const txId = (finalPayload as any).transaction_id ?? ''
        setMsg({ ok: true, text: txId ? `✓ Tx: ${txId.slice(0, 16)}…` : '✓ Depositado exitosamente' })
        setAmount('')
        setTimeout(load, 3000)
      } else {
        setMsg({ ok: false, text: (finalPayload as any).message ?? 'Transacción rechazada' })
      }
    } catch (e: any) {
      console.error('[AirFunder] deposit error', e)
      setMsg({ ok: false, text: e?.message ?? 'Error desconocido' })
    } finally {
      setDepositing(false)
    }
  }, [amount, load])

  const apyPct = info ? (Number(info.apyBps) / 100).toFixed(2) + '%' : '—'

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-slate-400/20 border border-slate-400/40 flex items-center justify-center">
            <Wind className="w-4 h-4 text-slate-300" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">Fondear contrato AIR</h2>
            <p className="text-xs text-muted-foreground">Depositar AIR para rewards de stakers</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Contract Info */}
      {loading && !info && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      )}

      {info && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Fondo de rewards</span>
              <span className="text-xl font-bold font-mono text-primary">{formatToken(info.contractBalance)} AIR</span>
              <span className="text-xs text-muted-foreground">Balance disponible para pagar</span>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-3 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Total en stake</span>
              <span className="text-xl font-bold font-mono text-foreground">{formatToken(info.totalStaked)} AIR</span>
              <span className="text-xs text-muted-foreground">AIR depositado por stakers</span>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-3 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">APY actual</span>
              <span className="text-xl font-bold font-mono text-foreground">{apyPct}</span>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-3 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Tu saldo AIR</span>
              <span className="text-xl font-bold font-mono text-foreground">{formatToken(info.userBalance)} AIR</span>
            </div>
          </div>

          {/* Paused warning */}
          {info.paused && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <p className="text-xs text-red-400 font-medium">⚠ El contrato está pausado. Los stakers no pueden hacer operaciones.</p>
            </div>
          )}

          {/* Owners */}
          <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Owners del contrato AIR</p>
            {info.owners.map((o, i) => (
              <div key={o} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-4">{i}:</span>
                <span className="text-xs font-mono text-foreground">{shortenAddress(o)}</span>
                {o.toLowerCase() === userAddress.toLowerCase() && (
                  <span className="text-xs text-primary font-medium">(tú)</span>
                )}
              </div>
            ))}
          </div>

          {/* Deposit section */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ArrowDownToLine className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-primary">Depositar AIR al fondo</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Deposita AIR para que los stakers puedan recibir sus rewards.
              Se ejecutarán dos transacciones: approve y depositRewards.
            </p>

            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Coins className="w-3 h-3" />
              <span>Tu saldo: <strong className="text-foreground">{formatToken(info.userBalance)} AIR</strong></span>
            </div>

            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Cantidad de AIR"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors font-mono"
              />
              <Button
                onClick={() => {
                  if (info) setAmount(ethers.formatUnits(info.userBalance, 18))
                }}
                variant="outline"
                size="sm"
                className="shrink-0 text-xs border-border"
              >
                MAX
              </Button>
            </div>

            <Button
              className="w-full"
              onClick={handleDeposit}
              disabled={depositing || !amount.trim() || Number(amount) <= 0}
            >
              {depositing
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Depositando...</>
                : <><ArrowDownToLine className="w-4 h-4 mr-2" /> Depositar {amount || '0'} AIR</>
              }
            </Button>

            {msg && (
              <p className={cn('text-xs text-center font-mono', msg.ok ? 'text-primary' : 'text-destructive')}>
                {msg.text}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
