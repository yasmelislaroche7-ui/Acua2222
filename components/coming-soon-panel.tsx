'use client'

import Image from 'next/image'
import { Clock, Zap, ArrowLeftRight, Layers, Coins, TrendingUp, Shield, Bell } from 'lucide-react'
import { NetworkConfig } from '@/lib/networks'
import { cn } from '@/lib/utils'

// ─── Feature preview card ─────────────────────────────────────────────────────
function FeatureCard({
  icon, title, desc, color, badge,
}: {
  icon: React.ReactNode; title: string; desc: string; color: string; badge?: string
}) {
  return (
    <div className="relative rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 overflow-hidden">
      {/* Glow overlay */}
      <div className="absolute inset-0 opacity-5" style={{ background: color }} />

      <div className="relative flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}22`, border: `1.5px solid ${color}44` }}>
          <span style={{ color }}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-xs font-bold text-foreground">{title}</p>
            {badge && (
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                {badge}
              </span>
            )}
          </div>
          <p className="text-[10px] text-[oklch(0.50_0.012_230)]">{desc}</p>
        </div>
        <div className="shrink-0 px-2 py-0.5 rounded-full bg-[oklch(0.15_0.02_245)] border border-[oklch(0.22_0.025_245)]">
          <span className="text-[8px] font-bold text-[oklch(0.45_0.01_230)]">PRONTO</span>
        </div>
      </div>
    </div>
  )
}

// ─── BNB Coming Soon ──────────────────────────────────────────────────────────
function BNBComingSoon() {
  const features = [
    { icon: <Coins className="w-4 h-4" />,          title: 'Stake BNB',             desc: 'Genera rendimientos en BNB con pools de liquidez en BSC.',         color: '#f0b90b', badge: 'APY 9%'  },
    { icon: <TrendingUp className="w-4 h-4" />,      title: 'Yield Farming BSC',     desc: 'Farms multi-token sobre PancakeSwap con recompensas automáticas.', color: '#f59e0b', badge: 'Multi'   },
    { icon: <ArrowLeftRight className="w-4 h-4" />,  title: 'Swap en BSC',           desc: 'Intercambia tokens BEP-20 con las mejores rutas y menor slippage.', color: '#fbbf24'                  },
    { icon: <Layers className="w-4 h-4" />,          title: 'Pools de Liquidez',     desc: 'Provee liquidez y gana comisiones de las operaciones de swap.',     color: '#f97316', badge: 'LP'      },
    { icon: <Shield className="w-4 h-4" />,          title: 'Vault BNB Seguro',      desc: 'Deposita BNB en vaults auditados con seguro de protocolo.',        color: '#ef4444'                  },
    { icon: <Zap className="w-4 h-4" />,             title: 'Flash Loans BSC',       desc: 'Acceso a préstamos instantáneos para arbitraje en BNB Chain.',     color: '#fcd34d'                  },
  ]

  return (
    <div className="space-y-4 pb-24">
      {/* Hero banner */}
      <div className="relative rounded-2xl overflow-hidden p-5" style={{ background: 'linear-gradient(135deg,#c88a05,#f0b90b22,#0a0a14)' }}>
        <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(circle at 80% 50%,#f0b90b,transparent 60%)' }} />
        <div className="relative flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl overflow-hidden border-2 border-[#f0b90b]/50 shrink-0">
            <Image src="https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" alt="BNB" width={56} height={56} className="w-full h-full object-cover" unoptimized />
          </div>
          <div>
            <p className="text-[10px] font-bold text-[#f0b90b]/80 uppercase tracking-wider">ACUA en</p>
            <h2 className="text-xl font-black text-foreground">BNB Chain</h2>
            <p className="text-[10px] text-[oklch(0.50_0.012_230)] mt-0.5">Ecosistema DeFi en Binance Smart Chain</p>
          </div>
        </div>
        <div className="relative mt-4 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[10px] font-semibold text-amber-400">En desarrollo · BSC · Chain ID 56</span>
        </div>
      </div>

      {/* Coming soon notice */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/8 border border-amber-500/25">
        <Clock className="w-5 h-5 text-amber-400 shrink-0" />
        <div>
          <p className="text-xs font-bold text-amber-400">Coming Soon</p>
          <p className="text-[10px] text-[oklch(0.50_0.012_230)]">La versión BNB de ACUA MINIEXCHANGE está en desarrollo. Pronto podrás acceder a todos estos servicios DeFi.</p>
        </div>
      </div>

      {/* Chain stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Red',    val: 'BSC',   color: '#f0b90b' },
          { label: 'Chain',  val: 'ID 56', color: '#fbbf24' },
          { label: 'Token',  val: 'BNB',   color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="p-2.5 rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] text-center">
            <p className="text-[9px] text-[oklch(0.45_0.01_230)]">{s.label}</p>
            <p className="text-sm font-black" style={{ color: s.color }}>{s.val}</p>
          </div>
        ))}
      </div>

      {/* Feature previews */}
      <div>
        <p className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider mb-2.5">Próximas funciones</p>
        <div className="space-y-2">
          {features.map(f => <FeatureCard key={f.title} {...f} />)}
        </div>
      </div>

      {/* Notify me */}
      <div className="flex items-center gap-3 p-4 rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)]">
        <Bell className="w-5 h-5 text-[oklch(0.50_0.012_230)] shrink-0" />
        <p className="text-[10px] text-[oklch(0.50_0.012_230)] flex-1">Sigue el canal oficial de ACUA para recibir noticias sobre el lanzamiento en BNB Chain.</p>
      </div>
    </div>
  )
}

// ─── Polygon Coming Soon ──────────────────────────────────────────────────────
function PolygonComingSoon() {
  const features = [
    { icon: <Coins className="w-4 h-4" />,          title: 'Stake POL / MATIC',     desc: 'Genera rendimientos con Polygon PoS staking y liquid staking.',    color: '#8247e5', badge: 'APY 7%'  },
    { icon: <TrendingUp className="w-4 h-4" />,      title: 'Yield Farming POL',     desc: 'Farms sobre QuickSwap y Uniswap v3 en Polygon con auto-compound.', color: '#9f5dfc', badge: 'Multi'   },
    { icon: <ArrowLeftRight className="w-4 h-4" />,  title: 'Swap en Polygon',       desc: 'Swap de tokens ERC-20 en Polygon con comisiones ultra-bajas.',     color: '#a855f7'                  },
    { icon: <Layers className="w-4 h-4" />,          title: 'Pools de Liquidez',     desc: 'Provee liquidez concentrada en Uniswap v3 y gana fees del swap.',  color: '#c084fc', badge: 'V3'      },
    { icon: <Shield className="w-4 h-4" />,          title: 'Bridge ACUA',           desc: 'Mueve tus tokens H2O entre World Chain y Polygon sin fricciones.', color: '#7c3aed', badge: 'BRIDGE'  },
    { icon: <Zap className="w-4 h-4" />,             title: 'zk-EVM Compatible',     desc: 'Compatible con Polygon zkEVM para transacciones más baratas.',     color: '#a78bfa'                  },
  ]

  return (
    <div className="space-y-4 pb-24">
      {/* Hero banner */}
      <div className="relative rounded-2xl overflow-hidden p-5" style={{ background: 'linear-gradient(135deg,#5b21b6,#8247e522,#0a0a14)' }}>
        <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(circle at 80% 50%,#8247e5,transparent 60%)' }} />
        <div className="relative flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl overflow-hidden border-2 border-[#8247e5]/50 shrink-0">
            <Image src="https://assets.coingecko.com/coins/images/4713/small/polygon.png" alt="Polygon" width={56} height={56} className="w-full h-full object-cover" unoptimized />
          </div>
          <div>
            <p className="text-[10px] font-bold text-[#a78bfa]/80 uppercase tracking-wider">ACUA en</p>
            <h2 className="text-xl font-black text-foreground">Polygon</h2>
            <p className="text-[10px] text-[oklch(0.50_0.012_230)] mt-0.5">Ecosistema DeFi en Polygon PoS / zkEVM</p>
          </div>
        </div>
        <div className="relative mt-4 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
          <span className="text-[10px] font-semibold text-violet-400">En desarrollo · Polygon · Chain ID 137</span>
        </div>
      </div>

      {/* Coming soon notice */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-violet-500/8 border border-violet-500/25">
        <Clock className="w-5 h-5 text-violet-400 shrink-0" />
        <div>
          <p className="text-xs font-bold text-violet-400">Coming Soon</p>
          <p className="text-[10px] text-[oklch(0.50_0.012_230)]">La versión Polygon de ACUA MINIEXCHANGE está en desarrollo. Pronto podrás acceder a DeFi con fees casi cero.</p>
        </div>
      </div>

      {/* Chain stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Red',    val: 'POL',    color: '#8247e5' },
          { label: 'Chain',  val: 'ID 137', color: '#a78bfa' },
          { label: 'Token',  val: 'MATIC',  color: '#9f5dfc' },
        ].map(s => (
          <div key={s.label} className="p-2.5 rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] text-center">
            <p className="text-[9px] text-[oklch(0.45_0.01_230)]">{s.label}</p>
            <p className="text-sm font-black" style={{ color: s.color }}>{s.val}</p>
          </div>
        ))}
      </div>

      {/* Feature previews */}
      <div>
        <p className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider mb-2.5">Próximas funciones</p>
        <div className="space-y-2">
          {features.map(f => <FeatureCard key={f.title} {...f} />)}
        </div>
      </div>

      {/* Notify me */}
      <div className="flex items-center gap-3 p-4 rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)]">
        <Bell className="w-5 h-5 text-[oklch(0.50_0.012_230)] shrink-0" />
        <p className="text-[10px] text-[oklch(0.50_0.012_230)] flex-1">Sigue el canal oficial de ACUA para recibir noticias sobre el lanzamiento en Polygon.</p>
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function ComingSoonPanel({ network }: { network: 'bnb' | 'polygon' }) {
  return network === 'bnb' ? <BNBComingSoon /> : <PolygonComingSoon />
}
