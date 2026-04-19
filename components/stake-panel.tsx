'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Droplets, Lock, Unlock, Gift, RefreshCw, Loader2,
  Users, Crown, Copy, Check, ChevronDown, ChevronUp,
  TrendingUp, Zap, Star, ArrowRightLeft, AlertTriangle,
  Sparkles, Share2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  H2O_STAKING_ADDRESS, H2O_TOKEN, UTH2_TOKEN,
  STAKE_ABI_FRAG, UNSTAKE_ABI_FRAG, CLAIM_ABI_FRAG,
  CLAIM_REF_ABI_FRAG, REGISTER_REF_ABI_FRAG, BUY_VIP_ABI_FRAG,
  APPROVE_ABI_FRAG, fetchH2OStakeInfo, formatToken, shortenAddress,
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

// ── Live pending counter ──────────────────────────────────────────────────
function useLivePending(base: bigint, apyBps: bigint, staked: bigint): string {
  const [val, setVal] = useState(parseFloat(ethers.formatEther(base)))
  const baseRef = useRef(base)

  useEffect(() => {
    const n = parseFloat(ethers.formatEther(base))
    setVal(n)
    baseRef.current = base
  }, [base])

  useEffect(() => {
    if (staked === 0n || apyBps === 0n) return
    const apy    = Number(apyBps) / 10000
    const stk    = parseFloat(ethers.formatEther(staked))
    const perSec = (apy * stk) / (365 * 24 * 3600)
    const id = setInterval(() => setVal(p => p + perSec), 1000)
    return () => clearInterval(id)
  }, [base, apyBps, staked])

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

// ── Tab type ──────────────────────────────────────────────────────────────
type ActionTab = 'deposit' | 'withdraw' | 'claim'

// ── VIP banner ────────────────────────────────────────────────────────────
interface VIPBannerProps {
  vipPrice: bigint
  vipExpiry: bigint
  uth2Balance: bigint
  onBuy: (months: number) => Promise<void>
  loading: boolean
}
function VIPBanner({ vipPrice, vipExpiry, uth2Balance, onBuy, loading }: VIPBannerProps) {
  const [months, setMonths] = useState(1)
  const [expanded, setExpanded] = useState(false)
  const now = BigInt(Math.floor(Date.now() / 1000))
  const isVip = vipExpiry > now
  const daysLeft = isVip ? Math.floor(Number(vipExpiry - now) / 86400) : 0
  const totalCost = vipPrice * BigInt(months)
  const canAfford = uth2Balance >= totalCost

  return (
    <div className={cn(
      'rounded-2xl border overflow-hidden',
      isVip
        ? 'border-yellow-500/40 bg-gradient-to-br from-yellow-950/40 to-amber-900/20'
        : 'border-purple-500/30 bg-gradient-to-br from-purple-950/30 to-indigo-900/20'
    )}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4"
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center',
            isVip ? 'bg-yellow-500/20' : 'bg-purple-500/20'
          )}>
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
            </div>
            <p className="text-xs text-muted-foreground">
              {isVip
                ? `Expira en ${daysLeft} día${daysLeft !== 1 ? 's' : ''} · Beneficios activos`
                : 'Boost de APY + Fee reducido · Paga con UTH2'}
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '📈 APY Extra', value: '+2%' },
              { label: '💸 Fee Claim', value: '0%' },
              { label: '⚡ Acceso', value: 'Prioritario' },
            ].map(b => (
              <div key={b.label} className="bg-black/20 rounded-lg p-2 text-center">
                <p className="text-[10px] text-muted-foreground">{b.label}</p>
                <p className={cn('text-xs font-bold', isVip ? 'text-yellow-300' : 'text-purple-300')}>{b.value}</p>
              </div>
            ))}
          </div>

          {!isVip && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Meses:</span>
                {[1, 3, 6, 12].map(m => (
                  <button
                    key={m}
                    onClick={() => setMonths(m)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
                      months === m
                        ? 'bg-purple-500 text-white'
                        : 'bg-purple-500/10 text-purple-300 hover:bg-purple-500/20'
                    )}
                  >{m}m</button>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Costo total: <span className="text-purple-300 font-semibold">{formatToken(totalCost)} UTH2</span></span>
                <span>Balance: {formatToken(uth2Balance)} UTH2</span>
              </div>
              {!canAfford && (
                <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-2 py-1.5">
                  UTH2 insuficiente para activar la suscripción
                </p>
              )}
              <Button
                className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                onClick={() => onBuy(months)}
                disabled={loading || !canAfford || vipPrice === 0n}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Crown className="w-4 h-4 mr-2" />}
                Activar VIP por {months} mes{months !== 1 ? 'es' : ''}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Referral section ──────────────────────────────────────────────────────
interface ReferralSectionProps {
  userAddress: string
  referrer: string
  refRewards: bigint
  onRegister: (addr: string) => Promise<void>
  onClaimRef: () => Promise<void>
  loading: boolean
}
function ReferralSection({
  userAddress, referrer, refRewards, onRegister, onClaimRef, loading
}: ReferralSectionProps) {
  const [expanded, setExpanded]   = useState(false)
  const [refInput, setRefInput]   = useState('')
  const [refMsg, setRefMsg]       = useState('')
  const { copied, copy }          = useCopy()
  const referralLink = `https://acua.world/stake?ref=${userAddress}`
  const hasReferrer  = referrer && referrer !== ethers.ZeroAddress
  const hasRefRewards = refRewards > 0n

  const handleRegister = async () => {
    if (!ethers.isAddress(refInput)) { setRefMsg('Dirección inválida'); return }
    setRefMsg('')
    await onRegister(refInput)
    setRefInput('')
  }

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/30 to-blue-900/20 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center">
            <Users className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-cyan-300">Sistema de Referidos</p>
              {hasRefRewards && (
                <span className="text-[9px] font-bold bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full animate-pulse">
                  REWARDS!
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Invita amigos · Ambos ganan 5% de comisión de reclamo
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
          {/* How it works */}
          <div className="bg-black/20 rounded-xl p-3 space-y-2">
            <p className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> ¿Cómo funciona?
            </p>
            <div className="space-y-1.5">
              {[
                '🔗 Comparte tu enlace de referido con amigos',
                '✅ Cuando tu amigo hace claim, ambos ganan 5%',
                '💰 Reclama tus comisiones cuando quieras',
              ].map((s, i) => (
                <p key={i} className="text-xs text-muted-foreground">{s}</p>
              ))}
            </div>
          </div>

          {/* My referral link */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Tu enlace de referido</p>
            <div className="flex items-center gap-2 bg-black/30 border border-border rounded-lg px-3 py-2">
              <span className="text-xs text-cyan-300 truncate flex-1 font-mono">{referralLink}</span>
              <button
                onClick={() => copy(referralLink)}
                className="shrink-0 text-muted-foreground hover:text-cyan-400 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Referrer */}
          {!hasReferrer ? (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">¿Te invitó alguien? Registra su dirección</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={refInput}
                  onChange={e => setRefInput(e.target.value)}
                  placeholder="0x..."
                  className="flex-1 bg-black/30 border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500"
                />
                <Button
                  size="sm"
                  className="bg-cyan-600 hover:bg-cyan-700 text-white shrink-0"
                  onClick={handleRegister}
                  disabled={loading || !refInput}
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Registrar'}
                </Button>
              </div>
              {refMsg && <p className="text-xs text-red-400 mt-1">{refMsg}</p>}
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
              <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <p className="text-xs text-green-300">Referido registrado: {shortenAddress(referrer)}</p>
            </div>
          )}

          {/* Ref rewards */}
          {hasRefRewards && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-green-400">Comisiones de referido</p>
                  <p className="text-lg font-bold text-green-300">{formatToken(refRewards)} H2O</p>
                </div>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={onClaimRef}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gift className="w-3.5 h-3.5 mr-1" />}
                  Reclamar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Legacy V1 section ─────────────────────────────────────────────────────
interface LegacyPanelProps {
  userAddress: string
}
function LegacyPanel({ userAddress }: LegacyPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [info, setInfo]         = useState<StakeInfo | null>(null)
  const [loading, setLoading]   = useState(false)
  const [msg, setMsg]           = useState('')

  const load = useCallback(async () => {
    if (!userAddress) return
    try {
      const d = await fetchStakeInfo(userAddress)
      setInfo(d)
    } catch { /* noop */ }
  }, [userAddress])

  useEffect(() => { if (expanded) load() }, [expanded, load])

  const hasPosition = info && (info.stakedAmount > 0n || info.pending > 0n)

  async function doOldUnstake() {
    setLoading(true); setMsg('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: STAKING_CONTRACT, abi: OLD_UNSTAKE_ABI, functionName: 'unstake', args: [] }],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ Retirado. ¡Mueve tu H2O al nuevo Stake V2!')
        setTimeout(load, 2000)
      } else { setMsg('Transacción rechazada') }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  async function doOldClaim() {
    setLoading(true); setMsg('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: STAKING_CONTRACT, abi: OLD_CLAIM_ABI, functionName: 'claimRewards', args: [] }],
      })
      if (finalPayload.status === 'success') {
        setMsg('✓ Rewards reclamados. ¡Luego retira y migra al V2!')
        setTimeout(load, 2000)
      } else { setMsg('Transacción rechazada') }
    } catch (e: any) { setMsg(e.message || 'Error') }
    finally { setLoading(false) }
  }

  return (
    <div className="rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-950/20 to-red-900/10 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-orange-400" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-orange-300">Stake H2O V1 (legado)</p>
              <span className="text-[9px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded-full">
                MIGRAR
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Contrato anterior · Retira y migra al nuevo V2</p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
          {/* Migration notice */}
          <div className="flex items-start gap-2 bg-orange-500/10 border border-orange-500/20 rounded-xl p-3">
            <ArrowRightLeft className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
            <p className="text-xs text-orange-300">
              Este es el contrato V1 antiguo. <strong>Retira tu posición y migra al nuevo Stake H2O V2</strong> para acceder al nuevo APY de mercado, referidos y suscripción VIP.
            </p>
          </div>

          {info ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-black/20 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Staked V1</p>
                <p className="text-sm font-bold text-orange-300">
                  {formatToken(info.stakedAmount)} H2O
                </p>
              </div>
              <div className="bg-black/20 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Rewards V1</p>
                <p className="text-sm font-bold text-green-300">
                  {formatToken(info.pending)} H2O
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="border-green-500/30 text-green-400 hover:bg-green-500/10"
              onClick={doOldClaim}
              disabled={loading || !info || info.pending === 0n}
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Gift className="w-3.5 h-3.5 mr-1" />}
              Reclamar V1
            </Button>
            <Button
              variant="outline"
              className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
              onClick={doOldUnstake}
              disabled={loading || !info || info.stakedAmount === 0n}
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Unlock className="w-3.5 h-3.5 mr-1" />}
              Retirar y Migrar
            </Button>
          </div>

          {msg && (
            <p className={cn('text-xs text-center', msg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>
              {msg}
            </p>
          )}
          {!hasPosition && info && (
            <p className="text-xs text-center text-muted-foreground">
              Sin posición activa en V1 · ¡Ya puedes usar el nuevo V2!
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────
interface StakePanelProps {
  userAddress: string
}

export function StakePanel({ userAddress }: StakePanelProps) {
  const [info, setInfo]       = useState<H2OStakeInfo | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [tab, setTab]         = useState<ActionTab>('deposit')
  const [amount, setAmount]   = useState('')
  const [txLoading, setTxLoading] = useState(false)
  const [msg, setMsg]         = useState<{ text: string; ok: boolean } | null>(null)

  const livePending = useLivePending(
    info?.earned ?? 0n,
    info?.apyBps ?? 0n,
    info?.staked ?? 0n,
  )

  const loadInfo = useCallback(async () => {
    if (!userAddress) return
    setLoadingData(true)
    try {
      const d = await fetchH2OStakeInfo(userAddress)
      setInfo(d)
    } catch (e) { console.error('fetchH2OStakeInfo', e) }
    finally { setLoadingData(false) }
  }, [userAddress])

  useEffect(() => { loadInfo() }, [loadInfo])

  const showMsg = (text: string, ok: boolean) => {
    setMsg({ text, ok })
    setTimeout(() => setMsg(null), 5000)
  }

  // ── Stake (approve + stake batch) ────────────────────────────────────────
  async function doStake() {
    if (!amount || parseFloat(amount) <= 0) return showMsg('Ingresa un monto válido', false)
    setTxLoading(true)
    try {
      const amtWei = ethers.parseEther(amount)
      const maxUint = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          {
            address: H2O_TOKEN,
            abi: APPROVE_ABI_FRAG,
            functionName: 'approve',
            args: [H2O_STAKING_ADDRESS, maxUint],
          },
          {
            address: H2O_STAKING_ADDRESS,
            abi: STAKE_ABI_FRAG,
            functionName: 'stake',
            args: [amtWei.toString()],
          },
        ],
      })
      if (finalPayload.status === 'success') {
        showMsg('✓ ¡Stake realizado! Actualizando...', true)
        setAmount('')
        setTimeout(loadInfo, 2500)
      } else {
        showMsg('Transacción cancelada', false)
      }
    } catch (e: any) { showMsg(e.message || 'Error inesperado', false) }
    finally { setTxLoading(false) }
  }

  // ── Unstake ──────────────────────────────────────────────────────────────
  async function doUnstake() {
    const staked = info?.staked ?? 0n
    if (staked === 0n) return showMsg('No tienes H2O en stake', false)
    const withdrawAmt = amount ? ethers.parseEther(amount) : staked
    if (withdrawAmt > staked) return showMsg('Monto mayor a tu stake', false)
    setTxLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: UNSTAKE_ABI_FRAG,
          functionName: 'unstake',
          args: [withdrawAmt.toString()],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg('✓ Retiro exitoso. ¡Tu H2O está de regreso!', true)
        setAmount('')
        setTimeout(loadInfo, 2500)
      } else { showMsg('Transacción cancelada', false) }
    } catch (e: any) { showMsg(e.message || 'Error inesperado', false) }
    finally { setTxLoading(false) }
  }

  // ── Claim ────────────────────────────────────────────────────────────────
  async function doClaim() {
    if ((info?.earned ?? 0n) === 0n) return showMsg('Sin rewards pendientes aún', false)
    setTxLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: CLAIM_ABI_FRAG,
          functionName: 'claimRewards',
          args: [],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg('✓ ¡Rewards reclamados! Actualizando...', true)
        setTimeout(loadInfo, 2500)
      } else { showMsg('Transacción cancelada', false) }
    } catch (e: any) { showMsg(e.message || 'Error inesperado', false) }
    finally { setTxLoading(false) }
  }

  // ── Register referrer ────────────────────────────────────────────────────
  async function doRegisterRef(addr: string) {
    setTxLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: REGISTER_REF_ABI_FRAG,
          functionName: 'registerReferrer',
          args: [addr],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg('✓ Referido registrado correctamente', true)
        setTimeout(loadInfo, 2000)
      } else { showMsg('Transacción cancelada', false) }
    } catch (e: any) { showMsg(e.message || 'Error', false) }
    finally { setTxLoading(false) }
  }

  // ── Claim ref rewards ────────────────────────────────────────────────────
  async function doClaimRef() {
    setTxLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: CLAIM_REF_ABI_FRAG,
          functionName: 'claimRefRewards',
          args: [],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg('✓ Comisiones de referido reclamadas', true)
        setTimeout(loadInfo, 2000)
      } else { showMsg('Transacción cancelada', false) }
    } catch (e: any) { showMsg(e.message || 'Error', false) }
    finally { setTxLoading(false) }
  }

  // ── Buy VIP ──────────────────────────────────────────────────────────────
  async function doBuyVIP(months: number) {
    const vipPrice = info?.vipPrice ?? 0n
    if (vipPrice === 0n) return showMsg('Precio VIP no disponible', false)
    const totalCost = vipPrice * BigInt(months)
    const maxUint = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
    setTxLoading(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          {
            address: UTH2_TOKEN,
            abi: APPROVE_ABI_FRAG,
            functionName: 'approve',
            args: [H2O_STAKING_ADDRESS, maxUint],
          },
          {
            address: H2O_STAKING_ADDRESS,
            abi: BUY_VIP_ABI_FRAG,
            functionName: 'buyVIP',
            args: [months.toString()],
          },
        ],
      })
      if (finalPayload.status === 'success') {
        showMsg(`✓ ¡VIP activado por ${months} mes${months !== 1 ? 'es' : ''}! Bienvenido 👑`, true)
        setTimeout(loadInfo, 2000)
      } else { showMsg('Transacción cancelada', false) }
    } catch (e: any) { showMsg(e.message || 'Error', false) }
    finally { setTxLoading(false) }
  }

  const staked      = info?.staked      ?? 0n
  const earned      = info?.earned      ?? 0n
  const h2oBalance  = info?.h2oBalance  ?? 0n
  const apyBps      = info?.apyBps      ?? 1200n
  const rewardFee   = info?.rewardFee   ?? 500n
  const apyDisplay  = (Number(apyBps) / 100).toFixed(1) + '%'
  const feeDisplay  = (Number(rewardFee) / 100).toFixed(1) + '%'
  const isStaked    = staked > 0n
  const canClaim    = earned > 0n

  return (
    <div className="space-y-4">

      {/* ── Hero header ──────────────────────────────────────────────── */}
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
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-1.5 py-0.5 rounded-full">
                    APY {apyDisplay}
                  </span>
                  <span className="text-[10px] text-muted-foreground">· Fee claim {feeDisplay}</span>
                </div>
              </div>
            </div>
            <button
              onClick={loadInfo}
              disabled={loadingData}
              className="text-muted-foreground hover:text-cyan-400 transition-colors"
            >
              <RefreshCw className={cn('w-4 h-4', loadingData && 'animate-spin')} />
            </button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-black/20 rounded-xl p-2.5 text-center border border-white/5">
              <p className="text-[10px] text-muted-foreground mb-0.5">Balance</p>
              <p className="text-sm font-bold text-foreground">
                {loadingData ? '…' : formatToken(h2oBalance, 18, 2)}
              </p>
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

          {/* Live accumulation bar */}
          {isStaked && (
            <div className="mt-3 flex items-center gap-2 text-xs text-green-400">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="font-mono text-[11px]">+{livePending} H2O acumulados</span>
              <span className="text-muted-foreground text-[10px]">· creciendo en tiempo real</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Action tabs ──────────────────────────────────────────────── */}
      <div>
        <div className="flex bg-black/30 border border-border rounded-xl p-1 mb-3">
          {([
            { id: 'deposit',  label: '💧 Depositar', icon: Lock },
            { id: 'withdraw', label: '↩ Retirar',    icon: Unlock },
            { id: 'claim',    label: '🎁 Reclamar',  icon: Gift },
          ] as { id: ActionTab; label: string; icon: any }[]).map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setAmount(''); setMsg(null) }}
              className={cn(
                'flex-1 py-2 text-xs font-semibold rounded-lg transition-all',
                tab === t.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Deposit */}
        {tab === 'deposit' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Balance: <span className="text-foreground">{formatToken(h2oBalance)} H2O</span></span>
              <button
                onClick={() => setAmount(ethers.formatEther(h2oBalance))}
                className="text-cyan-400 hover:text-cyan-300 font-medium"
              >
                MAX
              </button>
            </div>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-black/30 border border-border rounded-xl px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500 pr-16"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-cyan-400">H2O</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TrendingUp className="w-3 h-3 text-cyan-400" />
              <span>APY mercado: <span className="text-cyan-400 font-medium">{apyDisplay}</span> · Rewards en tiempo real</span>
            </div>
            <Button
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-semibold h-11"
              onClick={doStake}
              disabled={txLoading || !amount || parseFloat(amount) <= 0}
            >
              {txLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
              Depositar H2O
            </Button>
          </div>
        )}

        {/* Withdraw */}
        {tab === 'withdraw' && (
          <div className="space-y-3">
            <div className="bg-black/20 border border-border rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-1">Tu stake activo</p>
              <p className={cn('text-xl font-bold', isStaked ? 'text-cyan-300' : 'text-muted-foreground')}>
                {formatToken(staked)} <span className="text-sm">H2O</span>
              </p>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Cantidad a retirar (vacío = todo)</span>
              <button
                onClick={() => setAmount(ethers.formatEther(staked))}
                className="text-cyan-400 hover:text-cyan-300 font-medium"
              >
                TODO
              </button>
            </div>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={formatToken(staked)}
                className="w-full bg-black/30 border border-border rounded-xl px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-orange-500 pr-16"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-orange-400">H2O</span>
            </div>
            <Button
              className="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold h-11"
              onClick={doUnstake}
              disabled={txLoading || !isStaked}
            >
              {txLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Unlock className="w-4 h-4 mr-2" />}
              {isStaked ? 'Retirar H2O' : 'Sin stake activo'}
            </Button>
          </div>
        )}

        {/* Claim */}
        {tab === 'claim' && (
          <div className="space-y-3">
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
              <p className="text-xs text-green-400 mb-1">Rewards pendientes</p>
              <p className="text-3xl font-bold font-mono text-green-300">{isStaked ? livePending : '0'}</p>
              <p className="text-xs text-green-400 mt-0.5">H2O</p>
              {isStaked && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  ✨ Se acumulan cada segundo · 24 horas al día
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Fee de reclamo: <span className="text-foreground font-medium">{feeDisplay}</span></span>
              <span>·</span>
              <span>APY: <span className="text-cyan-400 font-medium">{apyDisplay}</span></span>
            </div>
            {!canClaim && isStaked && (
              <div className="text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-xl px-3 py-2">
                Los rewards se acumulan continuamente. El botón se activa cuando hay saldo reclamable en el contrato.
              </div>
            )}
            <Button
              className={cn(
                'w-full font-semibold h-11',
                canClaim
                  ? 'bg-green-600 hover:bg-green-500 text-white'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
              onClick={doClaim}
              disabled={txLoading || !canClaim}
            >
              {txLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />}
              {canClaim ? `Reclamar ${livePending} H2O` : 'Sin rewards pendientes'}
            </Button>
          </div>
        )}

        {/* Message toast */}
        {msg && (
          <div className={cn(
            'mt-3 rounded-xl px-3 py-2.5 text-xs font-medium text-center border',
            msg.ok
              ? 'bg-green-500/10 border-green-500/20 text-green-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          )}>
            {msg.text}
          </div>
        )}
      </div>

      {/* ── VIP Subscription ─────────────────────────────────────────── */}
      <VIPBanner
        vipPrice={info?.vipPrice ?? 0n}
        vipExpiry={info?.vipExpiry ?? 0n}
        uth2Balance={info?.uth2Balance ?? 0n}
        onBuy={doBuyVIP}
        loading={txLoading}
      />

      {/* ── Referral ─────────────────────────────────────────────────── */}
      <ReferralSection
        userAddress={userAddress}
        referrer={info?.referrer ?? ethers.ZeroAddress}
        refRewards={info?.refRewards ?? 0n}
        onRegister={doRegisterRef}
        onClaimRef={doClaimRef}
        loading={txLoading}
      />

      {/* ── Legacy V1 ────────────────────────────────────────────────── */}
      <LegacyPanel userAddress={userAddress} />

      {/* ── Footer info ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-black/20 p-3">
        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-cyan-400" />
            APY {apyDisplay} en H2O
          </span>
          <span className="w-px h-3 bg-border" />
          <span className="flex items-center gap-1">
            <Star className="w-3 h-3 text-yellow-400" />
            VIP reduce fees
          </span>
          <span className="w-px h-3 bg-border" />
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3 text-cyan-400" />
            Ref 5%
          </span>
        </div>
      </div>
    </div>
  )
}
