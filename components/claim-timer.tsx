'use client'

import { useCountdown } from '@/hooks/use-countdown'
import { Clock, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * ClaimTimer — compact badge shown next to Claim / Withdraw buttons.
 *
 * Props:
 *   targetTs      — unix timestamp (seconds) when action becomes available
 *   totalDelaySecs — full cooldown in seconds (for progress bar)
 *   label         — override ready label (default: "Disponible")
 *   size          — 'sm' | 'md'
 *   variant       — 'claim' | 'withdraw'
 */
export function ClaimTimer({
  targetTs,
  totalDelaySecs = 0,
  label: readyLabel = 'Disponible',
  size = 'sm',
  variant = 'claim',
}: {
  targetTs?: number | bigint | null
  totalDelaySecs?: number
  label?: string
  size?: 'sm' | 'md'
  variant?: 'claim' | 'withdraw'
}) {
  const cd = useCountdown(targetTs, totalDelaySecs)

  const colors = {
    claim:    { ready: 'bg-[#00c076]/15 border-[#00c076]/30 text-[#00c076]', wait: 'bg-amber-500/10 border-amber-500/25 text-amber-400' },
    withdraw: { ready: 'bg-blue-500/15 border-blue-500/30 text-blue-400',    wait: 'bg-orange-500/10 border-orange-500/25 text-orange-400' },
  }[variant]

  const textSize = size === 'md' ? 'text-xs' : 'text-[10px]'
  const iconSize = size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'

  if (cd.ready) {
    return (
      <span className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold',
        textSize, colors.ready,
      )}>
        <CheckCircle2 className={cn(iconSize, 'shrink-0')} />
        {readyLabel}
      </span>
    )
  }

  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono font-bold',
      textSize, colors.wait,
    )}>
      <Clock className={cn(iconSize, 'shrink-0 animate-pulse')} />
      {cd.label}
    </span>
  )
}

/**
 * DailyMiningTimer — shows a ring progress for daily mining claim cycles.
 * Used in MiningUTH2 and MiningWLD panels.
 *
 *   lastClaimSec — unix seconds of last claim (or 0 = never)
 *   cycleSecs    — cycle length in seconds (default 86400 = 1 day)
 */
export function DailyMiningTimer({
  lastClaimSec,
  cycleSecs = 86400,
  size = 'sm',
}: {
  lastClaimSec: number | bigint
  cycleSecs?: number
  size?: 'sm' | 'md'
}) {
  const last   = typeof lastClaimSec === 'bigint' ? Number(lastClaimSec) : lastClaimSec
  const target = last > 0 ? last + cycleSecs : 0
  const cd     = useCountdown(target > 0 ? target : null, cycleSecs)

  const r   = size === 'md' ? 14 : 11
  const sw  = 2.5
  const circ = 2 * Math.PI * r
  const dash = circ * (1 - cd.progress)

  const color = cd.ready ? '#00c076' : '#f59e0b'
  const textSize = size === 'md' ? 'text-[10px]' : 'text-[9px]'

  if (last === 0) {
    return (
      <span className={cn('text-[oklch(0.45_0.01_230)]', textSize)}>Sin datos</span>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      {/* Ring */}
      <svg width={(r + sw) * 2 + 2} height={(r + sw) * 2 + 2} className="-rotate-90">
        {/* Track */}
        <circle cx={r + sw / 2 + 1} cy={r + sw / 2 + 1} r={r}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
        {/* Progress */}
        <circle cx={r + sw / 2 + 1} cy={r + sw / 2 + 1} r={r}
          fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${circ - dash} ${dash}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s linear' }}
        />
      </svg>
      {/* Label */}
      <span className={cn('font-mono font-bold', textSize, cd.ready ? 'text-[#00c076]' : 'text-amber-400')}>
        {cd.ready ? '¡Listo!' : cd.label}
      </span>
    </div>
  )
}

/**
 * TimerButton — wraps a button label with a countdown + disables it while locked.
 * Drop-in wrapper used in panels.
 */
export function TimerButton({
  targetTs,
  totalDelaySecs = 0,
  readyContent,
  lockedContent,
  variant = 'claim',
  className,
  onClick,
  disabled,
  children,
}: {
  targetTs?: number | bigint | null
  totalDelaySecs?: number
  readyContent?: React.ReactNode
  lockedContent?: React.ReactNode
  variant?: 'claim' | 'withdraw'
  className?: string
  onClick?: () => void
  disabled?: boolean
  children?: React.ReactNode
}) {
  const cd = useCountdown(targetTs, totalDelaySecs)
  const isLocked = !cd.ready

  return (
    <button
      onClick={onClick}
      disabled={disabled || isLocked}
      className={className}
    >
      {isLocked
        ? lockedContent ?? <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 animate-pulse" />{cd.label}</span>
        : readyContent ?? children
      }
    </button>
  )
}
