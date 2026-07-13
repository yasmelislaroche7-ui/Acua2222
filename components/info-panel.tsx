'use client'

import { Droplets, Flame, Coins, Globe, TrendingUp, Pickaxe, Zap, HelpCircle, Info, ArrowRight, Star, Shield, Clock, RefreshCw, Building2, Factory, Cpu } from 'lucide-react'

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
    uses: ['Stakear en el contrato H2O (gana 12% APY)', 'Recibir como reward de Minería UTH₂', 'Vender por WLD dentro de la app', 'Auto-compounding en AutoStake (50% APR)'],
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
    symbol: 'TIME',
    name: 'Time Token (TIME)',
    description: 'Token de tiempo para el nuevo sistema de staking V2. Al stakearlo ganas rewards en WLD de forma continua.',
    color: '#8b5cf6',
    icon: <Clock className="w-4 h-4" />,
    uses: ['Stakear TIME en Stake V2 para ganar WLD', 'Rewards compartidos del pool de WLD', 'Sin bloqueos ni fees'],
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
    title: 'AutoStake H2O (50% APR · Auto-compound)',
    icon: <RefreshCw className="w-4 h-4" />,
    color: '#10b981',
    steps: [
      'Ve a la pestaña "AutoStake" (botón ♻️ en el menú abanico)',
      'Mínimo 1.000 H2O para activar (ajustable por admin)',
      'Acepta con Permit2 en World App — sin approve manual',
      'Tu stake se auto-reinvierte cada 10 minutos automáticamente',
      'Cualquier usuario puede minar tus bloques (tú ganas el compound)',
      'Para retirar: escribe la cantidad y presiona "Unstake"',
      'Rewards se capitalizan: el interés gana interés (compound)',
    ],
  },
  {
    title: 'Mine AutoStake — Gana 1% procesando TXs',
    icon: <Cpu className="w-4 h-4" />,
    color: '#6366f1',
    steps: [
      'Ve a "AutoMine" (botón ⛏ en el menú abanico)',
      'El panel escanea la blockchain en busca de posiciones listas (≥10 min)',
      '"Minar bloque" procesa el reinvest de un usuario y te paga 1% del reward',
      '"Minar todos" hace el batch completo en 1 sola TX',
      'El marcador "Todos" muestra en tiempo real todas las posiciones activas',
      'El panel se auto-recarga al terminar cada ciclo de 10 minutos',
      'Sin bots ni privilegios — cualquier wallet puede minar y ganar',
    ],
  },
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
    title: 'Stake V2 (TIME → WLD)',
    icon: <Zap className="w-4 h-4" />,
    color: '#8b5cf6',
    steps: [
      'Ve a la pestaña "Stake V2"',
      'Selecciona el token TIME para stakear',
      'Ingresa la cantidad de TIME que deseas stakear',
      'Confirma con Permit2 en World App (sin aprobación previa)',
      'Tus rewards en WLD se acumulan continuamente',
      'Reclama tus rewards WLD cuando quieras',
      'Retira tu TIME sin fees ni bloqueos',
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
    title: 'Factory Stake & Mine — Crea tu propio pool',
    icon: <Factory className="w-4 h-4" />,
    color: '#22d3ee',
    steps: [
      'Ve a "Factory" (botón 🏭 en el menú abanico)',
      'Despliega tu propio contrato de staking en World Chain sin código',
      'Define el token, APR, fees y mínimo de stake',
      'Fondea el pool de recompensas con Permit2',
      'Los usuarios pueden stakear directamente en tu pool',
      'Tú recibes las comisiones como owner del contrato',
      'Compatible con el sistema de AutoMine para auto-compounding',
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

// ─── ACUA Company section ─────────────────────────────────────────────────────
const COMPANY_INFO = [
  {
    q: '¿Qué es Acua?',
    a: 'Acua es un ecosistema DeFi nativo de World Chain construido dentro de World App. Ofrece staking, minería, bridge y swap con tokens propios, todo sin custodia y usando Permit2 para transacciones gasless.',
  },
  {
    q: '¿Es seguro?',
    a: 'Todos los contratos usan Permit2 para transacciones sin aprobaciones previas. Las firmas ocurren directamente en World App. Los contratos están desplegados en World Chain (Chain ID 480).',
  },
  {
    q: '¿Cómo generan rendimientos los pools?',
    a: 'Los pools de rewards se fondean por los owners y por las comisiones de stake/unstake (5% dividido: 4% al owner2, 1% al fondo). El APR está fijado en el contrato y no depende de otros usuarios.',
  },
  {
    q: '¿Qué es Permit2?',
    a: 'Permit2 es un contrato universal de Uniswap que permite mover tokens con una firma offline. No necesitas gastar gas en approve. World App firma automáticamente al confirmar la TX.',
  },
  {
    q: '¿Quién puede minar bloques?',
    a: 'Cualquier wallet. Cuando minas un bloque de AutoStake ganas el 1% del reward como incentivo. No se necesita ser owner ni tener ningún rol especial.',
  },
]

export function InfoPanel() {
  return (
    <div className="space-y-6 pb-4">

      {/* ACUA Company */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">ACUA Company</h2>
        </div>
        <div className="space-y-2">
          {COMPANY_INFO.map(item => (
            <div key={item.q} className="rounded-xl border border-border bg-surface-2 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-foreground">{item.q}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </div>

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
            AutoStake v2: mínimo 1.000 H2O, comisión 5% stake/unstake, 10% claim.
          </p>
        </div>
      </div>

    </div>
  )
}
