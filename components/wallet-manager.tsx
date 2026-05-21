'use client'

import { useState } from 'react'
import { ethers } from 'ethers'
import {
  KeyRound, Eye, EyeOff, AlertTriangle, Download, Upload,
  Copy, Check, X, ChevronDown, ChevronUp, Lock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLang } from '@/context/lang-context'
import { t } from '@/lib/i18n'

interface WalletManagerProps {
  onImport?: (address: string, privateKey: string) => void
}

export function WalletManager({ onImport }: WalletManagerProps) {
  const { lang } = useLang()
  const [mode, setMode] = useState<null | 'import' | 'export'>( null)
  const [importType, setImportType] = useState<'seed' | 'key'>('seed')
  const [inputValue, setInputValue] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [result, setResult] = useState<{ address: string; key: string } | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirmWarning, setConfirmWarning] = useState(false)

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const handleImport = () => {
    setError('')
    try {
      let wallet: ethers.Wallet | ethers.HDNodeWallet
      if (importType === 'seed') {
        wallet = ethers.Wallet.fromPhrase(inputValue.trim())
      } else {
        let pk = inputValue.trim()
        if (!pk.startsWith('0x')) pk = '0x' + pk
        wallet = new ethers.Wallet(pk)
      }
      setResult({ address: wallet.address, key: wallet.privateKey })
      onImport?.(wallet.address, wallet.privateKey)
    } catch (e: any) {
      setError(importType === 'seed' ? 'Frase semilla inválida. Verifica las palabras.' : 'Clave privada inválida.')
    }
  }

  const reset = () => {
    setMode(null); setInputValue(''); setResult(null)
    setShowInput(false); setShowKey(false); setError('')
    setConfirmWarning(false)
  }

  const WARNING_CONTENT = (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/8 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <p className="text-xs font-bold text-amber-400">{t('walletWarning', lang)}</p>
      </div>
      <p className="text-[10px] text-amber-300/80 leading-relaxed">{t('walletWarningDetail', lang)}</p>
      <ul className="text-[9px] text-amber-300/70 space-y-0.5 list-disc list-inside">
        <li>Guarda la frase offline en papel o dispositivo sin internet</li>
        <li>Nunca la ingreses en sitios web no confiables</li>
        <li>ACUA nunca te pedirá tu frase semilla</li>
      </ul>
    </div>
  )

  return (
    <div className="mt-3 border-t border-[oklch(0.18_0.02_245)] pt-3">
      <p className="text-[9px] font-bold text-[oklch(0.40_0.01_230)] uppercase tracking-wider px-1 mb-2">
        {t('wallet', lang)} · Importar / Exportar
      </p>

      {mode === null && (
        <div className="flex gap-2">
          <button
            onClick={() => { setMode('import'); setConfirmWarning(false) }}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[oklch(0.12_0.02_245)] border border-[oklch(0.22_0.025_245)] hover:border-[oklch(0.30_0.025_245)] transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[10px] font-bold text-blue-400">{t('importWallet', lang)}</span>
          </button>
          <button
            onClick={() => { setMode('export'); setConfirmWarning(false) }}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[oklch(0.12_0.02_245)] border border-[oklch(0.22_0.025_245)] hover:border-[oklch(0.30_0.025_245)] transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] font-bold text-emerald-400">{t('exportWallet', lang)}</span>
          </button>
        </div>
      )}

      {mode === 'import' && (
        <div className="space-y-3">
          {/* Close */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5 text-blue-400" /> {t('importWallet', lang)}
            </span>
            <button onClick={reset} className="w-6 h-6 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10">
              <X className="w-3.5 h-3.5 text-[oklch(0.50_0.012_230)]" />
            </button>
          </div>

          {WARNING_CONTENT}

          {!confirmWarning && (
            <button
              onClick={() => setConfirmWarning(true)}
              className="w-full py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-xs font-bold text-amber-400 hover:bg-amber-500/30 transition-colors"
            >
              Entiendo los riesgos · Continuar
            </button>
          )}

          {confirmWarning && (
            <>
              {/* Type selector */}
              <div className="flex gap-1.5">
                {(['seed', 'key'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => { setImportType(type); setInputValue(''); setError('') }}
                    className={cn(
                      'flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-colors border',
                      importType === type
                        ? 'bg-[oklch(0.65_0.22_255)]/20 border-[oklch(0.65_0.22_255)]/60 text-[oklch(0.65_0.22_255)]'
                        : 'bg-[oklch(0.12_0.02_245)] border-[oklch(0.22_0.025_245)] text-[oklch(0.50_0.012_230)]'
                    )}
                  >
                    {type === 'seed' ? '🌱 Frase Semilla' : '🔑 Clave Privada'}
                  </button>
                ))}
              </div>

              {/* Input */}
              <div className="relative">
                {importType === 'seed' ? (
                  <textarea
                    rows={3}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    placeholder={t('enterSeedPhrase', lang)}
                    className="w-full rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] px-3 py-2 text-[10px] text-foreground font-mono placeholder:text-[oklch(0.35_0.01_230)] focus:outline-none focus:border-[oklch(0.65_0.22_255)]/60 resize-none"
                    style={{ filter: showInput ? 'none' : 'blur(4px)', WebkitFilter: showInput ? 'none' : 'blur(4px)' }}
                  />
                ) : (
                  <input
                    type={showInput ? 'text' : 'password'}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    placeholder={t('enterPrivateKey', lang)}
                    className="w-full rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] px-3 py-2 text-[10px] text-foreground font-mono placeholder:text-[oklch(0.35_0.01_230)] focus:outline-none focus:border-[oklch(0.65_0.22_255)]/60"
                  />
                )}
                <button
                  onPointerDown={() => setShowInput(true)}
                  onPointerUp={() => setShowInput(false)}
                  onPointerLeave={() => setShowInput(false)}
                  className="absolute right-2 top-2 text-[oklch(0.45_0.01_230)] hover:text-foreground"
                >
                  {showInput ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {error && <p className="text-[10px] text-red-400">{error}</p>}

              {result ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-3 space-y-2">
                  <p className="text-[10px] font-bold text-emerald-400">✓ Wallet importada correctamente</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-[oklch(0.45_0.01_230)] w-14 shrink-0">Dirección</span>
                      <span className="text-[9px] font-mono text-foreground flex-1 truncate">{result.address}</span>
                      <button onClick={() => copy(result.address, 'addr')} className="shrink-0">
                        {copied === 'addr' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-[oklch(0.45_0.01_230)]" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-[oklch(0.45_0.01_230)] w-14 shrink-0">Priv. Key</span>
                      <span className="text-[9px] font-mono text-foreground flex-1 truncate" style={{ filter: showKey ? 'none' : 'blur(4px)' }}>
                        {result.key}
                      </span>
                      <button onPointerDown={() => setShowKey(true)} onPointerUp={() => setShowKey(false)} onPointerLeave={() => setShowKey(false)} className="shrink-0">
                        {showKey ? <EyeOff className="w-3 h-3 text-[oklch(0.45_0.01_230)]" /> : <Eye className="w-3 h-3 text-[oklch(0.45_0.01_230)]" />}
                      </button>
                      <button onClick={() => copy(result.key, 'key')} className="shrink-0">
                        {copied === 'key' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-[oklch(0.45_0.01_230)]" />}
                      </button>
                    </div>
                  </div>
                  <button onClick={reset} className="w-full py-1.5 rounded-lg bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] text-[9px] text-[oklch(0.50_0.012_230)] hover:bg-white/5 transition-colors">
                    Limpiar y cerrar
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleImport}
                  disabled={!inputValue.trim()}
                  className="w-full py-2 rounded-xl bg-[oklch(0.65_0.22_255)] text-white text-xs font-bold disabled:opacity-40 hover:bg-[oklch(0.70_0.24_255)] transition-colors"
                >
                  {t('import', lang)} Wallet
                </button>
              )}
            </>
          )}
        </div>
      )}

      {mode === 'export' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5 text-emerald-400" /> {t('exportWallet', lang)}
            </span>
            <button onClick={reset} className="w-6 h-6 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10">
              <X className="w-3.5 h-3.5 text-[oklch(0.50_0.012_230)]" />
            </button>
          </div>

          {WARNING_CONTENT}

          <div className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-3 space-y-2">
            <div className="flex items-center gap-2 text-[oklch(0.50_0.012_230)]">
              <Lock className="w-3.5 h-3.5" />
              <p className="text-[10px]">Tu wallet de World App está gestionada por MiniKit.</p>
            </div>
            <p className="text-[9px] text-[oklch(0.40_0.01_230)]">
              Para exportar tu wallet de World App, ve a la app de World, luego a Ajustes → Wallet → Mostrar frase de recuperación. ACUA no tiene acceso a tu clave privada de World App por seguridad.
            </p>
          </div>

          <div className="rounded-xl border border-blue-500/30 bg-blue-500/8 p-3">
            <p className="text-[10px] font-bold text-blue-400 mb-1">¿Tienes una wallet importada?</p>
            <p className="text-[9px] text-[oklch(0.45_0.01_230)]">
              Si importaste una wallet manualmente, puedes copiar su clave privada aquí. Importa primero la wallet para ver los datos.
            </p>
          </div>

          <button onClick={reset} className="w-full py-2 rounded-xl bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] text-xs text-[oklch(0.50_0.012_230)] hover:bg-white/5 transition-colors">
            Cerrar
          </button>
        </div>
      )}
    </div>
  )
}
