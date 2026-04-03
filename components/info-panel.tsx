'use client'

import { Droplets, Flame, Coins, Globe, TrendingUp, Pickaxe, Zap, HelpCircle, Info, ArrowRight, Star, Shield } from 'lucide-react'

interface TokenInfo {
  symbol: string
  name: string
  description: string
  color: string
  icon: React.ReactNode
  uses: string[]
}

const TOKENS_INFO: TokenInfo[] = [
  {
    symbol: 'H2O',
    name: 'Agua (H2O)',
    description: 'Token principal de Acua. Se obtiene hackeando stake de H2O o comprando con WLD. Es el token de rewards del Stake H2O y de la Minería UTH₂.',
    color: '#06b6d4',
    icon: <Droplets className="w-4 h-4" />,
    uses: ['Stakear en el contrato H2O (gana 12% APY)', 'Recibir como reward de Minería UTH₂', 'Vender por WLD dentro de la app'],
  },
  {
    symbol: 'WLD',
    name: 'Worldcoin (WLD)',
    description: 'Token nativo de World App. Se usa para comprar H2O y stakear, o para comprar paquetes de Minería Multi-Token.',
    color: '#3b82f6',
    icon: <Globe className="w-4 h-4" />,
    uses: ['Comprar H2O y stakear automáticamente (buyAndStake)', 'Stakear WLD directamente en el contrato WLD', 'Pagar paquetes de Minería WLD (gana 7 tokens)'],
  },
  {
    symbol: 'UTH₂',
    name: 'Ultra Thermo H2O (UTH₂)',
    description: 'Token de combustible para la Minería H2O. Se usa para comprar paquetes de minería permanentes que generan H2O cada día.',
    color: '#8b5cf6',
    icon: <Zap className="w-4 h-4" />,
    uses: ['Comprar paquetes de Minería UTH₂ (genera H2O diario permanente)', 'También se puede stakear en su contrato propio'],
  },
  {
    symbol: 'FIRE',
    name: 'Fire Token (FIRE)',
    description: 'Token de alto rendimiento que puede stakearse para ganar rewards en FIRE.',
    color: '#f97316',
    icon: <Flame className="w-4 h-4" />,
    uses: ['Stakear FIRE → gana rewards en FIRE', 'Recibir como reward de Minería WLD (paquete Fire Mine)'],
  },
  {
    symbol: 'BTCH2O',
    name: 'BTC H2O (BTCH2O)',
    description: 'Token híbrido entre Bitcoin y H2O dentro del ecosistema Acua.',
    color: '#f59e0b',
    icon: <Coins className="w-4 h-4" />,
    uses: ['Stakear BTCH2O → gana rewards en BTCH2O', 'Recibir como reward de Minería WLD (paquete BTC Mine)'],
  },
  {
    symbol: 'AIR',
    name: 'AIR Token (AIR)',
    description: 'Token de liquidez y acceso. Se puede stakear para generar rendimientos pasivos.',
    color: '#e2e8f0',
    icon: <Star className="w-4 h-4" />,
    uses: ['Stakear AIR → gana rewards en AIR'],
  },
  {
    symbol: 'SUSHI',
    name: 'SushiSwap (SUSHI)',
    description: 'Token del DEX SushiSwap, disponible para staking en World Chain.',
    color: '#ec4899',
    icon: <TrendingUp className="w-4 h-4" />,
    uses: ['Stakear SUSHI → gana rewards en SUSHI'],
  },
  {
    symbol: 'USDC',
    name: 'USD Coin (USDC)',
    description: 'Stablecoin pegged al dólar americano. Ideal para staking sin exposición a volatilidad.',
    color: '#2563eb',
    icon: <Coins className="w-4 h-4" />,
    uses: ['Stakear USDC → gana rewards en USDC (rendimiento estable)'],
  },
  {
    symbol: 'wCOP',
    name: 'Wrapped COP (wCOP)',
    description: 'Versión tokenizada del Peso Colombiano en World Chain.',
    color: '#fbbf24',
    icon: <Coins className="w-4 h-4" />,
    uses: ['Stakear wCOP → gana rewards en wCOP', 'Recibir como reward de Minería WLD (paquete COP Mine)'],
  },
  {
    symbol: 'wARS',
    name: 'Wrapped ARS (wARS)',
    description: 'Versión tokenizada del Peso Argentino en World Chain.',
    color: '#10b981',
    icon: <Coins className="w-4 h-4" />,
    uses: ['Stakear wARS → gana rewards en wARS', 'Recibir como reward de Minería WLD (paquete ARS Mine)'],
  },
]

interface GuideStep {
  title: string
  steps: string[]
  icon: React.ReactNode
  color: string
}

const GUIDES: GuideStep[] = [
  {
    title: 'Stake H2O (12% APY)',
    icon: <Droplets className="w-4 h-4" />,
    color: '#06b6d4',
    steps: [
      'Ve a la pestaña "Stake H2O"',
      'Si tienes H2O: ingresa la cantidad y presiona "Stake H2O"',
      'Si tienes WLD: usa "WLD → H2O" para comprar y stakear automáticamente',
      'Confirma la transacción en World App',
      'Tus rewards se acumulan segundo a segundo',
      'Presiona "Reclamar" para cobrar tus rewards cuando quieras',
      'Para retirar: presiona "Retirar H2O" o "Retirar y vender por WLD"',
    ],
  },
  {
    title: 'Multi-Staking (WLD, FIRE, SUSHI...)',
    icon: <TrendingUp className="w-4 h-4" />,
    color: '#3b82f6',
    steps: [
      'Ve a la pestaña "Stake+"',
      'Elige el token que quieres stakear',
      'Se abre un panel con tu balance, APY y stake actual',
      'Ingresa la cantidad y presiona "Stake [TOKEN]"',
      'Confirma con Permit2 en World App (sin aprobación previa)',
      'Para reclamar rewards: abre el token y ve a la pestaña "Claim"',
      'Para retirar: abre el token y ve a "Unstake"',
    ],
  },
  {
    title: 'Minería UTH₂ → H2O permanente',
    icon: <Pickaxe className="w-4 h-4" />,
    color: '#8b5cf6',
    steps: [
      'Ve a la pestaña "UTH₂"',
      'Elige un paquete (Starter, Bronze, Silver, Gold, Platinum, Diamond, Elite)',
      'Ingresa cuántos paquetes quieres comprar',
      'Confirma el pago en UTH₂ con World App',
      'Desde ese momento generas H2O cada día, PARA SIEMPRE',
      'Puedes comprar múltiples paquetes para aumentar tu producción',
      'Reclama tu H2O acumulado cuando quieras con "Reclamar H2O"',
    ],
  },
  {
    title: 'Minería WLD → 7 tokens',
    icon: <Star className="w-4 h-4" />,
    color: '#f59e0b',
    steps: [
      'Ve a la pestaña "WLD"',
      'Cada paquete mina un token diferente: H2O, FIRE, BTCH2O, WLD, wARS, wCOP o UTH₂',
      'Elige el paquete que más te interese',
      'Ingresa la cantidad de paquetes y confirma el pago en WLD',
      'Tu minería empieza inmediatamente y es permanente',
      'Reclama por paquete individual o todos a la vez con "Reclamar todas"',
    ],
  },
]

export function InfoPanel() {
  return (
    <div className="space-y-6 pb-4">

      {/* Cómo usar */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <HelpCircle className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Cómo usar la app</h2>
        </div>
        <div className="space-y-3">
          {GUIDES.map(guide => (
            <div key={guide.title} className="rounded-xl border border-border bg-surface-2 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/60" style={{ background: guide.color + '10' }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: guide.color + '22' }}>
                  <span style={{ color: guide.color }}>{guide.icon}</span>
                </div>
                <span className="text-sm font-semibold text-foreground">{guide.title}</span>
              </div>
              <div className="px-3 py-2.5 space-y-1.5">
                {guide.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="shrink-0 w-4 h-4 rounded-full text-xs flex items-center justify-center font-bold mt-0.5"
                      style={{ background: guide.color + '22', color: guide.color }}>
                      {i + 1}
                    </span>
                    <p className="text-xs text-muted-foreground leading-relaxed">{step}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Token utilities */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Info className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Utilidades de los tokens</h2>
        </div>
        <div className="space-y-2">
          {TOKENS_INFO.map(token => (
            <div key={token.symbol} className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: token.color + '22', color: token.color, border: `1.5px solid ${token.color}55` }}>
                  {token.icon}
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{token.symbol}</p>
                  <p className="text-xs text-muted-foreground">{token.name}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{token.description}</p>
              <div className="space-y-1">
                {token.uses.map((use, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <ArrowRight className="w-3 h-3 shrink-0 mt-0.5" style={{ color: token.color }} />
                    <p className="text-xs text-foreground/80 leading-relaxed">{use}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Security note */}
      <div className="rounded-xl border border-border bg-surface-2 p-3 flex items-start gap-2">
        <Shield className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-xs font-semibold text-foreground">Seguridad</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Todos los contratos usan Permit2 para transacciones seguras sin aprobaciones previas.
            Las transacciones se confirman directamente en World App.
            Los contratos están desplegados en World Chain (Chain ID 480).
          </p>
        </div>
      </div>

    </div>
  )
}
