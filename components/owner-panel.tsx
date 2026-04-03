'use client'

import { useState, useCallback } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { Shield, Loader2, Settings, AlertTriangle, RefreshCw, ArrowDownToLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  STAKING_CONTRACT,
  H2O_TOKEN,
  ContractConfig,
  formatToken,
  bpsToPercent,
  shortenAddress,
} from '@/lib/contract'
import { cn } from '@/lib/utils'

type OwnerAction =
  | 'setAPY'
  | 'setStakingFee'
  | 'setSwapFee'
  | 'setTreasury'
  | 'setOwner'
  | 'emergencyWithdraw'

interface OwnerField {
  action: OwnerAction
  label: string
  placeholder: string
  inputType?: string
  current?: string
  hint?: string
  danger?: boolean
}

// ─── ABIs completos por función (MiniKit requiere { name, type, stateMutability, inputs, outputs }) ──

const SET_APY_ABI = [{
  name: 'setAPY',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'v', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}]

const SET_STAKING_FEE_ABI = [{
  name: 'setStakingFee',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'v', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}]

const SET_SWAP_FEE_ABI = [{
  name: 'setSwapFee',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'v', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}]

const SET_TREASURY_ABI = [{
  name: 'setTreasury',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'newTreasury', type: 'address', internalType: 'address' }],
  outputs: [],
}]

const SET_OWNER_ABI = [{
  name: 'setOwner',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'newOwner', type: 'address', internalType: 'address' }],
  outputs: [],
}]

const EMERGENCY_WITHDRAW_ABI = [{
  name: 'emergencyWithdraw',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'token', type: 'address', internalType: 'address' },
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [],
}]

const ERC20_TRANSFER_ABI = [{
  name: 'transfer',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'to', type: 'address', internalType: 'address' },
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
}]

// ─── ABI lookup map ───────────────────────────────────────────────────────────

const ACTION_ABI: Record<OwnerAction, object[]> = {
  setAPY: SET_APY_ABI,
  setStakingFee: SET_STAKING_FEE_ABI,
  setSwapFee: SET_SWAP_FEE_ABI,
  setTreasury: SET_TREASURY_ABI,
  setOwner: SET_OWNER_ABI,
  emergencyWithdraw: EMERGENCY_WITHDRAW_ABI,
}

// ─── Fund Contract Row ────────────────────────────────────────────────────────

function FundContractRow({ onSuccess }: { onSuccess: () => void }) {
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleSend = useCallback(async () => {
    const trimmed = amount.trim()
    if (!trimmed || isNaN(Number(trimmed)) || Number(trimmed) <= 0) return
    setLoading(true)
    setFeedback(null)
    try {
      const wei = BigInt(Math.floor(Number(trimmed) * 1e18)).toString()
      console.log('[owner] fundContract amount=%s wei=%s to=%s', trimmed, wei, STAKING_CONTRACT)

      const result = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_TOKEN,
          abi: ERC20_TRANSFER_ABI,
          functionName: 'transfer',
          args: [STAKING_CONTRACT, wei],
        }],
      })

      const { finalPayload } = result
      if (finalPayload.status === 'success') {
        const txId = (finalPayload as any).transaction_id ?? ''
        setFeedback({ ok: true, msg: txId ? `Tx: ${txId.slice(0, 16)}…` : 'Enviado' })
        setAmount('')
        onSuccess()
      } else {
        setFeedback({ ok: false, msg: (finalPayload as any).message ?? 'Error en la transacción' })
      }
    } catch (e: any) {
      setFeedback({ ok: false, msg: e?.message ?? 'Error desconocido' })
    } finally {
      setLoading(false)
    }
  }, [amount, onSuccess])

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ArrowDownToLine className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Enviar H2O al contrato</span>
      </div>
      <p className="text-xs text-muted-foreground font-mono break-all">Token: {H2O_TOKEN}</p>
      <div className="flex gap-2">
        <input
          type="number" min="0" step="any" placeholder="Cantidad H2O"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-surface-1 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors font-mono"
        />
        <Button
          size="sm"
          className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={handleSend}
          disabled={loading || !amount.trim() || Number(amount) <= 0}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Enviar'}
        </Button>
      </div>
      {feedback && (
        <p className={cn('text-xs font-mono', feedback.ok ? 'text-primary' : 'text-destructive')}>
          {feedback.msg}
        </p>
      )}
    </div>
  )
}

// ─── Owner Row ────────────────────────────────────────────────────────────────

function OwnerRow({ field, onSuccess }: { field: OwnerField; onSuccess: () => void }) {
  const [value, setValue] = useState('')
  const [extra, setExtra] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleSubmit = useCallback(async () => {
    if (!value.trim()) return
    setLoading(true)
    setFeedback(null)

    const args = field.action === 'emergencyWithdraw'
      ? [value.trim(), extra.trim() || '0']
      : [value.trim()]

    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: STAKING_CONTRACT,
          abi: ACTION_ABI[field.action],
          functionName: field.action,
          args,
        }],
      })

      if (finalPayload.status === 'success') {
        const txId = (finalPayload as any).transaction_id ?? ''
        setFeedback({ ok: true, msg: txId ? `Tx: ${txId.slice(0, 16)}…` : 'Enviado' })
        setValue('')
        setExtra('')
        onSuccess()
      } else {
        setFeedback({ ok: false, msg: (finalPayload as any).message ?? 'Error' })
      }
    } catch (e: any) {
      setFeedback({ ok: false, msg: e?.message ?? 'Error desconocido' })
    } finally {
      setLoading(false)
    }
  }, [value, extra, field, onSuccess])

  return (
    <div className={cn(
      'rounded-xl border p-3 flex flex-col gap-2',
      field.danger ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-surface-2',
    )}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{field.label}</span>
        {field.current && (
          <span className="text-xs text-muted-foreground font-mono">{field.current}</span>
        )}
      </div>
      {field.hint && (
        <p className="text-xs text-muted-foreground">{field.hint}</p>
      )}
      <div className="flex gap-2">
        <input
          type={field.inputType ?? 'text'}
          placeholder={field.placeholder}
          value={value}
          onChange={e => setValue(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-surface-1 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors font-mono"
        />
        {field.action === 'emergencyWithdraw' && (
          <input
            type="number" placeholder="Amount"
            value={extra}
            onChange={e => setExtra(e.target.value)}
            className="w-28 rounded-lg border border-border bg-surface-1 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors font-mono"
          />
        )}
        <Button
          size="sm"
          variant={field.danger ? 'destructive' : 'outline'}
          className={cn('shrink-0', !field.danger && 'border-primary/40 text-primary hover:bg-primary/10')}
          onClick={handleSubmit}
          disabled={loading || !value.trim()}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Set'}
        </Button>
      </div>
      {feedback && (
        <p className={cn('text-xs font-mono', feedback.ok ? 'text-primary' : 'text-destructive')}>
          {feedback.msg}
        </p>
      )}
    </div>
  )
}

// ─── Owner Panel ──────────────────────────────────────────────────────────────

interface OwnerPanelProps {
  config: ContractConfig
  onRefresh: () => void
}

export function OwnerPanel({ config, onRefresh }: OwnerPanelProps) {
  const fields: OwnerField[] = [
    {
      action: 'setAPY',
      label: 'APY (basis points)',
      placeholder: '1200 = 12%',
      inputType: 'number',
      current: bpsToPercent(config.apyBps),
    },
    {
      action: 'setStakingFee',
      label: 'Fee de staking (bps)',
      placeholder: '100 = 1%',
      inputType: 'number',
      current: bpsToPercent(config.stakingFeeBps),
    },
    {
      action: 'setSwapFee',
      label: 'Fee de swap / sell (bps)',
      placeholder: '200 = 2%',
      inputType: 'number',
      current: bpsToPercent(config.swapFeeBps),
      hint: 'Se aplica tanto a compras (WLD→H2O) como a ventas (H2O→WLD) vía sellH2O.',
    },
    {
      action: 'setTreasury',
      label: 'Cambiar treasury',
      placeholder: '0x…',
      current: shortenAddress(config.treasury),
    },
    {
      action: 'setOwner',
      label: 'Cambiar owner',
      placeholder: '0x…',
      current: shortenAddress(config.owner),
      danger: true,
    },
    {
      action: 'emergencyWithdraw',
      label: 'Emergency withdraw',
      placeholder: 'Token address',
      danger: true,
    },
  ]

  return (
    <div className="flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-primary">Panel de Owner</span>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refrescar
        </button>
      </div>

      {/* Contract info */}
      <div className="rounded-xl border border-border bg-surface-2 p-3 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Info del contrato</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Owner</span>
          <span className="font-mono text-foreground">{shortenAddress(config.owner)}</span>

          <span className="text-muted-foreground">Treasury</span>
          <span className="font-mono text-foreground">{shortenAddress(config.treasury)}</span>

          <span className="text-muted-foreground">Swapper</span>
          <span className="font-mono text-foreground">{shortenAddress(config.swapper)}</span>

          <span className="text-muted-foreground">Contract Creator</span>
          <span className="font-mono text-foreground">{shortenAddress(config.creator)}</span>

          <span className="text-muted-foreground">Balance H2O contrato</span>
          <span className="font-mono text-primary">{formatToken(config.contractBalance)} H2O</span>
        </div>
      </div>

      {/* Warning */}
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 flex items-start gap-2 px-3 py-2">
        <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
        <p className="text-xs text-yellow-400">
          Las acciones de owner son irreversibles. Verifica cada valor antes de confirmar.
        </p>
      </div>

      {/* Fund contract */}
      <FundContractRow onSuccess={onRefresh} />

      {/* Settings */}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider">
        <Settings className="w-3.5 h-3.5" /> Configuración
      </p>
      <div className="flex flex-col gap-3">
        {fields.map(f => (
          <OwnerRow key={f.action} field={f} onSuccess={onRefresh} />
        ))}
      </div>
    </div>
  )
}