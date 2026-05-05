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

// ── Knowledge Base ─────────────────────────────────────────────────────────────
const KB: { patterns: string[]; answer: (lang: string) => string }[] = [
  {
    patterns: ['hola', 'hello', 'hi', 'ola', 'salut', 'ciao', 'bonjour', 'hallo', 'привет', 'مرحبا', 'こんにちは', '你好', '안녕'],
    answer: (l) => l === 'en'
      ? "Hello! 👋 I'm Agent H2O, your ACUA MINIEXCHANGE assistant on World Chain! I can help you with staking, rewards, bridge, swap, BNB wallet, mining, and much more. What would you like to do today?"
      : "¡Hola! 👋 Soy Agente H2O, tu asistente de ACUA MINIEXCHANGE en World Chain. Puedo ayudarte con staking, recompensas, bridge, swap, wallet BNB, minería ¡y mucho más! ¿Qué quieres hacer hoy?",
  },
  {
    patterns: ['tutorial', 'como usar', 'how to', 'empezar', 'start', 'comenzar', 'inicio', 'guia', 'guide', 'ayuda', 'help'],
    answer: (l) => l === 'en'
      ? "📖 **Quick Tutorial:**\n1. Open ACUA inside World App\n2. Connect your World Wallet (top right)\n3. Go to 'Stake H2O' → earn 12% APY\n4. Use the floating fan menu (bottom right) to navigate fast\n5. Switch to BNB network for SUSHI staking + wallet exchange\n6. Use the Bridge to move SUSHI between chains\n\n💡 Tip: All gas on World Chain is FREE via World App!"
      : "📖 **Tutorial Rápido:**\n1. Abre ACUA dentro de World App\n2. Conecta tu World Wallet (arriba derecha)\n3. Ve a 'Stake H2O' → gana 12% APY\n4. Usa el menú abanico flotante (abajo derecha) para navegar rápido\n5. Cambia a red BNB para staking SUSHI + exchange de wallet\n6. Usa el Bridge para mover SUSHI entre cadenas\n\n💡 ¡Gas en World Chain GRATIS con World App!",
  },
  {
    patterns: ['stake h2o', 'staking h2o', 'h2o stake', 'depositar h2o', 'deposit h2o', 'stakeado', 'staked'],
    answer: (l) => l === 'en'
      ? "💧 **H2O Staking:**\n• APY: **12% fixed**\n• Fee: 0.001 H2O per transaction\n• Rewards: paid in H2O, claimable anytime\n• No lock-up period — withdraw anytime\n• Gas: FREE on World Chain!\n\n**H2O 2.0** coming soon: referrals (10% rewards), FundManager, Vault. 🌊"
      : "💧 **Stake H2O:**\n• APY: **12% fijo**\n• Comisión: 0.001 H2O por tx\n• Recompensas en H2O, reclamables en cualquier momento\n• Sin período de bloqueo — retira cuando quieras\n• Gas: GRATIS en World Chain!\n\n**H2O 2.0** próximamente: referidos (10%), FundManager, Vault. 🌊",
  },
  {
    patterns: ['stake v2', 'stakev2', 'stake plus', 'stake+', 'multi token', 'multitoken'],
    answer: (l) => l === 'en'
      ? "🚀 **Stake+ & StakeV2:**\n• **Stake+**: Deposit 8 tokens simultaneously (WLD, FIRE, SUSHI, USDC, H2O, TIME, UTH2, WETH)\n• **StakeV2**: Advanced staking with upgradeable APR tiers\n• Both support Permit2 gasless flow\n• Rewards compound automatically 📈"
      : "🚀 **Stake+ y StakeV2:**\n• **Stake+**: Deposita 8 tokens simultáneamente (WLD, FIRE, SUSHI, USDC, H2O, TIME, UTH2, WETH)\n• **StakeV2**: Staking avanzado con niveles APR mejorables\n• Ambos soportan flujo Permit2 sin gas\n• Recompensas se componen automáticamente 📈",
  },
  {
    patterns: ['sushi 2', 'sushi world', 'sushi wld', 'sushi world chain', '300%', 'sushi staking'],
    answer: (l) => l === 'en'
      ? "🍣 **SUSHI 2.0 on World Chain:**\n• APR: **300%**\n• 5% fee on deposit/withdraw/claim\n• Rewards in SUSHI token\n• World Chain (not BNB)\n• Uses Permit2 — no separate approve needed\n• Contract verified on-chain ✅"
      : "🍣 **SUSHI 2.0 en World Chain:**\n• APR: **300%**\n• Comisión 5% en depósito/retiro/claim\n• Recompensas en token SUSHI\n• En World Chain (no BNB)\n• Usa Permit2 — sin approve separado\n• Contrato verificado on-chain ✅",
  },
  {
    patterns: ['sushi bnb', 'sushi binance', 'staking bnb', 'coccion', 'cocción', 'cooking', 'cook'],
    answer: (l) => l === 'en'
      ? "🟡 **SUSHI Staking on BNB:**\n• Deposit SUSHI → earn rewards\n• **Cooking system**: let rewards 'cook' longer for bigger multiplier\n• Streak multiplier: consecutive cook cycles boost rewards\n• VIP memberships unlock longer cook times\n• `withdraw()` withdraws ALL at once (no param)\n• `claimRewards()` to claim without withdrawing\n\nContract: 0x945B4b199Baf8F41E11E79df32D9919bd1fd1c08 🔥"
      : "🟡 **Staking SUSHI en BNB:**\n• Deposita SUSHI → gana recompensas\n• **Sistema de cocción**: deja recompensas 'cocinando' más tiempo para mayor multiplicador\n• Multiplicador racha: ciclos consecutivos aumentan recompensas\n• Membresías VIP desbloquean tiempos de cocción más largos\n• `withdraw()` retira TODO a la vez (sin parámetro)\n• `claimRewards()` para reclamar sin retirar\n\nContrato: 0x945B4b199Baf8F41E11E79df32D9919bd1fd1c08 🔥",
  },
  {
    patterns: ['recompensa', 'reward', 'ganancias', 'earnings', 'apy', 'apr', 'rendimiento', 'yield', 'cuanto gano', 'how much earn'],
    answer: (l) => l === 'en'
      ? "💰 **Rewards & APY/APR:**\n• H2O Stake: **12% APY**\n• SUSHI 2.0 (World Chain): **300% APR**\n• SUSHI BNB: variable (depends on cook time & membership)\n• Mining UTH₂→H2O: permanent passive income\n• Mining WLD→7 tokens: earn 7 simultaneously\n• Mining TIME→WLD: WLD rewards\n\nHighest yield: SUSHI 2.0 at 300% APR 📈"
      : "💰 **Recompensas & APY/APR:**\n• Stake H2O: **12% APY**\n• SUSHI 2.0 (World Chain): **300% APR**\n• SUSHI BNB: variable (depende de cocción y membresía)\n• Minería UTH₂→H2O: renta pasiva permanente\n• Minería WLD→7 tokens: gana 7 simultáneamente\n• Minería TIME→WLD: recompensas WLD\n\nMayor rendimiento: SUSHI 2.0 con 300% APR 📈",
  },
  {
    patterns: ['bridge', 'puente', 'wld a bnb', 'bnb a wld', 'sushi bridge', 'cross chain', 'mover sushi', 'transfer sushi'],
    answer: (l) => l === 'en'
      ? "🌉 **SUSHI Bridge (WLD ↔ BNB):**\n• Rate: 1:1 (same SUSHI token on both chains)\n• Fee: **2%** flat\n• Flat fee: 1,000 SUSHI minimum processing fee\n• Minimum: 10,000 SUSHI per request\n• Large amounts (>100k) auto-split into 10k chunks\n• Owner processes requests — instant when funded\n\n**How it works:**\n1. Submit request with dest address\n2. Owner receives your SUSHI on source chain\n3. You get net SUSHI on destination chain ✅"
      : "🌉 **Bridge SUSHI (WLD ↔ BNB):**\n• Tasa: 1:1 (mismo token SUSHI en ambas cadenas)\n• Comisión: **2%** plana\n• Fee fijo: 1,000 SUSHI mínimo\n• Mínimo: 10,000 SUSHI por solicitud\n• Montos grandes (>100k) se dividen en chunks de 10k\n• El owner procesa — instantáneo si hay fondos\n\n**Cómo funciona:**\n1. Envías solicitud con dirección destino\n2. El owner recibe tu SUSHI en la cadena origen\n3. Recibes SUSHI neto en la cadena destino ✅",
  },
  {
    patterns: ['cancelar bridge', 'cancel bridge', 'reembolso', 'refund bridge', 'cancelar solicitud'],
    answer: (l) => l === 'en'
      ? "↩️ **Bridge Cancel & Refund:**\n• Pending requests can be cancelled by the owner\n• Cancellation refunds 100% of your SUSHI back to your original address\n• No fee charged on cancelled requests\n• Status shows: Pending → Cancelled ✓ Refunded\n\nContact support if your request is stuck and needs cancellation."
      : "↩️ **Cancelar Bridge y Reembolso:**\n• Las solicitudes pendientes pueden cancelarse por el owner\n• La cancelación devuelve el 100% de tu SUSHI a tu dirección original\n• Sin comisión en solicitudes canceladas\n• Estado: Pendiente → Cancelado ✓ Reembolsado\n\nContacta soporte si tu solicitud está atascada.",
  },
  {
    patterns: ['swap', 'intercambio', 'exchange', 'cambiar tokens', 'token swap'],
    answer: (l) => l === 'en'
      ? "🔄 **Swap on World Chain:**\n• Uniswap V2, V3, V4 — best route auto-selected\n• 2% protocol fee + 0.1% H2O buyback\n• Uses Permit2 — no separate approve transaction\n• Volume rewards: earn UTH2 tokens\n\n**Swap on BNB Chain (Wallet tab):**\n• PancakeSwap V2 router\n• Supports: BNB, SUSHI, USDT, USDC, BUSD\n• Auto-quotes with 2% slippage protection\n• Gas: ~0.0002 BNB 💱"
      : "🔄 **Swap en World Chain:**\n• Uniswap V2, V3, V4 — mejor ruta automática\n• 2% comisión + 0.1% buyback H2O\n• Usa Permit2 — sin approve separado\n• Recompensas por volumen en UTH2\n\n**Swap en BNB Chain (tab Wallet):**\n• Router PancakeSwap V2\n• Soporta: BNB, SUSHI, USDT, USDC, BUSD\n• Auto-cotización con 2% slippage\n• Gas: ~0.0002 BNB 💱",
  },
  {
    patterns: ['bnb wallet', 'wallet bnb', 'enviar bnb', 'send bnb', 'recibir bnb', 'receive bnb', 'billetera bnb'],
    answer: (l) => l === 'en'
      ? "💛 **BNB Wallet Exchange:**\n\n📤 **Send**: Transfer BNB or any ERC20 (SUSHI, USDT, USDC, BUSD) to any address\n📥 **Receive**: QR code + copy address for receiving tokens\n🕑 **History**: Last 20 transactions via BSCScan API\n🔄 **Swap**: PancakeSwap V2 — swap between BNB and tokens\n\n💡 Need private key imported for send/swap. Read-only mode shows balances only."
      : "💛 **Wallet BNB Exchange:**\n\n📤 **Enviar**: Transfiere BNB o cualquier ERC20 (SUSHI, USDT, USDC, BUSD)\n📥 **Recibir**: Código QR + copiar dirección\n🕑 **Historial**: Últimas 20 txs via BSCScan API\n🔄 **Swap**: PancakeSwap V2 — intercambia BNB y tokens\n\n💡 Necesitas clave privada importada para enviar/swap. Modo solo lectura muestra balances.",
  },
  {
    patterns: ['qr', 'qr code', 'codigo qr', 'recibir tokens', 'receive tokens'],
    answer: (l) => l === 'en'
      ? "📱 **Receive with QR Code:**\n• Go to BNB network → Wallet tab → 📥 Receive\n• Scan the QR code with any wallet\n• Or copy your address directly\n• Supports all BNB Chain tokens\n\n⚠️ Send only BNB Chain (BSC, Chain ID 56) tokens to this address!"
      : "📱 **Recibir con Código QR:**\n• Ve a red BNB → pestaña Wallet → 📥 Recibir\n• Escanea el QR con cualquier wallet\n• O copia tu dirección directamente\n• Soporta todos los tokens de BNB Chain\n\n⚠️ Envía solo tokens de BNB Chain (BSC, Chain ID 56)!",
  },
  {
    patterns: ['historial', 'history', 'transacciones', 'transactions', 'txs'],
    answer: (l) => l === 'en'
      ? "📋 **Transaction History:**\n• **BNB Wallet**: Last 20 txs via BSCScan API (free, no key needed)\n• Shows: BNB transfers + ERC20 token transfers\n• Filter by: All / BNB only / Tokens only\n• Links directly to BSCScan for full details\n• Auto-loads when you open the History tab 🕑"
      : "📋 **Historial de Transacciones:**\n• **Wallet BNB**: Últimas 20 txs via API BSCScan (gratis)\n• Muestra: transferencias BNB + tokens ERC20\n• Filtrar por: Todo / Solo BNB / Solo Tokens\n• Links directos a BSCScan para detalles\n• Se carga automáticamente al abrir la pestaña Historial 🕑",
  },
  {
    patterns: ['comision', 'fee', 'costo', 'cost', 'cuanto cuesta', 'how much', 'precio', 'price'],
    answer: (l) => l === 'en'
      ? "💳 **Fee Schedule:**\n• H2O Stake tx fee: 0.001 H2O\n• Bridge: 2% + 1,000 SUSHI flat\n• Swap (WLD): 2% + 0.1% H2O buyback\n• SUSHI 2.0: 5% on deposit/withdraw/claim\n• Pancakeswap: 0.25% LP fee\n• Gas World Chain: **FREE** (World App)\n• Gas BNB: ~0.000021–0.00025 BNB per tx"
      : "💳 **Comisiones:**\n• Fee tx stake H2O: 0.001 H2O\n• Bridge: 2% + 1,000 SUSHI plano\n• Swap (WLD): 2% + 0.1% buyback H2O\n• SUSHI 2.0: 5% en depósito/retiro/claim\n• PancakeSwap: 0.25% fee LP\n• Gas World Chain: **GRATIS** (World App)\n• Gas BNB: ~0.000021–0.00025 BNB por tx",
  },
  {
    patterns: ['wallet', 'billetera', 'importar', 'import', 'world wallet', 'clave privada', 'private key', 'seed phrase', 'frase semilla'],
    answer: (l) => l === 'en'
      ? "🔐 **Wallet Management:**\n• **World Wallet**: auto-connected via MiniKit (World App)\n• **Import wallet**: seed phrase (12/24 words) or private key\n• Imported wallet used for BNB Chain signing\n• Delete anytime with confirmation\n• World Wallet works on both WLD and BNB chains\n\n⚠️ NEVER share your seed phrase or private key with anyone — not even support!"
      : "🔐 **Gestión de Wallet:**\n• **World Wallet**: conectada automáticamente via MiniKit\n• **Importar wallet**: frase semilla (12/24 palabras) o clave privada\n• Wallet importada para firmar en BNB Chain\n• Eliminar en cualquier momento con confirmación\n• World Wallet funciona en WLD y BNB\n\n⚠️ NUNCA compartas tu frase semilla o clave privada — ¡ni con soporte!",
  },
  {
    patterns: ['mining', 'mineria', 'minería', 'uth2', 'uth₂', 'wld mining', 'time mining', 'minar'],
    answer: (l) => l === 'en'
      ? "⛏️ **Mining on World Chain:**\n• **UTH₂ → H2O**: Pay UTH2 tokens, earn H2O permanently — best passive income\n• **WLD → 7 tokens**: Pay WLD, earn 7 different tokens simultaneously\n• **TIME → WLD**: Stake TIME tokens, earn WLD rewards\n\n💡 Mining ≠ Staking. With mining you **spend** one token to permanently **earn** another. Staking you **lock** tokens and **get them back** with rewards."
      : "⛏️ **Minería en World Chain:**\n• **UTH₂ → H2O**: Pagas UTH2, ganas H2O permanentemente — mejor renta pasiva\n• **WLD → 7 tokens**: Pagas WLD, ganas 7 tokens distintos simultáneamente\n• **TIME → WLD**: Stakeas TIME, ganas WLD\n\n💡 Minería ≠ Staking. Con minería **gastas** un token para **ganar** otro permanentemente. Con staking **bloqueas** tokens y **los recuperas** con recompensas.",
  },
  {
    patterns: ['vip', 'membresia', 'membresía', 'membership', 'silver', 'gold', 'diamond'],
    answer: (l) => l === 'en'
      ? "👑 **VIP Membership (SUSHI BNB):**\n• No membership: 15 min cook time\n• 🥈 Silver: 45 min (0.025 BNB)\n• 🥇 Gold: 3 hours (0.125 BNB)\n• 💎 Diamond: 48 hours (0.375 BNB)\n\nHigher tier = longer cooking = **bigger rewards + streak multiplier bonus!**\nStreaks: consecutive successful cook cycles multiply your earnings 🍣"
      : "👑 **Membresía VIP (SUSHI BNB):**\n• Sin membresía: 15 min cocción\n• 🥈 Silver: 45 min (0.025 BNB)\n• 🥇 Gold: 3 horas (0.125 BNB)\n• 💎 Diamond: 48 horas (0.375 BNB)\n\nTier más alto = más cocción = ¡**más recompensas + bono multiplicador de racha!**\nRachas: ciclos de cocción consecutivos multiplican tus ganancias 🍣",
  },
  {
    patterns: ['h2o', 'token h2o', 'que es h2o', 'what is h2o'],
    answer: (l) => l === 'en'
      ? "💧 **H2O Token:**\n• Contract: `0x17392e5483983945dEB92e0518a8F2C4eB6bA59d`\n• Network: World Chain (Chain ID 480)\n• Primary staking & fee currency of ACUA\n• Earn through: staking, mining UTH₂, swap buyback\n• Fee Collector: 0.001 H2O per DeFi transaction\n\n**H2O 2.0 (coming)**: referrals, FundManager, Vault, auto-compound 🌊"
      : "💧 **Token H2O:**\n• Contrato: `0x17392e5483983945dEB92e0518a8F2C4eB6bA59d`\n• Red: World Chain (Chain ID 480)\n• Moneda principal de staking y comisiones de ACUA\n• Ganar vía: staking, minería UTH₂, buyback swap\n• Fee Collector: 0.001 H2O por tx DeFi\n\n**H2O 2.0 (próximo)**: referidos, FundManager, Vault, auto-compuesto 🌊",
  },
  {
    patterns: ['bnb chain', 'binance', 'bsc', 'bnb network', 'red bnb'],
    answer: (l) => l === 'en'
      ? "🟡 **BNB Chain on ACUA:**\n\n• 🍣 SUSHI Staking with cooking system\n• 👑 VIP memberships (Silver/Gold/Diamond)\n• 🔄 Token swap via PancakeSwap V2\n• 📤 Send BNB & tokens to any address\n• 📥 Receive via QR code\n• 🕑 Full TX history via BSCScan\n• 🌉 Bridge SUSHI → World Chain\n\nSwitch to BNB in the network selector (top right) 🔥"
      : "🟡 **BNB Chain en ACUA:**\n\n• 🍣 Staking SUSHI con sistema de cocción\n• 👑 Membresías VIP (Silver/Gold/Diamond)\n• 🔄 Swap de tokens via PancakeSwap V2\n• 📤 Enviar BNB y tokens a cualquier dirección\n• 📥 Recibir via código QR\n• 🕑 Historial completo de txs via BSCScan\n• 🌉 Bridge SUSHI → World Chain\n\nCambia a BNB en el selector de red (arriba derecha) 🔥",
  },
  {
    patterns: ['gas', 'gasolina', 'gas fee', 'bnb gas', 'world chain gas', 'cuanto gas'],
    answer: (l) => l === 'en'
      ? "⛽ **Gas Fees:**\n\n**World Chain**: 100% FREE when using World App (MiniKit covers gas)\n\n**BNB Chain** (BSC minimum 1 gwei after Tycho hard fork):\n• Native BNB transfer: ~0.000021 BNB\n• ERC20 transfer: ~0.000065 BNB\n• ERC20 approve: ~0.000050 BNB\n• SUSHI stake: ~0.000150 BNB\n• PancakeSwap: ~0.000200 BNB\n\n💡 Always keep 0.01+ BNB for gas on BNB Chain!"
      : "⛽ **Gas:**\n\n**World Chain**: 100% GRATIS con World App (MiniKit paga el gas)\n\n**BNB Chain** (mínimo 1 gwei desde hard fork Tycho):\n• Transferencia BNB nativo: ~0.000021 BNB\n• Transferencia ERC20: ~0.000065 BNB\n• Approve ERC20: ~0.000050 BNB\n• Stake SUSHI: ~0.000150 BNB\n• PancakeSwap swap: ~0.000200 BNB\n\n💡 ¡Mantén siempre 0.01+ BNB para gas en BNB Chain!",
  },
  {
    patterns: ['seguridad', 'security', 'safe', 'seguro', 'hack', 'scam', 'estafa'],
    answer: (l) => l === 'en'
      ? "🔒 **Security Tips:**\n\n✅ ACUA is non-custodial — your keys, your crypto\n✅ All contracts verified on-chain\n✅ Permit2 used for gasless approvals (World Chain)\n✅ No admin backdoors in staking contracts\n\n⚠️ **NEVER:**\n• Share your seed phrase or private key\n• Send tokens to 'fix your wallet'\n• Click suspicious links claiming to be ACUA\n• Give anyone remote access to your device\n\nIf something seems wrong, close the app immediately!"
      : "🔒 **Consejos de Seguridad:**\n\n✅ ACUA es no custodial — tus llaves, tu cripto\n✅ Todos los contratos verificados on-chain\n✅ Permit2 para approvals sin gas (World Chain)\n✅ Sin backdoors admin en contratos de staking\n\n⚠️ **NUNCA:**\n• Compartas tu frase semilla o clave privada\n• Envíes tokens para 'reparar tu wallet'\n• Hagas clic en links sospechosos\n• Des acceso remoto a tu dispositivo\n\n¡Si algo parece raro, cierra la app inmediatamente!",
  },
  {
    patterns: ['idioma', 'language', 'lenguaje', 'traduccion', 'translation', 'cambiar idioma'],
    answer: (l) => l === 'en'
      ? "🌍 **Language Support:**\nACUA supports 16 languages:\n🇪🇸 Spanish · 🇺🇸 English · 🇧🇷 Portuguese · 🇫🇷 French · 🇩🇪 German · 🇮🇹 Italian · 🇨🇳 Chinese · 🇯🇵 Japanese · 🇰🇷 Korean · 🇷🇺 Russian · 🇸🇦 Arabic · 🇮🇳 Hindi · 🇹🇷 Turkish · 🇳🇱 Dutch · 🇵🇱 Polish · 🇮🇩 Indonesian\n\nChange language with the flag button in the top-right corner of the app 🌐"
      : "🌍 **Soporte de Idiomas:**\nACUA soporta 16 idiomas:\n🇪🇸 Español · 🇺🇸 Inglés · 🇧🇷 Portugués · 🇫🇷 Francés · 🇩🇪 Alemán · 🇮🇹 Italiano · 🇨🇳 Chino · 🇯🇵 Japonés · 🇰🇷 Coreano · 🇷🇺 Ruso · 🇸🇦 Árabe · 🇮🇳 Hindi · 🇹🇷 Turco · 🇳🇱 Neerlandés · 🇵🇱 Polaco · 🇮🇩 Indonesio\n\nCambia el idioma con el botón de bandera en la esquina superior derecha 🌐",
  },
  {
    patterns: ['motivacion', 'motivation', 'animo', 'porqué', 'why invest', 'invertir', 'vale la pena', 'worth it'],
    answer: (l) => l === 'en'
      ? "🚀 **Why ACUA?**\n\n✅ 12% APY on H2O — steady, reliable yield\n✅ 300% APR on SUSHI 2.0 — highest in the ecosystem\n✅ Multi-chain: World Chain + BNB Chain\n✅ Gas-free on World Chain via World App!\n✅ Non-custodial — you own your keys\n✅ Full exchange on BNB: send, receive, swap, history\n✅ Real DeFi built on World Chain ecosystem\n\nEvery small amount compounds over time. The best time to start was yesterday. The second best time is NOW! 💪"
      : "🚀 **¿Por qué ACUA?**\n\n✅ 12% APY en H2O — rendimiento estable\n✅ 300% APR en SUSHI 2.0 — el más alto del ecosistema\n✅ Multi-cadena: World Chain + BNB Chain\n✅ ¡Gas gratis en World Chain con World App!\n✅ No custodial — tú tienes tus llaves\n✅ Exchange completo en BNB: enviar, recibir, swap, historial\n✅ DeFi real en el ecosistema World Chain\n\n¡Cada pequeña cantidad se multiplica con el tiempo. El mejor momento para empezar era ayer. El segundo mejor momento es AHORA! 💪",
  },
  {
    patterns: ['monitor', 'precio', 'price', 'market', 'mercado', 'token price'],
    answer: (l) => l === 'en'
      ? "📊 **Monitor & Tokens:**\n• Use the Monitor tab to see live token prices on World Chain\n• Tokens tab shows all available tokens with balances\n• Price data via on-chain DEX pools\n• Supports: H2O, SUSHI, WLD, USDC, UTH2, TIME, FIRE, and more\n\nNavigate: Menu → Market → Monitor or Tokens 📈"
      : "📊 **Monitor y Tokens:**\n• Usa la pestaña Monitor para ver precios en vivo en World Chain\n• La pestaña Tokens muestra todos los tokens con balances\n• Precios via pools DEX on-chain\n• Soporta: H2O, SUSHI, WLD, USDC, UTH2, TIME, FIRE y más\n\nNavega: Menú → Market → Monitor o Tokens 📈",
  },
  {
    patterns: ['worldcoin', 'wld token', 'world app', 'minikit', 'world chain', 'world id'],
    answer: (l) => l === 'en'
      ? "🌐 **World Chain & ACUA:**\n• World Chain: Layer 2 built on Ethereum by Worldcoin\n• Chain ID: 480\n• MiniKit: World App's SDK — enables gasless txs + World ID verification\n• ACUA runs inside World App as a Mini App\n• All WLD chain gas is FREE for World App users\n\nWorld Chain offers: real human verification + free gas + growing DeFi ecosystem 🌍"
      : "🌐 **World Chain y ACUA:**\n• World Chain: Layer 2 sobre Ethereum de Worldcoin\n• Chain ID: 480\n• MiniKit: SDK de World App — txs sin gas + verificación World ID\n• ACUA corre dentro de World App como Mini App\n• Todo el gas en WLD Chain es GRATIS para usuarios de World App\n\nWorld Chain ofrece: verificación humana real + gas gratis + ecosistema DeFi creciente 🌍",
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
    ? "I'm not sure about that. Try asking about: staking, rewards, APY/APR, swap, bridge, mining, VIP membership, wallet, fees, gas, H2O token, BNB chain, security, or languages! 🌊"
    : "No estoy seguro sobre eso. ¡Prueba preguntarme sobre: staking, recompensas, APY/APR, swap, bridge, minería, membresía VIP, wallet, comisiones, gas, token H2O, BNB Chain, seguridad o idiomas! 🌊"
}

const QUICK_QUESTIONS = [
  { es: '¿Cómo hacer stake?',    en: 'How to stake?' },
  { es: '¿Cuánto gano?',         en: 'How much can I earn?' },
  { es: 'Tutorial rápido',       en: 'Quick tutorial' },
  { es: '¿Cómo usar el bridge?', en: 'How to use the bridge?' },
  { es: 'Wallet BNB Exchange',   en: 'BNB Wallet Exchange' },
  { es: '¡Motívame!',            en: 'Motivate me!' },
]

// ── Snap corners ──────────────────────────────────────────────────────────────
function snapToCorner(x: number, y: number): { x: number; y: number } {
  const w = typeof window !== 'undefined' ? window.innerWidth : 400
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  const corners = [
    { x: 18,      y: 22 },         // bottom-left
    { x: w - 58,  y: 22 },         // bottom-right
    { x: 18,      y: h - 80 },     // top-left
    { x: w - 58,  y: h - 80 },     // top-right
  ]
  return corners.reduce((a, b) =>
    Math.hypot(a.x - x, a.y - y) < Math.hypot(b.x - x, b.y - y) ? a : b
  )
}

function loadSavedPos() {
  if (typeof window === 'undefined') return { x: 18, y: 22 }
  try { return JSON.parse(localStorage.getItem('acua_agent_pos') ?? 'null') ?? { x: 18, y: 22 } }
  catch { return { x: 18, y: 22 } }
}

// ══════════════════════════════════════════════════════════════════════════════
export function AiAgent() {
  const { lang } = useLang()
  const [open, setOpen]           = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [messages, setMessages]   = useState<Message[]>([])
  const [input, setInput]         = useState('')
  const [typing, setTyping]       = useState(false)
  const messagesEndRef             = useRef<HTMLDivElement>(null)

  // ── Draggable position (bottom-left based coords for the floating button) ──
  const [btnPos, setBtnPos]       = useState(loadSavedPos)
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)

  const handlePointerDown = (e: React.PointerEvent) => {
    if (open) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: btnPos.x, origY: btnPos.y, moved: false }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragState.current.moved = true
    if (!dragState.current.moved) return
    // bottom-left coords: right = +x, up = -dy (screen y inverted)
    const newX = dragState.current.origX + dx
    const newY = dragState.current.origY - dy
    const w = window.innerWidth, h = window.innerHeight
    setBtnPos({ x: Math.max(8, Math.min(w - 52, newX)), y: Math.max(8, Math.min(h - 52, newY)) })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragState.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (dragState.current.moved) {
      const snapped = snapToCorner(btnPos.x, btnPos.y)
      setBtnPos(snapped)
      try { localStorage.setItem('acua_agent_pos', JSON.stringify(snapped)) } catch {}
    } else {
      setOpen(true)
    }
    dragState.current = null
  }

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
    }, 600 + Math.random() * 500)
  }, [lang])

  // Chat window position — follows button roughly
  const chatLeft = typeof window !== 'undefined' && btnPos.x > window.innerWidth / 2 ? 'auto' : 10
  const chatRight = typeof window !== 'undefined' && btnPos.x > window.innerWidth / 2 ? 10 : 'auto'
  const chatBottom = btnPos.y > 100 ? btnPos.y + 50 : 20

  return (
    <>
      {/* Floating trigger button — draggable */}
      {!open && (
        <button
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="fixed z-40 flex flex-col items-center justify-center gap-0.5 shadow-[0_0_16px_rgba(6,182,212,0.45)] touch-none select-none"
          style={{
            left:         btnPos.x,
            bottom:       btnPos.y,
            width:        42,
            height:       42,
            borderRadius: 13,
            background:   'linear-gradient(135deg, #0891b2, #06b6d4)',
            cursor:       'grab',
          }}
          aria-label="Agente H2O"
        >
          {/* Live dot */}
          <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-blue-400 border-[1.5px] border-[oklch(0.085_0.018_245)] flex items-center justify-center">
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
            bottom:     chatBottom,
            left:       chatLeft,
            right:      chatRight,
            width:      minimized ? 190 : 310,
            height:     minimized ? 44 : 460,
            maxHeight:  '82dvh',
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
              {!minimized && <p className="text-[8px] text-cyan-200/70">DeFi Assistant · ACUA · {KB.length} temas</p>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setMinimized(v => !v)}
                className="w-5 h-5 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
                {minimized ? <Maximize2 className="w-2.5 h-2.5 text-white" /> : <Minimize2 className="w-2.5 h-2.5 text-white" />}
              </button>
              <button onClick={() => { setOpen(false); setMessages([]) }}
                className="w-5 h-5 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
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
                      'max-w-[84%] rounded-2xl px-2.5 py-1.5 text-[10px] leading-relaxed whitespace-pre-line',
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
                <div className="px-2.5 pb-1.5 flex flex-wrap gap-1">
                  {QUICK_QUESTIONS.map(q => (
                    <button key={q.es} onClick={() => sendMessage(lang === 'en' ? q.en : q.es)}
                      className="text-[8px] font-medium px-2 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-colors">
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
                <button onClick={() => sendMessage(input)} disabled={!input.trim()}
                  className="w-7 h-7 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 flex items-center justify-center transition-colors shrink-0">
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
