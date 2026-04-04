'use client'

import { useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

const WORLDSCAN = 'https://worldscan.org/address'

interface TokenEntry {
  name: string
  symbol: string
  type: 'token' | 'staking' | 'mining' | 'swap'
  address: string
  color: string
  emoji: string
  description: string
}

const TOKENS: TokenEntry[] = [
  // ─── Tokens ─────────────────────────────────────────────────────────────
  { name: 'Acua H2O', symbol: 'H2O', type: 'token', address: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', color: 'cyan', emoji: '💧', description: 'Token nativo del ecosistema Acua' },
  { name: 'Worldcoin', symbol: 'WLD', type: 'token', address: '0x2cFc85d8E48F8EAB294be644d9E25C3030863003', color: 'blue', emoji: '🌐', description: 'Token nativo de World Chain' },
  { name: 'Fire Token', symbol: 'FIRE', type: 'token', address: '0x22c40632c13a7f3cae9c343480607d886832c686', color: 'orange', emoji: '🔥', description: 'Token de fuego del ecosistema' },
  { name: 'Sushi Token', symbol: 'SUSHI', type: 'token', address: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38', color: 'pink', emoji: '🍣', description: 'DeFi reward token' },
  { name: 'USD Coin', symbol: 'USDC', type: 'token', address: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', color: 'green', emoji: '💵', description: 'Stablecoin 1:1 con USD' },
  { name: 'wrapped COP', symbol: 'wCOP', type: 'token', address: '0x8a1d45e102e886510e891d2ec656a708991e2d76', color: 'yellow', emoji: '🇨🇴', description: 'Peso colombiano envuelto' },
  { name: 'wrapped ARS', symbol: 'wARS', type: 'token', address: '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d', color: 'sky', emoji: '🇦🇷', description: 'Peso argentino envuelto' },
  { name: 'BTC H2O', symbol: 'BTCH2O', type: 'token', address: '0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484', color: 'amber', emoji: '₿', description: 'Bitcoin del ecosistema Acua' },
  { name: 'Air Token', symbol: 'AIR', type: 'token', address: '0xDBA88118551d5Adf16a7AB943403Aea7ea06762b', color: 'violet', emoji: '🌬️', description: 'Token del aire' },
  { name: 'UTH2 Token', symbol: 'UTH2', type: 'token', address: '0x9eA8653640E22A5b69887985BB75d496dc97022a', color: 'teal', emoji: '⚗️', description: 'Uranio para minería H2O' },
  { name: 'Time Token', symbol: 'TIME', type: 'token', address: '0x212d7448720852D8Ad282a5d4A895B3461F9076E', color: 'purple', emoji: '⏱️', description: 'Token del tiempo' },
  // ─── Staking contracts ───────────────────────────────────────────────────
  { name: 'Stake Acua H2O', symbol: 'H2O Stake', type: 'staking', address: '0xabbD2D0360bA25FBb82a6f7574a150F1AEAc2e04', color: 'cyan', emoji: '💧', description: 'Contrato de staking H2O (92% APY)' },
  { name: 'Stake WLD', symbol: 'WLD Stake', type: 'staking', address: '0x224C31214989F8F22E036c4a8Ae294B9Ce339f74', color: 'blue', emoji: '🌐', description: 'Staking Worldcoin' },
  { name: 'Stake FIRE', symbol: 'FIRE Stake', type: 'staking', address: '0xC799a6D13735bAc407183e0d8Acb6F07dfF072DD', color: 'orange', emoji: '🔥', description: 'Staking Fire Token' },
  { name: 'Stake SUSHI', symbol: 'SUSHI Stake', type: 'staking', address: '0x31c25e2E5331F02F15fD43340079303EfE02625c', color: 'pink', emoji: '🍣', description: 'Staking Sushi Token' },
  { name: 'Stake USDC', symbol: 'USDC Stake', type: 'staking', address: '0x21075B62a6459D76534938BAD4EE7146a5AF1c1a', color: 'green', emoji: '💵', description: 'Staking USD Coin' },
  { name: 'Stake wCOP', symbol: 'wCOP Stake', type: 'staking', address: '0x68E3EcF55DFE392D7A9D8D8aB129A20D52A2bB70', color: 'yellow', emoji: '🇨🇴', description: 'Staking wrapped COP' },
  { name: 'Stake wARS', symbol: 'wARS Stake', type: 'staking', address: '0xf3b9162726D2034af1677bAbD1D667c2c4A0A46A', color: 'sky', emoji: '🇦🇷', description: 'Staking wrapped ARS' },
  { name: 'Stake BTCH2O', symbol: 'BTCH2O Stake', type: 'staking', address: '0x965934aE4b292816a694e7b9cDd41E873AeC32A0', color: 'amber', emoji: '₿', description: 'Staking BTC H2O' },
  { name: 'Stake AIR', symbol: 'AIR Stake', type: 'staking', address: '0xfc548193a52cCF151cD2BE34D59a14Be119c5cE1', color: 'violet', emoji: '🌬️', description: 'Staking Air Token' },
  { name: 'Stake TIME', symbol: 'TIME Stake', type: 'staking', address: '0x17e32C9E063533529F802839B9bA93e70D8953FE', color: 'purple', emoji: '⏱️', description: 'Staking TIME → earn WLD' },
  // ─── Mining contracts ────────────────────────────────────────────────────
  { name: 'Minería UTH2 → H2O', symbol: 'UTH2 Mine', type: 'mining', address: '0xbCF03E16F9114396A849053cb1555aAE744522e6', color: 'teal', emoji: '⛏️', description: 'Paga UTH2 y mina H2O permanente' },
  { name: 'Minería WLD → Multi', symbol: 'WLD Mine', type: 'mining', address: '0xD2E227D30bC94D6FfD4eCf6b56141429C801E228', color: 'blue', emoji: '💎', description: 'Paga WLD y mina 7 tokens' },
  // ─── Swap contracts (Uniswap V3 · World Chain) ───────────────────────────
  { name: 'Uniswap V3 SwapRouter02', symbol: 'Router', type: 'swap', address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', color: 'indigo', emoji: '🔄', description: 'Router oficial Uniswap V3 · World Chain · verificado ✓' },
  { name: 'Uniswap V3 QuoterV2', symbol: 'Quoter', type: 'swap', address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', color: 'indigo', emoji: '📊', description: 'Cotizador on-chain V3 · World Chain · verificado ✓' },
]

const colorMap: Record<string, string> = {
  cyan:   'border-cyan-500/30 bg-cyan-500/5 text-cyan-300',
  blue:   'border-blue-500/30 bg-blue-500/5 text-blue-300',
  orange: 'border-orange-500/30 bg-orange-500/5 text-orange-300',
  pink:   'border-pink-500/30 bg-pink-500/5 text-pink-300',
  green:  'border-green-500/30 bg-green-500/5 text-green-300',
  yellow: 'border-yellow-500/30 bg-yellow-500/5 text-yellow-300',
  sky:    'border-sky-500/30 bg-sky-500/5 text-sky-300',
  amber:  'border-amber-500/30 bg-amber-500/5 text-amber-300',
  violet: 'border-violet-500/30 bg-violet-500/5 text-violet-300',
  teal:   'border-teal-500/30 bg-teal-500/5 text-teal-300',
  purple: 'border-purple-500/30 bg-purple-500/5 text-purple-300',
  indigo: 'border-indigo-500/30 bg-indigo-500/5 text-indigo-300',
}

const typeLabel: Record<string, string> = {
  token: 'Token',
  staking: 'Staking',
  mining: 'Minería',
  swap: 'Swap',
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

function shortAddr(addr: string) {
  return addr.slice(0, 8) + '…' + addr.slice(-6)
}

export function TokenDirectoryPanel() {
  const [filter, setFilter] = useState<'all' | 'token' | 'staking' | 'mining' | 'swap'>('all')
  const [search, setSearch] = useState('')

  const filtered = TOKENS.filter(t =>
    (filter === 'all' || t.type === filter) &&
    (search === '' || t.name.toLowerCase().includes(search.toLowerCase()) || t.symbol.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="space-y-4 pb-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-base">
          📋
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">Directorio de Contratos</h2>
          <p className="text-xs text-muted-foreground">Tokens, staking, minería y swap del ecosistema Acua</p>
        </div>
      </div>

      {/* Search */}
      <input
        type="text" placeholder="🔍 Buscar token o contrato..."
        value={search} onChange={e => setSearch(e.target.value)}
        className="w-full bg-surface-2 border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60"
      />

      {/* Filter tabs */}
      <div className="flex gap-1.5">
        {(['all', 'token', 'staking', 'mining', 'swap'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors',
              filter === f ? 'bg-primary text-primary-foreground' : 'bg-surface-2 text-muted-foreground hover:text-foreground'
            )}>
            {f === 'all' ? 'Todo' : typeLabel[f]}
          </button>
        ))}
      </div>

      {/* Results count */}
      <p className="text-xs text-muted-foreground">{filtered.length} contratos</p>

      {/* Cards */}
      <div className="space-y-2.5">
        {filtered.map(entry => (
          <div key={entry.address + entry.type}
            className={cn('rounded-xl border p-3 space-y-2', colorMap[entry.color])}>
            {/* Row 1: name + type badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">{entry.emoji}</span>
                <div>
                  <p className="text-sm font-bold text-foreground leading-none">{entry.name}</p>
                  <p className="text-xs text-muted-foreground">{entry.description}</p>
                </div>
              </div>
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-semibold',
                entry.type === 'token'   ? 'bg-foreground/10 text-foreground/70' :
                entry.type === 'staking' ? 'bg-primary/20 text-primary' :
                entry.type === 'swap'    ? 'bg-indigo-500/20 text-indigo-300' :
                'bg-orange-500/20 text-orange-400'
              )}>
                {typeLabel[entry.type]}
              </span>
            </div>

            {/* Row 2: address */}
            <div className="rounded-lg bg-background/40 px-3 py-2 flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-foreground/80 truncate">{shortAddr(entry.address)}</span>
              <div className="flex items-center gap-2 shrink-0">
                <CopyButton text={entry.address} />
                <a href={`${WORLDSCAN}/${entry.address}`} target="_blank" rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* Row 3: full address copy */}
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-muted-foreground/60 truncate max-w-[200px] select-all">{entry.address}</span>
              <div className="flex items-center gap-3 ml-2 shrink-0">
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => navigator.clipboard.writeText(entry.address)}>
                  Copiar dirección
                </button>
                <a href={`${WORLDSCAN}/${entry.address}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:underline flex items-center gap-0.5">
                  WorldScan <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
