'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { ethers } from 'ethers'
import {
  TrendingUp, Clock, RefreshCw, Loader2, ChevronDown, AlertCircle,
  Wallet, Star, Award, Diamond, Crown, ExternalLink, Info,
  Users, Gift, Zap, Lock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLang } from '@/context/lang-context'
import { t } from '@/lib/i18n'
import {
  SUSHI_BNB_CONTRACT, SUSHI_BNB_TOKEN, BNB_RPC,
  SUSHI_BNB_ABI, ERC20_ABI, MEMBERSHIP_TIERS,
} from '@/lib/sushibnb-abi'

const SUSHI_COLOR = '#e84142'
const BNB_COLOR = '#f0b90b'

interface StakeInfo {
  staked: bigint
  pendingRewards: bigint
  cookingUntil: number
  cookingStarted: number
  membership: number
  membershipExpires: number
  streakBps: number
  sushiBal: bigint
  bnbBal: bigint
}

const COOK_OPTIONS = [
  { label: '15 min', seconds: 900,   minTier: 0 },
  { label: '45 min', seconds: 2700,  minTier: 1 },
  { label: '3 horas', seconds: 10800, minTier: 2 },
  { label: '24 horas', seconds: 86400, minTier: 2 },
  { label: '48 horas', seconds: 172800, minTier: 3 },
]

function fmtSushi(v: bigint, dec = 4): string {
  const n = parseFloat(ethers.formatEther(v))
  if (n === 0) return '0.0000'
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n.toFixed(dec)
}

function fmtBNB(v: bigint): string {
  return parseFloat(ethers.formatEther(v)).toFixed(4)
}

function countdown(until: number): string {
  const diff = until - Math.floor(Date.now() / 1000)
  if (diff <= 0) return 'Listo'
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function MembershipBadge({ tier }: { tier: number }) {
  const meta = MEMBERSHIP_TIERS[tier] ?? MEMBERSHIP_TIERS[0]
  const icons = ['', '🥈', '🥇', '💎']
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border"
      style={{ color: meta.color, borderColor: `${meta.color}50`, background: `${meta.color}15` }}>
      {icons[tier]} {meta.name}
    </span>
  )
}

interface BNBSushiPanelProps {
  bnbAddress: string | null
}

export function BNBSushiPanel({ bnbAddress }: BNBSushiPanelProps) {
  const { lang } = useLang()
  const [info, setInfo] = useState<StakeInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeView, setActiveView] = useState<'stake' | 'membership' | 'referral'>('stake')

  // Input states
  const [depositAmt, setDepositAmt] = useState('')
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [cookOption, setCookOption] = useState(0)
  const [showCookDrop, setShowCookDrop] = useState(false)
  const [referralCode, setReferralCode] = useState('')
  const [txStatus, setTxStatus] = useState<string | null>(null)
  const [txPending, setTxPending] = useState(false)

  const load = useCallback(async (addr: string) => {
    setLoading(true)
    try {
      const provider = new ethers.JsonRpcProvider(BNB_RPC)
      const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, provider)
      const sushiToken = new ethers.Contract(SUSHI_BNB_TOKEN, ERC20_ABI, provider)

      const [stakeInfo, membership, streak, sushiBal, bnbBal] = await Promise.allSettled([
        contract.getStakeInfo(addr),
        contract.getMembership(addr),
        contract.getStreakMultiplier(addr),
        sushiToken.balanceOf(addr),
        provider.getBalance(addr),
      ])

      const si = stakeInfo.status === 'fulfilled' ? stakeInfo.value : [0n, 0n, 0n, 0n]
      const mb = membership.status === 'fulfilled' ? membership.value : [0, 0]
      const sk = streak.status === 'fulfilled' ? streak.value : 10000n
      const sb = sushiBal.status === 'fulfilled' ? sushiBal.value : 0n
      const bb = bnbBal.status === 'fulfilled' ? bnbBal.value : 0n

      setInfo({
        staked: BigInt(si[0]?.toString() ?? '0'),
        pendingRewards: BigInt(si[1]?.toString() ?? '0'),
        cookingUntil: Number(si[2]?.toString() ?? '0'),
        cookingStarted: Number(si[3]?.toString() ?? '0'),
        membership: Number(mb[0]?.toString() ?? '0'),
        membershipExpires: Number(mb[1]?.toString() ?? '0'),
        streakBps: Number(sk?.toString() ?? '10000'),
        sushiBal: BigInt(sb?.toString() ?? '0'),
        bnbBal: BigInt(bb?.toString() ?? '0'),
      })
    } catch (e) {
      console.error('[BNBSushi] load error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (bnbAddress) load(bnbAddress)
  }, [bnbAddress, load])

  const handleTx = async (action: () => Promise<ethers.TransactionResponse>, successMsg: string) => {
    setTxPending(true)
    setTxStatus(null)
    try {
      const tx = await action()
      setTxStatus(`TX: ${tx.hash.slice(0, 10)}...`)
      await tx.wait()
      setTxStatus(`✓ ${successMsg}`)
      if (bnbAddress) await load(bnbAddress)
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason ?? e?.message ?? 'Error'}`)
    } finally {
      setTxPending(false)
    }
  }

  const getSigner = async () => {
    const provider = new ethers.JsonRpcProvider(BNB_RPC)
    if (!bnbAddress) throw new Error('No BNB wallet')
    // For imported wallets, we'd use the private key stored in context
    // This is a frontend-only implementation
    throw new Error('Necesitas conectar tu wallet BNB con clave privada importada')
  }

  const isCooking = info ? info.cookingUntil > Math.floor(Date.now() / 1000) : false
  const multiplier = info ? (info.streakBps / 10000).toFixed(2) : '1.00'
  const cookOpt = COOK_OPTIONS[cookOption]

  if (!bnbAddress) {
    return (
      <div className="space-y-4 pb-24">
        <div className="relative rounded-2xl overflow-hidden p-5" style={{ background: 'linear-gradient(135deg,#7c1d1d,#e8414210,#0a0a14)' }}>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-[#e84142]/40 shrink-0 flex items-center justify-center text-3xl"
              style={{ background: '#e8414215' }}>🍣</div>
            <div>
              <p className="text-[10px] font-bold text-[#e84142]/80 uppercase tracking-wider">ACUA en</p>
              <h2 className="text-xl font-black text-foreground">SUSHI Staking BNB</h2>
              <p className="text-[10px] text-[oklch(0.50_0.012_230)]">Conecta tu wallet BNB para comenzar</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/8 border border-amber-500/25">
          <Wallet className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-xs font-bold text-amber-400">Wallet BNB requerida</p>
            <p className="text-[10px] text-[oklch(0.50_0.012_230)]">
              Importa una wallet en el selector de redes (esquina superior derecha) para acceder al staking SUSHI en BNB Chain.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="relative rounded-2xl overflow-hidden p-4" style={{ background: 'linear-gradient(135deg,#7c1d1d,#e8414210,#0a0a14)' }}>
        <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(circle at 80% 50%, #e84142, transparent 60%)' }} />
        <div className="relative flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl border border-[#e84142]/30" style={{ background: '#e8414215' }}>🍣</div>
          <div className="flex-1">
            <p className="text-[10px] font-bold text-[#e84142]/80 uppercase tracking-wider">SUSHI Staking · BNB Chain</p>
            <h2 className="text-lg font-black text-foreground">🍣 SUSHI Staking</h2>
          </div>
          <div className="flex items-center gap-1.5">
            {info && <MembershipBadge tier={info.membership} />}
            <button onClick={() => bnbAddress && load(bnbAddress)} disabled={loading}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10">
              <RefreshCw className={cn('w-3.5 h-3.5 text-[oklch(0.45_0.01_230)]', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Balances row */}
        <div className="relative mt-3 flex gap-2">
          <div className="flex-1 rounded-xl bg-black/20 border border-white/5 px-3 py-2 text-center">
            <p className="text-[8px] text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Saldo SUSHI</p>
            <p className="text-sm font-black font-mono" style={{ color: SUSHI_COLOR }}>
              {info ? fmtSushi(info.sushiBal) : '—'}
            </p>
          </div>
          <div className="flex-1 rounded-xl bg-black/20 border border-white/5 px-3 py-2 text-center">
            <p className="text-[8px] text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Saldo BNB</p>
            <p className="text-sm font-black font-mono" style={{ color: BNB_COLOR }}>
              {info ? fmtBNB(info.bnbBal) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Tab selector */}
      <div className="flex rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-1 gap-1">
        {[
          { id: 'stake', label: '🍣 Stake', icon: null },
          { id: 'membership', label: '👑 VIP', icon: null },
          { id: 'referral', label: '🤝 Referidos', icon: null },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id as any)}
            className={cn(
              'flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-colors',
              activeView === tab.id
                ? 'text-white'
                : 'text-[oklch(0.50_0.012_230)] hover:text-foreground'
            )}
            style={activeView === tab.id ? { background: SUSHI_COLOR } : {}}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TX Status */}
      {txStatus && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-medium border',
          txStatus.startsWith('✓') ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-400'
          : txStatus.startsWith('✗') ? 'border-red-500/30 bg-red-500/8 text-red-400'
          : 'border-blue-500/30 bg-blue-500/8 text-blue-400'
        )}>
          {txPending && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
          {txStatus}
        </div>
      )}

      {/* ─── STAKE VIEW ─── */}
      {activeView === 'stake' && (
        <div className="space-y-3">
          {/* Staked balance */}
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4">
            <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider mb-2">Balance stakeado</p>
            <div className="flex items-center gap-3">
              <span className="text-2xl">🍣</span>
              <p className="text-3xl font-black font-mono" style={{ color: SUSHI_COLOR }}>
                {info ? fmtSushi(info.staked, 2) : '—'}
              </p>
            </div>
          </div>

          {/* Rewards */}
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4">
            <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider mb-2">Recompensas Acumuladas</p>
            <div className="flex items-center gap-3 mb-3">
              <p className="text-2xl font-black font-mono" style={{ color: SUSHI_COLOR }}>
                {info ? fmtSushi(info.pendingRewards, 6) : '0.000000'}
              </p>
              <span className="text-xl">🍣</span>
            </div>
            <button
              onClick={() => handleTx(async () => {
                const signer = await getSigner()
                const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
                return contract.harvest()
              }, 'Recompensas retiradas')}
              disabled={txPending || !info || info.pendingRewards === 0n}
              className="w-full py-2.5 rounded-xl text-xs font-bold border border-[oklch(0.30_0.025_245)] bg-[oklch(0.14_0.02_245)] text-[oklch(0.60_0.01_230)] disabled:opacity-40 hover:bg-[oklch(0.18_0.025_245)] transition-colors flex items-center justify-center gap-2"
            >
              {txPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '🍜'}
              RETIRAR RECOMPENSAS
            </button>
          </div>

          {/* Cooking section */}
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] overflow-hidden">
            <div className="p-4 space-y-3"
              style={{ backgroundImage: 'url(https://i.imgur.com/XwFMb7Q.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundBlendMode: 'overlay' }}>
              <div className="bg-black/60 rounded-xl p-3 space-y-3 backdrop-blur-sm">
                <p className="text-xs font-bold text-foreground">Ajustes de Cocción</p>

                {isCooking ? (
                  <div className="rounded-xl bg-[#e84142]/15 border border-[#e84142]/30 p-3 text-center">
                    <p className="text-[10px] text-[oklch(0.50_0.012_230)] mb-1">⏳ Cocinando hasta</p>
                    <p className="text-sm font-black font-mono" style={{ color: SUSHI_COLOR }}>
                      {countdown(info?.cookingUntil ?? 0)}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Cook time dropdown */}
                    <div className="relative">
                      <p className="text-[9px] text-[oklch(0.45_0.01_230)] mb-1">Elige el tiempo de Cocción (Min 15m)</p>
                      <button
                        onClick={() => setShowCookDrop(v => !v)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] text-xs font-medium text-foreground"
                        disabled={(info?.membership ?? 0) < (COOK_OPTIONS[cookOption]?.minTier ?? 0)}
                      >
                        {cookOpt.label}
                        <ChevronDown className={cn('w-3.5 h-3.5 text-[oklch(0.45_0.01_230)] transition-transform', showCookDrop && 'rotate-180')} />
                      </button>
                      {showCookDrop && (
                        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.12_0.02_245)] z-20 overflow-hidden">
                          {COOK_OPTIONS.map((opt, i) => {
                            const locked = (info?.membership ?? 0) < opt.minTier
                            return (
                              <button
                                key={i}
                                onClick={() => { if (!locked) { setCookOption(i); setShowCookDrop(false) } }}
                                className={cn(
                                  'w-full flex items-center justify-between px-3 py-2 text-xs transition-colors',
                                  locked ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/5',
                                  cookOption === i && 'bg-[#e84142]/10',
                                )}
                              >
                                <span className="font-medium text-foreground">{opt.label}</span>
                                {locked && <Lock className="w-3 h-3 text-[oklch(0.45_0.01_230)]" />}
                                {cookOption === i && <span className="text-[#e84142]">✓</span>}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* Streak multiplier */}
                    <div className="rounded-xl bg-[oklch(0.10_0.018_245)]/60 border border-white/5 px-3 py-2">
                      <p className="text-[9px] text-[oklch(0.45_0.01_230)] mb-1">Multiplicador de Racha</p>
                      <p className="text-sm font-black font-mono text-emerald-400">{multiplier}x (?)</p>
                    </div>

                    {/* Projected rewards */}
                    <div className="rounded-xl bg-[oklch(0.10_0.018_245)]/60 border border-white/5 px-3 py-2">
                      <p className="text-[9px] text-[oklch(0.45_0.01_230)] mb-1">Proyección de Recompensas:</p>
                      <p className="text-sm font-black font-mono text-emerald-400">
                        + {info ? (parseFloat(fmtSushi(info.staked)) * (cookOpt.seconds / 86400) * 0.0082 * (info.streakBps / 10000)).toFixed(6) : '0.000000'} Sushis (?)
                      </p>
                    </div>

                    {/* Cook button */}
                    <button
                      onClick={() => handleTx(async () => {
                        const signer = await getSigner()
                        const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
                        return contract.cook(cookOpt.seconds)
                      }, '¡Cocción iniciada!')}
                      disabled={txPending || !info || info.staked === 0n}
                      className="w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', boxShadow: '0 0 16px rgba(34,197,94,0.4)' }}
                    >
                      {txPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '🍳'}
                      {t('cook', lang).toUpperCase()}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Deposit */}
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-3">
            <p className="text-xs font-bold text-foreground">Depositar SUSHI</p>
            <div className="relative">
              <input
                type="number"
                value={depositAmt}
                onChange={e => setDepositAmt(e.target.value)}
                placeholder="0.0"
                className="w-full bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-[#e84142]/50 placeholder:text-[oklch(0.35_0.01_230)]"
              />
              <button onClick={() => setDepositAmt(info ? fmtSushi(info.sushiBal, 6) : '')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-[#e84142] hover:text-[#ff6b6b]">MAX</button>
            </div>
            <button
              onClick={() => handleTx(async () => {
                const signer = await getSigner()
                const amount = ethers.parseEther(depositAmt)
                const token = new ethers.Contract(SUSHI_BNB_TOKEN, ERC20_ABI, signer)
                const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
                const allowance = await token.allowance(bnbAddress, SUSHI_BNB_CONTRACT)
                if (allowance < amount) {
                  const approveTx = await token.approve(SUSHI_BNB_CONTRACT, ethers.MaxUint256)
                  await approveTx.wait()
                }
                return contract.deposit(amount)
              }, 'Depositado correctamente')}
              disabled={txPending || !depositAmt}
              className="w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white' }}
            >
              {txPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '🍱'}
              {t('deposit', lang).toUpperCase()}
            </button>
          </div>

          {/* Withdraw */}
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-3">
            <p className="text-xs font-bold text-foreground">Retirar SUSHI</p>
            <div className="relative">
              <input
                type="number"
                value={withdrawAmt}
                onChange={e => setWithdrawAmt(e.target.value)}
                placeholder="0.0"
                className="w-full bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-[#e84142]/50 placeholder:text-[oklch(0.35_0.01_230)]"
              />
              <button onClick={() => setWithdrawAmt(info ? fmtSushi(info.staked, 6) : '')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-[#e84142] hover:text-[#ff6b6b]">MAX</button>
            </div>
            <button
              onClick={() => handleTx(async () => {
                const signer = await getSigner()
                const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
                return contract.withdraw(ethers.parseEther(withdrawAmt))
              }, 'Retiro completado')}
              disabled={txPending || !withdrawAmt || !info || info.staked === 0n}
              className="w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all border border-[#e84142]/40"
              style={{ background: '#e8414210', color: '#e84142' }}
            >
              {txPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '📤'}
              RETIRAR BALANCE
            </button>
          </div>
        </div>
      )}

      {/* ─── MEMBERSHIP VIEW ─── */}
      {activeView === 'membership' && (
        <div className="space-y-3">
          {/* Hero */}
          <div className="rounded-2xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-5 text-center space-y-3">
            <div className="text-5xl">💪</div>
            <h3 className="text-base font-black text-foreground">🚀 Potenciá tus ganancias! 🚀</h3>
            <p className="text-[10px] text-[oklch(0.50_0.012_230)]">
              ✨ Aumentá tu nivel para cambiar el tiempo de cocción de tus sushis. ✨
            </p>
            <div className="flex items-center justify-center gap-2">
              <p className="text-[10px] text-[oklch(0.45_0.01_230)]">Mi Membresía actual:</p>
              {info && <MembershipBadge tier={info.membership} />}
            </div>
          </div>

          {/* Tiers */}
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[oklch(0.18_0.02_245)] flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-400" />
              <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">VIP · MEMBRESÍAS DISPONIBLES</p>
            </div>
            <div className="divide-y divide-[oklch(0.15_0.02_245)]">
              {MEMBERSHIP_TIERS.map((tier, i) => {
                const isCurrent = (info?.membership ?? 0) === i
                const icons = ['⚪', '🥈', '🥇', '💎']
                return (
                  <div key={i} className={cn(
                    'flex items-center gap-3 px-4 py-3 transition-colors',
                    isCurrent && 'bg-[oklch(0.14_0.02_245)]'
                  )}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{icons[i]}</span>
                        <span className="text-xs font-bold" style={{ color: tier.color }}>{tier.name}</span>
                        {isCurrent && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">ACTUAL</span>}
                      </div>
                      <p className="text-[9px] text-[oklch(0.45_0.01_230)] mt-0.5">⏱ Cocción: {tier.cookMinutes < 60 ? `${tier.cookMinutes} min` : tier.cookMinutes < 1440 ? `${tier.cookMinutes / 60} horas` : `${tier.cookMinutes / 1440} días`}</p>
                    </div>
                    {i === 0 ? (
                      <span className="text-[10px] text-[oklch(0.45_0.01_230)] px-3 py-1.5 rounded-xl bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)]">GRATIS</span>
                    ) : (
                      <button
                        onClick={() => handleTx(async () => {
                          const signer = await getSigner()
                          const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
                          return contract.subscribeMembership(i, { value: tier.priceBNB })
                        }, `Membresía ${tier.name} activada`)}
                        disabled={txPending || isCurrent || (info?.membership ?? 0) >= i}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold disabled:opacity-40 transition-all"
                        style={{ background: `${tier.color}20`, color: tier.color, border: `1.5px solid ${tier.color}50` }}
                      >
                        <Image src="https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" alt="BNB" width={12} height={12} className="rounded-full" unoptimized />
                        {parseFloat(ethers.formatEther(tier.priceBNB)).toFixed(3)} BNB
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── REFERRAL VIEW ─── */}
      {activeView === 'referral' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-emerald-400" />
              <p className="text-xs font-bold text-foreground">¿Te refirió un amigo? Ingresa el código</p>
            </div>
            <div className="flex gap-2">
              <input
                value={referralCode}
                onChange={e => setReferralCode(e.target.value)}
                placeholder="Código de Descuento"
                className="flex-1 bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-emerald-500/50 placeholder:text-[oklch(0.35_0.01_230)]"
              />
              <button
                onClick={() => handleTx(async () => {
                  const signer = await getSigner()
                  const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
                  return contract.applyReferral(referralCode)
                }, 'Código aplicado')}
                disabled={txPending || !referralCode}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] text-[oklch(0.60_0.01_230)] hover:border-emerald-500/40 disabled:opacity-40 transition-colors"
              >
                Aplicar
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-emerald-400" />
              <p className="text-xs font-bold text-emerald-400">🚀 ¡Gana recompensas invitando amigos!</p>
            </div>
            <p className="text-[10px] text-[oklch(0.50_0.012_230)]">
              Crea tu código único de descuento para compartir y gana el 10% de las membresías que tus amigos compren.
            </p>
            <button
              onClick={() => handleTx(async () => {
                const signer = await getSigner()
                const code = `ACUA${bnbAddress?.slice(2, 8).toUpperCase()}`
                const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
                return contract.createReferralCode(code)
              }, 'Código de referido creado')}
              disabled={txPending}
              className="w-full py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white' }}
            >
              {txPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '🔗'}
              Crear Código
            </button>
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/8 border border-blue-500/25">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-[9px] text-[oklch(0.50_0.012_230)]">
              Para realizar transacciones en BNB Chain, asegúrate de tener BNB para el gas. Las comisiones del stake y bridge en BNB son pagadas por el usuario en BNB.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
