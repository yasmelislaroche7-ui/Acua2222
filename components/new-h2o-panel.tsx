'use client'

import { useState, useEffect } from 'react'
import {
  Droplets, Zap, Users, Copy, Check, Clock, Gift,
  ArrowDownToLine, ArrowUpFromLine, Coins, Flame,
  ChevronRight, Star, Shield, TrendingUp, Sparkles, Heart, ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Launch date: 1 June 2026 ─────────────────────────────────────────────────
const LAUNCH_DATE = new Date('2026-06-01T00:00:00Z')

// ─── Countdown hook ───────────────────────────────────────────────────────────
function useCountdown(target: Date) {
  const [remaining, setRemaining] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, done: false })

  useEffect(() => {
    const tick = () => {
      const diff = target.getTime() - Date.now()
      if (diff <= 0) { setRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0, done: true }); return }
      const s = Math.floor(diff / 1000)
      setRemaining({
        days: Math.floor(s / 86400),
        hours: Math.floor((s % 86400) / 3600),
        minutes: Math.floor((s % 3600) / 60),
        seconds: s % 60,
        done: false,
      })
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [target])

  return remaining
}

// ─── CountdownUnit ────────────────────────────────────────────────────────────
function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <div className="w-14 h-14 rounded-2xl bg-black/40 border border-cyan-400/30 flex items-center justify-center backdrop-blur">
          <span className="text-2xl font-black text-cyan-300 font-mono tabular-nums">
            {String(value).padStart(2, '0')}
          </span>
        </div>
        <div className="absolute inset-0 rounded-2xl bg-cyan-400/5 animate-pulse" />
      </div>
      <span className="text-[10px] font-semibold text-cyan-400/60 uppercase tracking-widest">{label}</span>
    </div>
  )
}

// ─── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 rounded-2xl bg-white/5 border border-white/10 p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <span className="text-lg font-black text-foreground">{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

// ─── ActionButton (disabled "coming soon") ────────────────────────────────────
function ActionBtn({
  icon, label, description, color,
}: {
  icon: React.ReactNode; label: string; description: string; color: string
}) {
  return (
    <div className={cn(
      'relative flex items-center gap-3 p-4 rounded-2xl border cursor-not-allowed opacity-70',
      'bg-white/5 border-white/10',
    )}>
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', color)}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">{label}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-400 border border-amber-400/30">
            PRÓXIMAMENTE
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </div>
  )
}

// ─── ReferralSection ──────────────────────────────────────────────────────────
function ReferralSection({ userAddress }: { userAddress: string }) {
  const [copied, setCopied] = useState(false)
  const shortAddr = userAddress ? userAddress.slice(0, 8) + '...' : ''
  const refLink = `https://acua.app/stake?ref=${userAddress}`

  const handleCopy = () => {
    navigator.clipboard.writeText(refLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="rounded-3xl overflow-hidden border border-violet-500/30 bg-gradient-to-br from-violet-950/60 via-purple-900/40 to-indigo-950/60">
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
            <Users className="w-4 h-4 text-violet-400" />
          </div>
          <span className="text-base font-black text-foreground">Referidos</span>
          <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-400">
            PRÓXIMO
          </span>
        </div>
        <p className="text-sm font-bold text-violet-300 mt-2">
          Invita a tus amigos y gana el 10% de sus ganancias
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Cuando tu amigo o tú reclamen recompensas, <span className="text-foreground font-semibold">ambos ganan</span> automáticamente.
          Las ganancias se reparten entre las wallets conectadas en ese momento.
        </p>
      </div>

      {/* How it works */}
      <div className="mx-4 mb-4 rounded-2xl bg-white/5 border border-white/10 p-3 space-y-2">
        {[
          { icon: <Zap className="w-3.5 h-3.5 text-amber-400" />, text: 'Comparte tu link único de referido' },
          { icon: <Users className="w-3.5 h-3.5 text-cyan-400" />, text: 'Tu amigo se une con tu link y hace stake' },
          { icon: <Gift className="w-3.5 h-3.5 text-violet-400" />, text: 'Ambos ganan 10% de cada claim mientras estén conectados' },
          { icon: <Star className="w-3.5 h-3.5 text-yellow-400" />, text: 'Ganancias permanentes, sin límite de referidos' },
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="mt-0.5">{item.icon}</div>
            <span className="text-xs text-muted-foreground">{item.text}</span>
          </div>
        ))}
      </div>

      {/* Referral link */}
      <div className="px-4 pb-5">
        <div className="flex items-center gap-2 rounded-xl bg-black/30 border border-white/10 p-3">
          <span className="flex-1 text-xs font-mono text-muted-foreground truncate">
            acua.app/stake?ref={shortAddr}
          </span>
          <button
            onClick={handleCopy}
            className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <p className="text-[10px] text-center text-muted-foreground mt-2">
          Sistema activo con el lanzamiento del nuevo H2O
        </p>
      </div>
    </div>
  )
}

// ─── Feature Badge ────────────────────────────────────────────────────────────
function FeatureBadge({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
      {icon}
      <span className="text-[11px] font-medium text-muted-foreground">{text}</span>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function NewH2OPanel({ userAddress }: { userAddress: string }) {
  const { days, hours, minutes, seconds, done } = useCountdown(LAUNCH_DATE)

  return (
    <div className="space-y-4 pb-6">

      {/* ── HERO CARD ──────────────────────────────────────────────────────── */}
      <div className="relative rounded-3xl overflow-hidden border border-cyan-500/30">
        {/* Animated background */}
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-950 via-teal-900/80 to-blue-950" />
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-48 h-48 rounded-full bg-cyan-500/10 blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-32 h-32 rounded-full bg-teal-400/10 blur-2xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>

        {/* Content */}
        <div className="relative z-10 p-5">
          {/* Top row */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-cyan-400/20 border border-cyan-400/40 flex items-center justify-center">
                  <Droplets className="w-4 h-4 text-cyan-400" />
                </div>
                <span className="text-sm font-black text-foreground tracking-wide">H2O 2.0</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-400/20 border border-cyan-400/30 text-cyan-400 uppercase tracking-wider">
                  Nuevo
                </span>
              </div>
              <p className="text-xs text-cyan-300/70 ml-10">Stake · Referidos · Auto-sostenible</p>
            </div>
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-400/20 border border-amber-400/30">
              <Flame className="w-3 h-3 text-amber-400" />
              <span className="text-[10px] font-bold text-amber-400">MIGRACIÓN</span>
            </div>
          </div>

          {/* APY highlight */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1">
              <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-teal-400">
                12%
              </span>
              <span className="text-lg font-bold text-cyan-300/70 ml-1">APY</span>
              <p className="text-xs text-muted-foreground mt-0.5">Nuevo token H2O · Comisiones configurables</p>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Shield className="w-3 h-3 text-green-400" />
                <span className="text-green-400">Permit2</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <TrendingUp className="w-3 h-3 text-cyan-400" />
                <span className="text-cyan-400">Auto-fondeo</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="w-3 h-3 text-violet-400" />
                <span className="text-violet-400">Referidos</span>
              </div>
            </div>
          </div>

          {/* Countdown */}
          <div className="rounded-2xl bg-black/30 border border-cyan-400/20 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Clock className="w-3.5 h-3.5 text-cyan-400/70" />
              <span className="text-xs font-semibold text-cyan-400/70 uppercase tracking-wider">
                {done ? 'Lanzado en Puff' : 'Lanzamiento en Puff'}
              </span>
            </div>
            {done ? (
              <div className="flex items-center justify-center gap-2 py-2">
                <Sparkles className="w-5 h-5 text-cyan-400" />
                <span className="text-xl font-black text-cyan-300">¡Lanzado!</span>
                <Sparkles className="w-5 h-5 text-cyan-400" />
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3">
                <CountdownUnit value={days} label="días" />
                <span className="text-2xl font-black text-cyan-400/40 mb-4">:</span>
                <CountdownUnit value={hours} label="horas" />
                <span className="text-2xl font-black text-cyan-400/40 mb-4">:</span>
                <CountdownUnit value={minutes} label="min" />
                <span className="text-2xl font-black text-cyan-400/40 mb-4">:</span>
                <CountdownUnit value={seconds} label="seg" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── STATS ROW ──────────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        <StatCard
          icon={<Coins className="w-3 h-3" />}
          label="Depósito"
          value="5%"
          sub="comisión configurable"
        />
        <StatCard
          icon={<ArrowUpFromLine className="w-3 h-3" />}
          label="Retiro"
          value="7%"
          sub="comisión configurable"
        />
        <StatCard
          icon={<Zap className="w-3 h-3" />}
          label="Referido"
          value="10%"
          sub="ambos ganan"
        />
      </div>

      {/* ── FEATURES ROW ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <FeatureBadge icon={<Shield className="w-3 h-3 text-green-400" />} text="Permit2" />
        <FeatureBadge icon={<Droplets className="w-3 h-3 text-cyan-400" />} text="Cualquiera puede fondear" />
        <FeatureBadge icon={<Zap className="w-3 h-3 text-amber-400" />} text="Auto-sostenible" />
        <FeatureBadge icon={<TrendingUp className="w-3 h-3 text-violet-400" />} text="Nuevo H2O" />
      </div>

      {/* ── ACTIONS (disabled - coming soon) ───────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1">Acciones</h3>
        <ActionBtn
          icon={<ArrowDownToLine className="w-4 h-4 text-cyan-400" />}
          label="Stake H2O"
          description="Deposita nuevo H2O y genera recompensas"
          color="bg-cyan-400/15 border border-cyan-400/20"
        />
        <ActionBtn
          icon={<ArrowUpFromLine className="w-4 h-4 text-violet-400" />}
          label="Unstake H2O"
          description="Retira tu stake (comisión 7%)"
          color="bg-violet-400/15 border border-violet-400/20"
        />
        <ActionBtn
          icon={<Gift className="w-4 h-4 text-amber-400" />}
          label="Claim Recompensas"
          description="Reclama tus ganancias + recompensas de referidos"
          color="bg-amber-400/15 border border-amber-400/20"
        />
      </div>

      {/* ── REFERRAL SECTION ───────────────────────────────────────────────── */}
      <ReferralSection userAddress={userAddress} />

      {/* ── INFO CARD ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-bold text-foreground">Sistema Auto-sostenible</span>
        </div>
        {[
          'Cualquier usuario, contrato u owner puede fondear el pool de recompensas.',
          'Las comisiones se distribuyen automáticamente: pool de recompensas + posición del owner.',
          'Contratos conectables y desconectables en tiempo real para mayor seguridad.',
          'Nuevo swap integrado con Uniswap v2, v3 y v4 sin límites.',
          'Compatible con Permit2 para World App y wallets normales.',
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="w-1 h-1 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
            <span className="text-xs text-muted-foreground">{item}</span>
          </div>
        ))}
      </div>

      {/* ── DONATION CARD ──────────────────────────────────────────────────── */}
      <DonationCard />

    </div>
  )
}

// ─── Donation Card ────────────────────────────────────────────────────────────
const DONATION_ADDRESS = '0xc2ef127734f296952de75c1b58a6cec605cc2e59'

function DonationCard() {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(DONATION_ADDRESS).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="rounded-3xl overflow-hidden border border-amber-500/25 bg-gradient-to-br from-amber-950/50 via-orange-900/30 to-yellow-950/50">
      <div className="px-5 pt-5 pb-2">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Heart className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <span className="text-sm font-black text-foreground">Apoya el Ecosistema Acua</span>
            <p className="text-[10px] text-amber-400/70">Donaciones en WLD</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          ¿Te gusta Acua Staking? Dona <span className="text-amber-400 font-semibold">WLD</span> a esta dirección para ayudar al ecosistema, financiar el desarrollo y mantener los pools de recompensas activos para toda la comunidad.
        </p>

        <div className="flex items-center gap-1 mt-3 mb-1">
          <div className="w-1 h-1 rounded-full bg-amber-400" />
          <span className="text-[9px] font-bold text-amber-400/60 uppercase tracking-widest">Dirección de donación · WLD</span>
        </div>
      </div>

      <div className="px-5 pb-5">
        <div className="flex items-center gap-2 rounded-xl bg-black/30 border border-amber-500/20 p-3">
          <span className="flex-1 text-[11px] font-mono text-amber-200/70 break-all leading-relaxed">
            {DONATION_ADDRESS}
          </span>
          <button
            onClick={handleCopy}
            className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copiado' : 'Copiar'}</span>
          </button>
        </div>
        <div className="flex items-center gap-1.5 mt-2.5">
          <ExternalLink className="w-3 h-3 text-amber-400/50" />
          <p className="text-[10px] text-muted-foreground">
            Red: <span className="text-foreground/70">World Chain (480)</span> · Token: <span className="text-foreground/70">WLD</span>
          </p>
        </div>
        <p className="text-[10px] text-center text-amber-400/50 mt-3">
          💧 Cada donación ayuda a mantener el ecosistema Acua vivo
        </p>
      </div>
    </div>
  )
}
