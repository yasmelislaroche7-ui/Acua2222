'use client'

import { useEffect, useState, useCallback } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { walletFromPK, type WalletMode } from '@/lib/tx-signer'

export interface WalletState {
  address: string | null
  isInstalled: boolean
  isConnecting: boolean
  isOwner: boolean
  walletMode: WalletMode
  importedSigner: ethers.Wallet | null
}

export function useWallet(contractOwner: string | null, isInstalled: boolean) {
  const [state, setState] = useState<WalletState>({
    address: null,
    isInstalled: false,
    isConnecting: false,
    isOwner: false,
    walletMode: 'minikit',
    importedSigner: null,
  })

  // Once MiniKit is confirmed installed, check if already authenticated
  useEffect(() => {
    if (!isInstalled) return

    const addr = (MiniKit as any).user?.walletAddress ?? (MiniKit as any).walletAddress ?? null
    console.log('[wallet] isInstalled=true addr=%s contractOwner=%s', addr, contractOwner)

    if (addr) {
      const isOwner = contractOwner ? addr.toLowerCase() === contractOwner.toLowerCase() : false
      setState({ address: addr, isInstalled: true, isConnecting: false, isOwner, walletMode: 'minikit', importedSigner: null })
    } else {
      setState(s => ({ ...s, isInstalled: true }))
    }
  }, [isInstalled, contractOwner]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-evaluate owner whenever contractOwner resolves from chain
  useEffect(() => {
    if (!contractOwner || !state.address) return
    const isOwner = state.address.toLowerCase() === contractOwner.toLowerCase()
    setState(s => ({ ...s, isOwner }))
  }, [contractOwner]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── MiniKit connect ────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!MiniKit.isInstalled()) {
      console.error('[wallet] MiniKit no instalado — abrir dentro de World App')
      return
    }

    setState(s => ({ ...s, isConnecting: true }))

    try {
      const nonceRes = await fetch('/api/nonce')
      if (!nonceRes.ok) throw new Error('No se pudo obtener el nonce del servidor')
      const { nonce } = await nonceRes.json()
      console.log('[wallet] nonce obtenido: %s', nonce)

      const result = await MiniKit.commandsAsync.walletAuth({
        nonce,
        expirationTime: new Date(Date.now() + 60 * 60 * 1000),
        notBefore: new Date(Date.now() - 5 * 60 * 1000),
        statement: 'Conectar a Acua Staking',
      })

      console.log('[wallet] commandPayload:', result.commandPayload)
      console.log('[wallet] finalPayload:', result.finalPayload)

      const { finalPayload } = result

      if (!finalPayload || finalPayload.status !== 'success') {
        console.warn('[wallet] walletAuth no exitoso:', finalPayload?.status)
        setState(s => ({ ...s, isConnecting: false }))
        return
      }

      const verifyRes = await fetch('/api/complete-siwe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: finalPayload, nonce }),
      })
      const verifyData = await verifyRes.json()
      console.log('[wallet] verificación backend:', verifyData)

      if (!verifyData.isValid) {
        console.error('[wallet] SIWE inválido:', verifyData.error)
        setState(s => ({ ...s, isConnecting: false }))
        return
      }

      const addr: string | null =
        verifyData.address ??
        (finalPayload as any).address ??
        (MiniKit as any).user?.walletAddress ??
        (MiniKit as any).walletAddress ??
        null

      const isOwner = contractOwner && addr ? addr.toLowerCase() === contractOwner.toLowerCase() : false

      console.log('[wallet] conectado addr=%s isOwner=%s', addr, isOwner)
      setState({ address: addr, isInstalled: true, isConnecting: false, isOwner, walletMode: 'minikit', importedSigner: null })

    } catch (err) {
      console.error('[wallet] excepción:', err)
      setState(s => ({ ...s, isConnecting: false }))
    }
  }, [contractOwner])

  // ─── Import wallet from private key ─────────────────────────────────────────
  const importWallet = useCallback((privateKey: string): { address: string } | { error: string } => {
    const result = walletFromPK(privateKey)
    if ('error' in result) return result

    const { signer, address } = result
    const isOwner = contractOwner ? address.toLowerCase() === contractOwner.toLowerCase() : false

    console.log('[wallet] imported addr=%s isOwner=%s', address, isOwner)
    setState({
      address,
      isInstalled: true,
      isConnecting: false,
      isOwner,
      walletMode: 'imported',
      importedSigner: signer,
    })
    return { address }
  }, [contractOwner])

  // ─── Disconnect / clear ──────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    setState({
      address: null,
      isInstalled: state.isInstalled,
      isConnecting: false,
      isOwner: false,
      walletMode: 'minikit',
      importedSigner: null,
    })
  }, [state.isInstalled])

  return { ...state, connect, importWallet, disconnect }
}
