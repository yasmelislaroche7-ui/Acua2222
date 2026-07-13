'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Droplets, RefreshCw, Wallet, Shield, Loader2,
  TrendingUp, Pickaxe, Star, HelpCircle, Wind, Clock, BookOpen, Repeat2,
  Sparkles, X, ChevronRight, Activity, ArrowLeftRight, KeyRound, Eye, EyeOff, LogOut,
} from 'lucide-react'
import { StakePanel }            from '@/components/stake-panel'
import { OwnerPanel }            from '@/components/owner-panel'
import { MultiStakingPanel }     from '@/components/multi-staking-panel'
import { StakeV2Panel }          from '@/components/stake-v2-panel'
import { H2OV3Panel }            from '@/components/h2o-v3-panel'
import { MiningUTH2Panel }       from '@/components/mining-uth2-panel'
import { MiningWLDPanel }        from '@/components/mining-wld-panel'
import { MiningTimePanel }       from '@/components/mining-time-panel'
import { ContractsOwnerPanel }   from '@/components/contracts-owner-panel'
import { ContractAdminPanel }    from '@/components/contracts-admin-panel'
import { AirFunderPanel }        from '@/components/air-funder-panel'
import { InfoPanel }             from '@/components/info-panel'
import { TokenDirectoryPanel }   from '@/components/token-directory-panel'
import { SwapPanel }             from '@/components/swap-panel'
import { NewH2OPanel }           from '@/components/new-h2o-panel'
import { TnTPanel }              from '@/components/tnt-panel'
import { SushiV2Panel }          from '@/components/sushi-v2-panel'
import { AcuaTokenStakePanel }   from '@/components/acua-token-stake-panel'
import { AcuaFreeClaimPanel }    from '@/components/acua-free-claim-panel'
import { StakeV4Panel }          from '@/components/stake-v4-panel'
import { StakeV5Panel }          from '@/components/stake-v5-panel'
import { StakeFactoryPanel }     from '@/components/stake-factory-panel'
import { AutoStakePanel }        from '@/components/autostake-panel'
import { AutoStakeMiningPanel }  from '@/components/autostake-mining-panel'
import { AutoStakeOwnerPanel }   from '@/components/autostake-owner-panel'
import { PlatformMonitor }       from '@/components/platform-monitor'
import { StatsTicker, MarketMiniCard } from '@/components/market-ticker'
import { NetworkSwitcher }       from '@/components/network-switcher'
import { ComingSoonPanel }       from '@/components/coming-soon-panel'
import { LanguageSwitcher }      from '@/components/language-switcher'
import { AiAgent }               from '@/components/ai-agent'
import { GlobalChat }            from '@/components/global-chat'
import { BNBSushiPanel }         from '@/components/bnb-sushi-panel'
import { BNBWalletPanel }        from '@/components/bnb-wallet-panel'
import { BNBBridgePanel }        from '@/components/bnb-bridge-panel'
import { useWallet }             from '@/hooks/use-wallet'
import { type NetworkId, NETWORKS } from '@/lib/networks'
import {
  fetchStakeInfo, fetchContractConfig, fetchH2OBalance, fetchWLDBalance,
  StakeInfo, ContractConfig, shortenAddress,
} from '@/lib/contract'
import {
  STAKING_CONTRACTS, UNIVERSAL_STAKING_ABI, getProvider,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────
type Tab = 'h2o' | 'h2o-new' | 'h2o-v3' | 'stake-v2' | 'stake-plus' | 'uth2' | 'wld' | 'time' | 'stake-v5'
         | 'tokens' | 'swap' | 'tnt' | 'info' | 'admin' | 'monitor' | 'contracts-admin' | 'sushi-v2'
         | 'acua-stake' | 'acua-claim' | 'stake-v4' | 'stake-factory'
         | 'autostake' | 'autostake-mine' | 'autostake-admin'
type BNBTab = 'bnb-stake' | 'bnb-wallet' | 'bnb-bridge'
type InstalledState = null | true | false

const AIR_FUNDER_ADDRESS      = '0x72acfbfcee02176118107958ec317157ccd4afdb'
const SECONDARY_ADMIN_ADDRESS = '0x5474c309e985c6b4fc623acf01ade604da781e52'

// ─── MiniKit v1/v2 compatibility shim + logger ───────────────────────────────
//
// MiniKit v2 (released May 2026) removed:
//   • MiniKit.commandsAsync.* → replaced by await MiniKit.<cmd>() directly
//   • permit2: [{nonce,deadline,...}] SignatureTransfer array → replaced by AllowanceTransfer
//
// This shim restores commandsAsync.sendTransaction so ALL components (stake, mining,
// v3 pool, etc.) keep working with World App v2 without touching each file individually.
//
// Transactions that do NOT use Permit2 (claim, withdraw, unstake, claimRewards) work
// transparently in both v1 and v2.
//
// Transactions that DO use Permit2 SignatureTransfer (deposit, stake) still require
// the smart contracts to be migrated to AllowanceTransfer to fully work in v2. The
// shim will forward them as-is and let World App decide (v1-compatible World Apps
// will handle it; v2-only World Apps will fail with simulation_failed on those).
//
function installMiniKitCompat() {
  if (typeof window === 'undefined') return
  if ((window as any).__minikitCompatInstalled) return
  ;(window as any).__minikitCompatInstalled = true

  const mk = MiniKit as any
  const log = (label: string, data: unknown, color = '#00d4ff') =>
    console.log(`%c[MiniKit] ${label}`, `color:${color};font-weight:bold`, data)

  // ── Step 1: ensure commandsAsync exists (v2 removed it) ──────────────────
  if (!mk.commandsAsync || typeof mk.commandsAsync !== 'object') {
    mk.commandsAsync = {}
    log('commandsAsync shim created (MiniKit v2 detected)', null, '#ffa500')
  }

  // ── Step 2: ensure commandsAsync.sendTransaction exists ──────────────────
  if (typeof mk.commandsAsync.sendTransaction !== 'function') {
    // Wrap MiniKit.sendTransaction (v2 direct API) to look like v1 commandsAsync
    if (typeof mk.sendTransaction === 'function') {
      mk.commandsAsync.sendTransaction = async (opts: any) => {
        log('→ sendTransaction (v2 shim) PAYLOAD', opts, '#00d4ff')
        try {
          // v2 sendTransaction does not accept a `permit2` array.
          // Pass it through — if World App is v2-only it will ignore it;
          // if it's v1-compatible it will process it.
          const result = await mk.sendTransaction(opts)
          log('← sendTransaction (v2 shim) RESPONSE', result, '#00ff99')
          // v2 returns the payload directly; v1 wraps in { finalPayload }
          if (result && typeof result === 'object' && !('finalPayload' in result)) {
            return { finalPayload: result }
          }
          return result
        } catch (err) {
          log('✖ sendTransaction (v2 shim) ERROR', err, '#ff4d4d')
          throw err
        }
      }
      log('commandsAsync.sendTransaction polyfilled via MiniKit.sendTransaction', null, '#00ff99')
    } else {
      log('WARNING: MiniKit.sendTransaction not found — no shim possible', null, '#ff4d4d')
    }
  } else {
    // ── Step 3: wrap existing commandsAsync methods with logger (v1 path) ───
    for (const cmd of Object.keys(mk.commandsAsync)) {
      const fn = mk.commandsAsync[cmd]
      if (typeof fn !== 'function') continue
      mk.commandsAsync[cmd] = async function (...args: unknown[]) {
        log(`→ ${cmd} PAYLOAD`, args, '#00d4ff')
        try { const r = await fn.apply(this, args); log(`← ${cmd} RESPONSE`, r, '#00ff99'); return r }
        catch (err) { log(`✖ ${cmd} ERROR`, err, '#ff4d4d'); throw err }
      }
    }
    log('MiniKit logger active ✓', { patchedAt: new Date().toISOString() }, '#888888')
  }
}

// ─── Menu config ─────────────────────────────────────────────────────────────
interface MenuEntry { tab: Tab; icon: React.ReactNode; label: string; badge?: string; color?: string }
const MENU_STAKING: MenuEntry[] = [
  { tab: 'h2o',        icon: <Droplets className="w-4 h-4" />,    label: 'Stake H2O',      badge: '12% APY',  color: 'text-cyan-400' },
  { tab: 'h2o-new',    icon: <img src="/tokens/h2o2.webp" className="w-4 h-4 rounded-full object-cover" alt="H2O 2.0" />,    label: 'H2O 2.0',        badge: 'NUEVO',    color: 'text-blue-400' },
  { tab: 'h2o-v3',     icon: <Droplets className="w-4 h-4" />,    label: 'H2O v3 Pool',    color: 'text-cyan-300' },
  { tab: 'stake-v2',   icon: <Wind className="w-4 h-4" />,        label: 'Stake V2',       color: 'text-violet-400' },
  { tab: 'stake-plus', icon: <TrendingUp className="w-4 h-4" />,  label: 'Stake+',          badge: '8 tokens', color: 'text-emerald-400' },
  { tab: 'sushi-v2',   icon: <span className="text-sm leading-none">🍣</span>, label: 'SUSHI 2.0', badge: '300% APR', color: 'text-red-400' },
  { tab: 'acua-stake', icon: <span className="text-sm leading-none">🪙</span>, label: 'ACUA Stake', badge: '12% APR', color: 'text-violet-400' },
  { tab: 'stake-v4',  icon: <span className="text-sm leading-none">⚡</span>, label: 'Stake V4',   badge: 'SOLO RETIRO', color: 'text-purple-400' },
  { tab: 'stake-v5',  icon: <span className="text-sm leading-none">💎</span>, label: 'Stake V5',   badge: '5% FEE', color: 'text-fuchsia-400' },
  { tab: 'stake-factory', icon: <span className="text-sm leading-none">🏭</span>, label: 'Stake Factory', badge: 'CREA EL TUYO', color: 'text-cyan-400' },
  { tab: 'autostake',    icon: <span className="text-sm leading-none">♻️</span>,  label: 'AutoStake',    badge: 'AUTO', color: 'text-emerald-400' },
]
const MENU_MINING: MenuEntry[] = [
  { tab: 'uth2',          icon: <Pickaxe className="w-4 h-4" />, label: 'UTH₂ → H2O',      color: 'text-orange-400' },
  { tab: 'wld',           icon: <Star className="w-4 h-4" />,    label: 'WLD → 7 tokens',   color: 'text-yellow-400' },
  { tab: 'time',          icon: <Clock className="w-4 h-4" />,   label: 'TIME → WLD',       color: 'text-purple-400' },
  { tab: 'autostake-mine',icon: <span className="text-sm leading-none">⛏</span>, label: 'AutoStake Mine', badge: 'EARN 1%', color: 'text-[oklch(0.65_0.22_255)]' },
]
const MENU_MARKET: MenuEntry[] = [
  { tab: 'swap',       icon: <Repeat2 className="w-4 h-4" />,       label: 'Swap',         color: 'text-blue-400' },
  { tab: 'tnt',        icon: <ArrowLeftRight className="w-4 h-4" />, label: 'T+T Exchange', badge: 'NUEVO', color: 'text-violet-400' },
  { tab: 'acua-claim', icon: <Sparkles className="w-4 h-4" />,      label: 'Free Claim',   badge: 'GRATIS', color: 'text-emerald-400' },
  { tab: 'tokens',     icon: <BookOpen className="w-4 h-4" />,       label: 'Tokens',       color: 'text-teal-400' },
]
const MENU_INFO: MenuEntry[] = [
  { tab: 'monitor', icon: <Activity className="w-4 h-4" />,   label: 'Monitor',     badge: 'LIVE', color: 'text-green-400' },
  { tab: 'info',    icon: <HelpCircle className="w-4 h-4" />, label: 'Info / Guía', color: 'text-slate-400' },
]

// ─── Screens ─────────────────────────────────────────────────────────────────
function ConnectScreen({
  onConnect, loading, hasMiniKit, onImport,
}: {
  onConnect: () => void
  loading: boolean
  hasMiniKit: boolean
  onImport: (pk: string) => { address: string } | { error: string }
}) {
  const [tab, setTab]         = useState<'world' | 'import'>('world')
  const [pk, setPk]           = useState('')
  const [showPk, setShowPk]   = useState(false)
  const [importErr, setImportErr] = useState('')
  const [importing, setImporting] = useState(false)

  function handleImport() {
    if (!pk.trim()) return setImportErr('Introduce tu clave privada.')
    setImporting(true); setImportErr('')
    const result = onImport(pk.trim())
    if ('error' in result) {
      setImportErr(result.error)
      setImporting(false)
    }
    // On success the parent re-renders and this screen unmounts
  }

  const FEATURES = [
    { dot: 'bg-blue-500',    label: 'Stake H2O',              val: '12% APY'   },
    { dot: 'bg-emerald-500', label: 'Multi-Stake 8 tokens',   val: 'APY variable' },
    { dot: 'bg-orange-500',  label: 'Minería UTH₂ → H2O',    val: 'Permanente' },
    { dot: 'bg-yellow-500',  label: 'Minería WLD → 7 tokens', val: 'Simultáneo' },
    { dot: 'bg-red-500',     label: 'SUSHI BNB Staking',      val: 'Cocción VIP' },
    { dot: 'bg-cyan-500',    label: 'Bridge WLD ↔ BNB',       val: '1:1 SUSHI'  },
  ]

  return (
    <div className="flex-1 flex flex-col items-center gap-5 px-5 py-6 overflow-y-auto">
      {/* Logo */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative flex items-center justify-center" style={{ width: 88, height: 88 }}>
          <span className="absolute inset-0 rounded-3xl border-2 border-blue-500/60 heartbeat-ring" />
          <span className="relative w-18 h-18 rounded-3xl bg-gradient-to-br from-blue-600 to-blue-500 flex items-center justify-center shadow-[0_0_32px_rgba(59,130,246,0.55)] heartbeat-logo" style={{ width: 72, height: 72 }}>
            <div className="relative" style={{ width: 44, height: 44, marginTop: 4 }}>
              <Image src="/flame-logo.png" alt="Acua" fill loading="eager" className="object-contain" />
            </div>
          </span>
        </div>
        <div className="text-center">
          <h1 className="text-xl font-black tracking-tight text-foreground">ACUA MINIEXCHANGE</h1>
          <p className="text-[oklch(0.50_0.012_230)] text-xs mt-0.5 font-mono">World Chain · DeFi · 2026</p>
        </div>
      </div>

      {/* Features list */}
      <div className="w-full max-w-xs rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.12_0.02_245)] divide-y divide-[oklch(0.18_0.02_245)]">
        {FEATURES.map(f => (
          <div key={f.label} className="flex items-center gap-3 px-4 py-2">
            <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', f.dot)} />
            <span className="text-xs text-[oklch(0.60_0.01_230)] flex-1">{f.label}</span>
            <span className="text-xs font-bold text-foreground font-mono">{f.val}</span>
          </div>
        ))}
      </div>

      {/* Tab switcher */}
      <div className="w-full max-w-xs flex rounded-xl overflow-hidden border border-[oklch(0.22_0.025_245)]">
        <button
          onClick={() => setTab('world')}
          className={cn(
            'flex-1 py-2 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors',
            tab === 'world'
              ? 'bg-[oklch(0.65_0.22_255)] text-white'
              : 'bg-[oklch(0.12_0.02_245)] text-[oklch(0.55_0.01_230)] hover:text-foreground',
          )}
        >
          <Wallet className="w-3.5 h-3.5" /> World Wallet
        </button>
        <button
          onClick={() => setTab('import')}
          className={cn(
            'flex-1 py-2 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors',
            tab === 'import'
              ? 'bg-[oklch(0.65_0.22_255)] text-white'
              : 'bg-[oklch(0.12_0.02_245)] text-[oklch(0.55_0.01_230)] hover:text-foreground',
          )}
        >
          <KeyRound className="w-3.5 h-3.5" /> Importar Wallet
        </button>
      </div>

      {/* Tab content */}
      <div className="w-full max-w-xs space-y-3">
        {tab === 'world' ? (
          <>
            {hasMiniKit ? (
              <>
                <button
                  className="w-full h-12 rounded-xl bg-[oklch(0.65_0.22_255)] text-white font-bold text-sm flex items-center justify-center gap-2 glow-blue hover:bg-[oklch(0.70_0.24_255)] transition-colors"
                  onClick={onConnect}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wallet className="w-5 h-5" />}
                  Conectar World Wallet
                </button>
                <p className="text-[10px] text-center text-[oklch(0.40_0.01_230)]">
                  Gas patrocinado · Permit2 · World Chain
                </p>
              </>
            ) : (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-4 text-center space-y-2">
                <p className="text-xs font-semibold text-amber-400">Fuera de World App</p>
                <p className="text-[11px] text-[oklch(0.55_0.01_230)] leading-relaxed">
                  World Wallet solo funciona dentro de <strong className="text-foreground">World App</strong>.
                  Usa la pestaña <strong className="text-foreground">Importar Wallet</strong> para conectar con clave privada.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <p className="text-[10px] text-amber-400 font-semibold mb-1">Aviso de seguridad</p>
              <p className="text-[10px] text-[oklch(0.55_0.01_230)] leading-relaxed">
                Tu clave privada nunca se almacena. Permanece en memoria y se borra al cerrar la app.
                Usa solo en dispositivos de confianza.
              </p>
            </div>
            <div className="relative">
              <input
                type={showPk ? 'text' : 'password'}
                value={pk}
                onChange={e => { setPk(e.target.value); setImportErr('') }}
                placeholder="Clave privada (0x... o 64 hex)"
                className="w-full bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-3 pr-10 text-xs text-foreground placeholder:text-[oklch(0.40_0.01_230)] focus:outline-none focus:border-[oklch(0.65_0.22_255)] font-mono"
                onKeyDown={e => e.key === 'Enter' && handleImport()}
              />
              <button
                type="button"
                onClick={() => setShowPk(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[oklch(0.50_0.01_230)] hover:text-foreground"
              >
                {showPk ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {importErr && (
              <p className="text-[11px] text-red-400 text-center">{importErr}</p>
            )}
            <button
              onClick={handleImport}
              disabled={importing || !pk.trim()}
              className="w-full h-11 rounded-xl bg-[oklch(0.65_0.22_255)] text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-[oklch(0.70_0.24_255)] transition-colors disabled:opacity-50"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Conectar wallet
            </button>
            <p className="text-[10px] text-center text-[oklch(0.40_0.01_230)]">
              Funciona en World Chain · ethers.js · Paga gas en ETH
            </p>
          </>
        )}
      </div>
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

// ─── Navigation Drawer ───────────────────────────────────────────────────────
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
      <p className="text-[9px] font-bold text-[oklch(0.40_0.01_230)] uppercase tracking-[0.15em] px-4 py-2">{title}</p>
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute top-0 left-0 h-full w-[260px] bg-[oklch(0.09_0.018_245)] border-r border-[oklch(0.22_0.025_245)] flex flex-col slide-in-left">
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
        <div className="px-4 py-2 flex items-center gap-2 bg-[oklch(0.68_0.20_158)]/5 border-b border-[oklch(0.68_0.20_158)]/10">
          <div className="w-1.5 h-1.5 rounded-full bg-[#00c076] animate-pulse" />
          <span className="text-[10px] font-semibold text-[#00c076]">World Chain · Live</span>
          <span className="ml-auto text-[9px] text-[oklch(0.40_0.01_230)] font-mono">WC · 480</span>
        </div>
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
              <Section title="Admin" items={[
                { tab: 'admin',           icon: <Shield className="w-4 h-4" />,   label: 'Panel Admin',      badge: 'OWNER', color: 'text-violet-400' },
                { tab: 'contracts-admin', icon: <Shield className="w-4 h-4" />,   label: 'Admin Contratos',  badge: 'OWNER', color: 'text-blue-400' },
                { tab: 'autostake-admin', icon: <span className="text-sm leading-none">♻️</span>, label: 'AutoStake Admin', badge: 'OWNER', color: 'text-emerald-400' },
              ]} />
            </>
          )}
        </div>
        <div className="border-t border-[oklch(0.18_0.02_245)] px-4 py-3">
          <p className="text-[9px] text-[oklch(0.35_0.01_230)] text-center font-mono">
            ACUA MINIEXCHANGE · World Chain 480
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Tab label map ───────────────────────────────────────────────────────────
const TAB_LABELS: Record<Tab, string> = {
  'h2o': 'Stake H2O', 'h2o-new': 'H2O 2.0', 'h2o-v3': 'H2O v3 Pool',
  'stake-v2': 'Stake V2', 'stake-plus': 'Stake+', 'uth2': 'Minería UTH₂',
  'wld': 'Minería WLD', 'time': 'Minería TIME', 'tokens': 'Tokens',
  'swap': 'Swap', 'tnt': 'T+T Exchange', 'info': 'Info', 'admin': 'Admin', 'monitor': 'Monitor',
  'contracts-admin': 'Admin Contratos', 'sushi-v2': 'SUSHI 2.0',
  'acua-stake': 'ACUA Stake', 'acua-claim': 'Free Claim', 'stake-v4': 'Stake V4 ACUA (solo retiro)',
  'stake-v5': 'Stake V5 ACUA', 'stake-factory': 'Stake Factory',
  'autostake': 'AutoStake', 'autostake-mine': 'AutoStake Mining', 'autostake-admin': 'AutoStake Admin',
}

const BNB_TAB_LABELS: Record<BNBTab, string> = {
  'bnb-stake': '🍣 SUSHI Stake',
  'bnb-wallet': '💛 Wallet BNB',
  'bnb-bridge': '🌉 Bridge WLD↔BNB',
}

// ─── Improved Floating Fan Button ────────────────────────────────────────────
interface FabItem { tab: Tab; icon: React.ReactNode; label: string; color: string }

const FAB_ITEMS: FabItem[] = [
  // ── Inner arc (R=90) ──
  { tab: 'h2o',        icon: <Droplets className="w-3 h-3" />,        label: 'H2O',      color: '#06b6d4' },
  { tab: 'swap',       icon: <Repeat2 className="w-3 h-3" />,         label: 'Swap',     color: '#3b82f6' },
  { tab: 'h2o-new',    icon: <img src="/tokens/h2o2.webp" className="w-3 h-3 rounded-full object-cover" alt="H2O 2.0" />, label: 'H2O 2.0', color: '#60a5fa' },
  { tab: 'h2o-v3',     icon: <Droplets className="w-3 h-3" />,        label: 'H2O v3',   color: '#22d3ee' },
  { tab: 'stake-v2',   icon: <Wind className="w-3 h-3" />,            label: 'StakeV2',  color: '#a78bfa' },
  // ── Outer arc (R=162) ──
  { tab: 'stake-plus', icon: <TrendingUp className="w-3 h-3" />,      label: 'Stake+',   color: '#10b981' },
  { tab: 'wld',        icon: <Star className="w-3 h-3" />,            label: 'WLD',      color: '#fbbf24' },
  { tab: 'uth2',       icon: <Pickaxe className="w-3 h-3" />,         label: 'UTH2',     color: '#f97316' },
  { tab: 'sushi-v2',   icon: <span style={{ fontSize: 11, lineHeight: 1 }}>🍣</span>, label: 'SUSHI', color: '#ef4444' },
  { tab: 'tnt',        icon: <ArrowLeftRight className="w-3 h-3" />,  label: 'T+T',      color: '#8b5cf6' },
  // ── Far arc (R=234, 6 items, 18° steps) ──
  { tab: 'acua-claim',     icon: <Sparkles className="w-3 h-3" />,                          label: 'Claim',    color: '#34d399' },
  { tab: 'stake-v4',       icon: <span style={{ fontSize: 11, lineHeight: 1 }}>⚡</span>,   label: 'V4',       color: '#a855f7' },
  { tab: 'stake-v5',       icon: <span style={{ fontSize: 11, lineHeight: 1 }}>💎</span>,   label: 'V5',       color: '#e879f9' },
  { tab: 'stake-factory',  icon: <span style={{ fontSize: 11, lineHeight: 1 }}>🏭</span>,   label: 'Factory',  color: '#22d3ee' },
  { tab: 'autostake',      icon: <span style={{ fontSize: 11, lineHeight: 1 }}>♻️</span>,   label: 'AutoStake',color: '#10b981' },
  { tab: 'autostake-mine', icon: <span style={{ fontSize: 11, lineHeight: 1 }}>⛏</span>,   label: 'AutoMine', color: '#6366f1' },
]

// Triple-arc: inner R=90 (5), outer R=162 (5), far R=234 (6, 18° steps)
const FAB_POSITIONS = [
  // ── Inner arc (R=90, 22.5° steps, θ=90°→180°) ──
  { dx:   0, dy:  -90 },  // H2O       θ=90°
  { dx: -34, dy:  -83 },  // Swap      θ=112.5°
  { dx: -64, dy:  -64 },  // H2O 2.0   θ=135°
  { dx: -83, dy:  -34 },  // H2O v3    θ=157.5°
  { dx: -90, dy:    0 },  // Stake V2  θ=180°
  // ── Outer arc (R=162, 22.5° steps, θ=90°→180°) ──
  { dx:   0,  dy: -162 }, // Stake+    θ=90°
  { dx: -62,  dy: -150 }, // WLD       θ=112.5°
  { dx: -115, dy: -115 }, // UTH2      θ=135°
  { dx: -150, dy:  -62 }, // SUSHI     θ=157.5°
  { dx: -162, dy:    0 }, // T+T       θ=180°
  // ── Far arc (R=234, 18° steps, θ=90°→180°) ──
  { dx:   0,  dy: -234 }, // Claim     θ=90°
  { dx:  -72, dy: -223 }, // V4        θ=108°
  { dx: -138, dy: -189 }, // V5        θ=126°
  { dx: -189, dy: -138 }, // Factory   θ=144°
  { dx: -222, dy:  -72 }, // AutoStake θ=162°
  { dx: -234, dy:    0 }, // AutoMine  θ=180°
]

function FloatingFab({ onSelect, activeTab }: { onSelect: (t: Tab) => void; activeTab: Tab }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}

      <div className="fixed z-40" style={{ bottom: 18, right: 18 }}>
        {FAB_ITEMS.map((item, i) => {
          const pos = FAB_POSITIONS[i]
          const isActive = activeTab === item.tab
          return (
            <button
              key={item.tab}
              onClick={() => { onSelect(item.tab); setOpen(false) }}
              style={{
                position: 'absolute',
                width: 38,
                height: 42,
                bottom: 5,
                right: 5,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                borderRadius: 10,
                // Less translucent: solid background instead of near-transparent
                background: isActive ? `${item.color}55` : `${item.color}35`,
                border: `1.5px solid ${item.color}${isActive ? 'ee' : '99'}`,
                color: item.color,
                fontSize: 7,
                fontWeight: 800,
                letterSpacing: '0.03em',
                backdropFilter: 'none',
                transform: open
                  ? `translate(${pos.dx - 19}px, ${pos.dy - 21}px)`
                  : 'translate(-19px, -21px)',
                opacity: open ? 1 : 0,
                pointerEvents: open ? 'auto' : 'none',
                transition: `transform 0.32s cubic-bezier(0.34,1.46,0.64,1) ${i * 0.028}s, opacity 0.18s ease ${i * 0.028}s`,
                boxShadow: isActive ? `0 0 8px ${item.color}88` : `0 2px 6px rgba(0,0,0,0.5)`,
              }}
            >
              {item.icon}
              <span style={{ lineHeight: 1 }}>{item.label}</span>
            </button>
          )
        })}

        {/* Main button */}
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            width: 50,
            height: 50,
            borderRadius: 14,
            background: open
              ? 'linear-gradient(135deg, #1e40af, #2563eb)'
              : 'linear-gradient(135deg, #1d4ed8, #2563eb)',
            boxShadow: open
              ? '0 0 22px rgba(59,130,246,0.80)'
              : '0 0 14px rgba(59,130,246,0.50)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            border: '1.5px solid rgba(147,197,253,0.40)',
            transform: open ? 'scale(1.06) rotate(10deg)' : 'scale(1)',
            transition: 'transform 0.22s ease, box-shadow 0.22s ease',
          }}
          aria-label="Menú rápido"
        >
          <div style={{ width: 22, height: 22, position: 'relative' }}>
            <Image src="/flame-logo.png" alt="Menu" fill className="object-contain" />
          </div>
          <span style={{ color: '#ef4444', fontSize: 7, fontWeight: 900, letterSpacing: '0.08em', lineHeight: 1 }}>
            MENU
          </span>
        </button>
      </div>
    </>
  )
}

// ─── Panel bloqueado: requiere clave importada ───────────────────────────────
function ImportedKeyRequired({ network, color }: { network: string; color: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-14 px-6 text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
        style={{ background: `${color}18`, border: `1.5px solid ${color}40` }}>
        🔒
      </div>
      <div>
        <p className="text-[13px] font-bold mb-1" style={{ color }}>
          {network} · Clave requerida
        </p>
        <p className="text-[11px] text-[oklch(0.55_0.012_230)] leading-relaxed max-w-[240px]">
          Esta red requiere tu clave privada para firmar transacciones.
          Importa tu wallet usando el selector de redes <span className="font-bold text-white">↗</span> en la parte superior.
        </p>
      </div>
      <p className="text-[9px] text-[oklch(0.40_0.01_230)] leading-relaxed max-w-[220px]">
        Tu clave de World Wallet es la misma dirección EVM en todas las redes.
        Puedes importarla desde Ajustes → Clave de recuperación de World App.
      </p>
    </div>
  )
}

// ─── BNB Sub-navigation tabs ─────────────────────────────────────────────────
function BNBSubNav({ active, onChange }: { active: BNBTab; onChange: (t: BNBTab) => void }) {
  const tabs: { id: BNBTab; label: string; color: string }[] = [
    { id: 'bnb-stake',  label: '🍣 Stake',  color: '#e84142' },
    { id: 'bnb-wallet', label: '💛 Wallet', color: '#f0b90b' },
    { id: 'bnb-bridge', label: '🌉 Bridge', color: '#3b82f6' },
  ]
  return (
    <div className="shrink-0 flex gap-1.5 px-3 py-2 border-b border-[oklch(0.22_0.025_245)] bg-[oklch(0.085_0.018_245)]">
      {tabs.map(tb => (
        <button
          key={tb.id}
          onClick={() => onChange(tb.id)}
          className={cn(
            'flex-1 py-1.5 rounded-xl text-[10px] font-bold transition-all border',
            active === tb.id
              ? 'text-white'
              : 'bg-[oklch(0.10_0.018_245)] border-[oklch(0.22_0.025_245)] text-[oklch(0.50_0.012_230)] hover:text-foreground'
          )}
          style={active === tb.id ? { background: tb.color, borderColor: `${tb.color}cc` } : {}}
        >
          {tb.label}
        </button>
      ))}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function AcuaApp() {
  const [isInstalled, setIsInstalled] = useState<InstalledState>(null)
  const [config, setConfig]           = useState<ContractConfig | null>(null)
  const [stakeInfo, setStakeInfo]     = useState<StakeInfo | null>(null)
  const [h2oBalance, setH2OBalance]   = useState(0n)
  const [wldBalance, setWLDBalance]   = useState(0n)
  const [loadingData, setLoadingData] = useState(false)
  const [activeTab, setActiveTab]     = useState<Tab>('h2o')
  const [activeBNBTab, setActiveBNBTab] = useState<BNBTab>('bnb-stake')
  const [menuOpen, setMenuOpen]       = useState(false)
  const [isNewOwner, setIsNewOwner]   = useState(false)
  const [activeNetwork, setActiveNetwork] = useState<NetworkId>('wld')
  const [bnbAddress, setBnbAddress]   = useState<string | null>(null)
  const [bnbPrivateKey, setBnbPrivateKey] = useState<string | null>(null)

  const wallet = useWallet(config?.owner ?? null, isInstalled === true)

  useEffect(() => { installMiniKitCompat() }, [])

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

  const isAirFunder       = wallet.address?.toLowerCase() === AIR_FUNDER_ADDRESS
  const isSecondaryAdmin  = wallet.address?.toLowerCase() === SECONDARY_ADMIN_ADDRESS
  const isMainOwner       = wallet.isOwner || isNewOwner || isSecondaryAdmin

  if (isInstalled === null) return <LoadingScreen />
  if (!wallet.address) {
    return (
      <div className="h-dvh bg-background flex flex-col max-w-md mx-auto">
        <ConnectScreen
          onConnect={wallet.connect}
          loading={wallet.isConnecting}
          hasMiniKit={isInstalled === true}
          onImport={wallet.importWallet}
        />
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
        onSelect={t => { setActiveTab(t); setActiveNetwork('wld') }}
        isMainOwner={isMainOwner}
        isAirFunder={isAirFunder}
      />

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="shrink-0 bg-[oklch(0.09_0.018_245)]/95 backdrop-blur-xl border-b border-[oklch(0.22_0.025_245)] z-10">
        <div className="flex items-center gap-2 px-2 pt-1 pb-2.5">
          {/* Flame menu button */}
          <button
            onClick={() => setMenuOpen(true)}
            className="shrink-0 relative flex flex-col items-center justify-center gap-0.5"
            style={{ width: 44, height: 52 }}
            aria-label="Menú principal"
          >
            <span className="absolute inset-0 rounded-2xl border-2 border-blue-500/60 heartbeat-ring" />
            <span className="relative w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-500 flex flex-col items-center justify-center shadow-[0_0_14px_rgba(59,130,246,0.55)] heartbeat-logo gap-0.5">
              <div className="relative w-5 h-5">
                <Image src="/flame-logo.png" alt="Menu" fill className="object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]" />
              </div>
              <span style={{ color: '#ef4444', fontSize: 6, fontWeight: 900, letterSpacing: '0.08em', lineHeight: 1 }}>
                MENU
              </span>
            </span>
          </button>

          {/* Title + active tab / network */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black tracking-[0.12em] text-foreground leading-none">ACUA MINIEXCHANGE</p>
            <p className="text-[9px] font-mono mt-0.5 truncate" style={{ color: NETWORKS[activeNetwork].color }}>
              {activeNetwork === 'wld'
                ? TAB_LABELS[activeTab]
                : activeNetwork === 'bnb'
                  ? BNB_TAB_LABELS[activeBNBTab]
                  : `${NETWORKS[activeNetwork].name} · Coming Soon`}
            </p>
          </div>

          {/* Right side: language switcher + network switcher */}
          <div className="flex items-center gap-1.5">
            {loadingData && activeNetwork === 'wld' && (
              <Loader2 className="w-3 h-3 text-[oklch(0.50_0.012_230)] animate-spin" />
            )}
            {wallet.walletMode === 'imported' && (
              <button
                onClick={() => wallet.disconnect()}
                title="Wallet importada — tap para desconectar"
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-400 hover:bg-amber-500/25 transition-colors"
              >
                <KeyRound className="w-2.5 h-2.5" />
                <span className="text-[9px] font-bold tracking-wide">IMPORTADA</span>
              </button>
            )}
            <LanguageSwitcher />
            <NetworkSwitcher
              address={addr}
              activeNetwork={activeNetwork}
              onSwitch={setActiveNetwork}
              bnbAddress={bnbAddress}
              onBnbAddressChange={setBnbAddress}
              onBnbKeyChange={setBnbPrivateKey}
            />
          </div>
        </div>
      </header>

      {/* ── Stats ticker (WLD only) ───────────────────────────────────── */}
      {activeNetwork === 'wld' && <StatsTicker />}

      {/* ── Market mini card (WLD only) ────────────────────────────────── */}
      {activeNetwork === 'wld' && <MarketMiniCard />}

      {/* ── BNB sub-navigation ────────────────────────────────────────── */}
      {activeNetwork === 'bnb' && (
        <BNBSubNav active={activeBNBTab} onChange={setActiveBNBTab} />
      )}

      {/* ── Network banner for non-WLD non-BNB ───────────────────────── */}
      {activeNetwork !== 'wld' && activeNetwork !== 'bnb' && (
        <div className="shrink-0 px-3 py-2 flex items-center gap-2 border-b border-[oklch(0.22_0.025_245)]"
          style={{ background: `${NETWORKS[activeNetwork].color}12` }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: NETWORKS[activeNetwork].color }} />
          <span className="text-[10px] font-bold" style={{ color: NETWORKS[activeNetwork].color }}>
            {NETWORKS[activeNetwork].name} · Chain ID {NETWORKS[activeNetwork].chainId}
          </span>
          <span className="ml-auto text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
            COMING SOON
          </span>
        </div>
      )}

      {/* ── BNB banner ────────────────────────────────────────────────── */}
      {activeNetwork === 'bnb' && (
        <div className="shrink-0 px-3 py-2 flex items-center gap-2 border-b border-[oklch(0.22_0.025_245)]"
          style={{ background: '#f0b90b12' }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse bg-[#f0b90b]" />
          <span className="text-[10px] font-bold text-[#f0b90b]">BNB Chain · ID 56</span>
          {bnbAddress ? (
            <span className="ml-auto text-[8px] font-mono text-[oklch(0.50_0.012_230)] truncate max-w-[130px]">
              🔑 {bnbAddress.slice(0, 8)}…{bnbAddress.slice(-4)}
            </span>
          ) : (
            <span className="ml-auto text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              🔒 Importa tu clave
            </span>
          )}
        </div>
      )}

      {/* ── Content ───────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="px-3 py-3">

          {/* ── Polygon: requiere clave importada ─── */}
          {activeNetwork === 'polygon' && (
            <ImportedKeyRequired network="Polygon" color="#8247e5" />
          )}

          {/* ── BNB panels ──────────────────────────────────────────── */}
          {activeNetwork === 'bnb' && (() => {
            // BNB Chain solo funciona con clave privada importada.
            // La misma clave EVM que el usuario importa en el selector de redes
            // funciona en BNB Chain (misma dirección, distinto chainId).
            const effectiveBnbKey: string | null =
              bnbPrivateKey ??
              (wallet.walletMode === 'imported' && wallet.importedSigner
                ? (wallet.importedSigner as unknown as { privateKey: string }).privateKey
                : null)
            if (!effectiveBnbKey) return <ImportedKeyRequired network="BNB Chain" color="#f0b90b" />
            return (<>
              {activeBNBTab === 'bnb-stake' && (
                <BNBSushiPanel bnbAddress={bnbAddress ?? addr} bnbPrivateKey={effectiveBnbKey} walletMode={wallet.walletMode} />
              )}
              {activeBNBTab === 'bnb-wallet' && (
                <BNBWalletPanel bnbAddress={bnbAddress ?? addr} bnbPrivateKey={effectiveBnbKey} walletMode={wallet.walletMode} />
              )}
              {activeBNBTab === 'bnb-bridge' && (
                <BNBBridgePanel
                  wldAddress={addr}
                  bnbAddress={bnbAddress}
                  bnbPrivateKey={effectiveBnbKey}
                  isOwner={isMainOwner}
                />
              )}
            </>)
          })()}

          {/* ── WLD / World Chain app ─────────────── */}
          {activeNetwork === 'wld' && activeTab === 'h2o' && (
            <StakePanel userAddress={addr} />
          )}

          {activeNetwork === 'wld' && activeTab === 'h2o-new'    && <NewH2OPanel userAddress={addr} walletMode={wallet.walletMode} importedSigner={wallet.importedSigner} />}
          {activeNetwork === 'wld' && activeTab === 'stake-v2'   && <StakeV2Panel userAddress={addr} />}
          {activeNetwork === 'wld' && activeTab === 'h2o-v3'     && <H2OV3Panel userAddress={addr} />}
          {activeNetwork === 'wld' && activeTab === 'stake-plus'  && <MultiStakingPanel userAddress={addr} />}
          {activeNetwork === 'wld' && activeTab === 'uth2'        && <MiningUTH2Panel userAddress={addr} walletMode={wallet.walletMode} importedSigner={wallet.importedSigner} />}
          {activeNetwork === 'wld' && activeTab === 'wld'         && <MiningWLDPanel userAddress={addr} walletMode={wallet.walletMode} importedSigner={wallet.importedSigner} />}
          {activeNetwork === 'wld' && activeTab === 'time'        && <MiningTimePanel userAddress={addr} />}
          {activeNetwork === 'wld' && activeTab === 'tokens'      && <TokenDirectoryPanel />}
          {activeNetwork === 'wld' && activeTab === 'sushi-v2'   && <SushiV2Panel userAddress={addr} />}
          {activeNetwork === 'wld' && activeTab === 'swap'        && <SwapPanel userAddress={addr} isAdmin={isMainOwner} />}
          {activeNetwork === 'wld' && activeTab === 'tnt'         && <TnTPanel userAddress={addr} walletMode={wallet.walletMode} importedSigner={wallet.importedSigner} />}
          {activeNetwork === 'wld' && activeTab === 'acua-stake'  && <AcuaTokenStakePanel userAddress={addr} isAdmin={isMainOwner} />}
          {activeNetwork === 'wld' && activeTab === 'acua-claim'  && <AcuaFreeClaimPanel  userAddress={addr} isAdmin={isMainOwner} />}
          {activeNetwork === 'wld' && activeTab === 'stake-v4'    && <StakeV4Panel userAddress={addr} walletMode={wallet.walletMode} importedSigner={wallet.importedSigner} isAdmin={isMainOwner} />}
          {activeNetwork === 'wld' && activeTab === 'stake-v5'    && <StakeV5Panel userAddress={addr} walletMode={wallet.walletMode} importedSigner={wallet.importedSigner} isAdmin={isMainOwner} />}
          {activeNetwork === 'wld' && activeTab === 'stake-factory'  && <StakeFactoryPanel userAddress={addr} walletMode={wallet.walletMode} importedSigner={wallet.importedSigner} />}
          {activeNetwork === 'wld' && activeTab === 'autostake'      && <AutoStakePanel userAddress={addr} />}
          {activeNetwork === 'wld' && activeTab === 'autostake-mine' && <AutoStakeMiningPanel userAddress={addr} />}
          {activeNetwork === 'wld' && activeTab === 'autostake-admin' && <AutoStakeOwnerPanel userAddress={addr} />}
          {activeNetwork === 'wld' && activeTab === 'info'           && <InfoPanel />}

          {activeNetwork === 'wld' && activeTab === 'monitor' && (
            <PlatformMonitor
              userAddress={addr}
              stakeInfo={stakeInfo}
              h2oBalance={h2oBalance}
              onRefresh={loadData}
            />
          )}

          {activeNetwork === 'wld' && activeTab === 'admin' && (
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

          {activeNetwork === 'wld' && activeTab === 'contracts-admin' && isMainOwner && (
            <ContractAdminPanel userAddress={addr} />
          )}

          {activeNetwork === 'wld' && activeTab === 'contracts-admin' && !isMainOwner && (
            <div className="flex items-center justify-center py-16">
              <div className="text-center space-y-2">
                <Shield className="w-10 h-10 text-[oklch(0.40_0.01_230)] mx-auto" />
                <p className="text-sm text-[oklch(0.50_0.012_230)]">Acceso restringido al owner</p>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ── Floating Fan Menu (WLD only) ──────────────────────────────── */}
      {activeNetwork === 'wld' && (
        <FloatingFab onSelect={setActiveTab} activeTab={activeTab} />
      )}

      {/* ── Floating AI Agent "Agente H2O" ────────────────────────────── */}
      <AiAgent />

      {/* ── Global Chat flotante ──────────────────────────────────────── */}
      <GlobalChat userAddress={addr} walletMode={wallet.walletMode} importedSigner={wallet.importedSigner} />

    </div>
  )
}
