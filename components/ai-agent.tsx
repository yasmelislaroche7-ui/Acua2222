'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useLang } from '@/context/lang-context'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { X, Send, Bot, Minimize2, Maximize2, Droplets, ChevronDown } from 'lucide-react'

interface Message {
  role: 'agent' | 'user'
  text: string
  ts: number
}

// Knowledge base for Agente H2O
const KB: { patterns: string[]; answer: (lang: string) => string }[] = [
  {
    patterns: ['hola', 'hello', 'hi', 'ola', 'salut', 'ciao', 'bonjour', 'hallo', 'привет', 'مرحبا'],
    answer: (l) => l === 'en'
      ? "Hello! 👋 I'm Agent H2O, your ACUA MINIEXCHANGE assistant. You can ask me about staking, rewards, bridge, swap, wallet, and more. What would you like to know?"
      : "¡Hola! 👋 Soy Agente H2O, tu asistente de ACUA MINIEXCHANGE. Puedes preguntarme sobre staking, recompensas, bridge, swap, wallet y más. ¿Qué te gustaría saber?"
  },
  {
    patterns: ['tutorial', 'como usar', 'how to', 'empezar', 'start', 'comenzar', 'inicio', 'guia', 'guide'],
    answer: (l) => l === 'en'
      ? "📖 **Quick Tutorial:**\n1. Open ACUA inside World App\n2. Connect your World Wallet\n3. Go to 'Stake H2O' to earn 12% APY\n4. Use the fan menu (bottom right) to navigate\n5. Try Swap to exchange tokens\n6. Use Bridge to move SUSHI between World Chain & BNB\n\nStart with H2O staking for the safest yields! 🚀"
      : "📖 **Tutorial Rápido:**\n1. Abre ACUA dentro de World App\n2. Conecta tu World Wallet\n3. Ve a 'Stake H2O' para ganar 12% APY\n4. Usa el menú abanico (abajo a la derecha) para navegar\n5. Prueba Swap para intercambiar tokens\n6. Usa Bridge para mover SUSHI entre World Chain y BNB\n\n¡Empieza con el stake de H2O para los rendimientos más seguros! 🚀"
  },
  {
    patterns: ['stake', 'staking', 'stakeado', 'staked', 'depositar h2o', 'deposit h2o'],
    answer: (l) => l === 'en'
      ? "💧 **H2O Staking:**\n• APY: 12% fixed\n• Minimum: any amount\n• Fee: 0.001 H2O per tx\n• Rewards are paid in H2O\n• No lock-up period\n\nWe also have Stake+ with 8 tokens (WLD, FIRE, SUSHI, USDC, wCOP, wARS, BTCH2O, AIR) and H2O v3 Pool for LP rewards. 🌊"
      : "💧 **Stake H2O:**\n• APY: 12% fijo\n• Mínimo: cualquier cantidad\n• Comisión: 0.001 H2O por tx\n• Recompensas en H2O\n• Sin período de bloqueo\n\nTambién tenemos Stake+ con 8 tokens (WLD, FIRE, SUSHI, USDC, wCOP, wARS, BTCH2O, AIR) y H2O v3 Pool para recompensas LP. 🌊"
  },
  {
    patterns: ['recompensa', 'reward', 'ganancias', 'earnings', 'apy', 'apr', 'rendimiento', 'yield'],
    answer: (l) => l === 'en'
      ? "💰 **Rewards & APY:**\n• H2O Stake: 12% APY\n• SUSHI 2.0 (World Chain): 300% APR\n• SUSHI BNB: variable (cooking system)\n• H2O v3 Pool: variable LP fees\n• Mining UTH₂: permanent H2O\n• Mining WLD: 7 simultaneous tokens\n• Mining TIME: WLD rewards\n\nThe more you stake and the longer you hold, the more you earn! 📈"
      : "💰 **Recompensas & APY:**\n• Stake H2O: 12% APY\n• SUSHI 2.0 (World Chain): 300% APR\n• SUSHI BNB: variable (sistema cocción)\n• H2O v3 Pool: fees LP variables\n• Minería UTH₂: H2O permanente\n• Minería WLD: 7 tokens simultáneos\n• Minería TIME: recompensas WLD\n\n¡Cuanto más stakees y más tiempo mantengas, más ganas! 📈"
  },
  {
    patterns: ['bridge', 'puente', 'wld a bnb', 'bnb a wld', 'sushi bridge', 'cross chain', 'crosschain'],
    answer: (l) => l === 'en'
      ? "🌉 **SUSHI Bridge (WLD ↔ BNB):**\n• Rate: 1:1 (same SUSHI token)\n• Fee: 2% configurable\n• Minimum: 0.2 USDC value\n• Processed manually by owner\n• Smart: uses pool funds + user funds when available\n\nHow it works:\n1. Send SUSHI on World Chain\n2. Owner processes your request\n3. You receive SUSHI on BNB Chain (or vice versa)\n\nThe contract holds SUSHI on both chains as liquidity. ⚡"
      : "🌉 **Bridge SUSHI (WLD ↔ BNB):**\n• Tasa: 1:1 (mismo token SUSHI)\n• Comisión: 2% configurable\n• Mínimo: valor 0.2 USDC\n• Procesado manualmente por el owner\n• Inteligente: usa fondos del pool + usuario cuando disponible\n\nCómo funciona:\n1. Envías SUSHI en World Chain\n2. El owner procesa tu solicitud\n3. Recibes SUSHI en BNB Chain (o viceversa)\n\nEl contrato mantiene SUSHI en ambas cadenas como liquidez. ⚡"
  },
  {
    patterns: ['swap', 'intercambio', 'exchange', 'cambiar tokens', 'token swap'],
    answer: (l) => l === 'en'
      ? "🔄 **Swap:**\n• Supports Uniswap V2, V3, V4\n• World Chain DEX with best routes\n• 2% protocol fee + 0.1% H2O buyback\n• Uses Permit2 (no separate approve needed)\n• Volume rewards: earn UTH2 tokens based on swap volume\n\nThe swap finds the best route automatically across all available liquidity pools. 💱"
      : "🔄 **Swap:**\n• Soporta Uniswap V2, V3, V4\n• DEX en World Chain con mejores rutas\n• Comisión 2% protocolo + 0.1% buyback H2O\n• Usa Permit2 (sin approve separado)\n• Recompensas por volumen: gana tokens UTH2\n\nEl swap encuentra la mejor ruta automáticamente en todos los pools de liquidez disponibles. 💱"
  },
  {
    patterns: ['comision', 'fee', 'costo', 'cost', 'precio', 'price', 'cuanto cuesta', 'how much'],
    answer: (l) => l === 'en'
      ? "💳 **Fees:**\n• Per transaction fee: 0.001 H2O\n• Bridge fee: 2% of amount\n• Swap fee: 2% + 0.1% buyback\n• SUSHI 2.0 deposit/withdraw/claim: 5%\n• Gas on World Chain: FREE (World App pays)\n• Gas on BNB Chain: paid in BNB by user\n• Gas on Polygon: paid in POL by user"
      : "💳 **Comisiones:**\n• Comisión por tx: 0.001 H2O\n• Bridge: 2% del monto\n• Swap: 2% + 0.1% buyback\n• SUSHI 2.0 depósito/retiro/claim: 5%\n• Gas en World Chain: GRATIS (paga World App)\n• Gas en BNB Chain: lo paga el usuario en BNB\n• Gas en Polygon: lo paga el usuario en POL"
  },
  {
    patterns: ['wallet', 'billetera', 'importar', 'import', 'exportar', 'export', 'frase', 'seed', 'clave', 'private key'],
    answer: (l) => l === 'en'
      ? "🔐 **Wallet Management:**\nYou can import wallets using:\n• Seed phrase (12 or 24 words)\n• Private key (0x...)\n\n⚠️ NEVER share your seed phrase or private key with anyone. Store it offline in a safe place.\n\nWorld App wallet: managed by MiniKit. To export, go to World App Settings → Wallet → Show recovery phrase."
      : "🔐 **Gestión de Wallet:**\nPuedes importar wallets usando:\n• Frase semilla (12 o 24 palabras)\n• Clave privada (0x...)\n\n⚠️ NUNCA compartas tu frase semilla o clave privada con nadie. Guárdala offline en un lugar seguro.\n\nWallet de World App: gestionada por MiniKit. Para exportar, ve a Ajustes de World App → Wallet → Mostrar frase de recuperación."
  },
  {
    patterns: ['mining', 'mineria', 'minería', 'uth2', 'wld mining', 'time mining', 'minar'],
    answer: (l) => l === 'en'
      ? "⛏️ **Mining:**\n• **UTH₂ → H2O**: Pay UTH2, earn H2O permanently. Best for long-term holders.\n• **WLD → 7 tokens**: Pay WLD, earn 7 different tokens simultaneously.\n• **TIME → WLD**: Stake TIME tokens, earn WLD rewards from the reward pool.\n\nMining is different from staking — you spend one token to permanently earn another. 🔥"
      : "⛏️ **Minería:**\n• **UTH₂ → H2O**: Pagas UTH2, ganas H2O permanentemente. Ideal para holders a largo plazo.\n• **WLD → 7 tokens**: Pagas WLD, ganas 7 tokens diferentes simultáneamente.\n• **TIME → WLD**: Stakeas tokens TIME, ganas recompensas WLD del pool.\n\nLa minería es diferente al staking — gastas un token para ganar otro permanentemente. 🔥"
  },
  {
    patterns: ['vip', 'membresia', 'membresía', 'membership', 'silver', 'gold', 'diamond'],
    answer: (l) => l === 'en'
      ? "👑 **VIP Membership (SUSHI BNB):**\n• No membership: 15 min cook time\n• Silver: 45 min (0.025 BNB)\n• Gold: 3 hours (0.125 BNB)\n• Diamond: 48 hours (0.375 BNB)\n\nHigher membership = longer cook times = bigger rewards with streak multiplier. The streak multiplier increases the longer you cook without breaks! 🍣"
      : "👑 **Membresía VIP (SUSHI BNB):**\n• Sin membresía: 15 min cocción\n• Silver: 45 min (0.025 BNB)\n• Gold: 3 horas (0.125 BNB)\n• Diamond: 48 horas (0.375 BNB)\n\n¡Mayor membresía = tiempos de cocción más largos = mayores recompensas con multiplicador de racha! El multiplicador de racha aumenta cuanto más tiempo cocinas sin pausas. 🍣"
  },
  {
    patterns: ['motivacion', 'motivation', 'animo', 'porqué', 'why invest', 'invertir'],
    answer: (l) => l === 'en'
      ? "🚀 **Why ACUA?**\n\n✅ 12% APY on H2O — steady and reliable\n✅ 300% APR on SUSHI 2.0 — high reward staking\n✅ Multiple chains: World Chain + BNB + Polygon (soon)\n✅ Gas-free on World Chain (World App pays!)\n✅ Your keys, your crypto — non-custodial\n✅ Real DeFi on World Chain ecosystem\n\nEvery small investment compounds over time. Start with what you have and let the yield work for you! 💪"
      : "🚀 **¿Por qué ACUA?**\n\n✅ 12% APY en H2O — estable y confiable\n✅ 300% APR en SUSHI 2.0 — stake de alto rendimiento\n✅ Múltiples cadenas: World Chain + BNB + Polygon (pronto)\n✅ Gas gratis en World Chain (¡paga World App!)\n✅ Tus llaves, tu cripto — no custodial\n✅ DeFi real en el ecosistema World Chain\n\nCada pequeña inversión crece con el tiempo. ¡Empieza con lo que tienes y deja que el rendimiento trabaje por ti! 💪"
  },
  {
    patterns: ['h2o', 'token h2o', 'que es h2o', 'what is h2o'],
    answer: (l) => l === 'en'
      ? "💧 **H2O Token:**\n• Address: 0x17392e5483983945dEB92e0518a8F2C4eB6bA59d\n• Chain: World Chain (ID 480)\n• Decimals: 18\n• Use: Primary staking token, fee currency, liquidity\n\nH2O 2.0 is coming soon with enhanced features: referral system (10% rewards), new smart contracts, FundManager, CommissionManager, and NewAcuaSwapRouter. Stay tuned! 🌊"
      : "💧 **Token H2O:**\n• Dirección: 0x17392e5483983945dEB92e0518a8F2C4eB6bA59d\n• Red: World Chain (ID 480)\n• Decimales: 18\n• Uso: Token principal de staking, moneda de comisiones, liquidez\n\nH2O 2.0 llega pronto con funciones mejoradas: sistema de referidos (10% recompensas), nuevos contratos inteligentes, FundManager, CommissionManager y NewAcuaSwapRouter. ¡Mantente atento! 🌊"
  },
  {
    patterns: ['bnb', 'binance', 'bsc'],
    answer: (l) => l === 'en'
      ? "🟡 **BNB Chain on ACUA:**\n• SUSHI Staking with cooking system\n• VIP memberships for better rewards\n• Streak multiplier system\n• Referral program\n• Token wallet to view balances\n• SUSHI Bridge: WLD ↔ BNB (1:1 swap, 2% fee)\n\nConnect with your imported wallet on BNB network. Gas fees are paid in BNB by the user. 🔥"
      : "🟡 **BNB Chain en ACUA:**\n• Staking SUSHI con sistema de cocción\n• Membresías VIP para mejores recompensas\n• Sistema de multiplicador de racha\n• Programa de referidos\n• Wallet de tokens para ver saldos\n• Bridge SUSHI: WLD ↔ BNB (intercambio 1:1, 2% comisión)\n\nConéctate con tu wallet importada en la red BNB. Las comisiones de gas las paga el usuario en BNB. 🔥"
  },
]

function getAnswer(input: string, lang: string): string {
  const lower = input.toLowerCase()
  for (const entry of KB) {
    if (entry.patterns.some(p => lower.includes(p))) {
      return entry.answer(lang)
    }
  }
  return lang === 'en'
    ? "I'm not sure about that. You can ask me about: staking, rewards, APY/APR, swap, bridge, mining, VIP membership, wallet import/export, fees, H2O token, BNB section, or why to use ACUA! 🌊"
    : "No estoy seguro sobre eso. Puedes preguntarme sobre: staking, recompensas, APY/APR, swap, bridge, minería, membresía VIP, importar/exportar wallet, comisiones, token H2O, sección BNB, o ¡por qué usar ACUA! 🌊"
}

const QUICK_QUESTIONS = [
  { es: '¿Cómo funciona el stake?', en: 'How does staking work?' },
  { es: '¿Cuánto gano?', en: 'How much can I earn?' },
  { es: 'Tutorial rápido', en: 'Quick tutorial' },
  { es: '¿Qué es el bridge?', en: 'What is the bridge?' },
  { es: 'Motivación', en: 'Motivate me!' },
]

export function AiAgent() {
  const { lang } = useLang()
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [pos, setPos] = useState({ x: 20, y: 120 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Init welcome
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: 'agent', text: t('agentWelcome', lang), ts: Date.now() }])
    }
  }, [open]) // eslint-disable-line

  useEffect(() => {
    if (!minimized) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, minimized])

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return
    const userMsg: Message = { role: 'user', text: text.trim(), ts: Date.now() }
    setMessages(m => [...m, userMsg])
    setInput('')
    setTyping(true)
    setTimeout(() => {
      const answer = getAnswer(text, lang)
      setMessages(m => [...m, { role: 'agent', text: answer, ts: Date.now() }])
      setTyping(false)
    }, 700 + Math.random() * 500)
  }, [lang])

  // Drag handlers (touch + mouse)
  const onDragStart = (e: React.PointerEvent) => {
    if (open) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: pos.x, oy: pos.y }
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    const nx = Math.max(4, Math.min(window.innerWidth - 64, dragRef.current.ox + dx))
    const ny = Math.max(80, Math.min(window.innerHeight - 80, dragRef.current.oy + dy))
    setPos({ x: nx, y: ny })
  }
  const onDragEnd = () => { dragRef.current = null; setDragging(false) }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <div
          className="fixed z-50 touch-none"
          style={{ left: pos.x, top: pos.y, cursor: dragging ? 'grabbing' : 'grab' }}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
        >
          <button
            onClick={() => !dragging && setOpen(true)}
            className="relative w-14 h-14 rounded-2xl flex flex-col items-center justify-center gap-0.5 shadow-[0_0_20px_rgba(6,182,212,0.5)]"
            style={{ background: 'linear-gradient(135deg, #0891b2, #06b6d4, #0e7490)' }}
          >
            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-400 border-2 border-[oklch(0.085_0.018_245)] flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            </div>
            <span className="text-xl">🌊</span>
            <span className="text-[7px] font-black text-white tracking-wider leading-none">H2O AI</span>
          </button>
        </div>
      )}

      {/* Chat window */}
      {open && (
        <div
          className="fixed z-50 flex flex-col rounded-2xl border border-[oklch(0.22_0.025_245)] overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.8)]"
          style={{
            bottom: minimized ? 20 : 20,
            right: 20,
            width: minimized ? 200 : 320,
            height: minimized ? 48 : 480,
            maxHeight: '80dvh',
            background: 'oklch(0.09 0.018 245)',
            transition: 'width 0.3s ease, height 0.3s ease',
          }}
        >
          {/* Header */}
          <div
            className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[oklch(0.22_0.025_245)]"
            style={{ background: 'linear-gradient(90deg, #0891b2, #0e7490)' }}
          >
            <span className="text-lg">🌊</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black text-white leading-none">Agente H2O</p>
              {!minimized && <p className="text-[8px] text-cyan-200/70">DeFi Assistant · ACUA</p>}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMinimized(v => !v)}
                className="w-6 h-6 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                {minimized ? <Maximize2 className="w-3 h-3 text-white" /> : <Minimize2 className="w-3 h-3 text-white" />}
              </button>
              <button
                onClick={() => { setOpen(false); setMessages([]) }}
                className="w-6 h-6 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          </div>

          {!minimized && (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {messages.map((msg, i) => (
                  <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                    {msg.role === 'agent' && (
                      <div className="w-6 h-6 rounded-full bg-cyan-600 flex items-center justify-center shrink-0 mr-1.5 mt-0.5">
                        <span className="text-xs">🌊</span>
                      </div>
                    )}
                    <div
                      className={cn(
                        'max-w-[80%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed whitespace-pre-line',
                        msg.role === 'user'
                          ? 'bg-[oklch(0.65_0.22_255)] text-white rounded-br-sm'
                          : 'bg-[oklch(0.14_0.02_245)] text-foreground border border-[oklch(0.22_0.025_245)] rounded-bl-sm'
                      )}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
                {typing && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 rounded-full bg-cyan-600 flex items-center justify-center shrink-0">
                      <span className="text-xs">🌊</span>
                    </div>
                    <div className="bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] rounded-2xl rounded-bl-sm px-3 py-2 flex gap-1">
                      {[0, 1, 2].map(i => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick questions */}
              {messages.length <= 1 && (
                <div className="px-3 pb-2 flex flex-wrap gap-1">
                  {QUICK_QUESTIONS.map(q => (
                    <button
                      key={q.es}
                      onClick={() => sendMessage(lang === 'en' ? q.en : q.es)}
                      className="text-[9px] font-medium px-2 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                    >
                      {lang === 'en' ? q.en : q.es}
                    </button>
                  ))}
                </div>
              )}

              {/* Input */}
              <div className="shrink-0 flex gap-2 px-3 py-2 border-t border-[oklch(0.22_0.025_245)]">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
                  placeholder={t('agentAskMe', lang)}
                  className="flex-1 bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-1.5 text-[11px] text-foreground placeholder:text-[oklch(0.40_0.01_230)] focus:outline-none focus:border-cyan-500/50"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="w-8 h-8 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 flex items-center justify-center transition-colors shrink-0"
                >
                  <Send className="w-3.5 h-3.5 text-white" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
