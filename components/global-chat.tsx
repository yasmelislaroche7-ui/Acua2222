'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  MessageCircle, X, Send, Loader2, Trash2, ExternalLink,
  Globe, ChevronDown, RefreshCw, Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getProvider } from '@/lib/new-contracts'

// ─── Contract ────────────────────────────────────────────────────────────────
// After deploying AcuaGlobalChat, set the address here:
const CHAT_ADDR = '0xa1A60A5539c18659bD7A86Fe49Fb5A8fb0Aa4560'

const CHAT_ABI = [
  'function postMessage(string calldata text) external returns (uint256 id)',
  'function deleteMessage(uint256 id) external',
  'function getMessages(uint256 fromId, uint256 count) external view returns (tuple(uint256 id, address sender, string text, uint256 timestamp, bool deleted)[])',
  'function messageCount() external view returns (uint256)',
]

// POST ABI for MiniKit
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
  if (s < 60)  return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

interface ChatMsg { id: bigint; sender: string; text: string; timestamp: bigint; deleted: boolean }

// ─── isLink helper ────────────────────────────────────────────────────────────
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
export function GlobalChat({ userAddress }: { userAddress?: string }) {
  const [open, setOpen]       = useState(false)
  const [btnPos, setBtnPos]   = useState(loadPos)
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)

  const [msgs, setMsgs]           = useState<ChatMsg[]>([])
  const [loading, setLoading]     = useState(false)
  const [posting, setPosting]     = useState(false)
  const [input, setInput]         = useState('')
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [msgCount, setMsgCount]   = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  const isOwner = !!(userAddress && userAddress.toLowerCase() === OWNER2.toLowerCase())

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

  // ── Load messages ─────────────────────────────────────────────────────────
  const loadMsgs = useCallback(async () => {
    if (!CHAT_ADDR) return
    setLoading(true)
    try {
      const p  = getProvider()
      const c  = new ethers.Contract(CHAT_ADDR, CHAT_ABI, p)
      const count = BigInt((await c.messageCount()).toString())
      setMsgCount(Number(count))
      if (count === BigInt(0)) { setMsgs([]); return }
      const fromId = count - BigInt(1)
      const raw = await c.getMessages(fromId.toString(), '30')
      const parsed: ChatMsg[] = Array.from(raw).map((m: any) => ({
        id:        BigInt(m.id.toString()),
        sender:    m.sender as string,
        text:      m.text as string,
        timestamp: BigInt(m.timestamp.toString()),
        deleted:   m.deleted as boolean,
      }))
      // newest first from contract → reverse for display (oldest at top)
      setMsgs(parsed.reverse())
    } catch (e) { console.error('[Chat] loadMsgs', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (open) loadMsgs() }, [open, loadMsgs])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  // Auto-refresh every 15s while open
  useEffect(() => {
    if (!open) return
    const id = setInterval(loadMsgs, 15_000)
    return () => clearInterval(id)
  }, [open, loadMsgs])

  // ── Post message ──────────────────────────────────────────────────────────
  const postMsg = useCallback(async () => {
    const text = input.trim()
    if (!text || text.length > 500) return
    if (!MiniKit.isInstalled()) {
      setStatusMsg({ ok: false, text: 'Abre dentro de World App para enviar mensajes.' })
      return
    }
    setPosting(true); setStatusMsg(null)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: CHAT_ADDR, abi: POST_ABI as any, functionName: 'postMessage', args: [text] }],
      })
      if (finalPayload?.status === 'success') {
        setInput('')
        setStatusMsg({ ok: true, text: '✓ Mensaje publicado' })
        setTimeout(() => { loadMsgs(); setStatusMsg(null) }, 2000)
      } else {
        const code = (finalPayload as any)?.error_code ?? ''
        setStatusMsg({ ok: false, text: code || 'Error al publicar. Intenta de nuevo.' })
      }
    } catch (e: any) {
      setStatusMsg({ ok: false, text: e?.message ?? 'Error inesperado' })
    } finally { setPosting(false) }
  }, [input, loadMsgs])

  // ── Delete message (owner only) ────────────────────────────────────────────
  const deleteMsg = useCallback(async (id: bigint) => {
    if (!isOwner || !MiniKit.isInstalled()) return
    setPosting(true); setStatusMsg(null)
    try {
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
  }, [isOwner])

  const notDeployed = !CHAT_ADDR

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
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #10b981, #059669)',
          boxShadow: '0 4px 14px rgba(16,185,129,0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          cursor: 'pointer',
        }}
        title="Chat Global ACUA"
      >
        <Globe className="w-5 h-5 text-white" />
        {msgCount > 0 && !open && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: '#ef4444', color: 'white',
            borderRadius: '50%', width: 16, height: 16,
            fontSize: 8, fontWeight: 'bold',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {msgCount > 99 ? '99+' : msgCount}
          </span>
        )}
      </button>

      {/* ── Chat panel ──────────────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          zIndex: 70,
          maxWidth: 420,
          margin: '0 auto',
          height: '70vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, #0a1118 0%, #060c12 100%)',
          border: '1px solid rgba(16,185,129,0.25)',
          borderBottom: 'none',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
        }}>

          {/* Header */}
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '12px 16px' }}
            className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'rgba(16,185,129,0.15)' }}>
              <Globe className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white leading-tight">Chat Global ACUA</p>
              <p className="text-[9px] text-white/40">{msgCount} mensajes · World Chain · público</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={loadMsgs} disabled={loading}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/8 transition-colors">
                <RefreshCw className={cn('w-3.5 h-3.5 text-white/40', loading && 'animate-spin')} />
              </button>
              <button onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/8 transition-colors">
                <ChevronDown className="w-4 h-4 text-white/40" />
              </button>
            </div>
          </div>

          {/* No wallet / no contract notice */}
          {notDeployed && (
            <div className="flex-1 flex items-center justify-center p-6 text-center">
              <div className="space-y-2">
                <Globe className="w-10 h-10 text-emerald-400/40 mx-auto" />
                <p className="text-sm font-bold text-white/50">Contrato pendiente de deploy</p>
                <p className="text-[10px] text-white/30 leading-relaxed">
                  Ejecuta el script de deploy y el chat estará activo en World Chain.
                </p>
              </div>
            </div>
          )}

          {/* Messages */}
          {!notDeployed && (
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
              {loading && msgs.length === 0 && (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-emerald-400" /></div>
              )}
              {!loading && msgs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <MessageCircle className="w-8 h-8 text-white/20" />
                  <p className="text-xs text-white/30">Sin mensajes aún. Sé el primero!</p>
                </div>
              )}
              {msgs.map(m => {
                const isMine = !!(userAddress && m.sender.toLowerCase() === userAddress.toLowerCase())
                return (
                  <div key={m.id.toString()}
                    className={cn('flex flex-col gap-0.5', isMine ? 'items-end' : 'items-start')}>
                    <div className="flex items-center gap-1.5">
                      <a href={`${WORLDSCAN}/address/${m.sender}`} target="_blank" rel="noopener noreferrer"
                        className="text-[9px] font-mono text-white/30 hover:text-emerald-400 transition-colors flex items-center gap-0.5">
                        {isMine ? 'tú' : shortAddr(m.sender)}
                        <ExternalLink className="w-2 h-2" />
                      </a>
                      <span className="text-[8px] text-white/20">{timeAgo(Number(m.timestamp))}</span>
                      {isOwner && (
                        <button onClick={() => deleteMsg(m.id)}
                          className="opacity-0 group-hover:opacity-100 hover:opacity-100 text-red-400/60 hover:text-red-400 transition-colors ml-1"
                          title="Eliminar mensaje">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className={cn(
                      'group relative max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-snug break-words',
                      isMine
                        ? 'bg-emerald-500/20 text-emerald-100 border border-emerald-500/25 rounded-br-sm'
                        : 'bg-white/6 text-white/80 border border-white/8 rounded-bl-sm'
                    )}>
                      {renderText(m.text)}
                      {isOwner && (
                        <button onClick={() => deleteMsg(m.id)}
                          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Eliminar">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>
          )}

          {/* Status msg */}
          {statusMsg && (
            <div className={cn('mx-3 mb-1 rounded-xl px-3 py-1.5 text-[10px] font-medium',
              statusMsg.ok ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                          : 'bg-red-500/15 text-red-300 border border-red-500/25')}>
              {statusMsg.text}
            </div>
          )}

          {/* Input */}
          {!notDeployed && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '10px 12px' }}
              className="shrink-0">
              {!userAddress ? (
                <p className="text-center text-[10px] text-white/30 py-1">Conecta World Wallet para enviar mensajes</p>
              ) : (
                <div className="flex items-end gap-2">
                  <div className="flex-1 min-w-0 rounded-2xl px-3 py-2 flex items-center gap-2"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <input
                      value={input}
                      onChange={e => setInput(e.target.value.slice(0, 500))}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postMsg() } }}
                      placeholder="Escribe un mensaje o pega un link..."
                      className="flex-1 bg-transparent text-sm text-white placeholder:text-white/25 outline-none min-w-0"
                    />
                    <span className="text-[9px] text-white/20 shrink-0">{input.length}/500</span>
                  </div>
                  <button onClick={postMsg} disabled={posting || !input.trim()}
                    className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40 transition-all hover:scale-105 active:scale-95"
                    style={{ background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: input.trim() ? '0 0 12px rgba(16,185,129,0.4)' : 'none' }}>
                    {posting ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Send className="w-4 h-4 text-white" />}
                  </button>
                </div>
              )}
              {isOwner && (
                <div className="flex items-center gap-1 mt-1">
                  <Shield className="w-3 h-3 text-emerald-400" />
                  <span className="text-[9px] text-emerald-400/60">Modo owner — puedes eliminar mensajes</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
