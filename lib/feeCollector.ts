// lib/feeCollector.ts
// Helper para conectar todos los flujos (stake/unstake/claim/sub/mining)
// con el contrato H2OFeeCollector que cobra H2O por transacción vía Permit2.
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

// ─── Read fee + user H2O balance from on-chain ────────────────────────────────
// Fee was set to 0 on-chain (TX 0xe33da1497c7fb2690f1db6810db7cffc2e04392ea0f55ad22515c9a3ecd0d4e8,
// block 29501147). Returns 0n immediately for zero latency.
// If the fee ever changes on-chain, remove the early return to re-enable on-chain reads.
export async function fetchFeeInfo(_userAddress: string): Promise<{ fee: bigint; userH2O: bigint }> {
  return { fee: 0n, userH2O: 0n }
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
 * y este entry en la posición [0] del array `permit2`.
 *
 * Para la tx principal use el placeholder con el siguiente índice (1, 2, …).
 *
 * Cuando feeAmount === 0n: el contrato FeeCollector hace early-return en payFee
 * cuando fee==0, sin validar la firma. Por eso usamos '0x' como firma fija en
 * lugar de PERMIT2_SIGNATURE_PLACEHOLDER_0 — esto evita que World App intente
 * firmar un Permit2 de 0 H2O, que en World App v2 puede bloquear withdraw/claim.
 * El permit2 devuelto queda sin placeholder asociado (no se firma).
 *
 * @param feeAmount  Monto leído on-chain desde fetchFeeInfo().fee
 * @param deadline   Deadline compartido (opcional, por defecto +1h).
 */
export function buildFeePayment(feeAmount: bigint, deadline?: bigint) {
  const dl = deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600)

  // ── fee = 0: no Permit2 signing needed ────────────────────────────────────
  // FeeCollector.payFee() has an early-return when on-chain fee == 0,
  // so it never calls PERMIT2 nor validates the signature.
  // Using '0x' directly avoids asking World App to sign a 0-amount Permit2,
  // which in World App v2 can cause withdraw/claim to fail.
  if (feeAmount === 0n) {
    return {
      tx: {
        address: H2O_FEE_COLLECTOR_ADDRESS,
        abi: PAY_FEE_ABI_FRAG,
        functionName: 'payFee' as const,
        args: [
          {
            permitted: { token: H2O_TOKEN_ADDRESS, amount: '0' },
            nonce: '0',
            deadline: dl.toString(),
          },
          '0x', // no placeholder → World App won't request a signature for this
        ],
      },
      // permit2 kept for structural compat (stake-panel uses permit2: [fee.permit2, ...])
      // but it has no PLACEHOLDER_0 in tx args, so it won't be signed.
      permit2: {
        permitted: { token: H2O_TOKEN_ADDRESS, amount: '0' },
        spender: H2O_FEE_COLLECTOR_ADDRESS,
        nonce: '0',
        deadline: dl.toString(),
      },
      deadline: dl,
    }
  }

  // ── fee > 0: standard Permit2 SignatureTransfer flow ──────────────────────
  const nonce = feeNonce()
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
