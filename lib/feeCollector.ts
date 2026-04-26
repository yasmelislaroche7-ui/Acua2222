// lib/feeCollector.ts
// Helper para conectar todos los flujos (stake/unstake/claim/sub/mining)
// con el contrato H2OFeeCollector que cobra 1 H2O por transacción vía Permit2.
// El monto es ajustable por el owner mediante setFee(uint256).

import { ethers } from 'ethers'
import { getProvider } from '@/lib/new-contracts'

// ─── Address (desplegado en World Chain) ─────────────────────────────────────
export const H2O_FEE_COLLECTOR_ADDRESS = '0xB58B80EF6db1B508A0241ac4565fe7c29F299d60'

// H2O token (mismo que en otros archivos)
export const H2O_TOKEN_ADDRESS = '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d'

// ─── Permit2 tuple input (compartido con MiniKit) ────────────────────────────
const PERMIT_TUPLE_INPUT = {
  name: 'permit',
  type: 'tuple',
  internalType: 'struct IPermit2.PermitTransferFrom',
  components: [
    {
      name: 'permitted',
      type: 'tuple',
      internalType: 'struct IPermit2.TokenPermissions',
      components: [
        { name: 'token', type: 'address', internalType: 'address' },
        { name: 'amount', type: 'uint256', internalType: 'uint256' },
      ],
    },
    { name: 'nonce', type: 'uint256', internalType: 'uint256' },
    { name: 'deadline', type: 'uint256', internalType: 'uint256' },
  ],
} as const

// ─── ABI fragments ────────────────────────────────────────────────────────────
export const PAY_FEE_ABI_FRAG = [{
  name: 'payFee',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    PERMIT_TUPLE_INPUT,
    { name: 'signature', type: 'bytes', internalType: 'bytes' },
  ],
  outputs: [],
}] as const

const READ_ABI = [
  'function fee() view returns (uint256)',
  'function owner() view returns (address)',
  'function collected() view returns (uint256)',
  'function balance() view returns (uint256)',
]

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

// ─── Read fee + user H2O balance ─────────────────────────────────────────────
export async function fetchFeeInfo(userAddress: string): Promise<{ fee: bigint; userH2O: bigint }> {
  const provider = getProvider()
  const fc = new ethers.Contract(H2O_FEE_COLLECTOR_ADDRESS, READ_ABI, provider)
  const h2o = new ethers.Contract(H2O_TOKEN_ADDRESS, ERC20_ABI, provider)
  const [fee, bal] = await Promise.all([
    fc.fee().catch(() => 10n ** 18n),
    h2o.balanceOf(userAddress).catch(() => 0n),
  ])
  return { fee, userH2O: bal }
}

// ─── Helpers para construir el batch [feeTx, mainTx] de MiniKit ──────────────

// Genera nonce aleatorio para Permit2 (compartido)
export function feeNonce(): bigint {
  if (typeof window !== 'undefined' && window.crypto) {
    const arr = new Uint32Array(2)
    window.crypto.getRandomValues(arr)
    return BigInt(arr[0]) * 65536n + BigInt(arr[1] & 0xffff)
  }
  return BigInt(Math.floor(Math.random() * 2 ** 32))
}

/**
 * Devuelve los objetos { tx, permit2 } que se prependen al sendTransaction.
 * El llamante debe poner este tx en la posición [0] del array `transaction`
 * y este entry en la posición [0] del array `permit2`. La signature placeholder
 * es 'PERMIT2_SIGNATURE_PLACEHOLDER_0'.
 *
 * Para la tx principal use el placeholder con el siguiente índice (1, 2, …).
 *
 * @param feeAmount  Monto a autorizar en el permit (>= fee actual del contrato).
 *                   Recomendado pasar el fee leído on-chain por compatibilidad.
 * @param deadline   Deadline compartido (opcional, por defecto +1h).
 */
export function buildFeePayment(feeAmount: bigint, deadline?: bigint) {
  const nonce = feeNonce()
  const dl = deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600)
  return {
    tx: {
      address: H2O_FEE_COLLECTOR_ADDRESS,
      abi: PAY_FEE_ABI_FRAG,
      functionName: 'payFee' as const,
      args: [
        {
          permitted: { token: H2O_TOKEN_ADDRESS, amount: feeAmount.toString() },
          nonce: nonce.toString(),
          deadline: dl.toString(),
        },
        'PERMIT2_SIGNATURE_PLACEHOLDER_0',
      ],
    },
    permit2: {
      permitted: { token: H2O_TOKEN_ADDRESS, amount: feeAmount.toString() },
      spender: H2O_FEE_COLLECTOR_ADDRESS,
      nonce: nonce.toString(),
      deadline: dl.toString(),
    },
    deadline: dl,
  }
}

/**
 * Mensaje de error estándar cuando el usuario no tiene saldo H2O suficiente.
 */
export function insufficientFeeMsg(fee: bigint): string {
  const f = parseFloat(ethers.formatUnits(fee, 18))
  return `Necesitas al menos ${f} H2O en tu wallet para pagar la comisión de la transacción.`
}

/**
 * Texto corto para mostrar en confirmaciones / botones.
 */
export function feeLabel(fee: bigint): string {
  const f = parseFloat(ethers.formatUnits(fee, 18))
  return `${f} H2O`
}
