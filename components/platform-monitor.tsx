'use client'

import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import {
  Activity, Users, Coins, TrendingUp, Wallet, Award,
  RefreshCw, Loader2, Zap, BarChart2, Gift, Package,
  ArrowDownToLine, ArrowUpFromLine, Star, Shield, Globe,
} from 'lucide-react'
import { getProvider } from '@/lib/new-contracts'
import { type StakeInfo } from '@/lib/contract'
import { getPrices, getCachedPrices } from '@/lib/price-feed'

// ─── Contract addresses ───────────────────────────────────────────────────────
const H2O_STAKE    = '0xabbD2D0360bA25FBb82a6f7574a150F1AEAc2e04'
const H2O_TOKEN    = '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d'
const UTH2_MINING  = '0x5a8F1A8a8b1DE2fa673BFAB1E0c7Ca74f17D7bb6'
const WLD_MINING   = '0x14b00e92e9B7AC09E1a37F71AfcF9D6fD640D5A6'
const REFERRAL_SYS = '0x3aa8c0E71D0D4e5dC75C5C8eC3d6d7Ef55c3F01A'

const H2O_STAKE_ABI = [
  'function totalStaked() view returns (uint256)',
  'function pendingReward(address) view returns (uint256)',
  'event Staked(address indexed user, uint256 amount)',
  'event Unstaked(address indexed user, uint256 amount)',
  'event RewardClaimed(address indexed user, uint256 amount)',
]
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]
const MINING_ABI = [
  'event PackageBought(address indexed user, uint256 indexed packageId, uint256 price)',
  'function getAllPackages() view returns (tuple(uint256 price, uint256 dailyYield, bool active)[])',
]
const REFERRAL_ABI = [
  'event Registered(address indexed user, address indexed referrer)',
  'event ReferralRewardPaid(address indexed referrer, uint256 amount)',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtN(v: bigint, dec = 18, dig = 2) {
  const n = parseFloat(ethers.formatUnits(v, dec))
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}K`
  return n.toFixed(dig)
}
function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(2)}K`
  return `$${v.toFixed(2)}`
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({
  icon, label, value, sub, badge, accent = 'blue', loading,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string
  badge?: string; accent?: 'blue' | 'green' | 'amber' | 'violet' | 'cyan' | 'red' | 'orange' | 'yellow'
  loading?: boolean
}) {
  const colors = {
    blue:   'text-[oklch(0.65_0.22_255)] border-[oklch(0.65_0.22_255)]/20 bg-[oklch(0.65_0.22_255)]/5',
    green:  'text-[#00c076] border-[#00c076]/20 bg-[#00c076]/5',
    amber:  'text-amber-400 border-amber-400/20 bg-amber-400/5',
    violet: 'text-violet-400 border-violet-400/20 bg-violet-400/5',
    cyan:   'text-cyan-400 border-cyan-400/20 bg-cyan-400/5',
    red:    'text-[#f6465d] border-[#f6465d]/20 bg-[#f6465d]/5',
    orange: 'text-orange-400 border-orange-400/20 bg-orange-400/5',
    yellow: 'text-yellow-400 border-yellow-400/20 bg-yellow-400/5',
  }
  const c = colors[accent]
  return (
    <div className={`flex-1 min-w-0 rounded-lg border ${c} p-2.5`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="opacity-60 shrink-0">{icon}</span>
        <span className="text-[10px] font-medium text-[oklch(0.50_0.012_230)] truncate leading-tight">{label}</span>
        {badge && <span className="ml-auto text-[8px] font-bold bg-white/5 text-[oklch(0.45_0.01_230)] border border-white/10 rounded px-1 shrink-0">{badge}</span>}
      </div>
      {loading ? (
        <div className="h-5 w-16 bg-white/5 animate-pulse rounded" />
      ) : (
        <p className={`text-sm font-black font-mono truncate ${c.split(' ')[0]}`}>{value}</p>
      )}
      {sub && !loading && (
        <p className="text-[9px] text-[oklch(0.40_0.01_230)] mt-0.5 truncate">{sub}</p>
      )}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ icon, title, live }: { icon: React.ReactNode; title: string; live?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[oklch(0.65_0.22_255)]">{icon}</span>
      <span className="text-[11px] font-bold text-foreground uppercase tracking-wider">{title}</span>
      {live && <div className="w-1.5 h-1.5 rounded-full bg-[#00c076] animate-pulse" />}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface PlatformStats {
  // H2O Staking
  h2oTotalStaked:  bigint
  h2oPoolBalance:  bigint
  h2oStakers:      number   // estimated from events
  h2oTotalClaimed: bigint
  h2oTotalInvested: bigint
  // Mining UTH2
  uth2PackagesSold: number
  uth2TotalPaid:    bigint
  // Mining WLD
  wldPackagesSold:  number
  // Referrals
  totalReferrals:   number
  totalRefRewards:  bigint
  // Network
  h2oPrice:  number
  wldPrice:  number
  uth2Price: number
}

export function PlatformMonitor({
  userAddress,
  stakeInfo,
  h2oBalance,
  onRefresh,
}: {
  userAddress: string
  stakeInfo: StakeInfo | null
  h2oBalance: bigint
  onRefresh: () => void
}) {
  const [stats, setStats]     = useState<PlatformStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastTs, setLastTs]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p      = getProvider()
      const prices = await getPrices()
      const h2oC   = new ethers.Contract(H2O_STAKE, H2O_STAKE_ABI, p)
      const erc20  = new ethers.Contract(H2O_TOKEN, ERC20_ABI, p)

      // Parallel on-chain reads
      const [totalStaked, poolBal] = await Promise.all([
        h2oC.totalStaked().catch(() => 0n),
        erc20.balanceOf(H2O_STAKE).catch(() => 0n),
      ])

      // Events — last 5000 blocks (~84 min on WC at 1s/block)
      const curBlock = await p.getBlockNumber().catch(() => 0)
      const from     = Math.max(0, curBlock - 5000)

      const [stakedEvs, claimEvs, uth2Evs, wldEvs, regEvs, refEvs] = await Promise.all([
        h2oC.queryFilter(h2oC.filters.Staked(),          from, 'latest').catch(() => []),
        h2oC.queryFilter(h2oC.filters.RewardClaimed(),   from, 'latest').catch(() => []),
        new ethers.Contract(UTH2_MINING, MINING_ABI, p).queryFilter('PackageBought', from, 'latest').catch(() => []),
        new ethers.Contract(WLD_MINING,  MINING_ABI, p).queryFilter('PackageBought', from, 'latest').catch(() => []),
        new ethers.Contract(REFERRAL_SYS, REFERRAL_ABI, p).queryFilter('Registered',          from, 'latest').catch(() => []),
        new ethers.Contract(REFERRAL_SYS, REFERRAL_ABI, p).queryFilter('ReferralRewardPaid',  from, 'latest').catch(() => []),
      ])

      // Unique stakers from events (last 5k blocks window)
      const uniqueStakers = new Set(stakedEvs.map((e: any) => e.args?.[0]?.toLowerCase?.())).size

      // Total claimed in window
      const totalClaimed = claimEvs.reduce((s: bigint, e: any) => {
        try { return s + BigInt(e.args?.[1]?.toString() ?? '0') } catch { return s }
      }, 0n)

      // Total invested (staked events) in window
      const totalInvested = stakedEvs.reduce((s: bigint, e: any) => {
        try { return s + BigInt(e.args?.[1]?.toString() ?? '0') } catch { return s }
      }, 0n)

      // Mining packages sold
      const uth2Packages = uth2Evs.length
      const wldPackages  = wldEvs.length
      const uth2TotalPaid = uth2Evs.reduce((s: bigint, e: any) => {
        try { return s + BigInt(e.args?.[2]?.toString() ?? '0') } catch { return s }
      }, 0n)

      // Referral totals
      const refCount      = regEvs.length
      const totalRefRew   = refEvs.reduce((s: bigint, e: any) => {
        try { return s + BigInt(e.args?.[1]?.toString() ?? '0') } catch { return s }
      }, 0n)

      setStats({
        h2oTotalStaked:   totalStaked,
        h2oPoolBalance:   poolBal,
        h2oStakers:       uniqueStakers,
        h2oTotalClaimed:  totalClaimed,
        h2oTotalInvested: totalInvested,
        uth2PackagesSold: uth2Packages,
        uth2TotalPaid:    uth2TotalPaid,
        wldPackagesSold:  wldPackages,
        totalReferrals:   refCount,
        totalRefRewards:  totalRefRew,
        h2oPrice:  prices.H2O.usd,
        wldPrice:  prices.WLD.usd,
        uth2Price: prices.UTH2.usd,
      })
      setLastTs(new Date().toLocaleTimeString())
    } catch (e) { console.error('[monitor]', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // User-level data
  const userStaked  = stakeInfo?.stakedAmount  ?? 0n
  const userPending = stakeInfo?.pending ?? 0n
  const h2oP        = stats?.h2oPrice  ?? 0.0215
  const userValueH2O = parseFloat(ethers.formatEther(h2oBalance + userStaked + userPending)) * h2oP

  return (
    <div className="space-y-4">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[oklch(0.65_0.22_255)]" />
          <span className="text-sm font-black text-foreground uppercase tracking-wider">Monitor</span>
          <div className="w-1.5 h-1.5 rounded-full bg-[#00c076] animate-pulse" />
          <span className="text-[10px] text-[#00c076] font-bold">LIVE</span>
        </div>
        <button
          onClick={() => { load(); onRefresh() }}
          disabled={loading}
          className="flex items-center gap-1.5 text-[10px] text-[oklch(0.50_0.012_230)] hover:text-foreground transition-colors border border-[oklch(0.22_0.025_245)] rounded-lg px-2 py-1"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {lastTs ?? 'Actualizar'}
        </button>
      </div>

      {/* ── MI PORTFOLIO ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[oklch(0.65_0.22_255)]/20 bg-[oklch(0.65_0.22_255)]/5 p-3">
        <SectionHeader icon={<Wallet className="w-3.5 h-3.5" />} title="Mi Portfolio" />
        <div className="flex gap-2 mb-2">
          <StatCard icon={<Wallet className="w-3 h-3" />}         label="Balance H2O"   value={fmtN(h2oBalance)}    sub="en wallet"         accent="cyan"  />
          <StatCard icon={<Coins className="w-3 h-3" />}          label="Stakeado"       value={fmtN(userStaked)}    sub="H2O bloqueado"     accent="blue"  />
          <StatCard icon={<Award className="w-3 h-3" />}          label="Pendiente"      value={fmtN(userPending)}   sub="por reclamar"      accent="green" />
        </div>
        <div className="flex gap-2">
          <StatCard icon={<TrendingUp className="w-3 h-3" />}     label="Valor Total"   value={fmtUsd(userValueH2O)} sub="H2O+staked+reward" accent="amber"  />
          <StatCard icon={<Zap className="w-3 h-3" />}            label="APY H2O"       value="12.00%"              sub="anual"             accent="amber"  />
          <StatCard icon={<Globe className="w-3 h-3" />}          label="H2O Precio"    value={`$${h2oP.toFixed(5)}`} sub="en vivo"         accent="blue"  />
        </div>
      </div>

      {/* ── ACTIVIDAD PLATAFORMA ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.12_0.02_245)] p-3">
        <SectionHeader icon={<Users className="w-3.5 h-3.5" />} title="Actividad de Usuarios" live />
        <p className="text-[9px] text-[oklch(0.40_0.01_230)] mb-2 -mt-1">Últimos ~84 min · World Chain</p>
        <div className="flex gap-2 mb-2">
          <StatCard icon={<Users className="w-3 h-3" />}      label="Stakers Activos" value={loading ? '···' : `${stats?.h2oStakers ?? 0}`}                  sub="ventana 5k bloques" accent="blue"   loading={loading && !stats} />
          <StatCard icon={<Gift className="w-3 h-3" />}       label="Referidos"       value={loading ? '···' : `${stats?.totalReferrals ?? 0}`}               sub="registros"          accent="violet" loading={loading && !stats} />
          <StatCard icon={<Package className="w-3 h-3" />}    label="Paq. Minería"    value={loading ? '···' : `${(stats?.uth2PackagesSold ?? 0) + (stats?.wldPackagesSold ?? 0)}`} sub="UTH2+WLD mining" accent="amber"  loading={loading && !stats} />
        </div>
        <div className="flex gap-2">
          <StatCard icon={<ArrowDownToLine className="w-3 h-3" />} label="Invertido H2O"   value={loading ? '···' : fmtN(stats?.h2oTotalInvested ?? 0n)}  sub="stakeado ventana"  accent="green"  loading={loading && !stats} />
          <StatCard icon={<ArrowUpFromLine className="w-3 h-3" />} label="Reclamado H2O"   value={loading ? '···' : fmtN(stats?.h2oTotalClaimed ?? 0n)}   sub="rewards ventana"   accent="cyan"   loading={loading && !stats} />
          <StatCard icon={<Star className="w-3 h-3" />}            label="Reward Ref."     value={loading ? '···' : fmtN(stats?.totalRefRewards ?? 0n)}    sub="pagado refs"       accent="violet" loading={loading && !stats} />
        </div>
      </div>

      {/* ── MINERÍA ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.12_0.02_245)] p-3">
        <SectionHeader icon={<Package className="w-3.5 h-3.5" />} title="Minería" live />
        <div className="flex gap-2">
          <StatCard icon={<Zap className="w-3 h-3" />}      label="UTH2 Mining"    value={loading ? '···' : `${stats?.uth2PackagesSold ?? 0}`}     sub="paquetes vendidos"  accent="orange" loading={loading && !stats} />
          <StatCard icon={<Coins className="w-3 h-3" />}    label="UTH2 Pagado"    value={loading ? '···' : fmtN(stats?.uth2TotalPaid ?? 0n)}      sub="en esta ventana"    accent="amber"  loading={loading && !stats} />
          <StatCard icon={<Star className="w-3 h-3" />}     label="WLD Mining"     value={loading ? '···' : `${stats?.wldPackagesSold ?? 0}`}      sub="paquetes WLD"       accent="yellow" loading={loading && !stats} />
        </div>
      </div>

      {/* ── ESTADO GLOBAL ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.12_0.02_245)] p-3">
        <SectionHeader icon={<BarChart2 className="w-3.5 h-3.5" />} title="Estado Global del Protocolo" />
        <div className="flex gap-2 mb-2">
          <StatCard icon={<Shield className="w-3 h-3" />}      label="Total Stakeado"  value={loading ? '···' : fmtN(stats?.h2oTotalStaked ?? 0n)} sub="H2O contrato"    accent="blue"  loading={loading && !stats} />
          <StatCard icon={<Coins className="w-3 h-3" />}       label="Pool Rewards"    value={loading ? '···' : fmtN(stats?.h2oPoolBalance ?? 0n)}  sub="H2O disponible"  accent="green" loading={loading && !stats} />
          <StatCard icon={<TrendingUp className="w-3 h-3" />}  label="Pool USD"
            value={loading ? '···' : fmtUsd(parseFloat(ethers.formatEther(stats?.h2oPoolBalance ?? 0n)) * (stats?.h2oPrice ?? 0.0215))}
            sub="valor en USD" accent="amber" loading={loading && !stats} />
        </div>
        {/* Price table */}
        <div className="rounded-lg border border-[oklch(0.18_0.02_245)] overflow-hidden mt-1">
          <div className="grid grid-cols-3 text-[9px] font-bold text-[oklch(0.40_0.01_230)] uppercase px-3 py-1.5 bg-[oklch(0.10_0.018_245)] border-b border-[oklch(0.18_0.02_245)]">
            <span>Token</span><span className="text-center">Precio</span><span className="text-right">24h</span>
          </div>
          {[
            { sym: 'H2O',  price: stats?.h2oPrice,  ch: undefined },
            { sym: 'WLD',  price: stats?.wldPrice,  ch: undefined },
            { sym: 'UTH2', price: stats?.uth2Price, ch: undefined },
          ].map(({ sym, price }) => (
            <div key={sym} className="grid grid-cols-3 px-3 py-1.5 border-b border-[oklch(0.16_0.018_245)] last:border-0">
              <span className="text-[10px] font-bold text-foreground font-mono">{sym}</span>
              <span className="text-center text-[10px] font-mono text-[oklch(0.65_0.22_255)]">
                {price !== undefined ? `$${price.toFixed(5)}` : '···'}
              </span>
              <span className="text-right text-[10px] text-[oklch(0.40_0.01_230)]">—</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── INFO BOX ────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[oklch(0.22_0.025_245)] px-3 py-2 bg-[oklch(0.10_0.018_245)]">
        <p className="text-[9px] text-[oklch(0.40_0.01_230)] leading-relaxed">
          Los datos de actividad muestran eventos de los últimos ~5,000 bloques de World Chain (~84 minutos). Los totales históricos requieren indexación completa. Los precios se actualizan cada 60 segundos desde DexScreener + CoinGecko.
        </p>
      </div>

    </div>
  )
}
