'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  MessageCircle, X, Send, Loader2, Trash2, ExternalLink,
  Globe, ChevronDown, RefreshCw, Shield, Users, Lock,
  CheckCircle2, AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getProvider } from '@/lib/new-contracts'

// ─── Contract ────────────────────────────────────────────────────────────────
const CHAT_ADDR = '0xa1A60A5539c18659bD7A86Fe49Fb5A8fb0Aa4560'

const CHAT_ABI = [
  'function postMessage(string calldata text) external returns (uint256 id)',
  'function deleteMessage(uint256 id) external',
  'function getMessages(uint256 fromId, uint256 count) external view returns (tuple(uint256 id, address sender, string text, uint256 timestamp, bool deleted)[])',
  'function messageCount() external view returns (uint256)',
]

const POST_ABI = [{
  name: 'postMessage', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'text', type: 'string' }], outputs: [{ type: 'uint256' }],
}]
const DELETE_ABI = [{
  name: 'deleteMessage', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'id', type: 'uint256' }], outputs: [],
}]

const OWNER2 = '0x5474c309e985c6b4fc623acf01ade604da781e52'
const WORLDSCAN = 'https://worldscan.org'

// ─── Snap corners ────────────────────────────────────────────────────────────
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
function timeAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

interface ChatMsg { id: bigint; sender: string; text: string; timestamp: bigint; deleted: boolean }

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

// ═════════════════════════════════════════════════════════════════════════════
export function GlobalChat({
  userAddress,
  walletMode,
  importedSigner,
}: {
  userAddress?: string
  walletMode?: import('@/lib/tx-signer').WalletMode
  importedSigner?: import('ethers').Wallet | null
}) {
  const [open, setOpen]       = useState(false)
  const [btnPos, setBtnPos]   = useState(loadPos)
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)

  const [msgs, setMsgs]           = useState<ChatMsg[]>([])
  const [loading, setLoading]     = useState(false)
  const [posting, setPosting]     = useState(false)
  const [input, setInput]         = useState('')
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [msgCount, setMsgCount]   = useState(0)
  const [newCount, setNewCount]   = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)

  const isOwner = !!(userAddress && userAddress.toLowerCase() === OWNER2.toLowerCase())
  const isImported = walletMode === 'imported' && !!importedSigner
  const canPost = !!(userAddress && (MiniKit.isInstalled() || isImported))

  // ── Draggable ──────────────────────────────────────────────────────────────
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
    const newX = dragState.current.origX + dx
    const newY = dragState.current.origY - dy
    const w = window.innerWidth, h = window.innerHeight
    setBtnPos({ x: Math.max(8, Math.min(w - 56, newX)), y: Math.max(8, Math.min(h - 56, newY)) })
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
      const p  = getProvider()
      const c  = new ethers.Contract(CHAT_ADDR, CHAT_ABI, p)
      const count = BigInt((await c.messageCount()).toString())
      setMsgCount(Number(count))
      if (count === 0n) { setMsgs([]); return }
      // fetch last 30 messages
      const fromId = count > 30n ? count - 30n : 0n
      const raw = await c.getMessages(fromId.toString(), '30')
      const parsed: ChatMsg[] = Array.from(raw).map((m: any) => ({
        id:        BigInt(m.id.toString()),
        sender:    m.sender as string,
        text:      m.text as string,
        timestamp: BigInt(m.timestamp.toString()),
        deleted:   m.deleted as boolean,
      })).filter((m: ChatMsg) => !m.deleted)
      setMsgs(parsed)
      // badge: how many new since last check
      if (prevCountRef.current > 0 && Number(count) > prevCountRef.current) {
        setNewCount(n => n + Number(count) - prevCountRef.current)
      }
      prevCountRef.current = Number(count)
    } catch (e) { console.error('[Chat] loadMsgs', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (open) { loadMsgs(); setNewCount(0) } }, [open, loadMsgs])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  // Auto-refresh every 12s while open, every 60s while closed (for badge)
  useEffect(() => {
    const id = setInterval(async () => {
      if (open) { loadMsgs() } else {
        try {
          const p = getProvider()
          const c = new ethers.Contract(CHAT_ADDR, CHAT_ABI, p)
          const count = Number((await c.messageCount()).toString())
          if (prevCountRef.current > 0 && count > prevCountRef.current) {
            setNewCount(n => n + count - prevCountRef.current)
          }
          prevCountRef.current = count
        } catch {}
      }
    }, open ? 12_000 : 60_000)
    return () => clearInterval(id)
  }, [open, loadMsgs])

  // ── Post message ──────────────────────────────────────────────────────────
  const postMsg = useCallback(async () => {
    const text = input.trim()
    if (!text || text.length > 500 || !userAddress) return
    setPosting(true); setStatusMsg(null)
    try {
      // Imported wallet: sign with ethers directly
      if (isImported && importedSigner) {
        const iface = new ethers.Interface(CHAT_ABI)
        const data = iface.encodeFunctionData('postMessage', [text])
        const provider = getProvider()
        const [nonce, feeData] = await Promise.all([provider.getTransactionCount(userAddress), provider.getFeeData()])
        const tx = await importedSigner.sendTransaction({
          to: CHAT_ADDR, data,
          nonce, gasLimit: 200_000n,
          maxFeePerGas: feeData.maxFeePerGas ?? 1_100_000_000n,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1_000_000_000n,
          chainId: 480,
        })
        await tx.wait(1)
        setInput('')
        setStatusMsg({ ok: true, text: '✓ Mensaje publicado en World Chain' })
        setTimeout(() => { loadMsgs(); setStatusMsg(null) }, 2000)
        return
      }
      // MiniKit / World App
      if (!MiniKit.isInstalled()) {
        setStatusMsg({ ok: false, text: 'Abre dentro de World App para enviar mensajes.' }); return
      }
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: CHAT_ADDR, abi: POST_ABI as any, functionName: 'postMessage', args: [text] }],
      })
      if (finalPayload?.status === 'success') {
        setInput('')
        setStatusMsg({ ok: true, text: '✓ Mensaje publicado en World Chain' })
        setTimeout(() => { loadMsgs(); setStatusMsg(null) }, 2000)
      } else {
        const code = (finalPayload as any)?.error_code ?? ''
        setStatusMsg({ ok: false, text: code || 'Error al publicar.' })
      }
    } catch (e: any) {
      setStatusMsg({ ok: false, text: e?.message ?? 'Error inesperado' })
    } finally { setPosting(false) }
  }, [input, loadMsgs, userAddress, isImported, importedSigner])

  // ── Delete message (owner only) ────────────────────────────────────────────
  const deleteMsg = useCallback(async (id: bigint) => {
    if (!isOwner) return
    if (!MiniKit.isInstalled() && !isImported) return
    setPosting(true); setStatusMsg(null)
    try {
      if (isImported && importedSigner) {
        const iface = new ethers.Interface(CHAT_ABI)
        const data = iface.encodeFunctionData('deleteMessage', [id.toString()])
        const provider = getProvider()
        const [nonce, feeData] = await Promise.all([provider.getTransactionCount(userAddress!), provider.getFeeData()])
        const tx = await importedSigner.sendTransaction({
          to: CHAT_ADDR, data, nonce, gasLimit: 100_000n,
          maxFeePerGas: feeData.maxFeePerGas ?? 1_100_000_000n,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1_000_000_000n,
          chainId: 480,
        })
        await tx.wait(1)
        setMsgs(m => m.filter(msg => msg.id !== id))
        setStatusMsg({ ok: true, text: '✓ Eliminado' })
        setTimeout(() => setStatusMsg(null), 2000)
        return
      }
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: CHAT_ADDR, abi: DELETE_ABI as any, functionName: 'deleteMessage', args: [id.toString()] }],
      })
      if (finalPayload?.status === 'success') {
        setMsgs(m => m.filter(msg => msg.id !== id))
        setStatusMsg({ ok: true, text: '✓ Mensaje eliminado' })
        setTimeout(() => setStatusMsg(null), 2000)
      } else {
        setStatusMsg({ ok: false, text: 'Error al eliminar.' })
      }
    } catch (e: any) {
      setStatusMsg({ ok: false, text: e?.message ?? 'Error' })
    } finally { setPosting(false) }
  }, [isOwner, isImported, importedSigner, userAddress])

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Floating button ─────────────────────────────────────────────── */}
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
          width: 46,
          height: 46,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #0066ff, #0099ff)',
          boxShadow: '0 4px 18px rgba(0,122,255,0.5), 0 0 0 3px rgba(0,163,255,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid rgba(0,163,255,0.4)',
          cursor: 'pointer',
        }}
        title="Chat Global ACUA — Mensajes públicos en World Chain"
      >
        <MessageCircle className="w-5 h-5 text-white" />
        {newCount > 0 && !open && (
          <span style={{
            position: 'absolute', top: -5, right: -5,
            background: 'linear-gradient(135deg,#ef4444,#dc2626)',
            color: 'white', borderRadius: '50%',
            width: 18, height: 18,
            fontSize: 9, fontWeight: 'bold',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #030d1a',
          }}>
            {newCount > 9 ? '9+' : newCount}
          </span>
        )}
      </button>

      {/* ── Chat panel ──────────────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          zIndex: 70,
          maxWidth: 440,
          margin: '0 auto',
          height: '72vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, #030d1a 0%, #050f20 100%)',
          border: '1px solid rgba(0,163,255,0.25)',
          borderBottom: 'none',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -8px 48px rgba(0,80,255,0.2)',
        }}>

          {/* ── Header ──────────────────────────────────────────────────── */}
          <div style={{ borderBottom: '1px solid rgba(0,163,255,0.1)', padding: '10px 14px' }}
            className="flex items-center gap-2.5 shrink-0">
            {/* Icon */}
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg,rgba(0,122,255,0.2),rgba(0,80,200,0.2))', border: '1px solid rgba(0,163,255,0.25)' }}>
              <Globe className="w-4.5 h-4.5 text-blue-400" style={{ width: 18, height: 18 }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white leading-tight">Chat Global ACUA</p>
              <div className="flex items-center gap-1.5 mt-px">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <p className="text-[9px] text-white/40">
                  {msgCount} mensajes · World Chain · <span className="text-green-400/80">público</span>
                </p>
              </div>
            </div>
            {/* Status badges */}
            <div className="flex items-center gap-1 shrink-0">
              <div className="flex items-center gap-1 rounded-lg px-1.5 py-0.5" style={{ background: 'rgba(0,122,255,0.1)', border: '1px solid rgba(0,163,255,0.15)' }}>
                <Users className="w-2.5 h-2.5 text-blue-400" />
                <span className="text-[8px] text-blue-300 font-bold">PÚBLICO</span>
              </div>
              <button onClick={loadMsgs} disabled={loading}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/5 transition-colors">
                <RefreshCw className={cn('w-3.5 h-3.5 text-white/35', loading && 'animate-spin')} />
              </button>
              <button onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/5 transition-colors">
                <ChevronDown className="w-4 h-4 text-white/35" />
              </button>
            </div>
          </div>

          {/* ── Contract info bar ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-3 py-1.5 shrink-0"
            style={{ background: 'rgba(0,40,80,0.4)', borderBottom: '1px solid rgba(0,163,255,0.06)' }}>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-green-400" />
              <span className="text-[8px] text-green-400/80 font-bold">CONTRATO ACTIVO</span>
              <a href={`${WORLDSCAN}/address/${CHAT_ADDR}`} target="_blank" rel="noopener noreferrer"
                className="text-[8px] font-mono text-blue-400/50 hover:text-blue-300 transition-colors flex items-center gap-0.5">
                {CHAT_ADDR.slice(0, 10)}…{CHAT_ADDR.slice(-6)} <ExternalLink className="w-2 h-2" />
              </a>
            </div>
            <div className="flex items-center gap-1">
              <Lock className="w-2.5 h-2.5 text-white/25" />
              <span className="text-[8px] text-white/25">on-chain</span>
            </div>
          </div>

          {/* ── Messages ─────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
            {loading && msgs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                <p className="text-[10px] text-white/30">Leyendo blockchain…</p>
              </div>
            )}
            {!loading && msgs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(0,122,255,0.08)', border: '1px solid rgba(0,163,255,0.15)' }}>
                  <MessageCircle className="w-7 h-7 text-blue-400/40" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-white/40">Sin mensajes aún</p>
                  <p className="text-[10px] text-white/25 mt-1">Sé el primero en escribir en World Chain</p>
                </div>
              </div>
            )}
            {msgs.map(m => {
              const isMine = !!(userAddress && m.sender.toLowerCase() === userAddress.toLowerCase())
              return (
                <div key={m.id.toString()}
                  className={cn('flex flex-col gap-0.5', isMine ? 'items-end' : 'items-start')}>
                  <div className="flex items-center gap-1.5">
                    <a href={`${WORLDSCAN}/address/${m.sender}`} target="_blank" rel="noopener noreferrer"
                      className="text-[9px] font-mono hover:text-blue-300 transition-colors flex items-center gap-0.5"
                      style={{ color: isMine ? '#60a5fa' : 'rgba(255,255,255,0.3)' }}>
                      {isMine ? 'tú' : shortAddr(m.sender)}
                      <ExternalLink className="w-2 h-2" />
                    </a>
                    <span className="text-[8px] text-white/20">{timeAgo(Number(m.timestamp))}</span>
                  </div>
                  <div className="group relative max-w-[88%]">
                    <div className={cn(
                      'px-3 py-2 rounded-2xl text-sm leading-snug break-words',
                      isMine
                        ? 'text-white rounded-br-sm'
                        : 'text-white/80 rounded-bl-sm'
                    )} style={isMine ? {
                      background: 'linear-gradient(135deg,rgba(0,100,255,0.35),rgba(0,60,180,0.35))',
                      border: '1px solid rgba(0,163,255,0.3)',
                    } : {
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}>
                      {renderText(m.text)}
                    </div>
                    {isOwner && (
                      <button onClick={() => deleteMsg(m.id)}
                        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Eliminar mensaje">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* ── Status msg ───────────────────────────────────────────────── */}
          {statusMsg && (
            <div className={cn('mx-3 mb-1 rounded-xl px-3 py-1.5 text-[10px] font-medium flex items-center gap-1.5',
              statusMsg.ok
                ? 'bg-green-500/10 text-green-300 border border-green-500/20'
                : 'bg-red-500/10 text-red-300 border border-red-500/20')}>
              {statusMsg.ok
                ? <CheckCircle2 className="w-3 h-3 shrink-0" />
                : <AlertCircle className="w-3 h-3 shrink-0" />}
              {statusMsg.text}
            </div>
          )}

          {/* ── Input ────────────────────────────────────────────────────── */}
          <div style={{ borderTop: '1px solid rgba(0,163,255,0.1)', padding: '10px 12px' }}
            className="shrink-0">
            {!userAddress ? (
              <div className="flex items-center justify-center gap-2 py-2">
                <Globe className="w-4 h-4 text-blue-400/40" />
                <p className="text-[10px] text-white/35">Conecta World Wallet para enviar mensajes</p>
              </div>
            ) : !canPost ? (
              <div className="flex items-center justify-center gap-2 py-2">
                <AlertCircle className="w-4 h-4 text-yellow-400/60" />
                <p className="text-[10px] text-yellow-400/60">Abre dentro de World App para enviar</p>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <div className="flex-1 min-w-0 rounded-2xl px-3 py-2 flex items-center gap-2"
                  style={{ background: 'rgba(0,60,120,0.3)', border: '1px solid rgba(0,163,255,0.2)' }}>
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value.slice(0, 500))}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postMsg() } }}
                    placeholder="Mensaje público en World Chain…"
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-white/20 outline-none min-w-0"
                  />
                  <span className="text-[9px] text-white/20 shrink-0">{input.length}/500</span>
                </div>
                <button onClick={postMsg} disabled={posting || !input.trim()}
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40 transition-all hover:scale-105 active:scale-95"
                  style={{
                    background: input.trim() ? 'linear-gradient(135deg,#0066ff,#0099ff)' : 'rgba(0,122,255,0.15)',
                    border: '1px solid rgba(0,163,255,0.3)',
                    boxShadow: input.trim() ? '0 0 16px rgba(0,122,255,0.4)' : 'none',
                  }}>
                  {posting ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Send className="w-4 h-4 text-white" />}
                </button>
              </div>
            )}
            {isOwner && (
              <div className="flex items-center gap-1 mt-1">
                <Shield className="w-3 h-3 text-blue-400" />
                <span className="text-[9px] text-blue-400/50">Modo owner — puedes eliminar mensajes</span>
              </div>
            )}
            {isImported && userAddress && (
              <div className="flex items-center gap-1 mt-1">
                <CheckCircle2 className="w-3 h-3 text-green-400" />
                <span className="text-[9px] text-green-400/60">Wallet importada — envío directo on-chain</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
