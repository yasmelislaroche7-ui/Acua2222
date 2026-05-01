'use client'

import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import {
  Activity, Users, Coins, TrendingUp, Wallet,
  BarChart2, RefreshCw, Loader2, Zap, Award,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getProvider, STAKING_CONTRACTS, UNIVERSAL_STAKING_ABI } from '@/lib/new-contracts'
import { fetchH2OBalance, fetchStakeInfo, StakeInfo } from '@/lib/contract'

const H2O_TOKEN = '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d'
const H2O_STAKE_CONTRACT = '0xabbD2D0360bA25FBb82a6f7574a150F1AEAc2e04'

const H2O_STAKE_ABI_MIN = [
  'function totalStaked() view returns (uint256)',
  'function owner() view returns (address)',
]

const ERC20_ABI_MIN = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]

interface PlatformData {
  h2oStaked: bigint
  h2oContractBalance: bigint
  newContractStakes: { name: string; staked: bigint }[]
  totalNewStaked: bigint
}

interface UserData {
  h2oBalance: bigint
  stakeInfo: StakeInfo | null
}

// ─── Format helpers ───────────────────────────────────────────────────────────
function fmt(v: bigint, decimals = 18, digits = 2): string {
  const s = ethers.formatUnits(v, decimals)
  const n = parseFloat(s)
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(digits)
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  icon, label, value, sub, color = 'text-[oklch(0.65_0.22_255)]', loading,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color?: string; loading?: boolean
}) {
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-[oklch(0.22_0.025_245)] bg-[oklch(0.12_0.02_245)] px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="opacity-60">{icon}</span>
        <span className="text-[10px] font-medium text-[oklch(0.50_0.012_230)] truncate">{label}</span>
      </div>
      {loading ? (
        <div className="h-5 w-16 bg-white/5 animate-pulse rounded" />
      ) : (
        <p className={`text-base font-black font-mono truncate ${color}`}>{value}</p>
      )}
      {sub && !loading && (
        <p className="text-[9px] text-[oklch(0.40_0.01_230)] mt-0.5 truncate">{sub}</p>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function PlatformMonitor({
  userAddress,
  stakeInfo,
  h2oBalance,
  onRefresh,
}: {
  userAddress: string
  stakeInfo: StakeInfo | null
  h2oBalance: bigint
  onRefresh: () => void
}) {
  const [platform, setPlatform] = useState<PlatformData | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const p = getProvider()

      // H2O main staking contract
      const h2oContract = new ethers.Contract(H2O_STAKE_CONTRACT, H2O_STAKE_ABI_MIN, p)
      const [h2oStaked, h2oBalance] = await Promise.allSettled([
        h2oContract.totalStaked(),
        new ethers.Contract(H2O_TOKEN, ERC20_ABI_MIN, p).balanceOf(H2O_STAKE_CONTRACT),
      ])

      // New staking contracts
      const newContractEntries = Object.entries(STAKING_CONTRACTS)
      const newStakes = await Promise.allSettled(
        newContractEntries.map(async ([name, addr]) => {
          const c = new ethers.Contract(addr, UNIVERSAL_STAKING_ABI, p)
          try {
            const bal = await new ethers.Contract(
              await c.TOKEN ? await c.TOKEN() : addr,
              ERC20_ABI_MIN,
              p
            ).balanceOf(addr)
            return { name, staked: bal as bigint }
          } catch {
            return { name, staked: 0n }
          }
        })
      )

      const newContractStakes = newStakes.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { name: newContractEntries[i][0], staked: 0n }
      )
      const totalNewStaked = newContractStakes.reduce((s, c) => s + c.staked, 0n)

      setPlatform({
        h2oStaked: h2oStaked.status === 'fulfilled' ? h2oStaked.value : 0n,
        h2oContractBalance: h2oBalance.status === 'fulfilled' ? h2oBalance.value : 0n,
        newContractStakes,
        totalNewStaked,
      })
      setLastRefresh(new Date())
    } catch (e) {
      console.error('[monitor] load error', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const pendingReward = stakeInfo?.pending ?? 0n
  const userStaked = stakeInfo?.staked ?? 0n

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[oklch(0.65_0.22_255)]" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">Monitor de Plataforma</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#00c076] animate-pulse" />
        </div>
        <button
          onClick={() => { load(); onRefresh() }}
          disabled={loading}
          className="flex items-center gap-1 text-[10px] text-[oklch(0.50_0.012_230)] hover:text-foreground transition-colors"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {lastRefresh ? lastRefresh.toLocaleTimeString() : 'Actualizar'}
        </button>
      </div>

      {/* User stats */}
      <div>
        <p className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider mb-1.5 px-0.5">
          Mi Cuenta
        </p>
        <div className="flex gap-2">
          <StatCard
            icon={<Wallet className="w-3 h-3" />}
            label="Balance H2O"
            value={fmt(h2oBalance)}
            sub="wallet"
            color="text-cyan-400"
          />
          <StatCard
            icon={<Coins className="w-3 h-3" />}
            label="En Stake"
            value={fmt(userStaked)}
            sub="H2O bloqueado"
            color="text-[oklch(0.65_0.22_255)]"
          />
          <StatCard
            icon={<Award className="w-3 h-3" />}
            label="Pendiente"
            value={fmt(pendingReward)}
            sub="por reclamar"
            color="text-[#00c076]"
          />
        </div>
      </div>

      {/* Platform stats */}
      <div>
        <p className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider mb-1.5 px-0.5">
          Plataforma
        </p>
        <div className="flex gap-2">
          <StatCard
            icon={<BarChart2 className="w-3 h-3" />}
            label="H2O Stakeado"
            value={loading ? '...' : fmt(platform?.h2oStaked ?? 0n)}
            sub="contrato principal"
            loading={loading && !platform}
          />
          <StatCard
            icon={<TrendingUp className="w-3 h-3" />}
            label="Pool Multi"
            value={loading ? '...' : fmt(platform?.totalNewStaked ?? 0n)}
            sub="8 tokens activos"
            loading={loading && !platform}
          />
          <StatCard
            icon={<Zap className="w-3 h-3" />}
            label="APY H2O"
            value="12%"
            sub="anual"
            color="text-amber-400"
          />
        </div>
      </div>

      {/* Active contracts table */}
      {platform && platform.newContractStakes.length > 0 && (
        <div className="rounded-lg border border-[oklch(0.22_0.025_245)] overflow-hidden">
          <div className="px-3 py-1.5 bg-[oklch(0.10_0.018_245)] border-b border-[oklch(0.22_0.025_245)]">
            <span className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">
              Contratos Activos
            </span>
          </div>
          <div className="divide-y divide-[oklch(0.18_0.02_245)]">
            {platform.newContractStakes.map(({ name, staked }) => (
              <div key={name} className="flex items-center justify-between px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[oklch(0.65_0.22_255)]" />
                  <span className="text-[11px] font-semibold text-foreground font-mono">{name}</span>
                </div>
                <span className="text-[11px] font-bold font-mono text-[oklch(0.65_0.22_255)]">
                  {fmt(staked)} <span className="text-[oklch(0.45_0.01_230)] text-[9px]">{name}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
