'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { LangCode, getLangMeta } from '@/lib/i18n'

interface LangContextValue {
  lang: LangCode
  setLang: (l: LangCode) => void
  flag: string
}

const LangContext = createContext<LangContextValue>({
  lang: 'es',
  setLang: () => {},
  flag: '🇪🇸',
})

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(() => {
    if (typeof window === 'undefined') return 'es'
    return (localStorage.getItem('acua_lang') as LangCode) ?? 'es'
  })

  const setLang = useCallback((l: LangCode) => {
    setLangState(l)
    if (typeof window !== 'undefined') localStorage.setItem('acua_lang', l)
  }, [])

  const meta = getLangMeta(lang)

  return (
    <LangContext.Provider value={{ lang, setLang, flag: meta.flag }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}
