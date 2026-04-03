'use client'

import { useState, useEffect, useCallback } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { Droplets, RefreshCw, Wallet, Shield, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StakePanel } from '@/components/stake-panel'
import { OwnerPanel } from '@/components/owner-panel'
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
import { cn } from '@/lib/utils'

type Tab = 'stake' | 'owner'
// null = still detecting, true = inside World App, false = not
type InstalledState = null | true | false

// ─── MiniKit Logger ────────────────────────────────────────────────────────
// Patches MiniKit.commandsAsync to log all payloads + responses to Eruda
function patchMiniKitLogger() {
  if (typeof window === 'undefined') return
  if ((window as any).__minikitPatched) return
    ; (window as any).__minikitPatched = true

  const log = (label: string, data: unknown, color = '#00d4ff') => {
    const eruda = (window as any).eruda
    if (eruda) {
      // Use Eruda's console if available
      eruda.get('console')?.log?.(`%c[MiniKit] ${label}`, `color:${color};font-weight:bold`, data)
    }
    // Always mirror to native console so Eruda picks it up automatically
    console.log(`%c[MiniKit] ${label}`, `color:${color};font-weight:bold`, data)
  }

  // Patch commandsAsync (main async path used by sendTransaction, walletAuth, etc.)
  const original = MiniKit.commandsAsync as Record<string, unknown>
  if (original && typeof original === 'object') {
    for (const cmd of Object.keys(original)) {
      const fn = (original as Record<string, Function>)[cmd]
      if (typeof fn !== 'function') continue
        ; (original as Record<string, Function>)[cmd] = async function (...args: unknown[]) {
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

  // Also patch MiniKit.commands (sync / subscribe path)
  const syncOriginal = (MiniKit as any).commands as Record<string, unknown>
  if (syncOriginal && typeof syncOriginal === 'object') {
    for (const cmd of Object.keys(syncOriginal)) {
      const fn = (syncOriginal as Record<string, Function>)[cmd]
      if (typeof fn !== 'function') continue
        ; (syncOriginal as Record<string, Function>)[cmd] = function (...args: unknown[]) {
          log(`→ [sync] ${cmd} PAYLOAD`, args, '#ffaa00')
          const result = fn.apply(this, args)
          log(`← [sync] ${cmd} RESPONSE`, result, '#ffcc44')
          return result
        }
    }
  }

  // Intercept window message events (WorldApp <-> MiniKit bridge responses)
  const origAddListener = window.addEventListener.bind(window)
  window.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
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

// ─── Logo ──────────────────────────────────────────────────────────────────
function AcuaLogo() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
        <Droplets className="w-4 h-4 text-primary" />
      </div>
      <div>
        <p className="text-sm font-bold text-foreground leading-none">Acua Staking</p>
        <p className="text-xs text-muted-foreground leading-none mt-0.5">World Chain</p>
      </div>
    </div>
  )
}

// ─── Connect Screen ────────────────────────────────────────────────────────
function ConnectScreen({ onConnect, loading }: { onConnect: () => void; loading: boolean }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="w-20 h-20 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Droplets className="w-10 h-10 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Acua Staking</h1>
          <p className="text-muted-foreground text-sm mt-1">Gana 12% APY con H2O en World Chain</p>
        </div>
      </div>

      <div className="w-full max-w-xs flex flex-col gap-3">
        <div className="rounded-xl border border-border bg-surface-2 p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground">APY base</span>
            <span className="text-xs font-bold text-primary ml-auto">12%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-muted-foreground" />
            <span className="text-xs text-muted-foreground">Fee de staking</span>
            <span className="text-xs text-foreground ml-auto">1%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-muted-foreground" />
            <span className="text-xs text-muted-foreground">Token</span>
            <span className="text-xs text-foreground ml-auto">H2O (Acua)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-muted-foreground" />
            <span className="text-xs text-muted-foreground">Red</span>
            <span className="text-xs text-foreground ml-auto">World Chain (480)</span>
          </div>
        </div>

        <Button
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-12 text-base font-semibold"
          onClick={onConnect}
          disabled={loading}
        >
          {loading
            ? <Loader2 className="w-5 h-5 animate-spin mr-2" />
            : <Wallet className="w-5 h-5 mr-2" />
          }
          Conectar World Wallet
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          Solo disponible dentro de World App
        </p>
      </div>
    </div>
  )
}

// ─── Not Installed ────────────────────────────────────────────────────────
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

// ─── Loading screen ───────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
      <Droplets className="w-10 h-10 text-primary animate-pulse" />
      <p className="text-sm text-muted-foreground">Iniciando...</p>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────
export default function AcuaApp() {
  const [isInstalled, setIsInstalled] = useState<InstalledState>(null)
  const [config, setConfig] = useState<ContractConfig | null>(null)
  const [stakeInfo, setStakeInfo] = useState<StakeInfo | null>(null)
  const [h2oBalance, setH2OBalance] = useState(0n)
  const [wldBalance, setWLDBalance] = useState(0n)
  const [loadingData, setLoadingData] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('stake')

  const wallet = useWallet(config?.owner ?? null, isInstalled === true)

  // ── Activate MiniKit logger as early as possible ──────────────────────
  useEffect(() => {
    patchMiniKitLogger()
  }, [])

  // ── Detect MiniKit after mount, retry up to 15×200ms ─────────────────
  useEffect(() => {
    console.log('[acua] detect: start', {
      worldApp: !!(window as any).WorldApp,
      ua: navigator.userAgent.slice(0, 80),
    })
    let attempts = 0
    const interval = setInterval(() => {
      attempts++
      const installed = MiniKit.isInstalled()
      const mkAddr = MiniKit.walletAddress
      console.log('[acua] detect attempt=%d installed=%s mkAddr=%s', attempts, installed, mkAddr)
      if (installed || attempts >= 15) {
        clearInterval(interval)
        console.log('[acua] detect FINAL installed=%s', installed)
        setIsInstalled(installed)
      }
    }, 200)
    return () => clearInterval(interval)
  }, [])

  const loadData = useCallback(async () => {
    setLoadingData(true)
    try {
      const cfg = await fetchContractConfig()
      console.log('[acua] loadData config', cfg)
      setConfig(cfg)
      if (wallet.address) {
        const [si, h2o, wld] = await Promise.all([
          fetchStakeInfo(wallet.address),
          fetchH2OBalance(wallet.address),
          fetchWLDBalance(wallet.address),
        ])
        console.log('[acua] loadData stakeInfo', si)
        console.log('[acua] loadData balances h2o=%s wld=%s', h2o.toString(), wld.toString())
        setStakeInfo(si)
        setH2OBalance(h2o)
        setWLDBalance(wld)
      }
    } catch (e) {
      console.error('[acua] loadData ERROR', e)
    } finally {
      setLoadingData(false)
    }
  }, [wallet.address])

  // Load config on mount
  useEffect(() => {
    fetchContractConfig()
      .then(cfg => { console.log('[acua] config loaded', cfg); setConfig(cfg) })
      .catch(e => console.error('[acua] config ERROR', e))
  }, [])

  // Load user data when wallet connects
  useEffect(() => {
    console.log('[acua] wallet.address changed', wallet.address)
    if (wallet.address) loadData()
  }, [wallet.address]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render gates (all inside effects, never sync) ─────────────────────
  if (isInstalled === null) return <LoadingScreen />
  if (!isInstalled) return <NotInstalled />
  if (!wallet.address) return <ConnectScreen onConnect={wallet.connect} loading={wallet.isConnecting} />

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-md mx-auto">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <AcuaLogo />
          <div className="flex items-center gap-2">
            {loadingData && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="text-xs text-foreground font-mono">
                {shortenAddress(wallet.address)}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('stake')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'stake'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Droplets className="w-4 h-4" />
          Staking
        </button>
        {wallet.isOwner && (
          <button
            onClick={() => setActiveTab('owner')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === 'owner'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Shield className="w-4 h-4" />
            Owner
          </button>
        )}
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        {activeTab === 'stake' && (
          <StakePanel
            stakeInfo={stakeInfo}
            config={config}
            userAddress={wallet.address}
            h2oBalance={h2oBalance}
            wldBalance={wldBalance}
            onRefresh={loadData}
          />
        )}
        {activeTab === 'owner' && wallet.isOwner && config && (
          <OwnerPanel config={config} onRefresh={loadData} />
        )}
      </main>

      {/* Footer */}
      <footer className="px-4 py-3 border-t border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Contrato: <span className="font-mono">{shortenAddress('0xEa87DD903441A0A27d9cbB926569dA61c677B1B5')}</span>
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