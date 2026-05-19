'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  MessageCircle, X, Send, Loader2, ExternalLink,
  Globe, ChevronDown, RefreshCw, Users, Lock,
  CheckCircle2, AlertCircle, Zap, User, Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getProvider } from '@/lib/new-contracts'

// ─── Contract V2 ─────────────────────────────────────────────────────────────
const CHAT_ADDR = '0x97CA6216c01E9C9F7cf520Bcd256C6b173B652CA'
const CHAIN_ID  = 480n

const CHAT_ABI = [
  'function postMessage(string calldata text) external returns (uint256 id)',
  'function deleteMessage(uint256 id) external',
  'function getMessages(uint256 fromId, uint256 count) external view returns (tuple(uint256 id, address sender, string text, uint256 timestamp, bool deleted, bool relayed)[])',
  'function messageCount() external view returns (uint256)',
  'function getNonce(address addr) external view returns (uint256)',
]

const POST_ABI_MINIKIT = [{
  name: 'postMessage', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'text', type: 'string' }], outputs: [{ type: 'uint256' }],
}]
const DELETE_ABI_MINIKIT = [{
  name: 'deleteMessage', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'id', type: 'uint256' }], outputs: [],
}]

const OWNER  = '0x54F0D557E8042eC70974d2e85331BE5D66fFe5F4'.toLowerCase()
const OWNER2 = '0x5474c309e985c6b4fc623acf01ade604da781e52'.toLowerCase()
const WORLDSCAN = 'https://worldscan.org'

// ─── Session key: ephemeral anon wallet stored in localStorage ────────────────
function getOrCreateSessionKey(): ethers.Wallet | ethers.HDNodeWallet {
  if (typeof window === 'undefined') return ethers.Wallet.createRandom()
  const STORE = 'acua_chat_session_pk'
  try {
    const stored = localStorage.getItem(STORE)
    if (stored) return new ethers.Wallet(stored)
  } catch {}
  const w = ethers.Wallet.createRandom()
  try { localStorage.setItem(STORE, w.privateKey) } catch {}
  return w
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function snapCorner(x: number, y: number) {
  const w = typeof window !== 'undefined' ? window.innerWidth  : 400
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  const corners = [
    { x: 18,     y: 80 },
    { x: w - 60, y: 80 },
    { x: 18,     y: h - 80 },
    { x: w - 60, y: h - 80 },
  ]
  return corners.reduce((a, b) =>
    Math.hypot(a.x - x, a.y - y) < Math.hypot(b.x - x, b.y - y) ? a : b
  )
}
function loadPos() {
  if (typeof window === 'undefined') return { x: 18, y: 120 }
  try { return JSON.parse(localStorage.getItem('acua_chat_pos') ?? 'null') ?? { x: 18, y: 120 } }
  catch { return { x: 18, y: 120 } }
}
function shortAddr(a: string) {
  if (!a || a.length < 10) return a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}
function anonTag(a: string) {
  // e.g. "Anon·A3F1"
  return `Anon·${a.slice(-4).toUpperCase()}`
}
function timeAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts
  if (s < 60)    return `${s}s`
  if (s < 3600)  return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// ─── Build relay signature ────────────────────────────────────────────────────
type AnySigner = ethers.Wallet | ethers.HDNodeWallet
async function signPostPayload(signer: AnySigner, text: string, nonce: bigint) {
  const payloadHash = ethers.keccak256(
    ethers.solidityPacked(
      ['string', 'uint256', 'uint256', 'address'],
      [text, nonce, CHAIN_ID, CHAT_ADDR]
    )
  )
  return signer.signMessage(ethers.getBytes(payloadHash))
}
async function signDeletePayload(signer: AnySigner, msgId: bigint, nonce: bigint) {
  const payloadHash = ethers.keccak256(
    ethers.solidityPacked(
      ['string', 'uint256', 'uint256', 'uint256', 'address'],
      ['delete', msgId, nonce, CHAIN_ID, CHAT_ADDR]
    )
  )
  return signer.signMessage(ethers.getBytes(payloadHash))
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChatMsg {
  id:        bigint
  sender:    string
  text:      string
  timestamp: bigint
  deleted:   boolean
  relayed:   boolean
}

function renderText(text: string) {
  const urlRe = /(https?:\/\/[^\s]+)/g
  const parts = text.split(urlRe)
  return parts.map((p, i) =>
    urlRe.test(p)
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer"
            className="text-blue-400 underline break-all hover:text-blue-300 transition-colors">{p}</a>
      : <span key={i}>{p}</span>
  )
}

// ─── Colour from address (for avatars) ───────────────────────────────────────
function addrColor(addr: string): string {
  const colors = [
    '#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b',
    '#ef4444','#ec4899','#84cc16','#f97316','#6366f1',
  ]
  const idx = parseInt(addr.slice(2, 4), 16) % colors.length
  return colors[idx]
}

// ═════════════════════════════════════════════════════════════════════════════
export function GlobalChat({
  userAddress,
  walletMode,
  importedSigner,
}: {
  userAddress?:    string
  walletMode?:     import('@/lib/tx-signer').WalletMode
  importedSigner?: import('ethers').Wallet | null
}) {
  const [open, setOpen]     = useState(false)
  const [btnPos, setBtnPos] = useState(loadPos)
  const dragState = useRef<{
    startX: number; startY: number; origX: number; origY: number; moved: boolean
  } | null>(null)

  const [msgs, setMsgs]             = useState<ChatMsg[]>([])
  const [loading, setLoading]       = useState(false)
  const [posting, setPosting]       = useState(false)
  const [input, setInput]           = useState('')
  const [statusMsg, setStatusMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [msgCount, setMsgCount]     = useState(0)
  const [newCount, setNewCount]     = useState(0)
  const [cooldownLeft, setCooldownLeft] = useState(0)

  // Session key — ephemeral wallet for anonymous posting
  const sessionWallet = useRef<ethers.Wallet | ethers.HDNodeWallet | null>(null)
  useEffect(() => {
    sessionWallet.current = getOrCreateSessionKey()
  }, [])

  const bottomRef    = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)

  // Determine active signing wallet and sender address
  const isImported = walletMode === 'imported' && !!importedSigner
  const hasMiniKit = typeof window !== 'undefined' && MiniKit.isInstalled()

  // The "real" address: imported > minikit > anon session
  const realAddr   = userAddress ?? sessionWallet.current?.address ?? ''
  // Signing wallet for relay: imported > session key
  const signerForRelay: ethers.Wallet | ethers.HDNodeWallet | null = isImported ? importedSigner! : (sessionWallet.current ?? null)

  const isAdmin = !!(userAddress && (
    userAddress.toLowerCase() === OWNER || userAddress.toLowerCase() === OWNER2
  ))
  // Anyone with a relay signer can post (i.e. everyone — session key is always available)
  const canSend = !!signerForRelay

  // ── Draggable button ───────────────────────────────────────────────────────
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
    const w = window.innerWidth, h = window.innerHeight
    setBtnPos({
      x: Math.max(8, Math.min(w - 56, dragState.current.origX + dx)),
      y: Math.max(8, Math.min(h - 56, dragState.current.origY - dy)),
    })
  }
  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragState.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (dragState.current.moved) {
      const snapped = snapCorner(btnPos.x, btnPos.y)
      setBtnPos(snapped)
      try { localStorage.setItem('acua_chat_pos', JSON.stringify(snapped)) } catch {}
    } else {
      setOpen(true)
    }
    dragState.current = null
  }

  // ── Load messages ──────────────────────────────────────────────────────────
  const loadMsgs = useCallback(async () => {
    setLoading(true)
    try {
      const p     = getProvider()
      const c     = new ethers.Contract(CHAT_ADDR, CHAT_ABI, p)
      const count = BigInt((await c.messageCount()).toString())
      setMsgCount(Number(count))
      if (count === 0n) { setMsgs([]); return }
      const fromId = count > 50n ? count - 50n : 0n
      const raw    = await c.getMessages(fromId.toString(), '50')
      const parsed: ChatMsg[] = Array.from(raw).map((m: any) => ({
        id:        BigInt(m.id.toString()),
        sender:    m.sender as string,
        text:      m.text as string,
        timestamp: BigInt(m.timestamp.toString()),
        deleted:   m.deleted as boolean,
        relayed:   m.relayed as boolean,
      })).filter((m: ChatMsg) => !m.deleted)
      setMsgs(parsed)
      if (prevCountRef.current > 0 && Number(count) > prevCountRef.current)
        setNewCount(n => n + Number(count) - prevCountRef.current)
      prevCountRef.current = Number(count)
    } catch (e) { console.error('[Chat] loadMsgs', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (open) { loadMsgs(); setNewCount(0) } }, [open, loadMsgs])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  // Auto-refresh
  useEffect(() => {
    const id = setInterval(async () => {
      if (open) { loadMsgs() } else {
        try {
          const c = new ethers.Contract(CHAT_ADDR, CHAT_ABI, getProvider())
          const count = Number((await c.messageCount()).toString())
          if (prevCountRef.current > 0 && count > prevCountRef.current)
            setNewCount(n => n + count - prevCountRef.current)
          prevCountRef.current = count
        } catch {}
      }
    }, open ? 10_000 : 60_000)
    return () => clearInterval(id)
  }, [open, loadMsgs])

  // Cooldown countdown
  useEffect(() => {
    if (cooldownLeft <= 0) return
    const id = setInterval(() => setCooldownLeft(n => Math.max(0, n - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldownLeft])

  // ── Relay helpers ──────────────────────────────────────────────────────────
  async function callRelay(body: object) {
    const res = await fetch('/api/relay/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    return res.json() as Promise<{ ok?: boolean; error?: string; txHash?: string }>
  }

  async function getOnChainNonce(addr: string): Promise<bigint> {
    const c = new ethers.Contract(CHAT_ADDR, CHAT_ABI, getProvider())
    return BigInt((await c.getNonce(addr)).toString())
  }

  // ── Relay helper (reused in both paths) ───────────────────────────────────
  const sendViaRelay = useCallback(async (text: string): Promise<boolean> => {
    if (!signerForRelay) {
      setStatusMsg({ ok: false, text: 'Cargando firma…' }); return false
    }
    const sender = signerForRelay.address
    const nonce  = await getOnChainNonce(sender)
    const sig    = await signPostPayload(signerForRelay, text, nonce)
    const result = await callRelay({ action: 'post', sender, text, nonce: nonce.toString(), sig })
    if (result.ok) {
      setInput(''); setCooldownLeft(30)
      setStatusMsg({ ok: true, text: isImported ? '✓ Publicado · relay' : '✓ Publicado · modo anónimo' })
      setTimeout(() => { loadMsgs(); setStatusMsg(null) }, 2500)
      return true
    } else {
      setStatusMsg({ ok: false, text: result.error ?? 'Error al publicar' })
      if (result.error?.includes('30') || result.error?.toLowerCase().includes('cooldown')) setCooldownLeft(30)
      return false
    }
  }, [signerForRelay, isImported, loadMsgs])

  // ── Post message ──────────────────────────────────────────────────────────
  const postMsg = useCallback(async () => {
    const text = input.trim()
    if (!text || text.length < 2 || text.length > 500 || posting) return
    if (cooldownLeft > 0) {
      setStatusMsg({ ok: false, text: `Espera ${cooldownLeft}s` }); return
    }
    setPosting(true); setStatusMsg(null)
    try {
      // ── Path 1: MiniKit in World App — intenta directo, cae a relay si no está whitelisteado
      if (hasMiniKit && userAddress) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: CHAT_ADDR, abi: POST_ABI_MINIKIT as any,
            functionName: 'postMessage', args: [text],
          }],
        })
        if (finalPayload?.status === 'success') {
          setInput(''); setCooldownLeft(30)
          setStatusMsg({ ok: true, text: '✓ Publicado en World Chain' })
          setTimeout(() => { loadMsgs(); setStatusMsg(null) }, 2500)
          return
        }
        const code = (finalPayload as any)?.error_code ?? ''
        // Usuario canceló → no hacer fallback
        if (code === 'user_rejected') {
          setStatusMsg({ ok: false, text: 'Cancelado' }); return
        }
        // Contrato no whitelisteado u otro error → caer al relay automáticamente
        await sendViaRelay(text)
        return
      }
      // ── Path 2: Relay directo (wallet importada o sesión anónima) ─────────
      await sendViaRelay(text)
    } catch (e: any) {
      setStatusMsg({ ok: false, text: e?.shortMessage ?? e?.message ?? 'Error inesperado' })
    } finally { setPosting(false) }
  }, [input, loadMsgs, userAddress, posting, cooldownLeft, hasMiniKit, sendViaRelay])

  // ── Delete message ─────────────────────────────────────────────────────────
  const deleteMsg = useCallback(async (msg: ChatMsg) => {
    // Admin can delete via imported wallet (direct tx) or MiniKit
    // Message sender can delete via relay (gasless)
    const senderAddr   = signerForRelay?.address?.toLowerCase()
    const isMySender   = senderAddr && msg.sender.toLowerCase() === senderAddr
    const isMiniKitMe  = userAddress && msg.sender.toLowerCase() === userAddress.toLowerCase()
    if (!isAdmin && !isMySender && !isMiniKitMe) return
    setPosting(true); setStatusMsg(null)
    try {
      // Admin with imported wallet → direct on-chain delete
      if (isAdmin && isImported && importedSigner) {
        const iface = new ethers.Interface(CHAT_ABI)
        const data  = iface.encodeFunctionData('deleteMessage', [msg.id.toString()])
        const p     = getProvider()
        const [nonce, fee] = await Promise.all([p.getTransactionCount(userAddress!), p.getFeeData()])
        const tx = await importedSigner.sendTransaction({
          to: CHAT_ADDR, data, nonce, gasLimit: 120_000n,
          maxFeePerGas:         fee.maxFeePerGas         ?? 3_000_000n,
          maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 1_500_000n,
          chainId: 480,
        })
        await tx.wait(1)
        setMsgs(m => m.filter(x => x.id !== msg.id))
        setStatusMsg({ ok: true, text: '✓ Eliminado' })
        setTimeout(() => setStatusMsg(null), 2000)
        return
      }
      // Admin with MiniKit → direct call
      if (isAdmin && hasMiniKit) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: CHAT_ADDR, abi: DELETE_ABI_MINIKIT as any, functionName: 'deleteMessage', args: [msg.id.toString()] }],
        })
        if (finalPayload?.status === 'success') {
          setMsgs(m => m.filter(x => x.id !== msg.id))
          setStatusMsg({ ok: true, text: '✓ Eliminado' })
          setTimeout(() => setStatusMsg(null), 2000)
        } else { setStatusMsg({ ok: false, text: 'Error al eliminar' }) }
        return
      }
      // Sender deletes own message via relay (gasless)
      if ((isMySender || isMiniKitMe) && signerForRelay) {
        const sender = signerForRelay.address
        const nonce  = await getOnChainNonce(sender)
        const sig    = await signDeletePayload(signerForRelay, msg.id, nonce)
        const result = await callRelay({ action: 'delete', sender, msgId: msg.id.toString(), nonce: nonce.toString(), sig })
        if (result.ok) {
          setMsgs(m => m.filter(x => x.id !== msg.id))
          setStatusMsg({ ok: true, text: '✓ Mensaje eliminado' })
        } else { setStatusMsg({ ok: false, text: result.error ?? 'Error' }) }
        setTimeout(() => setStatusMsg(null), 2000)
      }
    } catch (e: any) {
      setStatusMsg({ ok: false, text: e?.message ?? 'Error' })
    } finally { setPosting(false) }
  }, [isAdmin, isImported, importedSigner, userAddress, signerForRelay, hasMiniKit])

  // ─── Who am I label ───────────────────────────────────────────────────────
  const myAddr = userAddress ?? signerForRelay?.address ?? ''
  const myLabel = userAddress
    ? (isImported ? `${shortAddr(userAddress)} (wallet)` : `${shortAddr(userAddress)} (World App)`)
    : signerForRelay ? `${anonTag(signerForRelay.address)} (anónimo)` : ''

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Floating chat button ─────────────────────────────────────── */}
      <button
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: 'fixed',
          bottom: btnPos.y,
          left:   btnPos.x,
          zIndex: 60,
          touchAction: 'none',
          width: 50,
          height: 50,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #0055ff 0%, #00aaff 100%)',
          boxShadow: '0 0 0 3px rgba(0,170,255,0.2), 0 6px 24px rgba(0,80,255,0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1.5px solid rgba(0,170,255,0.5)',
          cursor: 'pointer',
        }}
        title="Chat Global ACUA · todos pueden escribir"
      >
        <MessageCircle className="w-5 h-5 text-white" strokeWidth={2.2} />
        {newCount > 0 && !open && (
          <span style={{
            position: 'absolute', top: -5, right: -5,
            background: 'linear-gradient(135deg,#ef4444,#b91c1c)',
            color: '#fff', borderRadius: '50%',
            width: 20, height: 20,
            fontSize: 9, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #030d1a',
          }}>
            {newCount > 9 ? '9+' : newCount}
          </span>
        )}
      </button>

      {/* ── Chat panel ──────────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          zIndex: 70,
          maxWidth: 480,
          margin: '0 auto',
          height: '76vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#050e1f',
          border: '1px solid rgba(0,140,255,0.2)',
          borderBottom: 'none',
          borderRadius: '22px 22px 0 0',
          boxShadow: '0 -12px 60px rgba(0,70,255,0.18)',
          overflow: 'hidden',
        }}>

          {/* ── Header ─────────────────────────────────────────────── */}
          <div style={{
            background: 'linear-gradient(180deg, rgba(0,40,100,0.5) 0%, transparent 100%)',
            borderBottom: '1px solid rgba(0,140,255,0.12)',
            padding: '12px 14px 10px',
          }} className="flex items-center gap-3 shrink-0">

            {/* Icon */}
            <div style={{
              width: 38, height: 38, borderRadius: 12, flexShrink: 0,
              background: 'linear-gradient(135deg,rgba(0,100,255,0.3),rgba(0,60,180,0.3))',
              border: '1px solid rgba(0,160,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Globe className="w-4.5 h-4.5 text-blue-400" style={{ width: 18, height: 18 }} />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-white leading-tight">Chat Global ACUA</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse block" />
                  <span className="text-[9px] text-green-400/80 font-semibold">ACTIVO</span>
                </span>
                <span className="text-[9px] text-white/30">{msgCount} mensajes · World Chain</span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* "Free for all" badge */}
              <div className="flex items-center gap-1 rounded-lg px-2 py-1"
                style={{ background: 'rgba(0,200,100,0.1)', border: '1px solid rgba(0,200,100,0.2)' }}>
                <Zap className="w-2.5 h-2.5 text-green-400" />
                <span className="text-[8px] text-green-300 font-bold">GRATIS</span>
              </div>
              <button onClick={loadMsgs} disabled={loading}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white/5">
                <RefreshCw className={cn('w-3.5 h-3.5 text-white/30', loading && 'animate-spin')} />
              </button>
              <button onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white/5">
                <ChevronDown className="w-4 h-4 text-white/30" />
              </button>
            </div>
          </div>

          {/* ── Info strip ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-3 py-1.5 shrink-0"
            style={{ background: 'rgba(0,20,50,0.6)', borderBottom: '1px solid rgba(0,140,255,0.07)' }}>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-green-400" />
              <a href={`${WORLDSCAN}/address/${CHAT_ADDR}`} target="_blank" rel="noopener noreferrer"
                className="text-[8px] font-mono text-blue-400/50 hover:text-blue-300 transition-colors flex items-center gap-0.5">
                V2 · {CHAT_ADDR.slice(0, 8)}…{CHAT_ADDR.slice(-6)}
                <ExternalLink className="w-2 h-2" />
              </a>
            </div>
            <div className="flex items-center gap-1">
              <Users className="w-2.5 h-2.5 text-blue-400/40" />
              <span className="text-[8px] text-white/25">todos pueden escribir · relay gasless</span>
            </div>
          </div>

          {/* ── Messages list ───────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
            {loading && msgs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Loader2 className="w-7 h-7 animate-spin text-blue-400" />
                <p className="text-[10px] text-white/30">Leyendo blockchain…</p>
              </div>
            )}
            {!loading && msgs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-14 gap-3">
                <div style={{
                  width: 56, height: 56, borderRadius: 18,
                  background: 'rgba(0,100,255,0.08)', border: '1px solid rgba(0,140,255,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <MessageCircle className="w-7 h-7 text-blue-400/40" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-white/40">Sin mensajes aún</p>
                  <p className="text-[10px] text-white/25 mt-1">Sé el primero · no necesitas wallet</p>
                </div>
              </div>
            )}

            {msgs.map(m => {
              const isMine = myAddr && m.sender.toLowerCase() === myAddr.toLowerCase()
              const senderColor = addrColor(m.sender)
              const isOwnerMsg = m.sender.toLowerCase() === OWNER || m.sender.toLowerCase() === OWNER2

              // Can this user delete?
              const sessionAddr = signerForRelay?.address?.toLowerCase()
              const canDelete = isAdmin || (sessionAddr && m.sender.toLowerCase() === sessionAddr)

              return (
                <div key={m.id.toString()} className={cn('flex gap-2', isMine ? 'flex-row-reverse' : 'flex-row')}>
                  {/* Avatar circle */}
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: `${senderColor}22`,
                    border: `1.5px solid ${senderColor}55`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    alignSelf: 'flex-end',
                  }}>
                    {isOwnerMsg
                      ? <Shield className="w-3.5 h-3.5" style={{ color: senderColor }} />
                      : <User   className="w-3 h-3"    style={{ color: senderColor }} />
                    }
                  </div>

                  <div className={cn('flex flex-col max-w-[78%]', isMine ? 'items-end' : 'items-start')}>
                    {/* Sender + time */}
                    <div className="flex items-center gap-1.5 mb-0.5 px-1">
                      <a href={`${WORLDSCAN}/address/${m.sender}`} target="_blank" rel="noopener noreferrer"
                        className="text-[9px] font-semibold hover:opacity-80 transition-opacity"
                        style={{ color: isMine ? '#60a5fa' : senderColor }}>
                        {isMine ? 'Tú' : (isOwnerMsg ? '👑 Admin' : shortAddr(m.sender))}
                      </a>
                      {m.relayed && (
                        <span className="text-[7px] text-green-400/60 flex items-center gap-0.5">
                          <Zap className="w-2 h-2" />relay
                        </span>
                      )}
                      <span className="text-[8px] text-white/20">{timeAgo(Number(m.timestamp))}</span>
                    </div>

                    {/* Bubble */}
                    <div className="group relative">
                      <div className={cn(
                        'px-3 py-2 rounded-2xl text-[13px] leading-snug break-words',
                        isMine ? 'rounded-br-sm' : 'rounded-bl-sm'
                      )} style={isMine ? {
                        background: 'linear-gradient(135deg,rgba(0,90,255,0.4),rgba(0,50,180,0.4))',
                        border: '1px solid rgba(0,140,255,0.3)',
                        color: '#fff',
                      } : {
                        background: 'rgba(255,255,255,0.055)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        color: 'rgba(255,255,255,0.85)',
                      }}>
                        {renderText(m.text)}
                      </div>

                      {canDelete && (
                        <button onClick={() => deleteMsg(m)} disabled={posting}
                          className={cn(
                            'absolute -top-2 w-5 h-5 rounded-full flex items-center justify-center',
                            'opacity-0 group-hover:opacity-100 transition-opacity',
                            isMine ? '-left-2' : '-right-2'
                          )}
                          style={{ background: isAdmin && !isMine ? 'rgba(239,68,68,0.85)' : 'rgba(80,80,100,0.9)' }}
                          title="Eliminar">
                          <X className="w-2.5 h-2.5 text-white" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* ── Status bar ──────────────────────────────────────────── */}
          {statusMsg && (
            <div className={cn(
              'mx-3 mb-1 rounded-xl px-3 py-1.5 text-[10px] font-medium flex items-center gap-1.5 shrink-0',
              statusMsg.ok
                ? 'bg-green-500/10 text-green-300 border border-green-500/20'
                : 'bg-red-500/10 text-red-300 border border-red-500/20'
            )}>
              {statusMsg.ok
                ? <CheckCircle2 className="w-3 h-3 shrink-0" />
                : <AlertCircle  className="w-3 h-3 shrink-0" />}
              {statusMsg.text}
            </div>
          )}

          {/* ── Input area ──────────────────────────────────────────── */}
          <div style={{ borderTop: '1px solid rgba(0,140,255,0.1)', padding: '10px 12px 12px' }}
            className="shrink-0">

            {/* Who am I */}
            {myLabel && (
              <div className="flex items-center gap-1 mb-2 px-1">
                <div className="w-2 h-2 rounded-full"
                  style={{ background: userAddress ? '#3b82f6' : '#9ca3af' }} />
                <span className="text-[9px] text-white/30">Escribiendo como <span className="text-white/50 font-semibold">{myLabel}</span></span>
                {!userAddress && (
                  <span className="ml-auto text-[8px] text-white/20 flex items-center gap-0.5">
                    <Lock className="w-2 h-2" />clave local
                  </span>
                )}
              </div>
            )}

            <div className="flex items-end gap-2">
              {/* Text input */}
              <div className="flex-1 min-w-0 rounded-2xl px-3 py-2.5 flex items-end gap-2"
                style={{
                  background: 'rgba(0,50,110,0.35)',
                  border: '1px solid rgba(0,140,255,0.22)',
                }}>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value.slice(0, 500))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postMsg() }
                  }}
                  placeholder={cooldownLeft > 0
                    ? `Cooldown ${cooldownLeft}s…`
                    : 'Escribe un mensaje · Enter para enviar'
                  }
                  disabled={posting || !canSend || cooldownLeft > 0}
                  rows={1}
                  style={{
                    resize: 'none',
                    minHeight: 24,
                    maxHeight: 88,
                    overflowY: 'auto',
                    lineHeight: '1.4',
                    scrollbarWidth: 'none',
                  }}
                  className="flex-1 bg-transparent text-[13px] text-white placeholder-white/25 outline-none min-w-0 disabled:opacity-40"
                />
                {input.length > 420 && (
                  <span className={cn(
                    'text-[9px] shrink-0 self-end',
                    input.length > 490 ? 'text-red-400' : 'text-white/25'
                  )}>
                    {500 - input.length}
                  </span>
                )}
              </div>

              {/* Send button */}
              <button
                onClick={postMsg}
                disabled={!input.trim() || posting || input.length < 2 || cooldownLeft > 0 || !canSend}
                style={{
                  width: 44, height: 44, borderRadius: 14, flexShrink: 0,
                  background: posting || cooldownLeft > 0
                    ? 'rgba(0,80,180,0.3)'
                    : 'linear-gradient(135deg,#0055ff,#0099ff)',
                  border: '1px solid rgba(0,140,255,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s',
                }}
                className="disabled:opacity-35">
                {posting
                  ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                  : <Send    className="w-4 h-4 text-white" style={{ transform: 'translateX(1px)' }} />
                }
              </button>
            </div>

            {/* Bottom hint */}
            <p className="text-center text-[8px] text-white/15 mt-2">
              Mensajes públicos e inmutables en World Chain · sin costo de gas
            </p>
          </div>
        </div>
      )}
    </>
  )
}
