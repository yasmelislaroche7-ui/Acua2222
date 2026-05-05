'use client'

import { useState, useRef, useEffect } from 'react'
import { LANGUAGES, LangCode } from '@/lib/i18n'
import { useLang } from '@/context/lang-context'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

export function LanguageSwitcher() {
  const { lang, setLang, flag } = useLang()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center gap-1 rounded-lg border px-1.5 py-1 transition-all text-sm',
          open
            ? 'border-[oklch(0.65_0.22_255)]/60 bg-[oklch(0.65_0.22_255)]/10'
            : 'border-[oklch(0.22_0.025_245)] bg-[oklch(0.12_0.02_245)] hover:border-[oklch(0.30_0.025_245)]'
        )}
        aria-label="Language"
        title="Change language"
      >
        <span className="text-base leading-none">{flag}</span>
        <ChevronDown className={cn('w-2.5 h-2.5 text-[oklch(0.45_0.01_230)] transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-44 rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.09_0.018_245)] shadow-[0_8px_32px_rgba(0,0,0,0.6)] z-[60] overflow-hidden max-h-72 overflow-y-auto">
          <div className="px-3 py-2 border-b border-[oklch(0.18_0.02_245)]">
            <p className="text-[9px] font-bold text-[oklch(0.40_0.01_230)] uppercase tracking-wider">Idioma / Language</p>
          </div>
          <div className="py-1">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => { setLang(l.code as LangCode); setOpen(false) }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                  lang === l.code
                    ? 'bg-[oklch(0.65_0.22_255)]/10 text-foreground'
                    : 'hover:bg-white/5 text-[oklch(0.70_0.01_230)]'
                )}
              >
                <span className="text-base leading-none shrink-0">{l.flag}</span>
                <span className="text-xs font-medium">{l.name}</span>
                {lang === l.code && (
                  <span className="ml-auto text-[oklch(0.65_0.22_255)] text-xs">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
