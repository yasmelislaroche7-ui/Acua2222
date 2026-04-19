'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Droplets, Lock, Unlock, Gift, RefreshCw, Loader2,
  Users, Crown, Copy, Check, ChevronDown, ChevronUp,
  TrendingUp, Zap, Star, ArrowRightLeft, AlertTriangle,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  H2O_STAKING_ADDRESS, H2O_VIP_ADDRESS, H2O_TOKEN, UTH2_TOKEN,
  PERMIT2_ADDRESS, PERMIT_TUPLE_INPUT, WORLD_CHAIN_RPC,
  STAKE_ABI_FRAG, UNSTAKE_ABI_FRAG, CLAIM_ABI_FRAG,
  CLAIM_REF_ABI_FRAG, REGISTER_REF_ABI_FRAG,
  BUY_VIP_PERMIT2_ABI_FRAG, CLAIM_OWNER_VIP_ABI_FRAG,
  fetchH2OStakeInfo, calcAPY, formatToken, shortenAddress, randomNonce,
  H2OStakeInfo,
} from '@/lib/h2oStaking'
import {
  STAKING_CONTRACT, fetchStakeInfo, StakeInfo,
} from '@/lib/contract'

// ── Old contract MiniKit ABI frags ────────────────────────────────────────
const OLD_UNSTAKE_ABI = [{
  name: 'unstake', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

const OLD_CLAIM_ABI = [{
  name: 'claimRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

// ── Live pending counter (Synthetix-style) ────────────────────────────────
// rewardRate is total wei/second across all stakers
// userShare = staked / totalStaked
// userPerSecond = rewardRate * userShare
function useLivePending(
  base: bigint,
  staked: bigint,
  totalStaked: bigint,
  rewardRate: bigint,
  periodFinish: bigint,
): string {
  const [val, setVal] = useState(parseFloat(ethers.formatEther(base)))

  useEffect(() => {
    setVal(parseFloat(ethers.formatEther(base)))
  }, [base])

  useEffect(() => {
    const now = Math.floor(Date.now() / 1000)
    const finish = Number(periodFinish)
    if (staked === 0n || rewardRate === 0n || finish <= now) return
    const stakedF      = parseFloat(ethers.formatEther(staked))
    const totalStakedF = parseFloat(ethers.formatEther(totalStaked))
    const rateF        = parseFloat(ethers.formatEther(rewardRate)) // rate in H2O/sec total
    const perSec       = totalStakedF > 0 ? rateF * (stakedF / totalStakedF) : 0
    const id = setInterval(() => setVal(p => p + perSec), 1000)
    return () => clearInterval(id)
  }, [base, staked, totalStaked, rewardRate, periodFinish])

  if (val <= 0) return '0'
  if (val < 0.000001) return '< 0.000001'
  return val.toFixed(8)
}

// ── Copy helper ────────────────────────────────────────────────────────────
function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return { copied, copy }
}

type ActionTab = 'deposit' | 'withdraw' | 'claim'

// ── VIP banner ────────────────────────────────────────────────────────────
interface VIPBannerProps {
  vipPrice: bigint
  vipExpiry: bigint
  uth2Balance: bigint
  ownerVipPending: bigint
  onBuy: (months: number) => Promise<void>
  onClaimOwnerVip: () => Promise<void>
  loading: boolean
}
function VIPBanner({ vipPrice, vipExpiry, uth2Balance, ownerVipPending, onBuy, onClaimOwnerVip, loading }: VIPBannerProps) {
  const [months, setMonths]     = useState(1)
  const [expanded, setExpanded] = useState(false)
  const now       = BigInt(Math.floor(Date.now() / 1000))
  const isVip     = vipExpiry > now
  const daysLeft  = isVip ? Math.floor(Number(vipExpiry - now) / 86400) : 0
  const totalCost = vipPrice * BigInt(months)
  const hasBalance = uth2Balance >= totalCost && totalCost > 0n

  return (
    <div className={cn(
      'rounded-2xl border overflow-hidden',
      isVip
        ? 'border-yellow-500/40 bg-gradient-to-br from-yellow-950/40 to-amber-900/20'
        : 'border-purple-500/30 bg-gradient-to-br from-purple-950/30 to-indigo-900/20'
    )}>
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center',
            isVip ? 'bg-yellow-500/20' : 'bg-purple-500/20')}>
            <Crown className={cn('w-5 h-5', isVip ? 'text-yellow-400' : 'text-purple-400')} />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <p className={cn('text-sm font-bold', isVip ? 'text-yellow-300' : 'text-purple-300')}>
                Suscripción VIP
              </p>
              {isVip && (
                <span className="text-[9px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-1.5 py-0.5 rounded-full">
                  ACTIVA
                </span>
              )}
              {ownerVipPending > 0n && (
                <span className="text-[9px] font-bold bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full animate-pulse">
                  REWARDS!
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {isVip
                ? `Expira en ${daysLeft} día${daysLeft !== 1 ? 's' : ''} · Beneficios activos`
                : 'Acceso VIP · Paga con UTH2'}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '📈 APY Extra', value: '+Boost' },
              { label: '💸 Fee reducido', value: 'Activo' },
              { label: '⚡ Acceso', value: 'VIP Pool' },
            ].map(b => (
              <div key={b.label} className="bg-black/20 rounded-lg p-2 text-center">
                <p className="text-[10px] text-muted-foreground">{b.label}</p>
                <p className={cn('text-xs font-bold', isVip ? 'text-yellow-300' : 'text-purple-300')}>{b.value}</p>
              </div>
            ))}
          </div>

          {/* VIP pool earnings claim — only shown when there are pending rewards */}
          {ownerVipPending > 0n && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] text-yellow-400 font-semibold uppercase tracking-wide">Ganancias VIP pool</p>
                <p className="text-base font-bold text-yellow-300">{formatToken(ownerVipPending, 18, 4)} H2O</p>
                <p className="text-[10px] text-muted-foreground">pendiente de reclamar</p>
              </div>
              <Button size="sm" className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold shrink-0"
                onClick={onClaimOwnerVip} disabled={loading}>
                {loading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <><Gift className="w-3.5 h-3.5 mr-1" />Reclamar</>}
              </Button>
            </div>
          )}

          {/* Purchase / Extend form — always shown when expanded */}
          <div className="space-y-3">
            {isVip && (
              <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-3 py-2">
                <Crown className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                <p className="text-xs text-yellow-300">VIP activo · Puedes extender tu suscripción</p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Meses:</span>
              {[1, 3, 6, 12].map(m => (
                <button key={m} onClick={() => setMonths(m)}
                  className={cn('px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
                    months === m
                      ? (isVip ? 'bg-yellow-500 text-black' : 'bg-purple-500 text-white')
                      : (isVip ? 'bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20' : 'bg-purple-500/10 text-purple-300 hover:bg-purple-500/20'))}>
                  {m}m
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Costo: <span className={cn('font-semibold', isVip ? 'text-yellow-300' : 'text-purple-300')}>{formatToken(totalCost)} UTH2</span></span>
              <span>Balance: {formatToken(uth2Balance)} UTH2</span>
            </div>

            {vipPrice === 0n && (
              <p className="text-xs text-muted-foreground bg-black/20 rounded-lg px-2 py-1.5">
                Cargando precio…
              </p>
            )}

            <Button
              className={cn('w-full text-white', isVip
                ? 'bg-yellow-600 hover:bg-yellow-500'
                : 'bg-purple-600 hover:bg-purple-700')}
              onClick={() => onBuy(months)}
              disabled={loading || vipPrice === 0n || !hasBalance}
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                : <Crown className="w-4 h-4 mr-2" />}
              {loading
                ? 'Procesando…'
                : isVip
                  ? `Extender VIP +${months} mes${months !== 1 ? 'es' : ''}`
                  : `Activar VIP ${months} mes${months !== 1 ? 'es' : ''}`}
            </Button>

            {!hasBalance && vipPrice > 0n && (
              <p className="text-[11px] text-center text-muted-foreground">
                Necesitas {formatToken(totalCost)} UTH2 · Balance: {formatToken(uth2Balance)} UTH2
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Referral section ──────────────────────────────────────────────────────
const MINIAPP_URL = 'https://worldcoin.org/mini-app?app_id=app_60f2dc429532dcfa014c16d52ddc00fe&app_mode=mini-app'

interface ReferralSectionProps {
  userAddress: string
  referrer: string
  refCount: bigint
  refPending: bigint
  pendingRef: string | null   // ?ref= from URL — auto-propose registration
  onRegister: (addr: string) => Promise<void>
  onClaimRef: () => Promise<void>
  loading: boolean
}
function ReferralSection({ userAddress, referrer, refCount, refPending, pendingRef, onRegister, onClaimRef, loading }: ReferralSectionProps) {
  const [expanded, setExpanded]   = useState(false)
  const [refInput, setRefInput]   = useState('')
  const [refMsg, setRefMsg]       = useState('')
  const { copied, copy }          = useCopy()
  const hasReferrer   = referrer && referrer !== ethers.ZeroAddress
  const hasRefRewards = refPending > 0n
  const myRefCount    = Number(refCount)

  // Auto-expand and pre-fill if pending ref from URL
  useEffect(() => {
    if (pendingRef && !hasReferrer) {
      setExpanded(true)
      setRefInput(pendingRef)
    }
  }, [pendingRef, hasReferrer])

  const referralLink = `${MINIAPP_URL}&ref=${userAddress}`

  const handleRegister = async (addr?: string) => {
    const target = addr ?? refInput
    if (!ethers.isAddress(target)) { setRefMsg('Dirección inválida'); return }
    if (target.toLowerCase() === userAddress.toLowerCase()) { setRefMsg('No puedes referirte a ti mismo'); return }
    setRefMsg('')
    await onRegister(target)
    setRefInput('')
  }

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/30 to-blue-900/20 overflow-hidden">
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center">
            <Users className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-cyan-300">Invita · Ambos ganan</p>
              {myRefCount > 0 && (
                <span className="text-[9px] font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-1.5 py-0.5 rounded-full">
                  {myRefCount} referido{myRefCount !== 1 ? 's' : ''}
                </span>
              )}
              {hasRefRewards && (
                <span className="text-[9px] font-bold bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full animate-pulse">
                  REWARDS!
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              5% de la comisión de reclamo de tu amigo → para ti
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">

          {/* Auto-register banner from URL ref param */}
          {pendingRef && !hasReferrer && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3">
              <p className="text-xs font-semibold text-cyan-300 mb-1">🔗 ¡Te invitó alguien!</p>
              <p className="text-xs text-muted-foreground mb-2">
                Registra a <span className="font-mono text-cyan-400">{shortenAddress(pendingRef)}</span> como tu referido para que ambos ganen comisiones.
              </p>
              <Button size="sm" className="w-full bg-cyan-600 hover:bg-cyan-700 text-white"
                onClick={() => handleRegister(pendingRef)} disabled={loading}>
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                Registrar referido
              </Button>
            </div>
          )}

          {/* Stats: mis referidos */}
          {myRefCount > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-black/20 rounded-xl p-2.5 text-center border border-white/5">
                <p className="text-[10px] text-muted-foreground mb-0.5">Mis referidos</p>
                <p className="text-lg font-bold text-cyan-300">{myRefCount}</p>
                <p className="text-[9px] text-muted-foreground">personas</p>
              </div>
              <div className="bg-black/20 rounded-xl p-2.5 text-center border border-white/5">
                <p className="text-[10px] text-muted-foreground mb-0.5">Comisiones</p>
                <p className="text-lg font-bold text-green-300">{formatToken(refPending, 18, 4)}</p>
                <p className="text-[9px] text-muted-foreground">H2O pendiente</p>
              </div>
            </div>
          )}

          {/* How it works */}
          <div className="bg-black/20 rounded-xl p-3 space-y-1.5">
            <p className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> ¿Cómo funciona?
            </p>
            <p className="text-xs text-muted-foreground">🔗 Comparte tu enlace con amigos</p>
            <p className="text-xs text-muted-foreground">✅ Tu amigo abre el link y confirma en 1 clic</p>
            <p className="text-xs text-muted-foreground">💰 Cada vez que reclame, 5% va al pool de referidos para ti</p>
          </div>

          {/* Referral link */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Tu enlace de referido (World App)</p>
            <div className="flex items-center gap-2 bg-black/30 border border-border rounded-lg px-3 py-2">
              <span className="text-xs text-cyan-300 truncate flex-1 font-mono">{referralLink}</span>
              <button onClick={() => copy(referralLink)}
                className="shrink-0 text-muted-foreground hover:text-cyan-400 transition-colors">
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Register referrer — for existing users without a referrer */}
          {!hasReferrer && !pendingRef ? (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">¿Alguien te invitó? Ingresa su wallet y ganan ambos</p>
              <div className="flex gap-2">
                <input type="text" value={refInput} onChange={e => setRefInput(e.target.value)}
                  placeholder="Dirección 0x..."
                  className="flex-1 bg-black/30 border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500" />
                <Button size="sm" className="bg-cyan-600 hover:bg-cyan-700 text-white shrink-0"
                  onClick={() => handleRegister()} disabled={loading || !refInput}>
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Registrar'}
                </Button>
              </div>
              {refMsg && <p className="text-xs text-red-400 mt-1">{refMsg}</p>}
            </div>
          ) : hasReferrer ? (
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
              <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <p className="text-xs text-green-300">Tu referido: {shortenAddress(referrer)}</p>
            </div>
          ) : null}

          {/* Pending ref rewards */}
          {hasRefRewards && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-green-400">Comisiones pendientes</p>
                <p className="text-base font-bold text-green-300">{formatToken(refPending)} H2O</p>
              </div>
              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={onClaimRef} disabled={loading}>
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Gift className="w-3.5 h-3.5 mr-1" />Reclamar</>}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Legacy V1 section ─────────────────────────────────────────────────────
interface LegacyPanelProps { userAddress: string }
function LegacyPanel({ userAddress }: LegacyPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [info, setInfo]         = useState<StakeInfo | null>(null)
  const [loading, setLoading]   = useState(false)
  const [msg, setMsg]           = useState<{ text: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    if (!userAddress) return
    try { const d = await fetchStakeInfo(userAddress); setInfo(d) } catch { /* noop */ }
  }, [userAddress])

  useEffect(() => { if (expanded) load() }, [expanded, load])

  const showMsg = (text: string, ok: boolean) => {
    setMsg({ text, ok })
    setTimeout(() => setMsg(null), 5000)
  }

  async function doOldUnstake() {
    setLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: STAKING_CONTRACT, abi: OLD_UNSTAKE_ABI, functionName: 'unstake', args: [] }],
      })
      if (finalPayload.status === 'success') {
        showMsg('✓ Retirado. ¡Migra al nuevo Stake V2 ahora!', true)
        setTimeout(load, 2500)
      } else showMsg('Transacción cancelada', false)
    } catch (e: any) { showMsg(e.message || 'Error', false) }
    finally { setLoading(false) }
  }

  async function doOldClaim() {
    setLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: STAKING_CONTRACT, abi: OLD_CLAIM_ABI, functionName: 'claimRewards', args: [] }],
      })
      if (finalPayload.status === 'success') {
        showMsg('✓ Rewards V1 reclamados. ¡Ahora retira y migra!', true)
        setTimeout(load, 2500)
      } else showMsg('Transacción cancelada', false)
    } catch (e: any) { showMsg(e.message || 'Error', false) }
    finally { setLoading(false) }
  }

  const hasPosition = info && (info.stakedAmount > 0n || info.pending > 0n)

  return (
    <div className="rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-950/20 to-red-900/10 overflow-hidden">
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-orange-400" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-orange-300">Stake H2O V1 (legado)</p>
              <span className="text-[9px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded-full">MIGRAR</span>
            </div>
            <p className="text-xs text-muted-foreground">Contrato anterior · Retira y migra al nuevo V2</p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
          <div className="flex items-start gap-2 bg-orange-500/10 border border-orange-500/20 rounded-xl p-3">
            <ArrowRightLeft className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
            <p className="text-xs text-orange-300">
              Este es el contrato V1 antiguo. <strong>Retira y migra al nuevo Stake H2O V2</strong> para acceder al APY de mercado, referidos y VIP.
            </p>
          </div>

          {info ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-black/20 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Staked V1</p>
                <p className="text-sm font-bold text-orange-300">{formatToken(info.stakedAmount)} H2O</p>
              </div>
              <div className="bg-black/20 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Rewards V1</p>
                <p className="text-sm font-bold text-green-300">{formatToken(info.pending)} H2O</p>
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="border-green-500/30 text-green-400 hover:bg-green-500/10"
              onClick={doOldClaim} disabled={loading || !info || info.pending === 0n}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Gift className="w-3.5 h-3.5 mr-1" />}
              Reclamar V1
            </Button>
            <Button variant="outline" className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
              onClick={doOldUnstake} disabled={loading || !info || info.stakedAmount === 0n}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Unlock className="w-3.5 h-3.5 mr-1" />}
              Retirar y Migrar
            </Button>
          </div>

          {msg && (
            <div className={cn('rounded-xl px-3 py-2 text-xs text-center border',
              msg.ok ? 'bg-green-500/10 border-green-500/20 text-green-300' : 'bg-red-500/10 border-red-500/20 text-red-300')}>
              {msg.text}
            </div>
          )}
          {!hasPosition && info && (
            <p className="text-xs text-center text-muted-foreground">Sin posición en V1 · ¡Usa el nuevo V2!</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────
interface StakePanelProps { userAddress: string }

export function StakePanel({ userAddress }: StakePanelProps) {
  const [info, setInfo]           = useState<H2OStakeInfo | null>(null)
  const [loadingData, setLoading] = useState(false)
  const [tab, setTab]             = useState<ActionTab>('deposit')
  const [amount, setAmount]       = useState('')
  const [txLoading, setTxLoading] = useState(false)
  const [msg, setMsg]             = useState<{ text: string; ok: boolean } | null>(null)
  const [pendingRef, setPendingRef] = useState<string | null>(null)

  // Read ?ref= param from URL on mount (Worldcoin mini-app passes it)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')
    if (ref && ethers.isAddress(ref)) setPendingRef(ref)
  }, [])

  const staked       = info?.staked       ?? 0n
  const earned       = info?.earned       ?? 0n
  const h2oBalance   = info?.h2oBalance   ?? 0n
  const rewardRate   = info?.rewardRate   ?? 0n
  const totalStaked  = info?.totalStaked  ?? 0n
  const periodFinish = info?.periodFinish ?? 0n
  const depFee       = info?.depositFeeBps  ?? 500n
  const withFee      = info?.withdrawFeeBps ?? 500n
  const clmFee       = info?.claimFeeBps    ?? 1000n

  const apyDisplay  = calcAPY(rewardRate, totalStaked, periodFinish)
  const isStaked    = staked > 0n
  const canClaim    = earned > 0n

  const livePending = useLivePending(earned, staked, totalStaked, rewardRate, periodFinish)

  const loadInfo = useCallback(async () => {
    if (!userAddress) return
    setLoading(true)
    try { setInfo(await fetchH2OStakeInfo(userAddress)) }
    catch (e) { console.error('fetchH2OStakeInfo', e) }
    finally { setLoading(false) }
  }, [userAddress])

  useEffect(() => { loadInfo() }, [loadInfo])

  const showMsg = (text: string, ok: boolean) => {
    setMsg({ text, ok })
    setTimeout(() => setMsg(null), 7000)
  }
  // Progress messages during long async ops — no auto-clear
  const showProgress = (text: string) => setMsg({ text, ok: true })

  // ── STAKE via Permit2 ────────────────────────────────────────────────────
  // The contract: stake(IPermit2.PermitTransferFrom permit, bytes sig)
  // MiniKit handles the Permit2 signature automatically via permit2[]
  async function doStake() {
    if (!amount || parseFloat(amount) <= 0) return showMsg('Ingresa un monto válido', false)
    const amtWei   = ethers.parseEther(amount)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    const nonce    = randomNonce()

    setTxLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address:      H2O_STAKING_ADDRESS,
          abi:          STAKE_ABI_FRAG,
          functionName: 'stake',
          args: [
            {
              permitted: { token: H2O_TOKEN, amount: amtWei.toString() },
              nonce:     nonce.toString(),
              deadline:  deadline.toString(),
            },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
          ],
        }],
        permit2: [{
          permitted: { token: H2O_TOKEN, amount: amtWei.toString() },
          spender:   H2O_STAKING_ADDRESS,
          nonce:     nonce.toString(),
          deadline:  deadline.toString(),
        }],
      })

      if (finalPayload.status === 'success') {
        showMsg('✓ ¡Stake realizado! Los rewards empiezan a acumularse.', true)
        setAmount('')
        setTimeout(loadInfo, 2500)
      } else {
        showMsg('Transacción cancelada o rechazada', false)
      }
    } catch (e: any) { showMsg(e.message || 'Error inesperado', false) }
    finally { setTxLoading(false) }
  }

  // ── UNSTAKE ──────────────────────────────────────────────────────────────
  async function doUnstake() {
    if (staked === 0n) return showMsg('No tienes H2O en stake', false)
    const withdrawAmt = amount && parseFloat(amount) > 0
      ? ethers.parseEther(amount)
      : staked
    if (withdrawAmt > staked) return showMsg('Monto mayor a tu stake actual', false)

    setTxLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address:      H2O_STAKING_ADDRESS,
          abi:          UNSTAKE_ABI_FRAG,
          functionName: 'unstake',
          args:         [withdrawAmt.toString()],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg('✓ H2O retirado exitosamente.', true)
        setAmount('')
        setTimeout(loadInfo, 2500)
      } else showMsg('Transacción cancelada', false)
    } catch (e: any) { showMsg(e.message || 'Error', false) }
    finally { setTxLoading(false) }
  }

  // ── CLAIM REWARDS ────────────────────────────────────────────────────────
  async function doClaim() {
    if (!canClaim) return showMsg('Sin rewards pendientes aún', false)
    setTxLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address:      H2O_STAKING_ADDRESS,
          abi:          CLAIM_ABI_FRAG,
          functionName: 'claimRewards',
          args:         [],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg('✓ ¡Rewards reclamados! Actualizando...', true)
        setTimeout(loadInfo, 2500)
      } else showMsg('Transacción cancelada', false)
    } catch (e: any) { showMsg(e.message || 'Error', false) }
    finally { setTxLoading(false) }
  }

  // ── REGISTER REFERRER ────────────────────────────────────────────────────
  async function doRegisterRef(addr: string) {
    setTxLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS, abi: REGISTER_REF_ABI_FRAG,
          functionName: 'registerReferrer', args: [addr],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg('✓ ¡Referido registrado! Ambos ganarán comisiones', true)
        setPendingRef(null)   // clear URL param banner once registered
        setTimeout(loadInfo, 2000)
      } else showMsg('Transacción cancelada', false)
    } catch (e: any) { showMsg(e.message || 'Error', false) }
    finally { setTxLoading(false) }
  }

  // ── CLAIM REF REWARDS ────────────────────────────────────────────────────
  async function doClaimRef() {
    setTxLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS, abi: CLAIM_REF_ABI_FRAG,
          functionName: 'claimRefRewards', args: [],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg('✓ Comisiones de referido reclamadas', true)
        setTimeout(loadInfo, 2000)
      } else showMsg('Transacción cancelada', false)
    } catch (e: any) { showMsg(e.message || 'Error', false) }
    finally { setTxLoading(false) }
  }

  // ── BUY VIP via Permit2 (H2OVIPSubscription contract) ────────────────────
  // Uses the same Permit2 flow as doStake — one signature, no approve needed.
  // The spender is H2O_VIP_ADDRESS (standalone VIP contract), not the staking one.
  async function doBuyVIP(months: number) {
    const vipPrice = info?.vipPrice ?? 0n
    if (vipPrice === 0n) return showMsg('Precio VIP no disponible', false)
    const totalCost = vipPrice * BigInt(months)
    const deadline  = BigInt(Math.floor(Date.now() / 1000) + 3600)
    const nonce     = randomNonce()

    setTxLoading(true)
    try {
      showProgress('Confirma la compra VIP en World App…')

      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address:      H2O_VIP_ADDRESS,
          abi:          BUY_VIP_PERMIT2_ABI_FRAG,
          functionName: 'buyVIPWithPermit2',
          args: [
            months.toString(),
            {
              permitted: { token: UTH2_TOKEN, amount: totalCost.toString() },
              nonce:     nonce.toString(),
              deadline:  deadline.toString(),
            },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
          ],
        }],
        permit2: [{
          permitted: { token: UTH2_TOKEN, amount: totalCost.toString() },
          spender:   H2O_VIP_ADDRESS,
          nonce:     nonce.toString(),
          deadline:  deadline.toString(),
        }],
      })

      if (finalPayload.status === 'success') {
        showMsg(`✓ VIP activado por ${months} mes${months !== 1 ? 'es' : ''}! Bienvenido`, true)
        setTimeout(loadInfo, 2500)
      } else {
        const code = (finalPayload as any).error_code ?? 'unknown'
        showMsg(`La compra no se completó (${code})`, false)
      }
    } catch (e: any) {
      showMsg(e.message || 'No se pudo completar la compra VIP', false)
    } finally { setTxLoading(false) }
  }

  // ── CLAIM OWNER VIP POOL (H2OVIPSubscription contract) ───────────────────
  async function doClaimOwnerVip() {
    setTxLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address:      H2O_VIP_ADDRESS,
          abi:          CLAIM_OWNER_VIP_ABI_FRAG,
          functionName: 'claimOwnerVip',
          args:         [],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg('✓ Ganancias VIP pool reclamadas en H2O', true)
        setTimeout(loadInfo, 2000)
      } else {
        const code = (finalPayload as any).error_code ?? 'unknown'
        showMsg(`No se pudo reclamar el VIP pool (${code})`, false)
      }
    } catch (e: any) { showMsg(e.message || 'No se pudo completar el reclamo', false) }
    finally { setTxLoading(false) }
  }

  return (
    <div className="space-y-4">

      {/* ── Hero card ─────────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden border border-cyan-500/20 bg-gradient-to-br from-cyan-950/50 via-blue-950/40 to-indigo-950/50">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-cyan-500/10 via-transparent to-transparent pointer-events-none" />
        <div className="relative p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
                  <Droplets className="w-6 h-6 text-cyan-400" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-500 border-2 border-background flex items-center justify-center">
                  <Zap className="w-2.5 h-2.5 text-white" />
                </div>
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">Stake H2O V2</h2>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={cn(
                    'text-xs font-bold px-2 py-0.5 rounded-full border',
                    apyDisplay === '—'
                      ? 'bg-muted/20 text-muted-foreground border-border'
                      : 'bg-green-500/20 text-green-400 border-green-500/30'
                  )}>
                    APY{' '}
                    <span className={cn(
                      'font-extrabold',
                      apyDisplay === '—' ? 'text-muted-foreground' : 'text-green-300 text-sm'
                    )}>
                      {loadingData ? '…' : apyDisplay}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Fee depósito {Number(depFee) / 100}% · Retiro {Number(withFee) / 100}% · Claim {Number(clmFee) / 100}%
                  </span>
                </div>
              </div>
            </div>
            <button onClick={loadInfo} disabled={loadingData} className="text-muted-foreground hover:text-cyan-400 transition-colors">
              <RefreshCw className={cn('w-4 h-4', loadingData && 'animate-spin')} />
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-black/20 rounded-xl p-2.5 text-center border border-white/5">
              <p className="text-[10px] text-muted-foreground mb-0.5">Mi Balance</p>
              <p className="text-sm font-bold text-foreground">{loadingData ? '…' : formatToken(h2oBalance, 18, 2)}</p>
              <p className="text-[9px] text-muted-foreground">H2O</p>
            </div>
            <div className="bg-black/20 rounded-xl p-2.5 text-center border border-white/5">
              <p className="text-[10px] text-muted-foreground mb-0.5">En Stake</p>
              <p className={cn('text-sm font-bold', isStaked ? 'text-cyan-300' : 'text-muted-foreground')}>
                {loadingData ? '…' : formatToken(staked, 18, 2)}
              </p>
              <p className="text-[9px] text-muted-foreground">H2O</p>
            </div>
            <div className="bg-black/20 rounded-xl p-2.5 text-center border border-white/5">
              <p className="text-[10px] text-muted-foreground mb-0.5">Rewards</p>
              <p className={cn('text-sm font-bold font-mono', canClaim ? 'text-green-300' : 'text-muted-foreground')}>
                {isStaked ? livePending : '0'}
              </p>
              <p className="text-[9px] text-muted-foreground">H2O</p>
            </div>
          </div>

          {isStaked && (
            <div className="mt-3 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[11px] text-green-400 font-mono">{livePending} H2O</span>
              <span className="text-[10px] text-muted-foreground">· acumulando en tiempo real</span>
            </div>
          )}

          {totalStaked > 0n && (
            <p className="text-[10px] text-muted-foreground mt-2">
              Pool total: {formatToken(totalStaked, 18, 0)} H2O stakeados
            </p>
          )}
        </div>
      </div>

      {/* ── Action tabs ───────────────────────────────────────────────── */}
      <div>
        <div className="flex bg-black/30 border border-border rounded-xl p-1 mb-3">
          {([
            { id: 'deposit',  label: '💧 Depositar' },
            { id: 'withdraw', label: '↩ Retirar' },
            { id: 'claim',    label: '🎁 Reclamar' },
          ] as { id: ActionTab; label: string }[]).map(t => (
            <button key={t.id}
              onClick={() => { setTab(t.id); setAmount(''); setMsg(null) }}
              className={cn('flex-1 py-2 text-xs font-semibold rounded-lg transition-all',
                tab === t.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-muted-foreground hover:text-foreground')}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Deposit tab ─────────────────────────────────────────────── */}
        {tab === 'deposit' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Balance: <span className="text-foreground font-medium">{formatToken(h2oBalance)} H2O</span>
              </span>
              <button onClick={() => setAmount(ethers.formatEther(h2oBalance))}
                className="text-cyan-400 hover:text-cyan-300 font-medium">MAX</button>
            </div>
            <div className="relative">
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-black/30 border border-border rounded-xl px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500 pr-16" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-cyan-400">H2O</span>
            </div>
            <div className="bg-black/20 rounded-xl p-3 space-y-1">
              <p className="text-xs font-medium text-foreground">Flujo de depósito via Permit2</p>
              <p className="text-xs text-muted-foreground">
                1. World App te pide firmar la autorización Permit2 de H2O
              </p>
              <p className="text-xs text-muted-foreground">
                2. Se ejecuta <code className="text-cyan-400">stake(permit, sig)</code> — sin approve separado
              </p>
              <p className="text-xs text-muted-foreground">
                3. Fee de depósito: <span className="text-foreground">{Number(depFee)/100}%</span> · Starts accruing rewards instantly
              </p>
            </div>
            <Button className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-semibold h-11"
              onClick={doStake} disabled={txLoading || !amount || parseFloat(amount) <= 0}>
              {txLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
              Depositar H2O
            </Button>
          </div>
        )}

        {/* ── Withdraw tab ─────────────────────────────────────────────── */}
        {tab === 'withdraw' && (
          <div className="space-y-3">
            <div className="bg-black/20 border border-border rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-1">Tu stake activo</p>
              <p className={cn('text-xl font-bold', isStaked ? 'text-cyan-300' : 'text-muted-foreground')}>
                {formatToken(staked)} <span className="text-sm">H2O</span>
              </p>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Cantidad (vacío = retiro total)</span>
              <button onClick={() => setAmount(ethers.formatEther(staked))}
                className="text-cyan-400 hover:text-cyan-300 font-medium">TODO</button>
            </div>
            <div className="relative">
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder={formatToken(staked)}
                className="w-full bg-black/30 border border-border rounded-xl px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-orange-500 pr-16" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-orange-400">H2O</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Fee de retiro: <span className="text-foreground font-medium">{Number(withFee)/100}%</span>
            </p>
            <Button className="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold h-11"
              onClick={doUnstake} disabled={txLoading || !isStaked}>
              {txLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Unlock className="w-4 h-4 mr-2" />}
              {isStaked ? 'Retirar H2O' : 'Sin stake activo'}
            </Button>
          </div>
        )}

        {/* ── Claim tab ─────────────────────────────────────────────────── */}
        {tab === 'claim' && (
          <div className="space-y-3">
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
              <p className="text-xs text-green-400 mb-1">Rewards acumulados</p>
              <p className="text-3xl font-bold font-mono text-green-300">{isStaked ? livePending : '0'}</p>
              <p className="text-xs text-green-400 mt-0.5">H2O</p>
              {isStaked && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  ✨ Crecen cada segundo según tu proporción del pool
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Fee de reclamo: <span className="text-foreground font-medium">{Number(clmFee)/100}%</span>
              {' '}· 5% del fee va al pool de referidos
            </p>
            {!canClaim && isStaked && (
              <div className="text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-xl px-3 py-2">
                Los rewards se acumulan con el tiempo. El botón se activa cuando el contrato confirma saldo reclamable.
              </div>
            )}
            <Button
              className={cn('w-full font-semibold h-11', canClaim ? 'bg-green-600 hover:bg-green-500 text-white' : '')}
              variant={canClaim ? 'default' : 'secondary'}
              onClick={doClaim}
              disabled={txLoading || !canClaim}
            >
              {txLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />}
              {canClaim ? `Reclamar ${livePending} H2O` : 'Sin rewards pendientes'}
            </Button>
          </div>
        )}

        {/* Message toast — stake/unstake/claim actions */}
        {msg && (
          <div className={cn('mt-3 rounded-xl px-3 py-2.5 text-xs font-medium text-center border',
            msg.ok
              ? 'bg-green-500/10 border-green-500/20 text-green-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300')}>
            {msg.text}
          </div>
        )}
      </div>

      {/* ── VIP ───────────────────────────────────────────────────────── */}
      <VIPBanner
        vipPrice={info?.vipPrice ?? 0n}
        vipExpiry={info?.vipExpiry ?? 0n}
        uth2Balance={info?.uth2Balance ?? 0n}
        ownerVipPending={info?.ownerVipPending ?? 0n}
        onBuy={doBuyVIP}
        onClaimOwnerVip={doClaimOwnerVip}
        loading={txLoading}
      />

      {/* ── Message toast visible from VIP actions ─────────────────────── */}
      {msg && (
        <div className={cn('rounded-xl px-4 py-3 text-xs font-medium text-center border break-words',
          msg.ok
            ? 'bg-green-500/10 border-green-500/20 text-green-300'
            : 'bg-red-500/10 border-red-500/20 text-red-300')}>
          {msg.text}
        </div>
      )}

      {/* ── Referral ──────────────────────────────────────────────────── */}
      <ReferralSection
        userAddress={userAddress}
        referrer={info?.referrer ?? ethers.ZeroAddress}
        refCount={info?.refCount ?? 0n}
        refPending={info?.refPending ?? 0n}
        pendingRef={
          pendingRef && (info?.referrer === ethers.ZeroAddress || !info?.referrer)
            ? pendingRef
            : null
        }
        onRegister={doRegisterRef}
        onClaimRef={doClaimRef}
        loading={txLoading}
      />

      {/* ── Legacy V1 ─────────────────────────────────────────────────── */}
      <LegacyPanel userAddress={userAddress} />

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-black/20 p-3">
        <div className="flex items-center justify-center gap-3 flex-wrap text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-green-400" />
            <span>APY </span>
            <span className={apyDisplay !== '—' ? 'text-green-400 font-bold' : ''}>{apyDisplay}</span>
          </span>
          <span className="w-px h-3 bg-border" />
          <span className="flex items-center gap-1"><Star className="w-3 h-3 text-yellow-400" />VIP Pool UTH2</span>
          <span className="w-px h-3 bg-border" />
          <span className="flex items-center gap-1"><Users className="w-3 h-3 text-cyan-400" />Referidos 5%</span>
          <span className="w-px h-3 bg-border" />
          <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-green-400" />Rewards/seg</span>
        </div>
      </div>
    </div>
  )
}
