'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  RefreshCw, Loader2, AlertTriangle, Zap,
  ArrowDownToLine, ArrowUpFromLine, Activity, Lock,
  CheckCircle2, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ACUA_AUTOSTAKE_ADDRESS, DEPLOYED, H2O_TOKEN,
  STAKE_ABI, UNSTAKE_ABI,
  fetchUserPositions, fetchContractStats,
  randomNonce, fmtToken, formatApr,
  type UserPosition, type TokenInfo,
} from '@/lib/autostake'
import { cn } from '@/lib/utils'

interface Props { userAddress: string }

// Animated counter hook
function useAnimCount(target: number, duration = 800) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    let start = 0; const steps = 30; const inc = target / steps
    const t = setInterval(() => { start += inc; if (start >= target) { setVal(target); clearInterval(t) } else setVal(Math.floor(start)) }, duration / steps)
    return () => clearInterval(t)
  }, [target, duration])
  return val
}

// Glowing ring pulse
function PulseRing({ color }: { color: string }) {
  return (
    <span className="absolute inset-0 rounded-full animate-ping opacity-30" style={{ background: color, animationDuration: '2s' }} />
  )
}

// Stat chip
function StatChip({ label, value, color, glow }: { label: string; value: string; color: string; glow?: boolean }) {
  return (
    <div className="relative rounded-xl border p-3 overflow-hidden text-center"
      style={{ borderColor: color + '44', background: color + '08' }}>
      {glow && <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: `inset 0 0 18px ${color}22` }} />}
      <p className="text-xs font-black" style={{ color }}>{value}</p>
      <p className="text-[9px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}

export function AutoStakePanel({ userAddress }: Props) {
  const [positions, setPositions]   = useState<UserPosition[]>([])
  const [tokens, setTokens]         = useState<TokenInfo[]>([])
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null)
  const [tab, setTab]               = useState<'stake' | 'unstake'>('stake')
  const [amount, setAmount]         = useState('')
  const [loading, setLoading]       = useState(false)
  const [txLoading, setTxLoading]   = useState(false)
  const [msg, setMsg]               = useState<{ ok: boolean; text: string } | null>(null)
  const [scanLine, setScanLine]     = useState(0)
  const [walletBal, setWalletBal]   = useState<bigint>(0n)
  const [balLoading, setBalLoading] = useState(false)

  // Scan line animation
  useEffect(() => {
    const t = setInterval(() => setScanLine(p => (p + 1) % 100), 30)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [stats, pos] = await Promise.all([
        fetchContractStats(),
        fetchUserPositions(userAddress),
      ])
      setTokens(stats.tokens)
      setPositions(pos)
      if (!selectedToken && stats.tokens.length > 0) setSelectedToken(stats.tokens[0])
    } catch (e) { console.error('[AutoStake]', e) }
    finally { setLoading(false) }
  }, [userAddress, selectedToken])

  useEffect(() => { load() }, [load])

  // ── Fetch wallet balance when token or tab changes ──────────────────────────
  useEffect(() => {
    if (!selectedToken || !userAddress || tab !== 'stake') return
    let cancelled = false
    setBalLoading(true)
    const fetchBal = async () => {
      try {
        const { ethers: _ethers } = await import('ethers')
        const { getProvider } = await import('@/lib/new-contracts')
        const erc20 = new _ethers.Contract(selectedToken.address, ['function balanceOf(address) view returns (uint256)'], getProvider())
        const bal = await erc20.balanceOf(userAddress)
        if (!cancelled) setWalletBal(BigInt(bal.toString()))
      } catch { if (!cancelled) setWalletBal(0n) }
      finally { if (!cancelled) setBalLoading(false) }
    }
    fetchBal()
    return () => { cancelled = true }
  }, [selectedToken, userAddress, tab])

  const userPos = positions.find(p => p.token === selectedToken?.address)

  async function doStake() {
    if (!selectedToken || !amount || parseFloat(amount) <= 0) return
    setTxLoading(true); setMsg(null)
    try {
      const amtWei   = ethers.parseUnits(amount, 18)
      const nonce    = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          {
            address: ACUA_AUTOSTAKE_ADDRESS,
            abi: STAKE_ABI,
            functionName: 'stakeWithPermit2',
            args: [
              selectedToken.address,
              amtWei.toString(),
              {
                permitted: { token: selectedToken.address, amount: amtWei.toString() },
                nonce: nonce.toString(),
                deadline: deadline.toString(),
              },
              'PERMIT2_SIGNATURE_PLACEHOLDER_0',
            ],
          },
        ],
        permit2: [
          {
            permitted: { token: selectedToken.address, amount: amtWei.toString() },
            spender: ACUA_AUTOSTAKE_ADDRESS,
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
        ],
      })
      if (finalPayload.status === 'success') {
        setMsg({ ok: true, text: `✓ ¡${amount} ${selectedToken.symbol} en stake! El auto-compound empieza a trabajar.` })
        setAmount('')
        setTimeout(load, 3000)
      } else {
        const errMsg = (finalPayload as any).message ?? (finalPayload as any).description ?? ''
        setMsg({ ok: false, text: errMsg ? `Transacción rechazada: ${errMsg}` : 'Transacción cancelada por el usuario' })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'Error inesperado al enviar la transacción' })
    }
    finally { setTxLoading(false) }
  }

  async function doUnstake() {
    if (!selectedToken || !amount || parseFloat(amount) <= 0 || !userPos) return
    setTxLoading(true); setMsg(null)
    try {
      const amtWei = ethers.parseUnits(amount, 18)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          {
            address: ACUA_AUTOSTAKE_ADDRESS,
            abi: UNSTAKE_ABI,
            functionName: 'unstake',
            args: [selectedToken.address, amtWei.toString()],
          },
        ],
      })
      if (finalPayload.status === 'success') {
        setMsg({ ok: true, text: `✓ ¡${amount} ${selectedToken.symbol} retirado exitosamente!` })
        setAmount('')
        setTimeout(load, 3000)
      } else {
        const errMsg = (finalPayload as any).message ?? (finalPayload as any).description ?? ''
        setMsg({ ok: false, text: errMsg ? `Transacción rechazada: ${errMsg}` : 'Transacción cancelada por el usuario' })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'Error inesperado al enviar la transacción' })
    }
    finally { setTxLoading(false) }
  }

  if (!DEPLOYED) {
    return (
      <div className="flex flex-col items-center py-12 px-4 space-y-4">
        <AlertTriangle className="w-8 h-8 text-yellow-400" />
        <p className="font-semibold text-foreground">Contrato en preparación</p>
      </div>
    )
  }

  const blue = 'oklch(0.65 0.22 255)'

  return (
    <div className="pb-6 space-y-4 relative">

      {/* ── Header holográfico ── */}
      <div className="relative rounded-2xl overflow-hidden border border-[oklch(0.65_0.22_255)]/30"
        style={{ background: 'linear-gradient(135deg, oklch(0.12 0.04 255) 0%, oklch(0.09 0.02 240) 100%)' }}>
        {/* scan line */}
        <div className="absolute inset-x-0 h-px bg-[oklch(0.65_0.22_255)]/20 pointer-events-none transition-none"
          style={{ top: `${scanLine}%` }} />
        <div className="relative px-4 py-4 flex items-center gap-3">
          <div className="relative w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'oklch(0.65 0.22 255)/20', border: '1.5px solid oklch(0.65 0.22 255)/50' }}>
            <PulseRing color="#3b82f6" />
            <span className="text-xl relative z-10">♻️</span>
          </div>
          <div>
            <h2 className="font-black text-base tracking-wide" style={{ color: blue }}>AUTO STAKE</h2>
            <p className="text-[10px] text-muted-foreground font-mono">COMPOUND · PERMIT2 · WORLD CHAIN</p>
          </div>
          <button onClick={load} disabled={loading} className="ml-auto p-2 rounded-lg hover:bg-white/5">
            <RefreshCw className={cn('w-4 h-4 text-muted-foreground', loading && 'animate-spin')} />
          </button>
        </div>

        {/* stats strip */}
        {selectedToken && (
          <div className="px-4 pb-3 grid grid-cols-4 gap-2">
            {[
              { l: 'APR', v: formatApr(selectedToken.aprBps), c: '#10b981' },
              { l: 'Stakers', v: selectedToken.stakersCount.toString(), c: '#3b82f6' },
              { l: 'Fondo', v: `${fmtToken(selectedToken.rewardFund, 18, 0)} ${selectedToken.symbol}`, c: '#f59e0b' },
              { l: 'Mín. Stake', v: selectedToken.minStake > 0n ? `${fmtToken(selectedToken.minStake, 18, 0)}` : '—', c: '#f43f5e' },
            ].map(s => (
              <div key={s.l} className="rounded-lg border p-2 text-center" style={{ borderColor: s.c + '33', background: s.c + '0a' }}>
                <p className="text-[11px] font-black leading-none" style={{ color: s.c }}>{s.v}</p>
                <p className="text-[8px] text-muted-foreground mt-0.5">{s.l}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Buy Token + Vote WDD ── */}
      <div className="grid grid-cols-2 gap-2">
        <a
          href="https://world.org/mini-app?app_id=app_4593f73390a9843503ec096086b43612&path=/launchpad/token/0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd"
          target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-[11px] font-bold py-2.5 px-2 hover:bg-cyan-500/20 transition-colors text-center"
        >
          🛒 Comprar H2O
        </a>
        <a
          href="https://www.worldrepublic.org/es/govern/parties/a6a92b4e-986f-4fe0-8bce-2b0cd8898775?ref=BWRGUDHS"
          target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-violet-500/40 bg-violet-500/10 text-violet-300 text-[11px] font-bold py-2.5 px-2 hover:bg-violet-500/20 transition-colors text-center"
        >
          🗳️ Votar +5 WDD
        </a>
      </div>

      {/* Token pills */}
      {tokens.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {tokens.map(tk => (
            <button key={tk.address} onClick={() => setSelectedToken(tk)}
              className={cn('flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all',
                selectedToken?.address === tk.address
                  ? 'bg-[oklch(0.65_0.22_255)] text-white border-transparent shadow-[0_0_10px_oklch(0.65_0.22_255)/50]'
                  : 'border-border text-muted-foreground hover:border-[oklch(0.65_0.22_255)]/40')}>
              {tk.symbol}
            </button>
          ))}
        </div>
      )}

      {/* ── Position card ── */}
      {userPos ? (
        <div className="relative rounded-2xl border overflow-hidden"
          style={{ borderColor: 'oklch(0.65 0.22 255)/40', background: 'linear-gradient(135deg, oklch(0.14 0.05 255)/80 0%, oklch(0.10 0.02 240)/80 100%)' }}>
          <div className="absolute top-0 left-0 right-0 h-0.5"
            style={{ background: 'linear-gradient(90deg, transparent, oklch(0.65 0.22 255), transparent)' }} />
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-mono text-emerald-400 uppercase tracking-widest">POSICIÓN ACTIVA</span>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-2xl font-black text-white tabular-nums leading-none">
                  {fmtToken(userPos.amount, 18, 4)}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{userPos.symbol} · EN STAKE</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-black text-emerald-400">+{fmtToken(userPos.pendingReward, 18, 6)}</p>
                <p className="text-[9px] text-muted-foreground font-mono">REINVERTE AUTO</p>
              </div>
            </div>
            {userPos.cooldownRemaining > 0 ? (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                  <div className="h-full rounded-full bg-[oklch(0.65_0.22_255)] transition-all"
                    style={{ width: `${((600 - userPos.cooldownRemaining) / 600) * 100}%` }} />
                </div>
                <p className="text-[9px] text-amber-400 font-mono whitespace-nowrap">
                  ⏳ {Math.ceil(userPos.cooldownRemaining / 60)}m
                </p>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <p className="text-[9px] text-green-400 font-mono">LISTO PARA COMPOUND</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border/50 p-6 text-center space-y-2">
          <Lock className="w-6 h-6 text-muted-foreground/40 mx-auto" />
          <p className="text-xs text-muted-foreground">Sin posición activa</p>
          {selectedToken?.minStake && selectedToken.minStake > 0n && (
            <p className="text-[10px] text-rose-400 font-mono">
              MIN {fmtToken(selectedToken.minStake, 18, 0)} {selectedToken.symbol}
            </p>
          )}
        </div>
      )}

      {/* ── Deposit / Unstake ── */}
      <div className="rounded-2xl border border-border overflow-hidden"
        style={{ background: 'oklch(0.11 0.02 240)' }}>
        {/* tab bar */}
        <div className="flex">
          {(['stake', 'unstake'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setAmount(''); setMsg(null) }}
              className={cn('flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 transition-all',
                tab === t
                  ? 'bg-[oklch(0.65_0.22_255)] text-white'
                  : 'text-muted-foreground hover:text-foreground')}>
              {t === 'stake'
                ? <><ArrowDownToLine className="w-3.5 h-3.5" />Depositar</>
                : <><ArrowUpFromLine className="w-3.5 h-3.5" />Retirar</>}
            </button>
          ))}
        </div>

        {selectedToken && (
          <div className="p-4 space-y-3">
            {/* amount input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-muted-foreground">
                  {tab === 'stake' ? 'DEPOSITAR' : 'RETIRAR'}
                </span>
                {tab === 'stake' ? (
                  <button
                    onClick={() => setAmount(ethers.formatUnits(walletBal, 18))}
                    disabled={walletBal === 0n}
                    className="flex items-center gap-1 text-[10px] font-mono text-[oklch(0.65_0.22_255)] hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {balLoading
                      ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      : <>Wallet: <span className="font-bold">{fmtToken(walletBal, 18, 4)}</span> {selectedToken.symbol} · MAX</>
                    }
                  </button>
                ) : (
                  userPos && (
                    <button onClick={() => setAmount(ethers.formatUnits(userPos.amount, 18))}
                      className="text-[10px] font-mono text-[oklch(0.65_0.22_255)] hover:underline">
                      MAX {fmtToken(userPos.amount)} {userPos.symbol}
                    </button>
                  )
                )}
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-[oklch(0.65_0.22_255)]/30 bg-black/30 px-4 py-3 focus-within:border-[oklch(0.65_0.22_255)]/60 transition-colors">
                <input
                  type="number" value={amount} onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-transparent text-2xl font-black outline-none placeholder:text-muted-foreground/30 tabular-nums"
                />
                <span className="font-bold text-sm text-muted-foreground">{selectedToken.symbol}</span>
              </div>
              {tab === 'stake' && walletBal > 0n && amount && parseFloat(amount) > walletBal / 10n ** 18n && (
                <p className="text-[9px] font-mono text-rose-400/70">
                  ⚠ Saldo insuficiente · tienes {fmtToken(walletBal, 18, 4)} {selectedToken.symbol}
                </p>
              )}
              {tab === 'stake' && selectedToken.minStake > 0n && (
                <p className="text-[9px] font-mono text-rose-400/70">
                  · mín {fmtToken(selectedToken.minStake, 18, 0)} {selectedToken.symbol} (neto de fee)
                </p>
              )}
              <p className="text-[9px] font-mono text-muted-foreground/50">
                {tab === 'stake' ? '· fee 5%: 4%→owner · 1%→pool · Permit2 sin approve' : '· fee 5% al retirar · instantáneo'}
              </p>
            </div>

            <Button
              className="w-full h-12 font-black text-sm tracking-wide transition-all"
              style={{ background: 'oklch(0.65 0.22 255)', boxShadow: txLoading ? undefined : '0 0 20px oklch(0.65 0.22 255)/30' }}
              disabled={txLoading || !amount || parseFloat(amount) <= 0}
              onClick={tab === 'stake' ? doStake : doUnstake}
            >
              {txLoading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />PROCESANDO TX...</>
                : tab === 'stake'
                  ? <><Zap className="w-4 h-4 mr-2" />DEPOSITAR {selectedToken.symbol}</>
                  : <><ArrowUpFromLine className="w-4 h-4 mr-2" />RETIRAR {selectedToken.symbol}</>}
            </Button>
          </div>
        )}
      </div>

      {msg && (
        <div className={cn(
          'rounded-xl border px-4 py-3 flex items-start gap-3',
          msg.ok
            ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
            : 'border-red-500/50 bg-red-500/10 text-red-300',
        )}>
          {msg.ok
            ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
            : <XCircle      className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />}
          <span className="text-xs font-semibold leading-relaxed">{msg.text}</span>
        </div>
      )}

      {/* ── How it works ── */}
      <div className="rounded-2xl border border-border/40 bg-muted/5 p-4 space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-3.5 h-3.5 text-[oklch(0.65_0.22_255)]" />
          <p className="text-[10px] font-mono font-bold text-[oklch(0.65_0.22_255)] uppercase tracking-widest">Protocolo</p>
        </div>
        {[
          ['♻️', 'Rewards auto-compuestos cada 10 min sin acción tuya'],
          ['⚡', 'Cualquier usuario puede procesar tu compound y gana 1%'],
          ['🔐', 'Permit2: deposita sin approve previo · firma en World App'],
          ['📈', `${selectedToken ? formatApr(selectedToken.aprBps) : '—'} APR · mín ${selectedToken?.minStake && selectedToken.minStake > 0n ? fmtToken(selectedToken.minStake, 18, 0) + ' ' + selectedToken.symbol : '—'}`],
        ].map(([icon, text]) => (
          <div key={text as string} className="flex items-start gap-2">
            <span className="text-xs shrink-0">{icon}</span>
            <p className="text-[10px] text-muted-foreground font-mono">{text as string}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
