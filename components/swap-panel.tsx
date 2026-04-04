'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  ArrowUpDown, RefreshCw, Plus, ChevronDown, Loader2, Search,
  X, Wallet, Shield, ChevronUp, Check, AlertCircle, Repeat2,
  TrendingUp, UserCog, Coins,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TOKENS, getProvider, ERC20_ABI, shortenAddress, formatToken,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── Uniswap V3 — World Chain (480) ──────────────────────────────────────────
const UNISWAP_V3_ROUTER  = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' // SwapRouter02
const UNISWAP_V3_QUOTER  = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' // QuoterV2
const FEE_TIERS = [100, 500, 3000, 10000]

// ─── Default owners ───────────────────────────────────────────────────────────
const DEFAULT_OWNER_1 = '0x5474C309e985c6B4Fc623acf01AdE604dA781e52'
const DEFAULT_OWNER_2 = '0xc2ef127734f296952de75c1b58a6cec605cc2e59'
const DEFAULT_FEE_BPS  = 100 // 1%

// ─── LocalStorage helpers ─────────────────────────────────────────────────────
const LS_FEE     = 'acua_swap_feeBps'
const LS_OWNER1  = 'acua_swap_owner1'
const LS_OWNER2  = 'acua_swap_owner2'
const LS_CUSTOMS = 'acua_swap_customTokens'

function lsGet(key: string, fallback: string) {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}
function lsSet(key: string, val: string) {
  try { localStorage.setItem(key, val) } catch {}
}

// ─── Token item ───────────────────────────────────────────────────────────────
export interface TokenItem {
  symbol: string
  name: string
  address: string
  decimals: number
  color: string
  isCustom?: boolean
}

const DEFAULT_TOKENS: TokenItem[] = [
  { symbol: 'WLD',    name: 'Worldcoin',   address: TOKENS.WLD,    decimals: 18, color: '#3b82f6' },
  { symbol: 'H2O',    name: 'H2O Token',   address: TOKENS.H2O,    decimals: 18, color: '#06b6d4' },
  { symbol: 'FIRE',   name: 'Fire Token',  address: TOKENS.FIRE,   decimals: 18, color: '#f97316' },
  { symbol: 'SUSHI',  name: 'SushiSwap',   address: TOKENS.SUSHI,  decimals: 18, color: '#ec4899' },
  { symbol: 'USDC',   name: 'USD Coin',    address: TOKENS.USDC,   decimals: 6,  color: '#2563eb' },
  { symbol: 'wCOP',   name: 'wCOP',        address: TOKENS.wCOP,   decimals: 18, color: '#f59e0b' },
  { symbol: 'wARS',   name: 'wARS',        address: TOKENS.wARS,   decimals: 18, color: '#10b981' },
  { symbol: 'BTCH2O', name: 'BTC H2O',     address: TOKENS.BTCH2O, decimals: 18, color: '#f59e0b' },
  { symbol: 'AIR',    name: 'AIR Token',   address: TOKENS.AIR,    decimals: 18, color: '#8b5cf6' },
  { symbol: 'UTH2',   name: 'UTH2',        address: TOKENS.UTH2,   decimals: 18, color: '#a78bfa' },
]

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const APPROVE_ABI = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}]

const TRANSFER_ABI = [{
  name: 'transfer', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}]

const EXACT_INPUT_SINGLE_ABI = [{
  name: 'exactInputSingle', type: 'function', stateMutability: 'payable',
  inputs: [{
    name: 'params', type: 'tuple',
    components: [
      { name: 'tokenIn',            type: 'address'  },
      { name: 'tokenOut',           type: 'address'  },
      { name: 'fee',                type: 'uint24'   },
      { name: 'recipient',          type: 'address'  },
      { name: 'amountIn',           type: 'uint256'  },
      { name: 'amountOutMinimum',   type: 'uint256'  },
      { name: 'sqrtPriceLimitX96',  type: 'uint160'  },
    ],
  }],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}]

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]

// ─── Price fetcher via DexScreener ───────────────────────────────────────────
async function fetchUsdPrices(addresses: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}
  try {
    const chunk = addresses.slice(0, 30).join(',')
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk}`, {
      headers: { 'Accept': 'application/json' },
    })
    const data = await res.json()
    if (Array.isArray(data.pairs)) {
      const best: Record<string, { price: number; liq: number }> = {}
      for (const pair of data.pairs) {
        const addr = pair.baseToken?.address?.toLowerCase()
        if (!addr || !pair.priceUsd) continue
        const p = parseFloat(pair.priceUsd)
        const liq = parseFloat(pair.liquidity?.usd ?? '0')
        if (!best[addr] || liq > best[addr].liq) best[addr] = { price: p, liq }
      }
      for (const [addr, v] of Object.entries(best)) prices[addr] = v.price
    }
  } catch {}
  return prices
}

// ─── Uniswap quote (best fee tier) ───────────────────────────────────────────
async function getBestQuote(
  tokenIn: string, tokenOut: string, amountIn: bigint, decimalsOut: number
): Promise<{ amountOut: bigint; fee: number } | null> {
  const p = getProvider()
  const quoter = new ethers.Contract(UNISWAP_V3_QUOTER, QUOTER_ABI, p)
  let best: { amountOut: bigint; fee: number } | null = null
  await Promise.allSettled(
    FEE_TIERS.map(async (fee) => {
      try {
        const [amountOut] = await quoter.quoteExactInputSingle.staticCall({
          tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n,
        })
        if (!best || amountOut > best.amountOut) best = { amountOut, fee }
      } catch {}
    })
  )
  return best
}

// ─── Token symbol from contract ──────────────────────────────────────────────
async function fetchTokenMeta(address: string): Promise<{ symbol: string; name: string; decimals: number } | null> {
  try {
    const p = getProvider()
    const c = new ethers.Contract(address, ERC20_ABI, p)
    const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()])
    return { symbol, name: symbol, decimals: Number(decimals) }
  } catch { return null }
}

// ─── Token Picker Modal ───────────────────────────────────────────────────────
function TokenPicker({
  tokens, onSelect, onClose, exclude,
}: { tokens: TokenItem[]; onSelect: (t: TokenItem) => void; onClose: () => void; exclude?: string }) {
  const [q, setQ] = useState('')
  const filtered = tokens.filter(t =>
    t.address.toLowerCase() !== exclude?.toLowerCase() &&
    (t.symbol.toLowerCase().includes(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase()))
  )
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end justify-center p-4">
      <div className="w-full max-w-sm bg-background border border-border rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <span className="text-sm font-bold">Seleccionar token</span>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <div className="p-3">
          <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-3 py-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar token..."
              className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-border">
          {filtered.map(t => (
            <button
              key={t.address}
              onClick={() => { onSelect(t); onClose() }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ background: t.color + '22', color: t.color }}>
                {t.symbol.slice(0, 3)}
              </div>
              <div>
                <p className="text-sm font-semibold">{t.symbol}</p>
                <p className="text-xs text-muted-foreground">{t.name}</p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">Sin resultados</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function SwapPanel({ userAddress, isAdmin }: { userAddress: string; isAdmin?: boolean }) {
  // ── Token list ──────────────────────────────────────────────────────────────
  const [customTokens, setCustomTokens] = useState<TokenItem[]>(() => {
    try { return JSON.parse(lsGet(LS_CUSTOMS, '[]')) } catch { return [] }
  })
  const allTokens = [...DEFAULT_TOKENS, ...customTokens]

  // ── View: 'wallet' | 'swap' ─────────────────────────────────────────────────
  const [view, setView] = useState<'wallet' | 'swap'>('wallet')

  // ── Balances ────────────────────────────────────────────────────────────────
  const [balances, setBalances] = useState<Record<string, bigint>>({})
  const [prices, setPrices]     = useState<Record<string, number>>({})
  const [loadingBal, setLoadingBal] = useState(false)

  // ── Swap state ──────────────────────────────────────────────────────────────
  const [fromToken, setFromToken] = useState<TokenItem>(DEFAULT_TOKENS[0])
  const [toToken,   setToToken]   = useState<TokenItem>(DEFAULT_TOKENS[1])
  const [fromAmt,   setFromAmt]   = useState('')
  const [quote,     setQuote]     = useState<{ amountOut: bigint; fee: number } | null>(null)
  const [quoting,   setQuoting]   = useState(false)
  const [swapping,  setSwapping]  = useState(false)
  const [swapMsg,   setSwapMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [pickerFor, setPickerFor] = useState<'from' | 'to' | null>(null)
  const [slippage,  setSlippage]  = useState(50) // 0.5%

  // ── Admin / Fee ─────────────────────────────────────────────────────────────
  const [feeBps,   setFeeBps]   = useState(() => parseInt(lsGet(LS_FEE, String(DEFAULT_FEE_BPS))))
  const [owner1,   setOwner1]   = useState(() => lsGet(LS_OWNER1, DEFAULT_OWNER_1))
  const [owner2,   setOwner2]   = useState(() => lsGet(LS_OWNER2, DEFAULT_OWNER_2))
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminMsg,  setAdminMsg]  = useState('')

  // ── Add token ───────────────────────────────────────────────────────────────
  const [addAddr,    setAddAddr]    = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addMsg,     setAddMsg]     = useState('')

  // ── Load balances & prices ──────────────────────────────────────────────────
  const loadBalances = useCallback(async () => {
    setLoadingBal(true)
    try {
      const p = getProvider()
      const addrs = allTokens.map(t => t.address)
      const results = await Promise.allSettled(
        addrs.map(async addr => {
          const c = new ethers.Contract(addr, ERC20_ABI, p)
          return { addr, bal: await c.balanceOf(userAddress) }
        })
      )
      const bals: Record<string, bigint> = {}
      results.forEach(r => { if (r.status === 'fulfilled') bals[r.value.addr.toLowerCase()] = r.value.bal })
      setBalances(bals)

      const usdPrices = await fetchUsdPrices(addrs)
      setPrices(usdPrices)
    } catch (e) { console.error('[Swap] loadBalances', e) }
    finally { setLoadingBal(false) }
  }, [userAddress, allTokens.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadBalances() }, [loadBalances])

  // ── Quote ────────────────────────────────────────────────────────────────────
  const quoteTimeout = useRef<NodeJS.Timeout | null>(null)
  useEffect(() => {
    setQuote(null); setSwapMsg(null)
    if (!fromAmt || isNaN(Number(fromAmt)) || Number(fromAmt) <= 0) return
    if (quoteTimeout.current) clearTimeout(quoteTimeout.current)
    quoteTimeout.current = setTimeout(async () => {
      setQuoting(true)
      try {
        const feeAmt = BigInt(Math.floor(parseFloat(fromAmt) * feeBps / 10000 * 1e6)) * 10n ** BigInt(fromToken.decimals - 6 < 0 ? 0 : fromToken.decimals - 6)
        const rawAmt = ethers.parseUnits(fromAmt, fromToken.decimals)
        const netAmt = rawAmt > feeAmt ? rawAmt - feeAmt : rawAmt
        const result = await getBestQuote(fromToken.address, toToken.address, netAmt, toToken.decimals)
        setQuote(result)
      } catch (e) { console.error('[Swap] quote error', e) }
      finally { setQuoting(false) }
    }, 600)
  }, [fromAmt, fromToken, toToken, feeBps]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Swap ─────────────────────────────────────────────────────────────────────
  const doSwap = useCallback(async () => {
    if (!fromAmt || !quote) return
    setSwapping(true); setSwapMsg(null)
    try {
      const rawAmt    = ethers.parseUnits(fromAmt, fromToken.decimals)
      const feeAmt    = rawAmt * BigInt(feeBps) / 10000n
      const feeHalf   = feeAmt / 2n
      const netAmt    = rawAmt - feeAmt
      const minOut    = quote.amountOut * BigInt(10000 - slippage) / 10000n

      const txs: any[] = [
        { address: fromToken.address, abi: APPROVE_ABI, functionName: 'approve', args: [UNISWAP_V3_ROUTER, netAmt.toString()] },
      ]
      if (feeHalf > 0n) {
        txs.push({ address: fromToken.address, abi: TRANSFER_ABI, functionName: 'transfer', args: [owner1, feeHalf.toString()] })
        txs.push({ address: fromToken.address, abi: TRANSFER_ABI, functionName: 'transfer', args: [owner2, feeHalf.toString()] })
      }
      txs.push({
        address: UNISWAP_V3_ROUTER,
        abi: EXACT_INPUT_SINGLE_ABI,
        functionName: 'exactInputSingle',
        args: [[
          fromToken.address,
          toToken.address,
          quote.fee,
          userAddress,
          netAmt.toString(),
          minOut.toString(),
          '0',
        ]],
      })

      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({ transaction: txs })
      if (finalPayload.status === 'success') {
        const txId = (finalPayload as any).transaction_id ?? ''
        setSwapMsg({ ok: true, text: txId ? `✓ Tx: ${txId.slice(0, 16)}…` : '✓ Swap ejecutado' })
        setFromAmt(''); setQuote(null)
        setTimeout(loadBalances, 3000)
      } else {
        setSwapMsg({ ok: false, text: (finalPayload as any).message ?? 'Transacción rechazada' })
      }
    } catch (e: any) {
      setSwapMsg({ ok: false, text: e?.message ?? 'Error desconocido' })
    } finally { setSwapping(false) }
  }, [fromAmt, quote, fromToken, toToken, feeBps, slippage, userAddress, owner1, owner2, loadBalances])

  // ── Add custom token ─────────────────────────────────────────────────────────
  const addToken = useCallback(async () => {
    const addr = addAddr.trim()
    if (!ethers.isAddress(addr)) return setAddMsg('Dirección inválida')
    if (allTokens.find(t => t.address.toLowerCase() === addr.toLowerCase())) return setAddMsg('Token ya existe')
    setAddLoading(true); setAddMsg('')
    const meta = await fetchTokenMeta(addr)
    if (!meta) { setAddLoading(false); return setAddMsg('No se pudo leer el token') }
    const newToken: TokenItem = { ...meta, address: addr, color: '#94a3b8', isCustom: true }
    const updated = [...customTokens, newToken]
    setCustomTokens(updated)
    lsSet(LS_CUSTOMS, JSON.stringify(updated))
    setAddAddr(''); setAddMsg(`✓ ${meta.symbol} agregado`)
    setAddLoading(false)
    setTimeout(() => setAddMsg(''), 3000)
  }, [addAddr, customTokens, allTokens])

  // ── Save admin settings ──────────────────────────────────────────────────────
  const saveAdmin = () => {
    lsSet(LS_FEE, String(feeBps))
    lsSet(LS_OWNER1, owner1)
    lsSet(LS_OWNER2, owner2)
    setAdminMsg('✓ Guardado')
    setTimeout(() => setAdminMsg(''), 2000)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const getBalance = (token: TokenItem) => balances[token.address.toLowerCase()] ?? 0n
  const getUsdVal = (token: TokenItem, bal: bigint) => {
    const price = prices[token.address.toLowerCase()]
    if (!price) return null
    const floatBal = parseFloat(ethers.formatUnits(bal, token.decimals))
    return (floatBal * price).toFixed(2)
  }
  const feePercent = (feeBps / 100).toFixed(2)
  const fromAmtNum = parseFloat(fromAmt || '0')
  const feeAmtDisplay = isNaN(fromAmtNum) ? '0' : (fromAmtNum * feeBps / 10000).toFixed(6)

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
            <Repeat2 className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">Acua Swap</h2>
            <p className="text-xs text-muted-foreground">Uniswap V3 · World Chain</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadBalances} disabled={loadingBal} className="text-muted-foreground hover:text-foreground">
            <RefreshCw className={cn('w-4 h-4', loadingBal && 'animate-spin')} />
          </button>
          {/* View toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setView('wallet')}
              className={cn('px-3 py-1 text-xs font-medium transition-colors', view === 'wallet' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            ><Wallet className="w-3.5 h-3.5 inline mr-1" />Tokens</button>
            <button
              onClick={() => setView('swap')}
              className={cn('px-3 py-1 text-xs font-medium transition-colors', view === 'swap' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            ><Repeat2 className="w-3.5 h-3.5 inline mr-1" />Swap</button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════ WALLET VIEW ════════════════════════════ */}
      {view === 'wallet' && (
        <div className="space-y-2">
          {/* Total portfolio value */}
          {Object.keys(prices).length > 0 && (() => {
            let total = 0
            allTokens.forEach(t => {
              const price = prices[t.address.toLowerCase()]
              if (!price) return
              const bal = parseFloat(ethers.formatUnits(getBalance(t), t.decimals))
              total += bal * price
            })
            return total > 0 ? (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor total de cartera</p>
                <p className="text-2xl font-bold font-mono text-primary">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            ) : null
          })()}

          {/* Token cards grid */}
          <div className="space-y-2">
            {loadingBal && Object.keys(balances).length === 0 && (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            )}
            {allTokens.map(token => {
              const bal = getBalance(token)
              const usd = getUsdVal(token, bal)
              const price = prices[token.address.toLowerCase()]
              return (
                <div
                  key={token.address}
                  className="flex items-center gap-3 p-3 rounded-xl border border-border bg-surface-2 hover:border-primary/30 transition-colors cursor-pointer"
                  onClick={() => { setFromToken(token); setView('swap') }}
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: token.color + '22', color: token.color }}>
                    {token.symbol.slice(0, 4)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold text-foreground">{token.symbol}</span>
                      {token.isCustom && <span className="text-[9px] text-muted-foreground border border-border rounded px-1">custom</span>}
                    </div>
                    <span className="text-xs text-muted-foreground">{token.name}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-mono font-semibold text-foreground">
                      {bal === 0n ? '0' : formatToken(bal, token.decimals, 4)}
                    </p>
                    {price && <p className="text-xs text-muted-foreground">${price < 0.01 ? price.toExponential(2) : price.toLocaleString('en-US', { maximumFractionDigits: 4 })}</p>}
                    {usd && parseFloat(usd) > 0 && <p className="text-xs text-green-400 font-mono">${usd}</p>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Add custom token */}
          <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Plus className="w-3 h-3" /> Agregar token por dirección
            </p>
            <div className="flex gap-2">
              <input
                value={addAddr}
                onChange={e => setAddAddr(e.target.value)}
                placeholder="0x... dirección del token"
                className="flex-1 text-xs bg-background border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors font-mono"
              />
              <Button size="sm" className="text-xs h-8 shrink-0" onClick={addToken} disabled={addLoading}>
                {addLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              </Button>
            </div>
            {addMsg && (
              <p className={cn('text-xs font-medium', addMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{addMsg}</p>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════ SWAP VIEW ══════════════════════════════ */}
      {view === 'swap' && (
        <div className="space-y-3">
          {/* Fee info bar */}
          <div className="flex items-center justify-between text-xs text-muted-foreground bg-surface-2 rounded-lg px-3 py-2 border border-border">
            <span className="flex items-center gap-1"><Coins className="w-3 h-3" /> Comisión app: <strong className="text-foreground">{feePercent}%</strong></span>
            <span>Uniswap fee: <strong className="text-foreground">{quote ? (quote.fee / 10000).toFixed(2) + '%' : '…'}</strong></span>
          </div>

          {/* From token */}
          <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">De</span>
              <button
                onClick={() => setFromAmt(ethers.formatUnits(getBalance(fromToken), fromToken.decimals))}
                className="text-xs text-primary hover:underline font-mono"
              >
                Saldo: {formatToken(getBalance(fromToken), fromToken.decimals, 4)}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPickerFor('from')}
                className="flex items-center gap-2 bg-background border border-border rounded-lg px-2.5 py-1.5 hover:border-primary/40 transition-colors shrink-0"
              >
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{ background: fromToken.color + '22', color: fromToken.color }}>{fromToken.symbol.slice(0, 3)}</div>
                <span className="text-xs font-bold">{fromToken.symbol}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </button>
              <input
                type="number"
                min="0"
                step="any"
                value={fromAmt}
                onChange={e => setFromAmt(e.target.value)}
                placeholder="0.0"
                className="flex-1 bg-transparent text-right text-xl font-mono font-bold text-foreground placeholder:text-muted-foreground/40 outline-none"
              />
            </div>
            {fromAmt && parseFloat(fromAmt) > 0 && prices[fromToken.address.toLowerCase()] && (
              <p className="text-xs text-muted-foreground text-right">
                ≈ ${(parseFloat(fromAmt) * prices[fromToken.address.toLowerCase()]).toFixed(2)} USD
              </p>
            )}
          </div>

          {/* Flip button */}
          <div className="flex justify-center">
            <button
              onClick={() => { setFromToken(toToken); setToToken(fromToken); setFromAmt(''); setQuote(null) }}
              className="w-9 h-9 rounded-full border border-border bg-surface-2 flex items-center justify-center hover:border-primary/40 hover:bg-primary/10 transition-colors"
            >
              <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* To token */}
          <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Para</span>
              <span className="text-xs text-muted-foreground font-mono">Saldo: {formatToken(getBalance(toToken), toToken.decimals, 4)}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPickerFor('to')}
                className="flex items-center gap-2 bg-background border border-border rounded-lg px-2.5 py-1.5 hover:border-primary/40 transition-colors shrink-0"
              >
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{ background: toToken.color + '22', color: toToken.color }}>{toToken.symbol.slice(0, 3)}</div>
                <span className="text-xs font-bold">{toToken.symbol}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </button>
              <div className="flex-1 text-right">
                {quoting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />
                ) : quote ? (
                  <span className="text-xl font-mono font-bold text-green-400">
                    {formatToken(quote.amountOut, toToken.decimals, 6)}
                  </span>
                ) : (
                  <span className="text-xl font-mono font-bold text-muted-foreground/40">0.0</span>
                )}
              </div>
            </div>
            {quote && prices[toToken.address.toLowerCase()] && (
              <p className="text-xs text-muted-foreground text-right">
                ≈ ${(parseFloat(ethers.formatUnits(quote.amountOut, toToken.decimals)) * prices[toToken.address.toLowerCase()]).toFixed(2)} USD
              </p>
            )}
          </div>

          {/* Fee breakdown */}
          {fromAmt && parseFloat(fromAmt) > 0 && (
            <div className="rounded-lg border border-border bg-surface-2/50 p-2.5 space-y-1 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Comisión Acua ({feePercent}%)</span>
                <span className="font-mono">{feeAmtDisplay} {fromToken.symbol} <span className="text-muted-foreground/60">(50/50 owners)</span></span>
              </div>
              {quote && (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Fee Uniswap</span>
                    <span>{(quote.fee / 10000).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Slippage máx.</span>
                    <span>{(slippage / 100).toFixed(1)}%</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Slippage selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Slippage:</span>
            {[25, 50, 100].map(s => (
              <button
                key={s}
                onClick={() => setSlippage(s)}
                className={cn('text-xs px-2 py-1 rounded border transition-colors', slippage === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}
              >{(s / 100).toFixed(1)}%</button>
            ))}
          </div>

          {/* No quote warning */}
          {fromAmt && parseFloat(fromAmt) > 0 && !quoting && !quote && (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
              <p className="text-xs text-yellow-400">No se encontró liquidez en Uniswap para este par</p>
            </div>
          )}

          {/* Swap button */}
          <Button
            className="w-full h-12 text-base font-semibold"
            onClick={doSwap}
            disabled={swapping || !quote || !fromAmt || parseFloat(fromAmt) <= 0}
          >
            {swapping ? <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Ejecutando swap…</> : 'Swap'}
          </Button>

          {swapMsg && (
            <p className={cn('text-xs text-center font-medium font-mono', swapMsg.ok ? 'text-green-400' : 'text-red-400')}>
              {swapMsg.text}
            </p>
          )}
        </div>
      )}

      {/* ─── Add token (in swap view too) ─────────────────────────────────── */}
      {view === 'swap' && (
        <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
            <Plus className="w-3 h-3" /> Agregar token personalizado
          </p>
          <div className="flex gap-2">
            <input
              value={addAddr}
              onChange={e => setAddAddr(e.target.value)}
              placeholder="0x... dirección del token"
              className="flex-1 text-xs bg-background border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors font-mono"
            />
            <Button size="sm" className="text-xs h-8 shrink-0" onClick={addToken} disabled={addLoading}>
              {addLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            </Button>
          </div>
          {addMsg && <p className={cn('text-xs font-medium', addMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{addMsg}</p>}
        </div>
      )}

      {/* ─── Admin Panel ─────────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="rounded-xl border border-violet-500/30 overflow-hidden">
          <button
            onClick={() => setAdminOpen(p => !p)}
            className="w-full flex items-center justify-between p-3 bg-violet-500/10 text-left"
          >
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-violet-400" />
              <span className="text-xs font-bold text-violet-400">Admin Swap</span>
            </div>
            {adminOpen ? <ChevronUp className="w-4 h-4 text-violet-400" /> : <ChevronDown className="w-4 h-4 text-violet-400" />}
          </button>

          {adminOpen && (
            <div className="p-3 space-y-4">
              {/* Fee config */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">Comisión de la app (BPS · 100 = 1%)</p>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    value={feeBps}
                    onChange={e => setFeeBps(parseInt(e.target.value) || 0)}
                    className="w-24 text-xs bg-background border border-border rounded-lg px-2 py-1.5 text-foreground outline-none focus:border-primary/60"
                  />
                  <span className="text-xs text-muted-foreground">= {(feeBps / 100).toFixed(2)}% — split 50/50 entre owners</span>
                </div>
              </div>

              {/* Owner 1 */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Owner 1 (recibe 50% fee)</p>
                <input
                  value={owner1}
                  onChange={e => setOwner1(e.target.value)}
                  className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 text-foreground font-mono outline-none focus:border-primary/60"
                  placeholder="0x..."
                />
              </div>

              {/* Owner 2 */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Owner 2 (recibe 50% fee)</p>
                <input
                  value={owner2}
                  onChange={e => setOwner2(e.target.value)}
                  className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 text-foreground font-mono outline-none focus:border-primary/60"
                  placeholder="0x..."
                />
              </div>

              {/* Uniswap info */}
              <div className="rounded-lg bg-surface-2 border border-border p-2.5 space-y-1 text-xs">
                <p className="font-semibold text-muted-foreground">Direcciones Uniswap V3</p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SwapRouter02</span>
                  <span className="font-mono text-foreground">{shortenAddress(UNISWAP_V3_ROUTER)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">QuoterV2</span>
                  <span className="font-mono text-foreground">{shortenAddress(UNISWAP_V3_QUOTER)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Red</span>
                  <span className="text-foreground">World Chain (480)</span>
                </div>
              </div>

              <Button size="sm" className="w-full text-xs bg-violet-600 hover:bg-violet-500" onClick={saveAdmin}>
                <Check className="w-3 h-3 mr-1" /> Guardar configuración
              </Button>
              {adminMsg && <p className="text-xs text-center text-green-400 font-medium">{adminMsg}</p>}
            </div>
          )}
        </div>
      )}

      {/* Token picker modal */}
      {pickerFor && (
        <TokenPicker
          tokens={allTokens}
          exclude={pickerFor === 'from' ? toToken.address : fromToken.address}
          onSelect={t => pickerFor === 'from' ? setFromToken(t) : setToToken(t)}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  )
}
