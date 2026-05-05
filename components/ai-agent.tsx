'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useLang } from '@/context/lang-context'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { X, Send, Minimize2, Maximize2 } from 'lucide-react'

interface Message {
  role: 'agent' | 'user'
  text: string
  ts: number
}

const KB: { patterns: string[]; answer: (lang: string) => string }[] = [
  {
    patterns: ['hola', 'hello', 'hi', 'ola', 'salut', 'ciao', 'bonjour', 'hallo', 'привет', 'مرحبا'],
    answer: (l) => l === 'en'
      ? "Hello! 👋 I'm Agent H2O, your ACUA MINIEXCHANGE assistant. Ask me about staking, rewards, bridge, swap, wallet, and more!"
      : "¡Hola! 👋 Soy Agente H2O, tu asistente de ACUA MINIEXCHANGE. ¡Pregúntame sobre staking, recompensas, bridge, swap, wallet y más!"
  },
  {
    patterns: ['tutorial', 'como usar', 'how to', 'empezar', 'start', 'comenzar', 'inicio', 'guia', 'guide'],
    answer: (l) => l === 'en'
      ? "📖 **Quick Tutorial:**\n1. Open ACUA inside World App\n2. Connect your World Wallet\n3. Go to 'Stake H2O' to earn 12% APY\n4. Use the fan menu (bottom right) to navigate\n5. Try Swap to exchange tokens\n6. Use Bridge to move SUSHI between World Chain & BNB\n\nStart with H2O staking for the safest yields! 🚀"
      : "📖 **Tutorial Rápido:**\n1. Abre ACUA dentro de World App\n2. Conecta tu World Wallet\n3. Ve a 'Stake H2O' para ganar 12% APY\n4. Usa el menú abanico (abajo a la derecha) para navegar\n5. Prueba Swap para intercambiar tokens\n6. Usa Bridge para mover SUSHI entre World Chain y BNB\n\n¡Empieza con el stake de H2O! 🚀"
  },
  {
    patterns: ['stake', 'staking', 'stakeado', 'staked', 'depositar h2o', 'deposit h2o'],
    answer: (l) => l === 'en'
      ? "💧 **H2O Staking:**\n• APY: 12% fixed\n• Fee: 0.001 H2O per tx\n• Rewards paid in H2O\n• No lock-up period\n\nAlso: Stake+ with 8 tokens (WLD, FIRE, SUSHI, USDC…) and H2O v3 Pool. 🌊"
      : "💧 **Stake H2O:**\n• APY: 12% fijo\n• Comisión: 0.001 H2O por tx\n• Recompensas en H2O\n• Sin período de bloqueo\n\nTambién: Stake+ con 8 tokens y H2O v3 Pool. 🌊"
  },
  {
    patterns: ['recompensa', 'reward', 'ganancias', 'earnings', 'apy', 'apr', 'rendimiento', 'yield'],
    answer: (l) => l === 'en'
      ? "💰 **Rewards & APY:**\n• H2O Stake: 12% APY\n• SUSHI 2.0 (World Chain): 300% APR\n• SUSHI BNB: variable (cooking system)\n• Mining UTH₂: permanent H2O\n• Mining WLD: 7 simultaneous tokens\n• Mining TIME: WLD rewards 📈"
      : "💰 **Recompensas & APY:**\n• Stake H2O: 12% APY\n• SUSHI 2.0 (World Chain): 300% APR\n• SUSHI BNB: variable (sistema cocción)\n• Minería UTH₂: H2O permanente\n• Minería WLD: 7 tokens simultáneos\n• Minería TIME: recompensas WLD 📈"
  },
  {
    patterns: ['bridge', 'puente', 'wld a bnb', 'bnb a wld', 'sushi bridge', 'cross chain'],
    answer: (l) => l === 'en'
      ? "🌉 **SUSHI Bridge (WLD ↔ BNB):**\n• Rate: 1:1 (same SUSHI token)\n• Fee: 2%\n• Processed by owner\n• SUSHI goes to YOUR wallet on destination chain\n\n1. Send SUSHI on World Chain\n2. Owner processes\n3. You receive SUSHI on BNB (or vice versa) ⚡"
      : "🌉 **Bridge SUSHI (WLD ↔ BNB):**\n• Tasa: 1:1 (mismo token SUSHI)\n• Comisión: 2%\n• Procesado por el owner\n• El SUSHI llega a TU wallet en la red destino\n\n1. Envías SUSHI en World Chain\n2. El owner procesa\n3. Recibes SUSHI en BNB (o viceversa) ⚡"
  },
  {
    patterns: ['swap', 'intercambio', 'exchange', 'cambiar tokens', 'token swap'],
    answer: (l) => l === 'en'
      ? "🔄 **Swap:**\n• Uniswap V2, V3, V4 on World Chain\n• Best route auto-selected\n• 2% protocol fee + 0.1% H2O buyback\n• Uses Permit2 (no separate approve)\n• Volume rewards: earn UTH2 tokens 💱"
      : "🔄 **Swap:**\n• Uniswap V2, V3, V4 en World Chain\n• Mejor ruta automática\n• 2% comisión + 0.1% buyback H2O\n• Usa Permit2 (sin approve separado)\n• Recompensas por volumen en UTH2 💱"
  },
  {
    patterns: ['comision', 'fee', 'costo', 'cost', 'cuanto cuesta', 'how much'],
    answer: (l) => l === 'en'
      ? "💳 **Fees:**\n• Per tx fee: 0.001 H2O\n• Bridge: 2%\n• Swap: 2% + 0.1% buyback\n• SUSHI 2.0: 5% deposit/withdraw/claim\n• Gas World Chain: FREE (World App pays)\n• Gas BNB Chain: paid in BNB by user"
      : "💳 **Comisiones:**\n• Por tx: 0.001 H2O\n• Bridge: 2%\n• Swap: 2% + 0.1% buyback\n• SUSHI 2.0: 5% depósito/retiro/claim\n• Gas World Chain: GRATIS (paga World App)\n• Gas BNB Chain: paga el usuario en BNB"
  },
  {
    patterns: ['wallet', 'billetera', 'importar', 'import', 'world wallet'],
    answer: (l) => l === 'en'
      ? "🔐 **Wallet Management:**\n• World Wallet: connected via MiniKit (works on both WLD and BNB)\n• Import extra wallet: seed phrase or private key\n• Delete imported wallet anytime with confirmation\n• Imported wallet can be used for BNB Chain txs\n\n⚠️ NEVER share your seed phrase with anyone."
      : "🔐 **Gestión de Wallet:**\n• World Wallet: conectada via MiniKit (funciona en WLD y BNB)\n• Importar wallet extra: frase semilla o clave privada\n• Eliminar wallet importada con confirmación\n• Wallet importada para txs en BNB Chain\n\n⚠️ NUNCA compartas tu frase semilla."
  },
  {
    patterns: ['mining', 'mineria', 'minería', 'uth2', 'wld mining', 'time mining', 'minar'],
    answer: (l) => l === 'en'
      ? "⛏️ **Mining:**\n• **UTH₂ → H2O**: Pay UTH2, earn H2O permanently.\n• **WLD → 7 tokens**: Pay WLD, earn 7 tokens simultaneously.\n• **TIME → WLD**: Stake TIME, earn WLD rewards.\n\nMining = spend one token to permanently earn another. 🔥"
      : "⛏️ **Minería:**\n• **UTH₂ → H2O**: Pagas UTH2, ganas H2O permanentemente.\n• **WLD → 7 tokens**: Pagas WLD, ganas 7 tokens simultáneamente.\n• **TIME → WLD**: Stakeas TIME, ganas WLD.\n\nMinería = gastas un token para ganar otro permanentemente. 🔥"
  },
  {
    patterns: ['vip', 'membresia', 'membresía', 'membership', 'silver', 'gold', 'diamond'],
    answer: (l) => l === 'en'
      ? "👑 **VIP Membership (SUSHI BNB):**\n• No membership: 15 min cook\n• Silver: 45 min (0.025 BNB)\n• Gold: 3 hours (0.125 BNB)\n• Diamond: 48 hours (0.375 BNB)\n\nLonger cook = bigger rewards + streak multiplier! 🍣"
      : "👑 **Membresía VIP (SUSHI BNB):**\n• Sin membresía: 15 min cocción\n• Silver: 45 min (0.025 BNB)\n• Gold: 3 horas (0.125 BNB)\n• Diamond: 48 horas (0.375 BNB)\n\n¡Más cocción = más recompensas + multiplicador racha! 🍣"
  },
  {
    patterns: ['motivacion', 'motivation', 'animo', 'porqué', 'why invest', 'invertir'],
    answer: (l) => l === 'en'
      ? "🚀 **Why ACUA?**\n\n✅ 12% APY on H2O — steady and reliable\n✅ 300% APR on SUSHI 2.0\n✅ Multi-chain: World Chain + BNB\n✅ Gas-free on World Chain!\n✅ Non-custodial — your keys, your crypto\n✅ Real DeFi on World Chain ecosystem\n\nEvery small investment compounds over time. Start now! 💪"
      : "🚀 **¿Por qué ACUA?**\n\n✅ 12% APY en H2O — estable\n✅ 300% APR en SUSHI 2.0\n✅ Multi-cadena: World Chain + BNB\n✅ ¡Gas gratis en World Chain!\n✅ No custodial — tus llaves, tu cripto\n✅ DeFi real en World Chain\n\n¡Cada pequeña inversión crece con el tiempo! 💪"
  },
  {
    patterns: ['h2o', 'token h2o', 'que es h2o', 'what is h2o'],
    answer: (l) => l === 'en'
      ? "💧 **H2O Token:**\n• Address: 0x17392e5483983945dEB92e0518a8F2C4eB6bA59d\n• Chain: World Chain (ID 480)\n• Use: Primary staking token, fee currency\n\nH2O 2.0 coming soon with referrals (10% rewards), FundManager, and more! 🌊"
      : "💧 **Token H2O:**\n• Dirección: 0x17392e5483983945dEB92e0518a8F2C4eB6bA59d\n• Red: World Chain (ID 480)\n• Uso: Staking principal, moneda de comisiones\n\nH2O 2.0 llega pronto con referidos (10% recompensas), FundManager ¡y más! 🌊"
  },
  {
    patterns: ['bnb', 'binance', 'bsc'],
    answer: (l) => l === 'en'
      ? "🟡 **BNB Chain on ACUA:**\n• SUSHI Staking with cooking system\n• VIP memberships for better rewards\n• Streak multiplier system\n• Referral program\n• Token wallet (BNB, SUSHI, USDT, USDC, BUSD)\n• SUSHI Bridge: WLD ↔ BNB (1:1, 2% fee)\n\nYour World Wallet works on BNB too! Or import a separate wallet. 🔥"
      : "🟡 **BNB Chain en ACUA:**\n• Staking SUSHI con cocción\n• Membresías VIP para mejores recompensas\n• Multiplicador de racha\n• Programa de referidos\n• Wallet tokens (BNB, SUSHI, USDT, USDC, BUSD)\n• Bridge SUSHI: WLD ↔ BNB (1:1, 2%)\n\n¡Tu World Wallet funciona en BNB también! O importa una wallet separada. 🔥"
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
    ? "I'm not sure about that. Ask me about: staking, rewards, APY/APR, swap, bridge, mining, VIP, wallet, fees, H2O token, or BNB! 🌊"
    : "No estoy seguro sobre eso. ¡Pregúntame sobre: staking, recompensas, APY/APR, swap, bridge, minería, VIP, wallet, comisiones, token H2O o BNB! 🌊"
}

const QUICK_QUESTIONS = [
  { es: '¿Cómo funciona el stake?', en: 'How does staking work?' },
  { es: '¿Cuánto gano?', en: 'How much can I earn?' },
  { es: 'Tutorial rápido', en: 'Quick tutorial' },
  { es: '¿Qué es el bridge?', en: 'What is the bridge?' },
  { es: '¡Motívame!', en: 'Motivate me!' },
]

export function AiAgent() {
  const { lang } = useLang()
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
    setMessages(m => [...m, { role: 'user', text: text.trim(), ts: Date.now() }])
    setInput('')
    setTyping(true)
    setTimeout(() => {
      setMessages(m => [...m, { role: 'agent', text: getAnswer(text, lang), ts: Date.now() }])
      setTyping(false)
    }, 700 + Math.random() * 400)
  }, [lang])

  return (
    <>
      {/* Floating trigger button — fixed bottom-left, small */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed z-40 flex flex-col items-center justify-center gap-0.5 shadow-[0_0_16px_rgba(6,182,212,0.45)]"
          style={{
            bottom: 22,
            left: 18,
            width: 40,
            height: 40,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #0891b2, #06b6d4)',
          }}
          aria-label="Agente H2O"
        >
          <div
            className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-blue-400 border-[1.5px] border-[oklch(0.085_0.018_245)] flex items-center justify-center"
          >
            <div className="w-1 h-1 rounded-full bg-white animate-pulse" />
          </div>
          <span className="text-base leading-none">🌊</span>
          <span className="text-[6px] font-black text-white tracking-wider leading-none">H2O</span>
        </button>
      )}

      {/* Chat window */}
      {open && (
        <div
          className="fixed z-50 flex flex-col rounded-2xl border border-[oklch(0.22_0.025_245)] overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.8)]"
          style={{
            bottom: 20,
            left: 10,
            width: minimized ? 190 : 300,
            height: minimized ? 44 : 440,
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
            <span className="text-base">🌊</span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-black text-white leading-none">Agente H2O</p>
              {!minimized && <p className="text-[8px] text-cyan-200/70">DeFi Assistant · ACUA</p>}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMinimized(v => !v)}
                className="w-5 h-5 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                {minimized
                  ? <Maximize2 className="w-2.5 h-2.5 text-white" />
                  : <Minimize2 className="w-2.5 h-2.5 text-white" />}
              </button>
              <button
                onClick={() => { setOpen(false); setMessages([]) }}
                className="w-5 h-5 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X className="w-2.5 h-2.5 text-white" />
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
                      <div className="w-5 h-5 rounded-full bg-cyan-600 flex items-center justify-center shrink-0 mr-1.5 mt-0.5">
                        <span className="text-[10px]">🌊</span>
                      </div>
                    )}
                    <div className={cn(
                      'max-w-[82%] rounded-2xl px-2.5 py-1.5 text-[10px] leading-relaxed whitespace-pre-line',
                      msg.role === 'user'
                        ? 'bg-[oklch(0.65_0.22_255)] text-white rounded-br-sm'
                        : 'bg-[oklch(0.14_0.02_245)] text-foreground border border-[oklch(0.22_0.025_245)] rounded-bl-sm'
                    )}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {typing && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-cyan-600 flex items-center justify-center shrink-0">
                      <span className="text-[10px]">🌊</span>
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
                <div className="px-2.5 pb-2 flex flex-wrap gap-1">
                  {QUICK_QUESTIONS.map(q => (
                    <button
                      key={q.es}
                      onClick={() => sendMessage(lang === 'en' ? q.en : q.es)}
                      className="text-[8px] font-medium px-2 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                    >
                      {lang === 'en' ? q.en : q.es}
                    </button>
                  ))}
                </div>
              )}

              {/* Input */}
              <div className="shrink-0 flex gap-1.5 px-2.5 py-2 border-t border-[oklch(0.22_0.025_245)]">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
                  placeholder={t('agentAskMe', lang)}
                  className="flex-1 bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-2.5 py-1.5 text-[10px] text-foreground placeholder:text-[oklch(0.40_0.01_230)] focus:outline-none focus:border-cyan-500/50"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="w-7 h-7 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 flex items-center justify-center transition-colors shrink-0"
                >
                  <Send className="w-3 h-3 text-white" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
