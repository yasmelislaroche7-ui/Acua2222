'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  Factory, Plus, Coins, Users, Loader2, CheckCircle2, XCircle,
  Fuel, ArrowUpFromLine, ArrowDownToLine, Shield, Info, ChevronLeft,
  UserPlus, UserMinus, Pause, Play, ImageIcon, ExternalLink, Copy, Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  STAKE_FACTORY_ADDRESS, ACUA_OWNER_ADDRESS, USDC_ADDRESS,
  CREATE_POOL_ABI_FRAG, CREATE_POOL_NORMAL_ABI_FRAG,
  DEPOSIT_ABI_FRAG, DEPOSIT_NORMAL_ABI_FRAG, WITHDRAW_ABI_FRAG, CLAIM_ABI_FRAG,
  FUND_ABI_FRAG, FUND_DIRECT_ABI_FRAG, ADD_OWNER_ABI_FRAG, REMOVE_OWNER_ABI_FRAG,
  SET_APR_ABI_FRAG, SET_PAUSED_ABI_FRAG,
  fetchStakeFactoryConfig, fetchAllPools, fetchPoolInfo, fetchUserStakeInfo, fetchPoolOwners,
  fetchErc20Meta, fetchErc20Balance,
  type StakeFactoryConfig, type StakeFactoryPoolInfo, type StakeFactoryUserInfo,
  formatToken, formatAPR, formatFee, randomNonce,
  MAX_APR_BPS, DEPOSIT_FEE_BPS, WITHDRAW_FEE_BPS, CLAIM_FEE_BPS,
} from '@/lib/stake-factory'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function shortAddr(addr: string): string {
  if (!addr || addr === ethers.ZeroAddress) return '—'
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}
function parseMkErr(fp: any): string {
  if (!fp) return 'Sin respuesta'
  const d = fp.errorCode || fp.description || fp.error_code || ''
  if (typeof d === 'string' && d.includes('user_rejected')) return 'Cancelado por usuario'
  return String(d) || 'Error desconocido'
}
type Msg = { ok: boolean; text: string } | null

function MsgBox({ msg, onClear }: { msg: Msg; onClear: () => void }) {
  if (!msg) return null
  return (
    <div className={cn('flex items-start gap-2 rounded-2xl p-3 border',
      msg.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300')}>
      {msg.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
      <span className="flex-1 text-xs leading-relaxed break-words">{msg.text}</span>
      <button onClick={onClear} className="shrink-0 text-xs opacity-60 hover:opacity-100">✕</button>
    </div>
  )
}
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-black/30 border border-white/10 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-[11px] font-mono text-white truncate">{value}</p>
      </div>
      <button onClick={doCopy}
        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-bold text-cyan-300 transition-colors">
        {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}
function Stat({ label, value, c = 'text-violet-300' }: { label: string; value: string; c?: string }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{label}</span>
      <span className={cn('text-base font-black truncate', c)}>{value}</span>
    </div>
  )
}
function ActionBtn({ onClick, loading, disabled, label, icon, color = 'bg-violet-500/20 border-violet-500/40 text-violet-300' }: {
  onClick: () => void; loading?: boolean; disabled?: boolean; label: string; icon: React.ReactNode; color?: string
}) {
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={cn('flex items-center justify-center gap-2 w-full rounded-2xl px-4 py-3 text-sm font-bold border transition-opacity', color,
        (disabled || loading) ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-80 active:scale-[.98]')}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : icon}
      <span>{loading ? 'Procesando…' : label}</span>
    </button>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  userAddress: string
  walletMode?: 'minikit' | 'imported' | null
  importedSigner?: ethers.Signer | null
}

type TopTab = 'pools' | 'create' | 'info'

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function StakeFactoryPanel({ userAddress, walletMode, importedSigner }: Props) {
  const addr = userAddress || ''
  const isMK = walletMode === 'minikit' || (typeof window !== 'undefined' && (window as any).MiniKit)

  const [tab, setTab] = useState<TopTab>('pools')
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<StakeFactoryConfig | null>(null)
  const [pools, setPools] = useState<StakeFactoryPoolInfo[]>([])
  const [selectedPool, setSelectedPool] = useState<number | null>(null)
  const [usdcBalance, setUsdcBalance] = useState(0n)
  const [searchId, setSearchId] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchErr, setSearchErr] = useState('')

  const load = useCallback(async () => {
    if (!STAKE_FACTORY_ADDRESS) { setLoading(false); return }
    setLoading(true)
    try {
      const [cfg, allPools] = await Promise.all([
        fetchStakeFactoryConfig(),
        fetchAllPools(),
      ])
      setConfig(cfg)
      setPools(allPools)
      if (addr) {
        const bal = await fetchErc20Balance(cfg.creationFeeToken, addr)
        setUsdcBalance(bal)
      }
    } catch (e) { console.error('StakeFactory load:', e) }
    finally { setLoading(false) }
  }, [addr])

  useEffect(() => { load() }, [load])
  const refresh = () => setTimeout(load, 4000)

  if (!STAKE_FACTORY_ADDRESS) {
    return (
      <div className="rounded-3xl p-6 border border-amber-500/25 bg-amber-500/5 text-center">
        <p className="text-amber-300 text-sm font-bold">Stake Factory aún no desplegado</p>
      </div>
    )
  }

  const pool = selectedPool !== null ? pools.find(p => p.poolId === selectedPool) ?? null : null

  const handleSearch = async () => {
    const id = parseInt(searchId.trim(), 10)
    if (isNaN(id) || id < 0) { setSearchErr('Ingresa un número de ID válido'); return }
    setSearchErr('')
    const existing = pools.find(p => p.poolId === id)
    if (existing) { setSelectedPool(id); return }
    setSearchLoading(true)
    try {
      const p = await fetchPoolInfo(id)
      setPools(prev => (prev.some(x => x.poolId === id) ? prev : [...prev, p]))
      setSelectedPool(id)
    } catch {
      setSearchErr(`No existe ningún pool con ID #${id}`)
    } finally { setSearchLoading(false) }
  }

  return (
    <div className="space-y-4 pb-6">
      {/* ── Header ── */}
      <div className="rounded-3xl p-4 border border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 to-blue-500/5">
        <div className="flex items-center gap-2 mb-2">
          <Factory className="w-5 h-5 text-cyan-300" />
          <h2 className="text-lg font-black text-white">Stake Factory</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Crea tu propio pool de staking para cualquier token de World Chain. Cualquiera puede
          fondear, y tú decides el APR.
        </p>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Stat label="Pools creados" value={config ? config.poolCount.toString() : '—'} />
          <Stat label="Cuota de creación" value={config ? '$2 USDC' : '—'} c="text-emerald-300" />
        </div>
      </div>

      {/* ── Top Tabs ── */}
      {!pool && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {([
            { id: 'pools', label: '🏊 Pools', icon: <Coins className="w-3.5 h-3.5" /> },
            { id: 'create', label: '➕ Crear Pool', icon: <Plus className="w-3.5 h-3.5" /> },
            { id: 'info', label: 'ℹ️ Info', icon: <Info className="w-3.5 h-3.5" /> },
          ] as { id: TopTab; label: string; icon: React.ReactNode }[]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn('shrink-0 px-4 py-2 rounded-2xl text-xs font-bold border transition-colors',
                tab === t.id ? 'bg-cyan-500/25 border-cyan-500/50 text-cyan-200' : 'bg-white/5 border-white/10 text-muted-foreground')}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {loading && !pool && (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-cyan-400" /></div>
      )}

      {/* ── POOL DETAIL ── */}
      {pool && (
        <PoolDetail
          pool={pool}
          userAddress={addr}
          isMK={isMK}
          importedSigner={importedSigner}
          onBack={() => setSelectedPool(null)}
          onRefresh={refresh}
        />
      )}

      {/* ── POOLS LIST ── */}
      {!pool && !loading && tab === 'pools' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-2">
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={searchId} onChange={e => { setSearchId(e.target.value.replace(/[^0-9]/g, '')); setSearchErr('') }}
                  onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
                  placeholder="Buscar pool por ID (ej: 3)"
                  className="w-full rounded-xl bg-black/40 border border-white/15 pl-9 pr-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
              </div>
              <button onClick={handleSearch} disabled={searchLoading || !searchId}
                className={cn('shrink-0 px-4 py-2 rounded-xl text-xs font-black border bg-cyan-500/25 border-cyan-500/50 text-cyan-200',
                  (searchLoading || !searchId) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-cyan-500/35')}>
                {searchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Buscar'}
              </button>
            </div>
            {searchErr && <p className="text-[10px] text-red-300">{searchErr}</p>}
          </div>
          {pools.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
              <p className="text-sm text-muted-foreground">Aún no hay pools creados. ¡Sé el primero!</p>
            </div>
          )}
          {pools.map(p => (
            <button key={p.poolId} onClick={() => setSelectedPool(p.poolId)}
              className="w-full text-left rounded-2xl border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition-colors flex items-center gap-3">
              {p.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.logoUrl} alt={p.symbol} className="w-10 h-10 rounded-full object-cover border border-white/10 shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
                  <Coins className="w-5 h-5 text-cyan-300" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-white truncate">{p.name}</p>
                  <span className="text-[10px] text-muted-foreground">${p.symbol}</span>
                  {p.paused && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">Pausado</span>}
                </div>
                <p className="text-[10px] text-muted-foreground truncate">Creador: {shortAddr(p.creator)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-black text-amber-300">{formatAPR(p.aprBps)}</p>
                <p className="text-[9px] text-muted-foreground">APR</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── CREATE POOL ── */}
      {!pool && !loading && tab === 'create' && (
        <CreatePoolForm
          userAddress={addr}
          isMK={isMK}
          importedSigner={importedSigner}
          config={config}
          usdcBalance={usdcBalance}
          onCreated={(id) => { load(); setTimeout(() => { setSelectedPool(id); setTab('pools') }, 4500) }}
        />
      )}

      {/* ── INFO ── */}
      {!pool && tab === 'info' && <InfoTab config={config} />}
    </div>
  )
}

// ─── Create Pool Form ─────────────────────────────────────────────────────────
function CreatePoolForm({ userAddress, isMK, importedSigner, config, usdcBalance, onCreated }: {
  userAddress: string; isMK: boolean; importedSigner?: ethers.Signer | null
  config: StakeFactoryConfig | null; usdcBalance: bigint
  onCreated: (poolId: number) => void
}) {
  const [tokenAddr, setTokenAddr] = useState('')
  const [tokenMeta, setTokenMeta] = useState<{ decimals: number; symbol: string; name: string } | null>(null)
  const [checkingToken, setCheckingToken] = useState(false)
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [apr, setApr] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  useEffect(() => {
    let cancelled = false
    if (!tokenAddr || !ethers.isAddress(tokenAddr)) { setTokenMeta(null); return }
    setCheckingToken(true)
    fetchErc20Meta(tokenAddr).then(meta => {
      if (cancelled) return
      setTokenMeta(meta)
      if (!name) setName(meta.name)
      if (!symbol) setSymbol(meta.symbol)
    }).catch(() => setTokenMeta(null)).finally(() => { if (!cancelled) setCheckingToken(false) })
    return () => { cancelled = true }
  }, [tokenAddr])

  const aprBps = (() => { const n = parseFloat((apr || '0').replace(',', '.')); return isNaN(n) ? 0 : Math.round(n * 100) })()
  const feeAmount = config?.creationFeeAmount ?? 2_000000n
  const hasEnoughUsdc = usdcBalance >= feeAmount

  const doCreate = async () => {
    if (!ethers.isAddress(tokenAddr)) { setMsg({ ok: false, text: 'Dirección de token inválida' }); return }
    if (!name.trim() || !symbol.trim()) { setMsg({ ok: false, text: 'Nombre y símbolo requeridos' }); return }
    if (aprBps <= 0 || aprBps > MAX_APR_BPS) { setMsg({ ok: false, text: `APR inválido (máx ${MAX_APR_BPS / 100}%)` }); return }
    setLoading(true); setMsg(null)
    try {
      if (isMK) {
        const nonce = randomNonce()
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: STAKE_FACTORY_ADDRESS,
            abi: CREATE_POOL_ABI_FRAG,
            functionName: 'createPool',
            args: [
              tokenAddr, name.trim(), symbol.trim(), logoUrl.trim(), aprBps.toString(),
              { permitted: { token: USDC_ADDRESS, amount: feeAmount.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_0',
            ],
          }],
          permit2: [{ permitted: { token: USDC_ADDRESS, amount: feeAmount.toString() }, spender: STAKE_FACTORY_ADDRESS, nonce: nonce.toString(), deadline: deadline.toString() }],
        })
        if (finalPayload.status === 'success') {
          setMsg({ ok: true, text: '✓ Pool creado exitosamente' })
          onCreated(-1)
        } else setMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const ERC20_ABI = ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) nonpayable returns (bool)']
        const uc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, importedSigner)
        const allow = await uc.allowance(userAddress, STAKE_FACTORY_ADDRESS)
        if (allow < feeAmount) await (await uc.approve(STAKE_FACTORY_ADDRESS, feeAmount * 10n)).wait()
        const fc = new ethers.Contract(STAKE_FACTORY_ADDRESS, CREATE_POOL_NORMAL_ABI_FRAG, importedSigner)
        const tx = await fc.createPoolNormal(tokenAddr, name.trim(), symbol.trim(), logoUrl.trim(), aprBps)
        await tx.wait()
        setMsg({ ok: true, text: '✓ Pool creado exitosamente' })
        onCreated(-1)
      } else setMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-3">
      <MsgBox msg={msg} onClear={() => setMsg(null)} />
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-3">
        <div>
          <label className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider">Token ERC20 (World Chain)</label>
          <input value={tokenAddr} onChange={e => setTokenAddr(e.target.value.trim())}
            placeholder="0x..."
            className="w-full mt-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
          {checkingToken && <p className="text-[10px] text-muted-foreground mt-1">Verificando token…</p>}
          {tokenMeta && (
            <p className="text-[10px] text-emerald-300 mt-1">✓ {tokenMeta.name} (${tokenMeta.symbol}) · {tokenMeta.decimals} decimales</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider">Nombre del pool</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Mi Pool"
              className="w-full mt-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder-muted-foreground outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider">Símbolo</label>
            <input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="MPL"
              className="w-full mt-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder-muted-foreground outline-none" />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Logo (URL, opcional)</label>
          <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..."
            className="w-full mt-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider">APR inicial (%) · máx {MAX_APR_BPS / 100}%</label>
          <input value={apr} onChange={e => setApr(e.target.value)} placeholder="ej: 50"
            className="w-full mt-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
        </div>
        <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-[10px] text-muted-foreground space-y-0.5">
          <p>Cuota de creación: <span className="text-emerald-300 font-bold">2 USDC</span></p>
          <p>Tu saldo USDC: <span className={hasEnoughUsdc ? 'text-emerald-300' : 'text-red-300'}>{formatToken(usdcBalance, 6, 2)} USDC</span></p>
          <p>Comisión por pool: 5% en depósito/retiro/reclamo (4% para ti + co-owners, 1% ACUA)</p>
        </div>
        <ActionBtn onClick={doCreate} loading={loading}
          disabled={!ethers.isAddress(tokenAddr) || !name.trim() || !symbol.trim() || aprBps <= 0 || !hasEnoughUsdc}
          label="Crear Pool (2 USDC)" icon={<Plus className="w-4 h-4" />}
          color="bg-cyan-500/20 border-cyan-500/40 text-cyan-300" />
        {!hasEnoughUsdc && <p className="text-[10px] text-red-300 text-center">Necesitas 2 USDC en tu wallet para crear un pool</p>}
      </div>
    </div>
  )
}

// ─── Pool Detail ──────────────────────────────────────────────────────────────
function PoolDetail({ pool, userAddress, isMK, importedSigner, onBack, onRefresh }: {
  pool: StakeFactoryPoolInfo; userAddress: string; isMK: boolean; importedSigner?: ethers.Signer | null
  onBack: () => void; onRefresh: () => void
}) {
  const [tab, setTab] = useState<'stake' | 'owners' | 'admin'>('stake')
  const [userInfo, setUserInfo] = useState<StakeFactoryUserInfo | null>(null)
  const [owners, setOwners] = useState<string[]>([])
  const [tokenBalance, setTokenBalance] = useState(0n)
  const [loading, setLoading] = useState(true)

  const [depositAmt, setDepositAmt] = useState('')
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [fundAmt, setFundAmt] = useState('')
  const [newOwnerAddr, setNewOwnerAddr] = useState('')
  const [aprInput, setAprInput] = useState('')

  const [lDep, setLDep] = useState(false)
  const [lWith, setLWith] = useState(false)
  const [lClaim, setLClaim] = useState(false)
  const [lFund, setLFund] = useState(false)
  const [lAddOwner, setLAddOwner] = useState(false)
  const [lRemoveOwner, setLRemoveOwner] = useState(false)
  const [lApr, setLApr] = useState(false)
  const [lPause, setLPause] = useState(false)

  const [depMsg, setDepMsg] = useState<Msg>(null)
  const [withMsg, setWithMsg] = useState<Msg>(null)
  const [claimMsg, setClaimMsg] = useState<Msg>(null)
  const [ownerMsg, setOwnerMsg] = useState<Msg>(null)
  const [adminMsg, setAdminMsg] = useState<Msg>(null)

  const isOwner = owners.some(o => o.toLowerCase() === userAddress.toLowerCase())
  const isCreator = pool.creator.toLowerCase() === userAddress.toLowerCase()

  const load = useCallback(async () => {
    if (!userAddress) { setLoading(false); return }
    setLoading(true)
    try {
      const [info, ownerList, bal] = await Promise.all([
        fetchUserStakeInfo(pool.poolId, userAddress),
        fetchPoolOwners(pool.poolId),
        fetchErc20Balance(pool.token, userAddress),
      ])
      setUserInfo(info)
      setOwners(ownerList)
      setTokenBalance(bal)
    } catch (e) { console.error('PoolDetail load:', e) }
    finally { setLoading(false) }
  }, [pool.poolId, pool.token, userAddress])

  useEffect(() => { load() }, [load])
  const refresh = () => { setTimeout(load, 4000); onRefresh() }

  const dec = pool.tokenDecimals

  const doDeposit = async () => {
    let gross: bigint
    try { gross = ethers.parseUnits((depositAmt || '0').replace(',', '.'), dec) } catch { return }
    if (!gross) return
    if (tokenBalance < gross) { setDepMsg({ ok: false, text: 'Balance insuficiente' }); return }
    setLDep(true); setDepMsg(null)
    try {
      if (isMK) {
        const nonce = randomNonce()
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: STAKE_FACTORY_ADDRESS, abi: DEPOSIT_ABI_FRAG, functionName: 'deposit',
            args: [pool.poolId.toString(),
              { permitted: { token: pool.token, amount: gross.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_0', gross.toString()],
          }],
          permit2: [{ permitted: { token: pool.token, amount: gross.toString() }, spender: STAKE_FACTORY_ADDRESS, nonce: nonce.toString(), deadline: deadline.toString() }],
        })
        if (finalPayload.status === 'success') { setDepMsg({ ok: true, text: '✓ Depósito realizado (5% comisión aplicada)' }); setDepositAmt(''); refresh() }
        else setDepMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const ERC20_ABI = ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) nonpayable returns (bool)']
        const tc = new ethers.Contract(pool.token, ERC20_ABI, importedSigner)
        const allow = await tc.allowance(userAddress, STAKE_FACTORY_ADDRESS)
        if (allow < gross) await (await tc.approve(STAKE_FACTORY_ADDRESS, gross * 100n)).wait()
        const sc = new ethers.Contract(STAKE_FACTORY_ADDRESS, DEPOSIT_NORMAL_ABI_FRAG, importedSigner)
        await (await sc.depositNormal(pool.poolId, gross)).wait()
        setDepMsg({ ok: true, text: '✓ Depósito realizado (5% comisión aplicada)' }); setDepositAmt(''); refresh()
      } else setDepMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setDepMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLDep(false) }
  }

  const doWithdraw = async () => {
    if (!userInfo || userInfo.staked === 0n) { setWithMsg({ ok: false, text: 'Sin stake activo' }); return }
    let amount: bigint
    try { amount = withdrawAmt ? ethers.parseUnits(withdrawAmt.replace(',', '.'), dec) : userInfo.staked } catch { return }
    if (!amount || amount > userInfo.staked) { setWithMsg({ ok: false, text: 'Cantidad inválida' }); return }
    setLWith(true); setWithMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_FACTORY_ADDRESS, abi: WITHDRAW_ABI_FRAG, functionName: 'withdraw', args: [pool.poolId.toString(), amount.toString()] }],
        })
        if (finalPayload.status === 'success') { setWithMsg({ ok: true, text: '✓ Retiro completado (5% comisión aplicada)' }); setWithdrawAmt(''); refresh() }
        else setWithMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_FACTORY_ADDRESS, WITHDRAW_ABI_FRAG, importedSigner)
        await (await sc.withdraw(pool.poolId, amount)).wait()
        setWithMsg({ ok: true, text: '✓ Retiro completado (5% comisión aplicada)' }); setWithdrawAmt(''); refresh()
      } else setWithMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setWithMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLWith(false) }
  }

  const doClaim = async () => {
    if (!userInfo || userInfo.rewards === 0n) { setClaimMsg({ ok: false, text: 'Sin recompensas pendientes' }); return }
    setLClaim(true); setClaimMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_FACTORY_ADDRESS, abi: CLAIM_ABI_FRAG, functionName: 'claimRewards', args: [pool.poolId.toString()] }],
        })
        if (finalPayload.status === 'success') { setClaimMsg({ ok: true, text: '✓ Recompensas reclamadas (5% comisión aplicada)' }); refresh() }
        else setClaimMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_FACTORY_ADDRESS, CLAIM_ABI_FRAG, importedSigner)
        await (await sc.claimRewards(pool.poolId)).wait()
        setClaimMsg({ ok: true, text: '✓ Recompensas reclamadas (5% comisión aplicada)' }); refresh()
      } else setClaimMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setClaimMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLClaim(false) }
  }

  const doFund = async () => {
    let amount: bigint
    try { amount = ethers.parseUnits((fundAmt || '0').replace(',', '.'), dec) } catch { return }
    if (!amount) return
    setLFund(true); setAdminMsg(null)
    try {
      if (isMK) {
        const nonce = randomNonce()
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: STAKE_FACTORY_ADDRESS, abi: FUND_ABI_FRAG, functionName: 'fund',
            args: [pool.poolId.toString(),
              { permitted: { token: pool.token, amount: amount.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_0', amount.toString()],
          }],
          permit2: [{ permitted: { token: pool.token, amount: amount.toString() }, spender: STAKE_FACTORY_ADDRESS, nonce: nonce.toString(), deadline: deadline.toString() }],
        })
        if (finalPayload.status === 'success') { setAdminMsg({ ok: true, text: '✓ Pool fondeado' }); setFundAmt(''); refresh() }
        else setAdminMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const ERC20_ABI = ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) nonpayable returns (bool)']
        const tc = new ethers.Contract(pool.token, ERC20_ABI, importedSigner)
        const allow = await tc.allowance(userAddress, STAKE_FACTORY_ADDRESS)
        if (allow < amount) await (await tc.approve(STAKE_FACTORY_ADDRESS, amount * 100n)).wait()
        const sc = new ethers.Contract(STAKE_FACTORY_ADDRESS, FUND_DIRECT_ABI_FRAG, importedSigner)
        await (await sc.fundDirect(pool.poolId, amount)).wait()
        setAdminMsg({ ok: true, text: '✓ Pool fondeado (directo)' }); setFundAmt(''); refresh()
      } else setAdminMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setAdminMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLFund(false) }
  }

  const doAddOwner = async () => {
    if (!ethers.isAddress(newOwnerAddr)) { setOwnerMsg({ ok: false, text: 'Dirección inválida' }); return }
    setLAddOwner(true); setOwnerMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_FACTORY_ADDRESS, abi: ADD_OWNER_ABI_FRAG, functionName: 'addOwner', args: [pool.poolId.toString(), newOwnerAddr] }],
        })
        if (finalPayload.status === 'success') { setOwnerMsg({ ok: true, text: '✓ Co-owner agregado' }); setNewOwnerAddr(''); refresh() }
        else setOwnerMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_FACTORY_ADDRESS, ADD_OWNER_ABI_FRAG, importedSigner)
        await (await sc.addOwner(pool.poolId, newOwnerAddr)).wait()
        setOwnerMsg({ ok: true, text: '✓ Co-owner agregado' }); setNewOwnerAddr(''); refresh()
      } else setOwnerMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setOwnerMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLAddOwner(false) }
  }

  const doRemoveOwner = async (ownerAddr: string) => {
    setLRemoveOwner(true); setOwnerMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_FACTORY_ADDRESS, abi: REMOVE_OWNER_ABI_FRAG, functionName: 'removeOwner', args: [pool.poolId.toString(), ownerAddr] }],
        })
        if (finalPayload.status === 'success') { setOwnerMsg({ ok: true, text: '✓ Co-owner removido' }); refresh() }
        else setOwnerMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_FACTORY_ADDRESS, REMOVE_OWNER_ABI_FRAG, importedSigner)
        await (await sc.removeOwner(pool.poolId, ownerAddr)).wait()
        setOwnerMsg({ ok: true, text: '✓ Co-owner removido' }); refresh()
      } else setOwnerMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setOwnerMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLRemoveOwner(false) }
  }

  const doSetApr = async () => {
    const pct = parseFloat((aprInput || '0').replace(',', '.'))
    const bps = Math.round(pct * 100)
    if (!bps || bps < 0 || bps > MAX_APR_BPS) { setAdminMsg({ ok: false, text: `APR inválido (máx ${MAX_APR_BPS / 100}%)` }); return }
    setLApr(true); setAdminMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_FACTORY_ADDRESS, abi: SET_APR_ABI_FRAG, functionName: 'setApr', args: [pool.poolId.toString(), bps.toString()] }],
        })
        if (finalPayload.status === 'success') { setAdminMsg({ ok: true, text: `✓ APR actualizado a ${(bps / 100).toFixed(2)}%` }); setAprInput(''); refresh() }
        else setAdminMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_FACTORY_ADDRESS, SET_APR_ABI_FRAG, importedSigner)
        await (await sc.setApr(pool.poolId, bps)).wait()
        setAdminMsg({ ok: true, text: `✓ APR actualizado a ${(bps / 100).toFixed(2)}%` }); setAprInput(''); refresh()
      } else setAdminMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setAdminMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLApr(false) }
  }

  const doPause = async (val: boolean) => {
    setLPause(true); setAdminMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_FACTORY_ADDRESS, abi: SET_PAUSED_ABI_FRAG, functionName: 'setPaused', args: [pool.poolId.toString(), val] }],
        })
        if (finalPayload.status === 'success') { setAdminMsg({ ok: true, text: val ? '✓ Pool pausado' : '✓ Pool reactivado' }); refresh() }
        else setAdminMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_FACTORY_ADDRESS, SET_PAUSED_ABI_FRAG, importedSigner)
        await (await sc.setPaused(pool.poolId, val)).wait()
        setAdminMsg({ ok: true, text: val ? '✓ Pool pausado' : '✓ Pool reactivado' }); refresh()
      } else setAdminMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setAdminMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLPause(false) }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white">
        <ChevronLeft className="w-4 h-4" /> Volver a la lista
      </button>

      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 flex items-center gap-3">
        {pool.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pool.logoUrl} alt={pool.symbol} className="w-12 h-12 rounded-full object-cover border border-white/10 shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        ) : (
          <div className="w-12 h-12 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
            <Coins className="w-6 h-6 text-cyan-300" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-base font-black text-white truncate">{pool.name} <span className="text-xs text-muted-foreground">${pool.symbol}</span></p>
          <p className="text-[10px] text-muted-foreground font-mono truncate">Pool #{pool.poolId} · Token: {shortAddr(pool.token)} · {pool.tokenDecimals} dec</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-black text-amber-300">{formatAPR(pool.aprBps)}</p>
          <p className="text-[9px] text-muted-foreground">APR</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-2">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          <Shield className="w-3 h-3" /> Contratos (World Chain)
        </p>
        <CopyRow label={`ID de pool #${pool.poolId} — Contrato del stake (Stake Factory)`} value={STAKE_FACTORY_ADDRESS} />
        <CopyRow label={`Contrato del token $${pool.symbol}`} value={pool.token} />
      </div>

      {pool.paused && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-2 text-center text-xs text-red-300 font-bold">
          Este pool está pausado — depósitos/retiros/reclamos deshabilitados
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Total stakeado" value={formatToken(pool.totalStaked, dec, 2)} />
        <Stat label="Fund Pool" value={formatToken(pool.fundPool, dec, 2)} c="text-emerald-300" />
        <Stat label="Usuarios" value={pool.totalUsers.toString()} c="text-blue-300" />
        <Stat label="Creador" value={shortAddr(pool.creator)} c="text-fuchsia-300" />
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {([
          { id: 'stake', label: '🪙 Stake' },
          { id: 'owners', label: '👥 Owners' },
          ...(isOwner ? [{ id: 'admin' as const, label: '🛡 Admin' }] : []),
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={cn('shrink-0 px-4 py-2 rounded-2xl text-xs font-bold border transition-colors',
              tab === t.id ? 'bg-cyan-500/25 border-cyan-500/50 text-cyan-200' : 'bg-white/5 border-white/10 text-muted-foreground')}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-cyan-400" /></div>}

      {!loading && tab === 'stake' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Mi stake" value={userInfo ? formatToken(userInfo.staked, dec, 4) : '—'} />
            <Stat label="Recompensas" value={userInfo ? formatToken(userInfo.rewards, dec, 4) : '—'} c="text-emerald-300" />
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Mi balance: {formatToken(tokenBalance, dec, 4)} ${pool.symbol}
          </p>

          <MsgBox msg={depMsg} onClear={() => setDepMsg(null)} />
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
            <p className="text-xs font-bold text-emerald-300 flex items-center gap-1.5"><ArrowDownToLine className="w-3.5 h-3.5" /> Depositar</p>
            <div className="flex gap-2">
              <input value={depositAmt} onChange={e => setDepositAmt(e.target.value)} placeholder={`Cantidad ${pool.symbol}`}
                className="flex-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
              <button onClick={() => setDepositAmt(ethers.formatUnits(tokenBalance, dec))} className="shrink-0 px-2 rounded-xl text-[10px] font-bold border border-white/15 text-muted-foreground">MAX</button>
            </div>
            <ActionBtn onClick={doDeposit} loading={lDep} disabled={!depositAmt || pool.paused}
              label="Depositar (5% comisión)" icon={<ArrowDownToLine className="w-4 h-4" />}
              color="bg-emerald-500/20 border-emerald-500/40 text-emerald-300" />
          </div>

          <MsgBox msg={withMsg} onClear={() => setWithMsg(null)} />
          <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4 space-y-2">
            <p className="text-xs font-bold text-orange-300 flex items-center gap-1.5"><ArrowUpFromLine className="w-3.5 h-3.5" /> Retirar (instantáneo)</p>
            <div className="flex gap-2">
              <input value={withdrawAmt} onChange={e => setWithdrawAmt(e.target.value)} placeholder="Vacío = todo"
                className="flex-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
            </div>
            <ActionBtn onClick={doWithdraw} loading={lWith} disabled={!userInfo || userInfo.staked === 0n || pool.paused}
              label="Retirar (5% comisión)" icon={<ArrowUpFromLine className="w-4 h-4" />}
              color="bg-orange-500/20 border-orange-500/40 text-orange-300" />
          </div>

          <MsgBox msg={claimMsg} onClear={() => setClaimMsg(null)} />
          <ActionBtn onClick={doClaim} loading={lClaim} disabled={!userInfo || userInfo.rewards === 0n || pool.paused}
            label="Reclamar recompensas (5% comisión)" icon={<Coins className="w-4 h-4" />}
            color="bg-pink-500/20 border-pink-500/40 text-pink-300" />
        </div>
      )}

      {!loading && tab === 'owners' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
            <p className="text-xs font-bold text-fuchsia-300 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Owners del pool ({owners.length})</p>
            <p className="text-[10px] text-muted-foreground">Todos los owners pueden fondear el pool y comparten por igual el 4% de comisión.</p>
            <div className="space-y-1">
              {owners.map(o => (
                <div key={o} className="flex items-center justify-between rounded-xl bg-black/30 border border-white/10 px-3 py-2">
                  <span className="text-[10px] font-mono text-white">{shortAddr(o)}{o.toLowerCase() === pool.creator.toLowerCase() && <span className="ml-1 text-[9px] text-amber-300">(creador)</span>}</span>
                  {isCreator && o.toLowerCase() !== pool.creator.toLowerCase() && (
                    <button onClick={() => doRemoveOwner(o)} disabled={lRemoveOwner} className="text-red-300 hover:text-red-200 disabled:opacity-40">
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {isCreator && (
            <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 space-y-2">
              <MsgBox msg={ownerMsg} onClear={() => setOwnerMsg(null)} />
              <p className="text-xs font-bold text-fuchsia-300 flex items-center gap-1.5"><UserPlus className="w-3.5 h-3.5" /> Agregar co-owner</p>
              <div className="flex gap-2">
                <input value={newOwnerAddr} onChange={e => setNewOwnerAddr(e.target.value.trim())} placeholder="0x..."
                  className="flex-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
                <button onClick={doAddOwner} disabled={lAddOwner || !newOwnerAddr}
                  className={cn('shrink-0 px-3 rounded-xl text-xs font-black border bg-fuchsia-500/25 border-fuchsia-500/50 text-fuchsia-200',
                    (lAddOwner || !newOwnerAddr) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-fuchsia-500/35')}>
                  {lAddOwner ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Agregar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'admin' && isOwner && (
        <div className="space-y-3">
          <MsgBox msg={adminMsg} onClear={() => setAdminMsg(null)} />

          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-2">
            <p className="text-xs font-bold text-blue-300 flex items-center gap-1.5"><Fuel className="w-3.5 h-3.5" /> Fondear pool</p>
            <div className="flex gap-2">
              <input value={fundAmt} onChange={e => setFundAmt(e.target.value)} placeholder={`Cantidad ${pool.symbol}`}
                className="flex-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
              <button onClick={doFund} disabled={lFund || !fundAmt}
                className={cn('shrink-0 px-3 rounded-xl text-xs font-black border bg-blue-500/25 border-blue-500/50 text-blue-200',
                  (lFund || !fundAmt) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-500/35')}>
                {lFund ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Fondear'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
            <p className="text-xs font-bold text-amber-300">Ajustar APR</p>
            <p className="text-[10px] text-muted-foreground">Actual: {formatAPR(pool.aprBps)} · máx {MAX_APR_BPS / 100}%</p>
            <div className="flex gap-2">
              <input value={aprInput} onChange={e => setAprInput(e.target.value)} placeholder="ej: 50 = 50%"
                className="flex-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
              <button onClick={doSetApr} disabled={lApr || !aprInput}
                className={cn('shrink-0 px-3 rounded-xl text-xs font-black border bg-amber-500/25 border-amber-500/50 text-amber-200',
                  (lApr || !aprInput) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-amber-500/35')}>
                {lApr ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Actualizar'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
            <p className="text-xs font-bold text-white">Estado del pool</p>
            <ActionBtn onClick={() => doPause(!pool.paused)} loading={lPause}
              label={pool.paused ? 'Reactivar pool' : 'Pausar pool'}
              icon={pool.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              color={pool.paused ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-red-500/20 border-red-500/40 text-red-300'} />
          </div>
         </div>
        )}
    </div>
  )
}

// ─── Info Tab ─────────────────────────────────────────────────────────────────
function InfoTab({ config }: { config: StakeFactoryConfig | null }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-2">
        <p className="text-sm font-bold text-cyan-300">¿Qué es Stake Factory?</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Stake Factory te permite crear tu propio pool de staking para cualquier token ERC20
          de World Chain, sin necesidad de programar ni desplegar contratos. Tú decides el
          nombre, símbolo, logo y el APR de tu pool.
        </p>
      </div>

      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
        <p className="text-sm font-bold text-emerald-300">Cómo crear un pool</p>
        <ol className="text-xs text-muted-foreground leading-relaxed list-decimal list-inside space-y-1">
          <li>Pega la dirección del token ERC20 que quieres poner en staking</li>
          <li>Define nombre, símbolo, logo (opcional) y el APR inicial (máximo {MAX_APR_BPS / 100}%)</li>
          <li>Paga la cuota única de creación: <strong className="text-white">2 USDC</strong></li>
          <li>¡Tu pool queda activo al instante para que cualquiera lo fondee y haga stake!</li>
        </ol>
      </div>

      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
        <p className="text-sm font-bold text-amber-300">Comisiones</p>
        <ul className="text-xs text-muted-foreground leading-relaxed space-y-1">
          <li>• Depósito: {formatFee(DEPOSIT_FEE_BPS)} — 4% para ti y tus co-owners, 1% para ACUA</li>
          <li>• Retiro: {formatFee(WITHDRAW_FEE_BPS)} — 4% para ti y tus co-owners, 1% para ACUA</li>
          <li>• Reclamo de recompensas: {formatFee(CLAIM_FEE_BPS)} — 4% para ti y tus co-owners, 1% para ACUA</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 space-y-2">
        <p className="text-sm font-bold text-fuchsia-300">Co-owners</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Como creador, puedes agregar o quitar co-owners de tu pool. Todos los owners pueden
          fondear el pool y ajustar el APR / pausar el pool, y comparten por igual la comisión
          del 4% generada por depósitos, retiros y reclamos.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-1">
        <p className="text-sm font-bold text-white flex items-center gap-1.5"><ExternalLink className="w-3.5 h-3.5" /> Contrato</p>
        <p className="text-[10px] font-mono text-muted-foreground break-all">{STAKE_FACTORY_ADDRESS}</p>
        <p className="text-[10px] text-muted-foreground">Dueño de ACUA (1% de cada comisión): {ACUA_OWNER_ADDRESS}</p>
      </div>
    </div>
  )
}
