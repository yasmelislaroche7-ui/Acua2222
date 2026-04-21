'use client'

import { useEffect, useState, useCallback } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'

export interface WalletState {
  address: string | null
  isInstalled: boolean
  isConnecting: boolean
  isOwner: boolean
}

export function useWallet(contractOwner: string | null, isInstalled: boolean) {
  const [state, setState] = useState<WalletState>({
    address: null,
    isInstalled: false,
    isConnecting: false,
    isOwner: false,
  })

  // Once MiniKit is confirmed installed, check if already authenticated
  useEffect(() => {
    if (!isInstalled) return

    // Try both the new and old property names for wallet address
    const addr = (MiniKit as any).user?.walletAddress ?? MiniKit.walletAddress ?? null
    console.log('[wallet] isInstalled=true addr=%s contractOwner=%s', addr, contractOwner)

    if (addr) {
      const isOwner = contractOwner
        ? addr.toLowerCase() === contractOwner.toLowerCase()
        : false
      setState({ address: addr, isInstalled: true, isConnecting: false, isOwner })
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

  const connect = useCallback(async () => {
    if (!MiniKit.isInstalled()) {
      console.error('[wallet] MiniKit no instalado — abrir dentro de World App')
      return
    }

    setState(s => ({ ...s, isConnecting: true }))

    try {
      // 1. Fetch nonce from backend (stored in httpOnly cookie for verification)
      const nonceRes = await fetch('/api/nonce')
      if (!nonceRes.ok) {
        throw new Error('No se pudo obtener el nonce del servidor')
      }
      const { nonce } = await nonceRes.json()
      console.log('[wallet] nonce obtenido: %s', nonce)

      // 2. Trigger walletAuth via MiniKit
      const result = await MiniKit.commandsAsync.walletAuth({
        nonce,
        expirationTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hora
        notBefore: new Date(Date.now() - 5 * 60 * 1000),        // hace 5 min
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

      // 3. Verify signature on backend
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

      // 4. Set address — prefer backend-verified address
      const addr: string | null =
        verifyData.address ??
        (finalPayload as any).address ??
        (MiniKit as any).user?.walletAddress ??
        MiniKit.walletAddress ??
        null

      const isOwner = contractOwner && addr
        ? addr.toLowerCase() === contractOwner.toLowerCase()
        : false

      console.log('[wallet] conectado addr=%s isOwner=%s', addr, isOwner)
      setState({ address: addr, isInstalled: true, isConnecting: false, isOwner })

    } catch (err) {
      console.error('[wallet] excepción:', err)
      setState(s => ({ ...s, isConnecting: false }))
    }
  }, [contractOwner])

  return { ...state, connect }
}
