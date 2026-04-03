'use client'

import { useState, useEffect, useCallback } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Droplets, RefreshCw, Wallet, Shield, Loader2,
  TrendingUp, Pickaxe, Star, HelpCircle, Wind, Clock, BookOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StakePanel } from '@/components/stake-panel'
import { OwnerPanel } from '@/components/owner-panel'
import { MultiStakingPanel } from '@/components/multi-staking-panel'
import { MiningUTH2Panel } from '@/components/mining-uth2-panel'
import { MiningWLDPanel } from '@/components/mining-wld-panel'
import { MiningTimePanel } from '@/components/mining-time-panel'
import { ContractsOwnerPanel } from '@/components/contracts-owner-panel'
import { AirFunderPanel } from '@/components/air-funder-panel'
import { InfoPanel } from '@/components/info-panel'
import { TokenDirectoryPanel } from '@/components/token-directory-panel'
import { useWallet } from '@/hooks/use-wallet'
import {
  fetchStakeInfo,
  fetchContractConfig,
  fetchH2OBalance,
  fetchWLDBalance,
  StakeInfo,
  ContractConfig,
  shortenAddress,
} from '@/lib/contract'
import {
  STAKING_CONTRACTS, UNIVERSAL_STAKING_ABI, getProvider,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

type Tab = 'h2o' | 'stake-plus' | 'uth2' | 'wld' | 'time' | 'tokens' | 'info' | 'admin' | 'air-fund'
type InstalledState = null | true | false

// ─── Hardcoded special addresses ──────────────────────────────────────────────
// AIR secondary funder (owners[1] of AIR staking) — sees Panel 2 only
const AIR_FUNDER_ADDRESS = '0x72acfbfcee02176118107958ec317157ccd4afdb'
// Secondary admin — sees Panel 1 (same as main owner)
const SECONDARY_ADMIN_ADDRESS = '0xc2ef127734f296952de75c1b58a6cec605cc2e59'

// ─── MiniKit Logger ───────────────────────────────────────────────────────────
function patchMiniKitLogger() {
  if (typeof window === 'undefined') return
  if ((window as any).__minikitPatched) return
  ;(window as any).__minikitPatched = true

  const log = (label: string, data: unknown, color = '#00d4ff') => {
    console.log(`%c[MiniKit] ${label}`, `color:${color};font-weight:bold`, data)
  }

  const original = MiniKit.commandsAsync as Record<string, unknown>
  if (original && typeof original === 'object') {
    for (const cmd of Object.keys(original)) {
      const fn = (original as Record<string, Function>)[cmd]
      if (typeof fn !== 'function') continue
      ;(original as Record<string, Function>)[cmd] = async function (...args: unknown[]) {
        log(`→ ${cmd} PAYLOAD`, args, '#00d4ff')
        try {
          const result = await fn.apply(this, args)
          log(`← ${cmd} RESPONSE`, result, '#00ff99')
          return result
        } catch (err) {
          log(`✖ ${cmd} ERROR`, err, '#ff4d4d')
          throw err
        }
      }
    }
  }

  const origAddListener = window.addEventListener.bind(window)
  window.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    if (type === 'message') {
      const wrapped = function (event: MessageEvent) {
        if (event.data && typeof event.data === 'object') {
          log('⬅ BRIDGE MESSAGE', event.data, '#bb88ff')
        }
        if (typeof listener === 'function') listener(event as any)
        else (listener as EventListenerObject).handleEvent(event as any)
      }
      return origAddListener(type, wrapped as EventListener, options)
    }
    return origAddListener(type, listener as EventListener, options)
  }

  log('MiniKit logger active ✓', { patchedAt: new Date().toISOString() }, '#888888')
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
function AcuaLogo() {
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
        <Droplets className="w-4 h-4 text-primary" />
        <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping opacity-30" />
      </div>
      <div>
        <p className="text-sm font-bold text-foreground leading-none">Acua Staking</p>
        <p className="text-xs text-primary/60 leading-none mt-0.5 font-mono">World Chain · 480</p>
      </div>
    </div>
  )
}

// ─── Connect Screen ───────────────────────────────────────────────────────────
function ConnectScreen({ onConnect, loading }: { onConnect: () => void; loading: boolean }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-8 px-6">
      {/* Acua branding */}
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative w-24 h-24 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
          <Droplets className="w-12 h-12 text-primary" />
          <div className="absolute inset-0 rounded-full border border-primary/20 animate-ping" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-foreground">Acua</h1>
          <p className="text-primary/70 text-sm mt-1 font-mono">Staking · Minería · Multi-Token</p>
        </div>
      </div>

      <div className="w-full max-w-xs flex flex-col gap-3">
        {/* Feature list */}
        <div className="rounded-2xl border border-border bg-surface-2 p-4 space-y-2.5">
          {[
            { color: 'bg-cyan-400', label: 'Stake H2O', value: '12% APY' },
            { color: 'bg-blue-400', label: 'Multi-Stake 8 tokens', value: 'APY variable' },
            { color: 'bg-orange-400', label: 'Minería UTH₂ → H2O', value: 'Permanente' },
            { color: 'bg-yellow-400', label: 'Minería WLD → 7 tokens', value: 'Simultáneo' },
            { color: 'bg-violet-400', label: 'Stake TIME → WLD', value: 'Pool rewards' },
            { color: 'bg-gray-400',   label: 'Red', value: 'World Chain (480)' },
          ].map(f => (
            <div key={f.label} className="flex items-center gap-2">
              <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', f.color)} />
              <span className="text-xs text-muted-foreground flex-1">{f.label}</span>
              <span className="text-xs font-semibold text-foreground">{f.value}</span>
            </div>
          ))}
        </div>

        <Button
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-12 text-base font-semibold rounded-xl"
          onClick={onConnect}
          disabled={loading}
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Wallet className="w-5 h-5 mr-2" />}
          Conectar World Wallet
        </Button>
        <p className="text-xs text-center text-muted-foreground">Solo disponible dentro de World App</p>
      </div>
    </div>
  )
}

// ─── Not Installed ────────────────────────────────────────────────────────────
function NotInstalled() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
      <Droplets className="w-12 h-12 text-primary/60" />
      <h1 className="text-xl font-bold text-foreground">Acua Staking</h1>
      <p className="text-muted-foreground text-sm max-w-xs">
        Abre esta app dentro de <strong className="text-foreground">World App</strong> para usar Acua Staking.
      </p>
    </div>
  )
}

// ─── Loading Screen ───────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
      <div className="relative">
        <Droplets className="w-12 h-12 text-primary" />
        <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping" />
      </div>
      <p className="text-sm text-muted-foreground font-mono">Iniciando...</p>
    </div>
  )
}

// ─── Tab Button ───────────────────────────────────────────────────────────────
function TabBtn({ active, onClick, icon, label, special }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; special?: 'admin' | 'air'
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 flex flex-col items-center justify-center gap-0.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
        active
          ? special === 'admin'
            ? 'border-violet-400 text-violet-400'
            : special === 'air'
            ? 'border-slate-300 text-slate-300'
            : 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
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

  // ── New contract ownership ────────────────────────────────────────────────
  const [isNewOwner, setIsNewOwner] = useState(false)

  const wallet = useWallet(config?.owner ?? null, isInstalled === true)

  useEffect(() => { patchMiniKitLogger() }, [])

  // ── Detect MiniKit ─────────────────────────────────────────────────────────
  useEffect(() => {
    console.log('[acua] detect: start', { worldApp: !!(window as any).WorldApp, ua: navigator.userAgent.slice(0, 80) })
    let attempts = 0
    const interval = setInterval(() => {
      attempts++
      const installed = MiniKit.isInstalled()
      if (installed || attempts >= 15) { clearInterval(interval); setIsInstalled(installed) }
    }, 200)
    return () => clearInterval(interval)
  }, [])

  // ── Load H2O staking config ────────────────────────────────────────────────
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
  }, [wallet.address]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Check ownership of new staking contracts ──────────────────────────────
  const fetchNewContractOwnership = useCallback(async (addr: string) => {
    try {
      const p = getProvider()
      const addrLow = addr.toLowerCase()

      const allContractAddrs = Object.values(STAKING_CONTRACTS)
      const ownerResults = await Promise.allSettled(
        allContractAddrs.map(async (ca) => {
          const c = new ethers.Contract(ca, UNIVERSAL_STAKING_ABI, p)
          const owners = await c.getOwners()
          return (owners as string[]).map(o => o.toLowerCase())
        })
      )

      const allOwners: string[] = []
      ownerResults.forEach(r => {
        if (r.status === 'fulfilled') {
          r.value.forEach(o => { if (o !== ethers.ZeroAddress.toLowerCase()) allOwners.push(o) })
        }
      })

      const isOwnerOfNewContract = allOwners.includes(addrLow)
      setIsNewOwner(isOwnerOfNewContract)
      console.log('[acua] ownership check:', { isOwnerOfNewContract, addrLow })
    } catch (e) { console.error('[acua] fetchNewContractOwnership ERROR', e) }
  }, [])

  // ── Derived ownership flags ───────────────────────────────────────────────
  // Hardcoded AIR funder: always sees Panel 2, never Panel 1
  const isAirFunder = wallet.address?.toLowerCase() === AIR_FUNDER_ADDRESS
  // Hardcoded secondary admin: always sees Panel 1
  const isSecondaryAdmin = wallet.address?.toLowerCase() === SECONDARY_ADMIN_ADDRESS
  // Main owner: any contract owner OR secondary admin, NOT the AIR funder
  const isMainOwner = !isAirFunder && (wallet.isOwner || isNewOwner || isSecondaryAdmin)

  // ── Render gates ──────────────────────────────────────────────────────────
  if (isInstalled === null) return <LoadingScreen />
  if (!isInstalled) return <NotInstalled />
  if (!wallet.address) return <ConnectScreen onConnect={wallet.connect} loading={wallet.isConnecting} />

  const addr = wallet.address

  // ── Build tab list ────────────────────────────────────────────────────────
  const mainTabs: { tab: Tab; icon: React.ReactNode; label: string; special?: 'admin' | 'air' }[] = [
    { tab: 'h2o',        icon: <Droplets className="w-3.5 h-3.5" />,    label: 'H2O' },
    { tab: 'stake-plus', icon: <TrendingUp className="w-3.5 h-3.5" />,  label: 'Stake+' },
    { tab: 'uth2',       icon: <Pickaxe className="w-3.5 h-3.5" />,     label: 'UTH₂' },
    { tab: 'wld',        icon: <Star className="w-3.5 h-3.5" />,        label: 'WLD' },
    { tab: 'time',       icon: <Clock className="w-3.5 h-3.5" />,       label: 'TIME' },
    { tab: 'tokens',     icon: <BookOpen className="w-3.5 h-3.5" />,    label: 'Tokens' },
    { tab: 'info',       icon: <HelpCircle className="w-3.5 h-3.5" />,  label: 'Info' },
  ]

  if (isMainOwner) {
    mainTabs.push({ tab: 'admin', icon: <Shield className="w-3.5 h-3.5" />, label: 'Admin', special: 'admin' })
  }
  if (isAirFunder) {
    mainTabs.push({ tab: 'air-fund', icon: <Wind className="w-3.5 h-3.5" />, label: 'AIR', special: 'air' })
  }

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-md mx-auto">

      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <AcuaLogo />
          <div className="flex items-center gap-2">
            {loadingData && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-foreground font-mono">{shortenAddress(addr)}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Tab bar — horizontally scrollable */}
      <div className="flex overflow-x-auto border-b border-border scrollbar-none sticky top-[57px] z-10 bg-background/95 backdrop-blur">
        {mainTabs.map(t => (
          <TabBtn
            key={t.tab}
            active={activeTab === t.tab}
            onClick={() => setActiveTab(t.tab)}
            icon={t.icon}
            label={t.label}
            special={t.special}
          />
        ))}
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-4">

        {/* H2O Stake (untouched) */}
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

        {/* Multi-Staking */}
        {activeTab === 'stake-plus' && <MultiStakingPanel userAddress={addr} />}

        {/* Minería UTH₂ */}
        {activeTab === 'uth2' && <MiningUTH2Panel userAddress={addr} />}

        {/* Minería WLD */}
        {activeTab === 'wld' && <MiningWLDPanel userAddress={addr} />}

        {/* Minería TIME */}
        {activeTab === 'time' && <MiningTimePanel userAddress={addr} />}

        {/* Token Directory */}
        {activeTab === 'tokens' && <TokenDirectoryPanel />}

        {/* Info & guides */}
        {activeTab === 'info' && <InfoPanel />}

        {/* Admin Panel 1 */}
        {activeTab === 'admin' && isMainOwner && (
          <div className="space-y-6">
            <ContractsOwnerPanel userAddress={addr} />
            {wallet.isOwner && config && (
              <div className="border-t border-border pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Droplets className="w-4 h-4 text-primary" />
                  <span className="text-sm font-bold text-primary">Admin Stake H2O (Acua)</span>
                </div>
                <OwnerPanel config={config} onRefresh={loadData} />
              </div>
            )}
          </div>
        )}

        {/* AIR Funder Panel 2 */}
        {activeTab === 'air-fund' && isAirFunder && (
          <AirFunderPanel userAddress={addr} />
        )}

      </main>

      {/* Footer */}
      <footer className="px-4 py-3 border-t border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-mono">
          Acua · WC(480)
        </span>
        <button
          onClick={loadData}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </button>
      </footer>
    </div>
  )
}
