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
    const addr = MiniKit.walletAddress
    console.log('[wallet] isInstalled=true addr=%s contractOwner=%s', addr, contractOwner)
    if (addr) {
      const isOwner = contractOwner ? addr.toLowerCase() === contractOwner.toLowerCase() : false
      console.log('[wallet] auto-connected addr=%s isOwner=%s', addr, isOwner)
      setState({ address: addr, isInstalled: true, isConnecting: false, isOwner })
    } else {
      setState(s => ({ ...s, isInstalled: true }))
    }
  }, [isInstalled, contractOwner]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-evaluate owner whenever contractOwner resolves from chain
  useEffect(() => {
    if (!contractOwner || !state.address) return
    const isOwner = state.address.toLowerCase() === contractOwner.toLowerCase()
    console.log('[wallet] owner re-check addr=%s contractOwner=%s isOwner=%s', state.address, contractOwner, isOwner)
    setState(s => ({ ...s, isOwner }))
  }, [contractOwner]) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(async () => {
    const installedCheck = MiniKit.isInstalled()
    console.log('[wallet] connect start installedCheck=%s', installedCheck)
    if (!installedCheck) {
      console.error('[wallet] connect ERROR: MiniKit not installed')
      return
    }
    setState(s => ({ ...s, isConnecting: true }))
    try {
      const nonce = crypto.randomUUID()
      console.log('[wallet] calling walletAuth nonce=%s', nonce)

      const result = await MiniKit.commandsAsync.walletAuth({
        nonce,
        expirationTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        notBefore: new Date(Date.now() - 24 * 60 * 60 * 1000),
        statement: 'Conectar a Acua Staking',
      })

      // Log full raw payloads — visible in eruda Console tab
      console.log('[wallet] commandPayload', result.commandPayload)
      console.log('[wallet] finalPayload', result.finalPayload)
      console.log('[wallet] MiniKit.walletAddress after auth', MiniKit.walletAddress)

      const { finalPayload } = result
      console.log('[wallet] status=%s', finalPayload?.status)

      if (finalPayload?.status === 'success') {
        // Some MiniKit versions set address on finalPayload, others only on MiniKit.walletAddress
        const payloadAddr = (finalPayload as any).address ?? null
        const addr: string | null = payloadAddr ?? MiniKit.walletAddress ?? null
        const isOwner = contractOwner && addr
          ? addr.toLowerCase() === contractOwner.toLowerCase()
          : false
        console.log('[wallet] SUCCESS addr=%s payloadAddr=%s mkAddr=%s isOwner=%s',
          addr, payloadAddr, MiniKit.walletAddress, isOwner)
        setState({ address: addr, isInstalled: true, isConnecting: false, isOwner })
      } else {
        console.warn('[wallet] NOT success status=%s finalPayload=%o', finalPayload?.status, finalPayload)
        setState(s => ({ ...s, isConnecting: false }))
      }
    } catch (err) {
      console.error('[wallet] EXCEPTION', err)
      setState(s => ({ ...s, isConnecting: false }))
    }
  }, [contractOwner])

  return { ...state, connect }
}

