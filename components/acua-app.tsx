'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Droplets, RefreshCw, Wallet, Shield, Loader2,
  TrendingUp, Pickaxe, Star, HelpCircle, Wind, Clock, BookOpen, Repeat2,
  Sparkles, X, ChevronRight, Activity, BarChart2, Zap, Flame,
  Menu, Home, Settings, Bell, ArrowLeftRight,
} from 'lucide-react'
import { StakePanel } from '@/components/stake-panel'
import { OwnerPanel } from '@/components/owner-panel'
import { MultiStakingPanel } from '@/components/multi-staking-panel'
import { StakeV2Panel } from '@/components/stake-v2-panel'
import { H2OV3Panel } from '@/components/h2o-v3-panel'
import { MiningUTH2Panel } from '@/components/mining-uth2-panel'
import { MiningWLDPanel } from '@/components/mining-wld-panel'
import { MiningTimePanel } from '@/components/mining-time-panel'
import { ContractsOwnerPanel } from '@/components/contracts-owner-panel'
import { AirFunderPanel } from '@/components/air-funder-panel'
import { InfoPanel } from '@/components/info-panel'
import { TokenDirectoryPanel } from '@/components/token-directory-panel'
import { SwapPanel } from '@/components/swap-panel'
import { NewH2OPanel } from '@/components/new-h2o-panel'
import { PlatformMonitor } from '@/components/platform-monitor'
import { StatsTicker, MarketMiniCard } from '@/components/market-ticker'
import { useWallet } from '@/hooks/use-wallet'
import {
  fetchStakeInfo, fetchContractConfig, fetchH2OBalance, fetchWLDBalance,
  StakeInfo, ContractConfig, shortenAddress,
} from '@/lib/contract'
import {
  STAKING_CONTRACTS, UNIVERSAL_STAKING_ABI, getProvider,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

type Tab = 'h2o' | 'h2o-new' | 'h2o-v3' | 'stake-v2' | 'stake-plus' | 'uth2' | 'wld' | 'time' | 'tokens' | 'swap' | 'info' | 'admin' | 'monitor'
type InstalledState = null | true | false

const AIR_FUNDER_ADDRESS    = '0x72acfbfcee02176118107958ec317157ccd4afdb'
const SECONDARY_ADMIN_ADDRESS = '0xc2ef127734f296952de75c1b58a6cec605cc2e59'

// ─── MiniKit logger ───────────────────────────────────────────────────────────
function patchMiniKitLogger() {
  if (typeof window === 'undefined') return
  if ((window as any).__minikitPatched) return
  ;(window as any).__minikitPatched = true
  const log = (label: string, data: unknown, color = '#00d4ff') =>
    console.log(`%c[MiniKit] ${label}`, `color:${color};font-weight:bold`, data)
  const original = MiniKit.commandsAsync as Record<string, unknown>
  if (original && typeof original === 'object') {
    for (const cmd of Object.keys(original)) {
      const fn = (original as Record<string, Function>)[cmd]
      if (typeof fn !== 'function') continue
      ;(original as Record<string, Function>)[cmd] = async function (...args: unknown[]) {
        log(`→ ${cmd} PAYLOAD`, args, '#00d4ff')
        try { const r = await fn.apply(this, args); log(`← ${cmd} RESPONSE`, r, '#00ff99'); return r }
        catch (err) { log(`✖ ${cmd} ERROR`, err, '#ff4d4d'); throw err }
      }
    }
  }
  log('MiniKit logger active ✓', { patchedAt: new Date().toISOString() }, '#888888')
}

// ─── Menu categories config ───────────────────────────────────────────────────
interface MenuEntry { tab: Tab; icon: React.ReactNode; label: string; badge?: string; color?: string }
const MENU_STAKING: MenuEntry[] = [
  { tab: 'h2o',       icon: <Droplets className="w-4 h-4" />,   label: 'Stake H2O',     badge: '12% APY', color: 'text-cyan-400' },
  { tab: 'h2o-new',   icon: <Sparkles className="w-4 h-4" />,   label: 'H2O 2.0',       badge: 'NUEVO',   color: 'text-blue-400' },
  { tab: 'h2o-v3',    icon: <Droplets className="w-4 h-4" />,   label: 'H2O v3 Pool',   color: 'text-cyan-300' },
  { tab: 'stake-v2',  icon: <Wind className="w-4 h-4" />,       label: 'Stake V2',      color: 'text-violet-400' },
  { tab: 'stake-plus',icon: <TrendingUp className="w-4 h-4" />, label: 'Stake+',         badge: '8 tokens', color: 'text-emerald-400' },
]
const MENU_MINING: MenuEntry[] = [
  { tab: 'uth2', icon: <Pickaxe className="w-4 h-4" />,    label: 'UTH₂ → H2O',    color: 'text-orange-400' },
  { tab: 'wld',  icon: <Star className="w-4 h-4" />,       label: 'WLD → 7 tokens', color: 'text-yellow-400' },
  { tab: 'time', icon: <Clock className="w-4 h-4" />,      label: 'TIME → WLD',     color: 'text-purple-400' },
]
const MENU_MARKET: MenuEntry[] = [
  { tab: 'swap',   icon: <Repeat2 className="w-4 h-4" />,   label: 'Swap',   color: 'text-blue-400' },
  { tab: 'tokens', icon: <BookOpen className="w-4 h-4" />,  label: 'Tokens', color: 'text-teal-400' },
]
const MENU_INFO: MenuEntry[] = [
  { tab: 'monitor', icon: <Activity className="w-4 h-4" />,    label: 'Monitor',     badge: 'LIVE', color: 'text-green-400' },
  { tab: 'info',    icon: <HelpCircle className="w-4 h-4" />,  label: 'Info / Guía', color: 'text-slate-400' },
]

// ─── Screens ──────────────────────────────────────────────────────────────────
function NotInstalled() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="relative flex items-center justify-center" style={{ width: 96, height: 96 }}>
        <span className="absolute inset-0 rounded-3xl border-2 border-blue-500/60 heartbeat-ring" />
        <span className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-600 to-blue-500 flex items-center justify-center shadow-[0_0_32px_rgba(59,130,246,0.55)] heartbeat-logo">
          <div className="relative w-12 h-12 mt-1.5">
            <Image src="/flame-logo.png" alt="Acua" fill loading="eager" className="object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]" />
          </div>
        </span>
      </div>
      <div>
        <h1 className="text-2xl font-black text-foreground tracking-tight">ACUA MINIEXCHANGE</h1>
        <p className="text-[oklch(0.50_0.012_230)] text-sm mt-1.5">
          Abre esta app dentro de <strong className="text-foreground">World App</strong> para continuar.
        </p>
      </div>
      <div className="text-[10px] font-mono text-[oklch(0.50_0.025_255)] border border-[oklch(0.22_0.025_245)] rounded-md px-3 py-1.5 bg-[oklch(0.12_0.02_245)]">
        World Chain · Chain ID 480
      </div>
    </div>
  )
}

function ConnectScreen({ onConnect, loading }: { onConnect: () => void; loading: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5 py-8 overflow-y-auto">
      {/* Logo */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative flex items-center justify-center" style={{ width: 96, height: 96 }}>
          <span className="absolute inset-0 rounded-3xl border-2 border-blue-500/60 heartbeat-ring" />
          <span className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-600 to-blue-500 flex items-center justify-center shadow-[0_0_32px_rgba(59,130,246,0.55)] heartbeat-logo">
            <div className="relative w-12 h-12 mt-1.5">
              <Image src="/flame-logo.png" alt="Acua" fill loading="eager" className="object-contain" />
            </div>
          </span>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-black tracking-tight text-foreground">ACUA MINIEXCHANGE</h1>
          <p className="text-[oklch(0.50_0.012_230)] text-xs mt-1 font-mono">World Chain · DeFi · 2026</p>
        </div>
      </div>

      {/* Feature grid */}
      <div className="w-full max-w-xs rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.12_0.02_245)] divide-y divide-[oklch(0.18_0.02_245)]">
        {[
          { dot: 'bg-blue-500',    label: 'Stake H2O',         val: '12% APY' },
          { dot: 'bg-emerald-500', label: 'Multi-Stake 8 tokens', val: 'APY variable' },
          { dot: 'bg-orange-500',  label: 'Minería UTH₂ → H2O',  val: 'Permanente' },
          { dot: 'bg-yellow-500',  label: 'Minería WLD → 7 tokens', val: 'Simultáneo' },
          { dot: 'bg-violet-500',  label: 'Stake TIME → WLD',   val: 'Pool rewards' },
          { dot: 'bg-cyan-500',    label: 'Swap integrado',     val: 'V2 + V3 + V4' },
        ].map(f => (
          <div key={f.label} className="flex items-center gap-3 px-4 py-2.5">
            <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', f.dot)} />
            <span className="text-xs text-[oklch(0.60_0.01_230)] flex-1">{f.label}</span>
            <span className="text-xs font-bold text-foreground font-mono">{f.val}</span>
          </div>
        ))}
      </div>

      <button
        className="w-full max-w-xs h-12 rounded-xl bg-[oklch(0.65_0.22_255)] text-white font-bold text-base flex items-center justify-center gap-2 glow-blue hover:bg-[oklch(0.70_0.24_255)] transition-colors"
        onClick={onConnect}
        disabled={loading}
      >
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wallet className="w-5 h-5" />}
        Conectar World Wallet
      </button>
      <p className="text-[10px] text-center text-[oklch(0.40_0.01_230)]">Solo disponible dentro de World App</p>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="h-dvh bg-background flex flex-col items-center justify-center gap-4">
      <div className="relative w-12 h-12">
        <Image src="/flame-logo.png" alt="Acua" fill className="object-contain" />
        <div className="absolute inset-0 rounded-full border-2 border-blue-500/30 animate-ping" />
      </div>
      <p className="text-xs text-[oklch(0.45_0.01_230)] font-mono">Iniciando ACUA MINIEXCHANGE...</p>
    </div>
  )
}

// ─── Navigation Drawer ────────────────────────────────────────────────────────
function NavDrawer({
  open, onClose, activeTab, onSelect, isMainOwner, isAirFunder,
}: {
  open: boolean; onClose: () => void; activeTab: Tab
  onSelect: (t: Tab) => void; isMainOwner: boolean; isAirFunder: boolean
}) {
  if (!open) return null

  const select = (t: Tab) => { onSelect(t); onClose() }

  const Section = ({ title, items }: { title: string; items: MenuEntry[] }) => (
    <div>
      <p className="text-[9px] font-bold text-[oklch(0.40_0.01_230)] uppercase tracking-[0.15em] px-4 py-2">
        {title}
      </p>
      {items.map(item => (
        <button
          key={item.tab}
          onClick={() => select(item.tab)}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
            activeTab === item.tab
              ? 'bg-[oklch(0.65_0.22_255)]/10 border-r-2 border-[oklch(0.65_0.22_255)]'
              : 'hover:bg-white/5',
          )}
        >
          <span className={cn('shrink-0', item.color ?? 'text-[oklch(0.60_0.01_230)]')}>{item.icon}</span>
          <span className={cn('font-medium', activeTab === item.tab ? 'text-foreground' : 'text-[oklch(0.70_0.01_230)]')}>
            {item.label}
          </span>
          {item.badge && (
            <span className={cn(
              'ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full',
              item.badge === 'NUEVO' || item.badge === 'LIVE'
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'bg-white/5 text-[oklch(0.50_0.01_230)] border border-white/10',
            )}>
              {item.badge}
            </span>
          )}
          {activeTab === item.tab && <ChevronRight className="w-3 h-3 ml-auto text-[oklch(0.65_0.22_255)]" />}
        </button>
      ))}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="absolute top-0 left-0 h-full w-[260px] bg-[oklch(0.09_0.018_245)] border-r border-[oklch(0.22_0.025_245)] flex flex-col slide-in-left">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-[oklch(0.18_0.02_245)]">
          <div className="flex items-center gap-2.5">
            <div className="relative w-8 h-8">
              <Image src="/flame-logo.png" alt="Acua" fill className="object-contain" />
            </div>
            <div>
              <p className="text-xs font-black text-foreground tracking-wider">ACUA</p>
              <p className="text-[9px] text-[oklch(0.45_0.01_230)] font-mono">MINIEXCHANGE</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-[oklch(0.50_0.012_230)]" />
          </button>
        </div>

        {/* Live badge */}
        <div className="px-4 py-2 flex items-center gap-2 bg-[oklch(0.68_0.20_158)]/5 border-b border-[oklch(0.68_0.20_158)]/10">
          <div className="w-1.5 h-1.5 rounded-full bg-[#00c076] animate-pulse" />
          <span className="text-[10px] font-semibold text-[#00c076]">World Chain · Live</span>
          <span className="ml-auto text-[9px] text-[oklch(0.40_0.01_230)] font-mono">WC · 480</span>
        </div>

        {/* Menu items */}
        <div className="flex-1 overflow-y-auto py-2">
          <Section title="Staking" items={MENU_STAKING} />
          <div className="mx-4 border-t border-[oklch(0.18_0.02_245)] my-1" />
          <Section title="Minería" items={MENU_MINING} />
          <div className="mx-4 border-t border-[oklch(0.18_0.02_245)] my-1" />
          <Section title="Mercado" items={MENU_MARKET} />
          <div className="mx-4 border-t border-[oklch(0.18_0.02_245)] my-1" />
          <Section title="Info & Monitor" items={MENU_INFO} />
          {(isMainOwner || isAirFunder) && (
            <>
              <div className="mx-4 border-t border-[oklch(0.18_0.02_245)] my-1" />
              <Section title="Admin" items={[{
                tab: 'admin',
                icon: <Shield className="w-4 h-4" />,
                label: 'Panel Admin',
                badge: 'OWNER',
                color: 'text-violet-400',
              }]} />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[oklch(0.18_0.02_245)] px-4 py-3">
          <p className="text-[9px] text-[oklch(0.35_0.01_230)] text-center font-mono">
            ACUA MINIEXCHANGE · World Chain 480
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Tab label map ────────────────────────────────────────────────────────────
const TAB_LABELS: Record<Tab, string> = {
  'h2o': 'Stake H2O', 'h2o-new': 'H2O 2.0', 'h2o-v3': 'H2O v3 Pool',
  'stake-v2': 'Stake V2', 'stake-plus': 'Stake+', 'uth2': 'Minería UTH₂',
  'wld': 'Minería WLD', 'time': 'Minería TIME', 'tokens': 'Tokens',
  'swap': 'Swap', 'info': 'Info', 'admin': 'Admin', 'monitor': 'Monitor',
}

// ─── Quick-access bottom tabs ─────────────────────────────────────────────────
function BottomTab({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick} className={cn(
      'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
      active ? 'text-[oklch(0.65_0.22_255)]' : 'text-[oklch(0.45_0.01_230)] hover:text-foreground',
    )}>
      <span className={cn('transition-transform', active && 'scale-110')}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function AcuaApp() {
  const [isInstalled, setIsInstalled] = useState<InstalledState>(null)
  const [config, setConfig] = useState<ContractConfig | null>(null)
  const [stakeInfo, setStakeInfo] = useState<StakeInfo | null>(null)
  const [h2oBalance, setH2OBalance] = useState(0n)
  const [wldBalance, setWLDBalance] = useState(0n)
  const [loadingData, setLoadingData] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('h2o')
  const [menuOpen, setMenuOpen] = useState(false)
  const [isNewOwner, setIsNewOwner] = useState(false)

  const wallet = useWallet(config?.owner ?? null, isInstalled === true)

  useEffect(() => { patchMiniKitLogger() }, [])

  // Detect MiniKit
  useEffect(() => {
    console.log('[acua] detect: start', { worldApp: !!(window as any).WorldApp, ua: navigator.userAgent.slice(0, 80) })
    if (!(window as any).WorldApp) { setIsInstalled(false); return }
    let attempts = 0
    const iv = setInterval(() => {
      attempts++
      const ok = Boolean((window as any).MiniKit)
      if (ok || attempts >= 15) { clearInterval(iv); setIsInstalled(ok) }
    }, 200)
    return () => clearInterval(iv)
  }, [])

  // Load data
  const loadData = useCallback(async () => {
    setLoadingData(true)
    try {
      const cfg = await fetchContractConfig()
      setConfig(cfg)
      if (wallet.address) {
        const [si, h2o, wld] = await Promise.all([
          fetchStakeInfo(wallet.address),
          fetchH2OBalance(wallet.address),
          fetchWLDBalance(wallet.address),
        ])
        setStakeInfo(si); setH2OBalance(h2o); setWLDBalance(wld)
      }
    } catch (e) { console.error('[acua] loadData ERROR', e) }
    finally { setLoadingData(false) }
  }, [wallet.address])

  useEffect(() => {
    fetchContractConfig()
      .then(cfg => { console.log('[acua] config loaded', cfg); setConfig(cfg) })
      .catch(e => console.error('[acua] config ERROR', e))
  }, [])

  useEffect(() => {
    console.log('[acua] wallet.address changed', wallet.address)
    if (wallet.address) { loadData(); fetchNewContractOwnership(wallet.address) }
  }, [wallet.address]) // eslint-disable-line

  const fetchNewContractOwnership = useCallback(async (addr: string) => {
    try {
      const p = getProvider()
      const low = addr.toLowerCase()
      const results = await Promise.allSettled(
        Object.values(STAKING_CONTRACTS).map(async ca => {
          const c = new ethers.Contract(ca, UNIVERSAL_STAKING_ABI, p)
          return (await c.getOwners() as string[]).map(o => o.toLowerCase())
        })
      )
      const all: string[] = []
      results.forEach(r => { if (r.status === 'fulfilled') r.value.forEach(o => { if (o !== ethers.ZeroAddress.toLowerCase()) all.push(o) }) })
      setIsNewOwner(all.includes(low))
    } catch (e) { console.error('[acua] ownership ERROR', e) }
  }, [])

  // Ownership flags
  const isAirFunder      = wallet.address?.toLowerCase() === AIR_FUNDER_ADDRESS
  const isSecondaryAdmin = wallet.address?.toLowerCase() === SECONDARY_ADMIN_ADDRESS
  const isMainOwner      = wallet.isOwner || isNewOwner || isSecondaryAdmin

  // Gates
  if (isInstalled === null) return <LoadingScreen />
  if (!isInstalled || !wallet.address) {
    return (
      <div className="h-dvh bg-background flex flex-col max-w-md mx-auto">
        {!isInstalled ? <NotInstalled /> : <ConnectScreen onConnect={wallet.connect} loading={wallet.isConnecting} />}
      </div>
    )
  }

  const addr = wallet.address

  return (
    <div className="h-dvh bg-background flex flex-col max-w-md mx-auto overflow-hidden">

      {/* ── Navigation Drawer ─────────────────────────────────────────── */}
      <NavDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeTab={activeTab}
        onSelect={setActiveTab}
        isMainOwner={isMainOwner}
        isAirFunder={isAirFunder}
      />

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="shrink-0 bg-[oklch(0.09_0.018_245)]/95 backdrop-blur-xl border-b border-[oklch(0.22_0.025_245)] z-10">
        <div className="flex items-center gap-2 px-2 pt-1 pb-2.5">
          {/* Flame menu button — pulsing heartbeat */}
          <button
            onClick={() => setMenuOpen(true)}
            className="shrink-0 relative flex items-center justify-center"
            style={{ width: 48, height: 52 }}
            aria-label="Menú principal"
          >
            {/* Outer glow ring — heartbeat */}
            <span className="absolute inset-0 rounded-2xl border-2 border-blue-500/60 heartbeat-ring" />
            {/* Button body */}
            <span className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-500 flex items-center justify-center shadow-[0_0_16px_rgba(59,130,246,0.55)] heartbeat-logo">
              <div className="relative w-7 h-7 mt-1">
                <Image src="/flame-logo.png" alt="Menu" fill className="object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]" />
              </div>
            </span>
          </button>

          {/* Title + active tab */}
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-black tracking-[0.12em] text-foreground leading-none">ACUA MINIEXCHANGE</p>
            <p className="text-[9px] text-[oklch(0.50_0.012_230)] font-mono mt-0.5 truncate">
              {TAB_LABELS[activeTab]}
            </p>
          </div>

          {/* Status + wallet */}
          <div className="flex items-center gap-2">
            {loadingData && <Loader2 className="w-3 h-3 text-[oklch(0.50_0.012_230)] animate-spin" />}
            <div className="flex items-center gap-1.5 rounded-lg border border-[oklch(0.22_0.025_245)] bg-[oklch(0.12_0.02_245)] px-2 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00c076] animate-pulse" />
              <span className="text-[10px] text-foreground font-mono">{shortenAddress(addr)}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Stats ticker ──────────────────────────────────────────────── */}
      <StatsTicker />

      {/* ── Market mini card (H2O candle chart) ───────────────────────── */}
      <MarketMiniCard />

      {/* ── Content ───────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="px-3 py-3">

          {activeTab === 'h2o' && (
            <StakePanel
              stakeInfo={stakeInfo}
              config={config}
              userAddress={addr}
              h2oBalance={h2oBalance}
              wldBalance={wldBalance}
              onRefresh={loadData}
            />
          )}

          {activeTab === 'h2o-new' && <NewH2OPanel userAddress={addr} />}

          {activeTab === 'stake-v2' && <StakeV2Panel userAddress={addr} />}

          {activeTab === 'h2o-v3' && <H2OV3Panel userAddress={addr} />}

          {activeTab === 'stake-plus' && <MultiStakingPanel userAddress={addr} />}

          {activeTab === 'uth2' && <MiningUTH2Panel userAddress={addr} />}

          {activeTab === 'wld' && <MiningWLDPanel userAddress={addr} />}

          {activeTab === 'time' && <MiningTimePanel userAddress={addr} />}

          {activeTab === 'tokens' && <TokenDirectoryPanel />}

          {activeTab === 'swap' && <SwapPanel userAddress={addr} isAdmin={isMainOwner} />}

          {activeTab === 'info' && <InfoPanel />}

          {activeTab === 'monitor' && (
            <PlatformMonitor
              userAddress={addr}
              stakeInfo={stakeInfo}
              h2oBalance={h2oBalance}
              onRefresh={loadData}
            />
          )}

          {activeTab === 'admin' && (
            <>
              {isAirFunder && !isMainOwner ? (
                <AirFunderPanel userAddress={addr} />
              ) : isMainOwner ? (
                <div className="space-y-5">
                  <ContractsOwnerPanel userAddress={addr} />
                  {wallet.isOwner && config && (
                    <div className="border-t border-[oklch(0.22_0.025_245)] pt-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Droplets className="w-4 h-4 text-[oklch(0.65_0.22_255)]" />
                        <span className="text-sm font-bold text-[oklch(0.65_0.22_255)]">Admin Stake H2O</span>
                      </div>
                      <OwnerPanel config={config} onRefresh={loadData} />
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}

        </div>
      </main>

      {/* ── Bottom Quick Nav ───────────────────────────────────────────── */}
      <nav className="shrink-0 border-t border-[oklch(0.22_0.025_245)] bg-[oklch(0.09_0.018_245)]/95 backdrop-blur-xl flex">
        <BottomTab icon={<Droplets className="w-4 h-4" />}    label="H2O"    active={activeTab === 'h2o'}     onClick={() => setActiveTab('h2o')} />
        <BottomTab icon={<Repeat2 className="w-4 h-4" />}     label="Swap"   active={activeTab === 'swap'}    onClick={() => setActiveTab('swap')} />
        <BottomTab icon={<Activity className="w-4 h-4" />}    label="Monitor" active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} />
        <BottomTab icon={<TrendingUp className="w-4 h-4" />}  label="Stake+" active={activeTab === 'stake-plus'} onClick={() => setActiveTab('stake-plus')} />
        <BottomTab icon={<Sparkles className="w-4 h-4" />}    label="H2O 2.0" active={activeTab === 'h2o-new'} onClick={() => setActiveTab('h2o-new')} />
      </nav>

    </div>
  )
}
