'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  Wallet, RefreshCw, Copy, Check, ExternalLink, Loader2,
  Send, QrCode, History, ArrowUpRight, ArrowDownLeft,
  ArrowLeftRight, ChevronDown, Info, CheckCircle2, XCircle,
} from 'lucide-react'
import { BNB_TOKENS, BNB_RPC, ERC20_ABI } from '@/lib/sushibnb-abi'
import { useLang } from '@/context/lang-context'
import { cn } from '@/lib/utils'
import type { WalletMode } from '@/lib/tx-signer'

// ── MiniKit JSON ABIs (for BNB signing via World Wallet) ───────────────────────
const MK_ERC20_TRANSFER = [{ name: 'transfer', type: 'function', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }]
const MK_ERC20_APPROVE  = [{ name: 'approve',  type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }]
const MK_SWAP_ETH_FOR_TOKENS   = [{ name: 'swapExactETHForTokens',   type: 'function', stateMutability: 'payable', inputs: [{ name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }], outputs: [{ name: '', type: 'uint256[]' }] }]
const MK_SWAP_TOKENS_FOR_ETH   = [{ name: 'swapExactTokensForETH',   type: 'function', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }], outputs: [{ name: '', type: 'uint256[]' }] }]
const MK_SWAP_TOKENS_FOR_TOKENS= [{ name: 'swapExactTokensForTokens',type: 'function', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }], outputs: [{ name: '', type: 'uint256[]' }] }]

// ── PancakeSwap V2 ─────────────────────────────────────────────────────────────
const PANCAKE_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E'
const WBNB       = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
const NATIVE     = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const BSCSCAN    = 'https://bscscan.com'
const GAS_WEI    = 1_100_000_000n // 1.1 gwei

const ROUTER_ABI = [
  'function getAmountsOut(uint256, address[]) view returns (uint256[])',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])',
]

// ── Types ──────────────────────────────────────────────────────────────────────
type WalletView = 'balances' | 'send' | 'receive' | 'history' | 'swap'
type HistView   = 'all' | 'bnb' | 'tokens'

interface TxStep {
  label:  string
  hash?:  string
  done?:  boolean
  error?: string
}

interface HistoryTx {
  hash:       string
  type:       'send' | 'receive'
  symbol:     string
  value:      string
  timeStamp:  string
  from:       string
  to:         string
  isError:    string
}

interface BNBWalletPanelProps {
  bnbAddress:     string | null
  bnbPrivateKey?: string | null
  walletMode?:    WalletMode
}

// ── Token helpers ──────────────────────────────────────────────────────────────
const TOKENS = BNB_TOKENS.map(t => ({ ...t, address: t.address }))

function getToken(symbol: string) {
  return TOKENS.find(t => t.symbol === symbol) ?? TOKENS[0]
}

function fmtAmt(v: bigint, dec: number) {
  const n = parseFloat(ethers.formatUnits(v, dec))
  if (n === 0) return '0.00'
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 0.01) return n.toFixed(4)
  return n.toFixed(6)
}

function timeAgo(ts: string): string {
  const diff = Math.floor(Date.now() / 1000) - parseInt(ts)
  if (diff < 60)    return `${diff}s`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function TxStepView({ step }: { step: TxStep | null }) {
  if (!step) return null
  return (
    <div className={cn('rounded-xl border px-3 py-2.5 space-y-1.5',
      step.error  ? 'border-red-500/30 bg-red-500/8'
      : step.done ? 'border-emerald-500/30 bg-emerald-500/8'
      : 'border-blue-500/30 bg-blue-500/8'
    )}>
      <div className="flex items-center gap-2">
        {step.error  ? <XCircle className="w-4 h-4 text-red-400 shrink-0" />
         : step.done ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
         : <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />}
        <p className={cn('text-[10px] font-bold leading-snug',
          step.error ? 'text-red-400' : step.done ? 'text-emerald-400' : 'text-blue-300'
        )}>{step.label}</p>
      </div>
      {step.hash && (
        <a href={`${BSCSCAN}/tx/${step.hash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[8px] font-mono text-[oklch(0.45_0.01_230)] hover:text-blue-400 transition-colors">
          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
          {step.hash.slice(0, 14)}…{step.hash.slice(-6)}
        </a>
      )}
      {step.error && <p className="text-[9px] text-red-300 leading-relaxed">{step.error}</p>}
    </div>
  )
}

function TokenSelect({ value, onChange, exclude }: { value: string; onChange: (v: string) => void; exclude?: string }) {
  const [open, setOpen] = useState(false)
  const tk = getToken(value)
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] text-[11px] font-bold text-foreground hover:bg-[oklch(0.18_0.025_245)] transition-colors">
        <Image src={tk.logoUrl} alt={tk.symbol} width={16} height={16} className="rounded-full" unoptimized />
        {tk.symbol}
        <ChevronDown className={cn('w-3 h-3 text-[oklch(0.45_0.01_230)] transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.12_0.02_245)] z-30 shadow-xl min-w-[130px] overflow-hidden">
          {TOKENS.filter(t => t.symbol !== exclude).map(t => (
            <button key={t.symbol} onClick={() => { onChange(t.symbol); setOpen(false) }}
              className={cn('w-full flex items-center gap-2 px-3 py-2 text-[10px] hover:bg-white/5 transition-colors', value === t.symbol && 'bg-white/8')}>
              <Image src={t.logoUrl} alt={t.symbol} width={14} height={14} className="rounded-full" unoptimized />
              <span className="font-bold text-foreground">{t.symbol}</span>
              <span className="text-[oklch(0.40_0.01_230)] ml-auto text-[7px] truncate">{t.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export function BNBWalletPanel({ bnbAddress, bnbPrivateKey, walletMode }: BNBWalletPanelProps) {
  const { lang } = useLang()
  const [view, setView] = useState<WalletView>('balances')

  // Balances
  const [balances, setBalances] = useState(BNB_TOKENS.map(tk => ({ ...tk, balance: 0n, loading: false })))
  const [loading, setLoading]   = useState(false)
  const [copied, setCopied]     = useState(false)

  // Send
  const [sendToken, setSendToken]     = useState('BNB')
  const [sendTo, setSendTo]           = useState('')
  const [sendAmt, setSendAmt]         = useState('')
  const [sendStep, setSendStep]       = useState<TxStep | null>(null)
  const [sendPending, setSendPending] = useState(false)

  // Swap
  const [swapFrom, setSwapFrom]           = useState('BNB')
  const [swapTo, setSwapTo]               = useState('SUSHI')
  const [swapAmt, setSwapAmt]             = useState('')
  const [swapOut, setSwapOut]             = useState<string | null>(null)
  const [swapStep, setSwapStep]           = useState<TxStep | null>(null)
  const [swapPending, setSwapPending]     = useState(false)
  const [swapOutRaw, setSwapOutRaw]       = useState<bigint | null>(null)
  const [quoteLoading, setQuoteLoading]   = useState(false)

  // History
  const [histNormal, setHistNormal]   = useState<HistoryTx[]>([])
  const [histTokens, setHistTokens]   = useState<HistoryTx[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const [histView, setHistView]       = useState<HistView>('all')

  // ── Signer ─────────────────────────────────────────────────────────────────
  const getSigner = () => {
    if (!bnbPrivateKey) throw new Error('Sin clave BNB — abre el selector de redes (↗) para conectar tu wallet.')
    const provider = new ethers.JsonRpcProvider(BNB_RPC)
    provider.getFeeData = async () => new ethers.FeeData(null, null, GAS_WEI)
    return new ethers.Wallet(bnbPrivateKey, provider)
  }

  // ── Load balances ──────────────────────────────────────────────────────────
  const loadBalances = useCallback(async (addr: string) => {
    setLoading(true)
    try {
      const provider = new ethers.JsonRpcProvider(BNB_RPC)
      const updated = await Promise.all(
        BNB_TOKENS.map(async tk => {
          try {
            const bal = tk.address === NATIVE
              ? await provider.getBalance(addr)
              : await new ethers.Contract(tk.address, ERC20_ABI, provider).balanceOf(addr)
            return { ...tk, balance: bal as bigint, loading: false }
          } catch {
            return { ...tk, balance: 0n, loading: false }
          }
        })
      )
      setBalances(updated)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (bnbAddress) loadBalances(bnbAddress) }, [bnbAddress, loadBalances])

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  const doSend = async () => {
    if (!sendTo || !sendAmt || sendPending) return
    setSendPending(true)
    setSendStep({ label: 'Preparando…' })
    try {
      const tk = getToken(sendToken)

      if (isMiniKit) {
        setSendStep({ label: `Enviando ${sendAmt} ${tk.symbol} via World Wallet…` })
        let txList: object[]
        if (tk.address === NATIVE) {
          // BNB native transfer — MiniKit can't do raw ETH send directly, use a minimal payable call
          // Fall back: send as a value-bearing empty tx by wrapping in a dummy call.
          // Most World App versions support native value sends.
          txList = [{ address: sendTo, abi: [{ name: 'transfer', type: 'receive', stateMutability: 'payable', inputs: [], outputs: [] }], functionName: 'transfer', args: [], value: ethers.parseEther(sendAmt).toString() }]
        } else {
          txList = [{ address: tk.address, abi: MK_ERC20_TRANSFER, functionName: 'transfer', args: [sendTo, ethers.parseUnits(sendAmt, tk.decimals).toString()] }]
        }
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({ transaction: txList as any })
        if ((finalPayload as any).status === 'success') {
          setSendStep({ label: `✓ ${sendAmt} ${tk.symbol} enviados`, done: true })
          setSendAmt(''); setSendTo('')
          if (bnbAddress) loadBalances(bnbAddress)
        } else {
          setSendStep({ label: 'Error', error: (finalPayload as any).message ?? 'Transacción rechazada' })
        }
        return
      }

      const signer = getSigner()
      if (tk.address === NATIVE) {
        setSendStep({ label: `Enviando ${sendAmt} BNB…` })
        const tx = await signer.sendTransaction({
          to: sendTo, value: ethers.parseEther(sendAmt.replace(',', '.')), gasLimit: 21_000n, gasPrice: GAS_WEI,
        })
        setSendStep({ label: 'Confirmando…', hash: tx.hash })
        await tx.wait()
        setSendStep({ label: `✓ ${sendAmt} BNB enviados`, done: true })
      } else {
        setSendStep({ label: `Enviando ${sendAmt} ${tk.symbol}…` })
        const c = new ethers.Contract(tk.address, ERC20_ABI, signer)
        const tx = await c.transfer(sendTo, ethers.parseUnits(sendAmt.replace(',', '.'), tk.decimals), {
          gasLimit: 65_000n, gasPrice: GAS_WEI,
        })
        setSendStep({ label: 'Confirmando…', hash: tx.hash })
        await tx.wait()
        setSendStep({ label: `✓ ${sendAmt} ${tk.symbol} enviados`, done: true })
      }
      setSendAmt(''); setSendTo('')
      if (bnbAddress) loadBalances(bnbAddress)
    } catch (e: any) {
      const msg = (e?.shortMessage ?? e?.message ?? 'Error desconocido').slice(0, 160)
      setSendStep({ label: 'Error', error: msg })
    } finally {
      setSendPending(false)
    }
  }

  // ── Quote ──────────────────────────────────────────────────────────────────
  const getQuote = useCallback(async (fromSym: string, toSym: string, amtIn: string) => {
    if (!amtIn || parseFloat(amtIn) <= 0 || fromSym === toSym) { setSwapOut(null); return }
    setQuoteLoading(true)
    try {
      const provider = new ethers.JsonRpcProvider(BNB_RPC)
      const router   = new ethers.Contract(PANCAKE_V2, ROUTER_ABI, provider)
      const fromAddr = getToken(fromSym).address === NATIVE ? WBNB : getToken(fromSym).address
      const toAddr   = getToken(toSym).address   === NATIVE ? WBNB : getToken(toSym).address
      if (fromAddr === toAddr) { setSwapOut(null); setSwapOutRaw(null); return }
      const path = (fromAddr === WBNB || toAddr === WBNB) ? [fromAddr, toAddr] : [fromAddr, WBNB, toAddr]
      const amounts = await router.getAmountsOut(
        ethers.parseUnits(amtIn, getToken(fromSym).decimals), path
      )
      const outRaw = BigInt(amounts[amounts.length - 1])
      setSwapOutRaw(outRaw)
      setSwapOut(parseFloat(ethers.formatUnits(outRaw, getToken(toSym).decimals)).toFixed(6))
    } catch { setSwapOut(null); setSwapOutRaw(null) }
    finally { setQuoteLoading(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => { if (swapAmt) getQuote(swapFrom, swapTo, swapAmt) }, 600)
    return () => clearTimeout(t)
  }, [swapAmt, swapFrom, swapTo, getQuote])

  // ── Swap ───────────────────────────────────────────────────────────────────
  const doSwap = async () => {
    if (!swapAmt || !swapOut || swapPending || swapFrom === swapTo) return
    setSwapPending(true)
    setSwapStep({ label: 'Preparando swap…' })
    try {
      const fromTk   = getToken(swapFrom)
      const toTk     = getToken(swapTo)
      const fromAddr = fromTk.address === NATIVE ? WBNB : fromTk.address
      const toAddr   = toTk.address   === NATIVE ? WBNB : toTk.address
      const path     = (fromAddr === WBNB || toAddr === WBNB) ? [fromAddr, toAddr] : [fromAddr, WBNB, toAddr]
      const deadline = Math.floor(Date.now() / 1000) + 1200
      const amtIn    = ethers.parseUnits(swapAmt.replace(',', '.'), fromTk.decimals)
      const rawOut   = swapOutRaw ?? ethers.parseUnits(parseFloat(swapOut ?? '0').toFixed(6), toTk.decimals)
      const amtOutMin = rawOut * 98n / 100n
      const dest     = bnbAddress!

      if (isMiniKit) {
        const txList: object[] = []
        // Check approval for non-native tokens
        if (fromTk.address !== NATIVE) {
          const provider = new ethers.JsonRpcProvider(BNB_RPC)
          const erc20 = new ethers.Contract(fromTk.address, ERC20_ABI, provider)
          const allow: bigint = await erc20.allowance(dest, PANCAKE_V2)
          if (allow < amtIn) {
            txList.push({ address: fromTk.address, abi: MK_ERC20_APPROVE, functionName: 'approve', args: [PANCAKE_V2, ethers.MaxUint256.toString()] })
          }
        }
        setSwapStep({ label: `Swap ${swapAmt} ${fromTk.symbol} → ${toTk.symbol} via World Wallet…` })
        if (fromTk.address === NATIVE) {
          txList.push({ address: PANCAKE_V2, abi: MK_SWAP_ETH_FOR_TOKENS, functionName: 'swapExactETHForTokens', args: [amtOutMin.toString(), path, dest, deadline.toString()], value: amtIn.toString() })
        } else if (toTk.address === NATIVE) {
          txList.push({ address: PANCAKE_V2, abi: MK_SWAP_TOKENS_FOR_ETH, functionName: 'swapExactTokensForETH', args: [amtIn.toString(), amtOutMin.toString(), path, dest, deadline.toString()] })
        } else {
          txList.push({ address: PANCAKE_V2, abi: MK_SWAP_TOKENS_FOR_TOKENS, functionName: 'swapExactTokensForTokens', args: [amtIn.toString(), amtOutMin.toString(), path, dest, deadline.toString()] })
        }
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({ transaction: txList as any })
        if ((finalPayload as any).status === 'success') {
          setSwapStep({ label: `✓ Swap: ${swapAmt} ${fromTk.symbol} → ~${swapOut} ${toTk.symbol}`, done: true })
          setSwapAmt(''); setSwapOut(null); setSwapOutRaw(null)
          if (bnbAddress) loadBalances(bnbAddress)
        } else {
          setSwapStep({ label: 'Error', error: (finalPayload as any).message ?? 'Transacción rechazada' })
        }
        return
      }

      const signer = getSigner()
      const router = new ethers.Contract(PANCAKE_V2, ROUTER_ABI, signer)

      if (fromTk.address !== NATIVE) {
        const erc20 = new ethers.Contract(fromTk.address, ERC20_ABI, signer)
        const allow: bigint = await erc20.allowance(dest, PANCAKE_V2)
        if (allow < amtIn) {
          setSwapStep({ label: `Aprobando ${fromTk.symbol}…` })
          const appTx = await erc20.approve(PANCAKE_V2, ethers.MaxUint256, { gasLimit: 50_000n, gasPrice: GAS_WEI })
          setSwapStep({ label: 'Aprobando…', hash: appTx.hash })
          await appTx.wait()
        }
      }

      setSwapStep({ label: `Swap ${swapAmt} ${fromTk.symbol} → ${toTk.symbol}…` })
      let tx
      if (fromTk.address === NATIVE) {
        tx = await router.swapExactETHForTokens(amtOutMin, path, dest, deadline, { value: amtIn, gasLimit: 200_000n, gasPrice: GAS_WEI })
      } else if (toTk.address === NATIVE) {
        tx = await router.swapExactTokensForETH(amtIn, amtOutMin, path, dest, deadline, { gasLimit: 200_000n, gasPrice: GAS_WEI })
      } else {
        tx = await router.swapExactTokensForTokens(amtIn, amtOutMin, path, dest, deadline, { gasLimit: 350_000n, gasPrice: GAS_WEI })
      }
      setSwapStep({ label: 'Confirmando swap…', hash: tx.hash })
      await tx.wait()
      setSwapStep({ label: `✓ Swap: ${swapAmt} ${fromTk.symbol} → ~${swapOut} ${toTk.symbol}`, done: true })
      setSwapAmt(''); setSwapOut(null); setSwapOutRaw(null)
      if (bnbAddress) loadBalances(bnbAddress)
    } catch (e: any) {
      const msg = (e?.shortMessage ?? e?.message ?? 'Error').slice(0, 160)
      setSwapStep({ label: 'Error', error: msg })
    } finally {
      setSwapPending(false)
    }
  }

  // ── History (BSCScan free API) ─────────────────────────────────────────────
  const loadHistory = useCallback(async (addr: string) => {
    setHistLoading(true)
    try {
      const [r1, r2] = await Promise.all([
        fetch(`https://api.bscscan.com/api?module=account&action=txlist&address=${addr}&page=1&offset=20&sort=desc`).then(r => r.json()),
        fetch(`https://api.bscscan.com/api?module=account&action=tokentx&address=${addr}&page=1&offset=20&sort=desc`).then(r => r.json()),
      ])
      const al = addr.toLowerCase()
      const bnbTxs: HistoryTx[] = (Array.isArray(r1.result) ? r1.result : [])
        .filter((t: any) => parseFloat(t.value) > 0)
        .map((t: any) => ({
          hash: t.hash, type: t.from.toLowerCase() === al ? 'send' : 'receive',
          symbol: 'BNB', value: parseFloat(ethers.formatEther(t.value)).toFixed(4),
          timeStamp: t.timeStamp, from: t.from, to: t.to, isError: t.isError,
        }))
      const tokenTxs: HistoryTx[] = (Array.isArray(r2.result) ? r2.result : [])
        .map((t: any) => ({
          hash: t.hash, type: t.from.toLowerCase() === al ? 'send' : 'receive',
          symbol: t.tokenSymbol ?? '?',
          value: parseFloat(ethers.formatUnits(t.value ?? '0', parseInt(t.tokenDecimal ?? '18'))).toFixed(4),
          timeStamp: t.timeStamp, from: t.from, to: t.to, isError: '0',
        }))
      setHistNormal(bnbTxs)
      setHistTokens(tokenTxs)
    } catch { setHistNormal([]); setHistTokens([]) }
    finally { setHistLoading(false) }
  }, [])

  // ── No wallet ──────────────────────────────────────────────────────────────
  if (!bnbAddress) return (
    <div className="space-y-4 pb-24">
      <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-6 text-center space-y-3">
        <Wallet className="w-10 h-10 text-[#f0b90b] mx-auto opacity-60" />
        <p className="text-sm font-bold text-foreground">Wallet BNB no conectada</p>
        <p className="text-[10px] text-[oklch(0.50_0.012_230)]">
          Importa una wallet en la sección de redes para ver tus balances en BNB Chain.
        </p>
      </div>
    </div>
  )

  const isMiniKit  = false  // MiniKit cannot sign BNB Chain (chainId 56) transactions
  const noKey      = !bnbPrivateKey
  const sendBal    = balances.find(b => b.symbol === sendToken)?.balance ?? 0n
  const swapFromBal = balances.find(b => b.symbol === swapFrom)?.balance ?? 0n
  const allHist    = [...histNormal, ...histTokens].sort((a, b) => parseInt(b.timeStamp) - parseInt(a.timeStamp))
  const displayHist = histView === 'all' ? allHist : histView === 'bnb' ? histNormal : histTokens

  return (
    <div className="space-y-4 pb-24">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[#f0b90b]/30 bg-[#f0b90b]/5 p-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl overflow-hidden border-2 border-[#f0b90b]/40 shrink-0">
            <Image src="https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" alt="BNB" width={40} height={40} className="w-full h-full object-cover" unoptimized />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold text-[#f0b90b]/80 uppercase tracking-wider">Wallet BNB Chain · Exchange</p>
            <p className="text-[9px] font-mono text-foreground truncate">{bnbAddress}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => copy(bnbAddress)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-[oklch(0.45_0.01_230)]" />}
            </button>
            <a href={`${BSCSCAN}/address/${bnbAddress}`} target="_blank" rel="noopener noreferrer"
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
              <ExternalLink className="w-3.5 h-3.5 text-[oklch(0.45_0.01_230)]" />
            </a>
            <button onClick={() => loadBalances(bnbAddress)} disabled={loading}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50 transition-colors">
              <RefreshCw className={cn('w-3.5 h-3.5 text-[oklch(0.45_0.01_230)]', loading && 'animate-spin')} />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[8px] text-[oklch(0.45_0.01_230)]">{isMiniKit ? '🌐 World Wallet · MiniKit' : noKey ? '👁 Solo lectura' : '🔑 Clave privada BNB activa'}</span>
          <span className="text-[8px] text-[oklch(0.35_0.01_230)]">PancakeSwap V2 · BSCScan</span>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-1 gap-0.5">
        {([
          { id: 'balances' as const, label: '💰 Saldo'   },
          { id: 'send'     as const, label: '📤 Enviar'   },
          { id: 'receive'  as const, label: '📥 Recibir'  },
          { id: 'history'  as const, label: '🕑 Historial' },
          { id: 'swap'     as const, label: '🔄 Swap'     },
        ]).map(tab => (
          <button key={tab.id} onClick={() => {
            setView(tab.id)
            if (tab.id === 'history' && bnbAddress && !histLoading && allHist.length === 0) {
              loadHistory(bnbAddress)
            }
          }}
            className={cn('flex-1 py-1.5 rounded-lg text-[8px] font-bold transition-colors whitespace-nowrap',
              view === tab.id ? 'text-black' : 'text-[oklch(0.45_0.01_230)] hover:text-foreground')}
            style={view === tab.id ? { background: '#f0b90b' } : {}}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════ BALANCES ═══════════════════════════════════════════════════ */}
      {view === 'balances' && (
        <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[oklch(0.18_0.02_245)]">
            <p className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Tokens en BNB Chain</p>
          </div>
          <div className="divide-y divide-[oklch(0.15_0.02_245)]">
            {balances.map(tk => (
              <div key={tk.address} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 border-2" style={{ borderColor: `${tk.color}40` }}>
                  <Image src={tk.logoUrl} alt={tk.symbol} width={36} height={36} className="w-full h-full object-cover" unoptimized />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground">{tk.symbol}</p>
                  <p className="text-[9px] text-[oklch(0.45_0.01_230)]">{tk.name}</p>
                </div>
                <div className="text-right">
                  {loading
                    ? <Loader2 className="w-4 h-4 animate-spin text-[oklch(0.45_0.01_230)]" />
                    : <p className="text-sm font-bold font-mono" style={{ color: tk.color }}>{fmtAmt(tk.balance, tk.decimals)}</p>}
                  <p className="text-[8px] text-[oklch(0.40_0.01_230)]">{tk.symbol}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-[oklch(0.15_0.02_245)] flex justify-center">
            <a href={`${BSCSCAN}/address/${bnbAddress}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[9px] text-[oklch(0.45_0.01_230)] hover:text-[#f0b90b] transition-colors">
              <ExternalLink className="w-3 h-3" /> Ver en BSCScan
            </a>
          </div>
        </div>
      )}

      {/* ════ SEND ════════════════════════════════════════════════════════ */}
      {view === 'send' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-4">
            <p className="text-xs font-bold text-foreground">Enviar tokens BNB Chain</p>

            {/* Token */}
            <div className="space-y-1.5">
              <p className="text-[9px] text-[oklch(0.45_0.01_230)]">Token</p>
              <div className="flex items-center gap-3">
                <TokenSelect value={sendToken} onChange={t => { setSendToken(t); setSendStep(null) }} />
                <span className="text-[8px] text-[oklch(0.45_0.01_230)]">
                  Balance: <span className="font-bold text-foreground">{fmtAmt(sendBal, getToken(sendToken).decimals)}</span>
                </span>
              </div>
            </div>

            {/* Recipient */}
            <div className="space-y-1.5">
              <p className="text-[9px] text-[oklch(0.45_0.01_230)]">Dirección destino (BNB Chain)</p>
              <input value={sendTo} onChange={e => setSendTo(e.target.value)} placeholder="0x..."
                className="w-full bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-2.5 text-[10px] font-mono text-foreground focus:outline-none focus:border-[#f0b90b]/50 placeholder:text-[oklch(0.35_0.01_230)]" />
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <p className="text-[9px] text-[oklch(0.45_0.01_230)]">Cantidad</p>
              <div className="relative">
                <input value={sendAmt} onChange={e => setSendAmt(e.target.value)} type="number"
                  placeholder={`0.0 ${sendToken}`}
                  className="w-full bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:border-[#f0b90b]/50 placeholder:text-[oklch(0.35_0.01_230)]" />
                <button onClick={() => setSendAmt(ethers.formatUnits(sendBal, getToken(sendToken).decimals))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-[#f0b90b] hover:text-yellow-300">MAX</button>
              </div>
            </div>

            {/* Gas note */}
            <div className="flex items-center gap-1.5 text-[8px] text-[oklch(0.45_0.01_230)]">
              <Info className="w-3 h-3 shrink-0" />
              {sendToken === 'BNB' ? 'Gas: ~0.000021 BNB (transferencia nativa)' : `Gas: ~0.000065 BNB (ERC20 transfer)`}
            </div>

            <TxStepView step={sendStep} />

            <button onClick={doSend} disabled={sendPending || !sendTo || !sendAmt || parseFloat(sendAmt) <= 0}
              className="w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(135deg, #f0b90b, #d4900a)', color: '#000' }}>
              {sendPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              ENVIAR {sendToken}
            </button>

          </div>
        </div>
      )}

      {/* ════ RECEIVE ═════════════════════════════════════════════════════ */}
      {view === 'receive' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-5 space-y-4 text-center">
            <p className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Recibir tokens · BNB Chain</p>

            {/* QR Code */}
            <div className="flex justify-center">
              <div className="p-3 bg-white rounded-2xl shadow-xl inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(bnbAddress)}&bgcolor=ffffff&color=000000&qzone=2`}
                  alt="QR Code"
                  width={180} height={180}
                  className="rounded-lg block"
                />
              </div>
            </div>

            {/* Address */}
            <div className="rounded-xl bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] p-3">
              <p className="text-[8px] text-[oklch(0.45_0.01_230)] mb-1.5">Tu dirección BNB Chain</p>
              <p className="text-[9px] font-mono text-foreground break-all leading-relaxed">{bnbAddress}</p>
            </div>

            {/* Copy */}
            <button onClick={() => copy(bnbAddress)}
              className="w-full py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all"
              style={{ background: copied ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #f0b90b, #d4900a)', color: copied ? 'white' : '#000' }}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? '¡Dirección Copiada!' : 'Copiar Dirección'}
            </button>

            {/* QR button */}
            <button onClick={() => {
              const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(bnbAddress)}`
              window.open(qrUrl, '_blank')
            }}
              className="w-full py-2 rounded-xl text-[9px] font-bold flex items-center justify-center gap-1.5 border border-[oklch(0.22_0.025_245)] bg-[oklch(0.14_0.02_245)] text-[oklch(0.60_0.01_230)] hover:bg-[oklch(0.18_0.025_245)] transition-colors">
              <QrCode className="w-3.5 h-3.5" /> Ver QR en tamaño grande
            </button>

            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 text-left">
              <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[8px] text-amber-300 leading-relaxed">
                Envía solo tokens de <strong>BNB Chain (BSC, Chain ID 56)</strong> a esta dirección. No envíes desde otras redes sin usar el bridge primero.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ════ HISTORY ═════════════════════════════════════════════════════ */}
      {view === 'history' && (
        <div className="space-y-3">
          {/* Sub-tabs */}
          <div className="flex rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-1 gap-1">
            {[
              { id: 'all' as HistView,    label: 'Todo' },
              { id: 'bnb' as HistView,    label: '⬡ BNB' },
              { id: 'tokens' as HistView, label: '🪙 Tokens' },
            ].map(s => (
              <button key={s.id} onClick={() => setHistView(s.id)}
                className={cn('flex-1 py-1.5 rounded-lg text-[9px] font-bold transition-colors',
                  histView === s.id ? 'text-black' : 'text-[oklch(0.45_0.01_230)]')}
                style={histView === s.id ? { background: '#f0b90b' } : {}}>
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex justify-between items-center">
            <p className="text-[9px] text-[oklch(0.45_0.01_230)]">Últimas 20 txs · BSCScan API</p>
            <button onClick={() => bnbAddress && loadHistory(bnbAddress)} disabled={histLoading}
              className="flex items-center gap-1 text-[8px] text-[oklch(0.45_0.01_230)] hover:text-foreground transition-colors">
              <RefreshCw className={cn('w-3 h-3', histLoading && 'animate-spin')} />
              Actualizar
            </button>
          </div>

          {histLoading ? (
            <div className="py-10 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-[#f0b90b] mx-auto" />
              <p className="text-[9px] text-[oklch(0.45_0.01_230)] mt-2">Cargando historial…</p>
            </div>
          ) : displayHist.length === 0 ? (
            <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-8 text-center space-y-2">
              <p className="text-3xl">🕑</p>
              <p className="text-[10px] font-bold text-[oklch(0.50_0.012_230)]">Sin historial</p>
              <p className="text-[9px] text-[oklch(0.40_0.01_230)]">Toca "Actualizar" para cargar tus transacciones</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayHist.map((tx, i) => (
                <a key={tx.hash + i} href={`${BSCSCAN}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] hover:bg-[oklch(0.12_0.02_245)] transition-colors group">
                  <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                    tx.isError === '1' ? 'bg-red-500/15' : tx.type === 'send' ? 'bg-amber-500/15' : 'bg-emerald-500/15')}>
                    {tx.isError === '1'
                      ? <XCircle className="w-4 h-4 text-red-400" />
                      : tx.type === 'send'
                      ? <ArrowUpRight className="w-4 h-4 text-amber-400" />
                      : <ArrowDownLeft className="w-4 h-4 text-emerald-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('text-[9px] font-bold',
                        tx.isError === '1' ? 'text-red-400' : tx.type === 'send' ? 'text-amber-400' : 'text-emerald-400')}>
                        {tx.isError === '1' ? 'Error' : tx.type === 'send' ? 'Enviado' : 'Recibido'}
                      </span>
                      <span className="text-[8px] text-[oklch(0.40_0.01_230)]">{timeAgo(tx.timeStamp)}</span>
                    </div>
                    <p className="text-[8px] font-mono text-[oklch(0.40_0.01_230)] truncate">
                      {tx.type === 'send' ? `→ ${tx.to?.slice(0,10)}…` : `← ${tx.from?.slice(0,10)}…`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn('text-xs font-bold font-mono',
                      tx.isError === '1' ? 'text-red-400' : tx.type === 'send' ? 'text-amber-400' : 'text-emerald-400')}>
                      {tx.type === 'send' ? '−' : '+'}{tx.value}
                    </p>
                    <p className="text-[8px] text-[oklch(0.40_0.01_230)]">{tx.symbol}</p>
                  </div>
                  <ExternalLink className="w-3 h-3 text-[oklch(0.35_0.01_230)] group-hover:text-blue-400 transition-colors shrink-0" />
                </a>
              ))}
            </div>
          )}

          {allHist.length > 0 && (
            <a href={`${BSCSCAN}/address/${bnbAddress}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 py-2 text-[9px] text-[oklch(0.45_0.01_230)] hover:text-[#f0b90b] transition-colors">
              <ExternalLink className="w-3 h-3" /> Historial completo en BSCScan
            </a>
          )}
        </div>
      )}

      {/* ════ SWAP ════════════════════════════════════════════════════════ */}
      {view === 'swap' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-foreground">Swap · PancakeSwap V2</p>
              <span className="text-[8px] text-[oklch(0.45_0.01_230)] px-2 py-0.5 rounded-full bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)]">Slippage 2%</span>
            </div>

            {/* From */}
            <div className="rounded-xl bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[9px] text-[oklch(0.45_0.01_230)]">De</p>
                <span className="text-[8px] text-[oklch(0.45_0.01_230)]">
                  Balance: <span className="font-bold">{fmtAmt(swapFromBal, getToken(swapFrom).decimals)}</span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <TokenSelect value={swapFrom} onChange={t => { setSwapFrom(t); setSwapOut(null); setSwapOutRaw(null); setSwapStep(null) }} exclude={swapTo} />
                <div className="flex-1 relative">
                  <input value={swapAmt} onChange={e => setSwapAmt(e.target.value)} type="number" placeholder="0.0"
                    className="w-full bg-transparent text-lg font-bold font-mono text-foreground focus:outline-none placeholder:text-[oklch(0.30_0.01_230)]" />
                  <button onClick={() => setSwapAmt(ethers.formatUnits(swapFromBal, getToken(swapFrom).decimals))}
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-[8px] font-bold text-[#f0b90b]">MAX</button>
                </div>
              </div>
            </div>

            {/* Direction toggle */}
            <div className="flex justify-center">
              <button onClick={() => {
                const t = swapFrom; setSwapFrom(swapTo); setSwapTo(t)
                setSwapOut(null); setSwapOutRaw(null); setSwapStep(null)
              }}
                className="w-9 h-9 rounded-xl bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] flex items-center justify-center hover:bg-[oklch(0.18_0.025_245)] hover:border-[#f0b90b]/40 transition-all">
                <ArrowLeftRight className="w-4 h-4 text-[#f0b90b]" />
              </button>
            </div>

            {/* To */}
            <div className="rounded-xl bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] p-3 space-y-2">
              <p className="text-[9px] text-[oklch(0.45_0.01_230)]">A</p>
              <div className="flex items-center gap-3">
                <TokenSelect value={swapTo} onChange={t => { setSwapTo(t); setSwapOut(null); setSwapOutRaw(null); setSwapStep(null) }} exclude={swapFrom} />
                <div className="text-lg font-bold font-mono text-emerald-400 min-h-[28px] flex items-center">
                  {quoteLoading
                    ? <Loader2 className="w-4 h-4 animate-spin text-[oklch(0.45_0.01_230)]" />
                    : swapOut ?? '0.0'}
                </div>
              </div>
            </div>

            {/* Rate info */}
            {swapOut && swapAmt && parseFloat(swapAmt) > 0 && (
              <div className="rounded-xl bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] px-3 py-2 space-y-1 text-[8px]">
                <div className="flex justify-between">
                  <span className="text-[oklch(0.45_0.01_230)]">Tasa</span>
                  <span className="font-mono">1 {swapFrom} = {(parseFloat(swapOut) / parseFloat(swapAmt)).toFixed(4)} {swapTo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[oklch(0.45_0.01_230)]">Mínimo recibido (2% slip)</span>
                  <span className="font-mono text-emerald-400">{(parseFloat(swapOut) * 0.98).toFixed(4)} {swapTo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[oklch(0.45_0.01_230)]">Gas estimado</span>
                  <span className="font-mono text-[#f0b90b]">~0.000200 BNB</span>
                </div>
              </div>
            )}

            <TxStepView step={swapStep} />

            <button onClick={doSwap}
              disabled={swapPending || !swapAmt || !swapOut || parseFloat(swapAmt) <= 0 || swapFrom === swapTo}
              className="w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(135deg, #f0b90b, #d4900a)', color: '#000' }}>
              {swapPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
              SWAP {swapFrom} → {swapTo}
            </button>

          </div>

          <div className="flex items-start gap-2 p-3 rounded-xl bg-[#f0b90b]/8 border border-[#f0b90b]/25">
            <Info className="w-3.5 h-3.5 text-[#f0b90b] shrink-0 mt-0.5" />
            <p className="text-[8px] text-[oklch(0.45_0.01_230)] leading-relaxed">
              Swap en <strong className="text-[#f0b90b]">PancakeSwap V2</strong> · BSC. Slippage 2% protegido. Gas: ~0.0002 BNB (200k gas × 1 gwei). Ruta optimizada vía WBNB.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
