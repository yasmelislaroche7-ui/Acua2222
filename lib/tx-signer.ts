'use client'
// ─── Universal Transaction Signer ─────────────────────────────────────────────
// Rutas de firma:
//   • 'minikit'  → World Wallet vía MiniKit, World Chain, Permit2, gas patrocinado
//   • 'imported' → Wallet importada (clave privada), ethers.js, usuario paga gas
//
// Para wallet importada: aprueba Permit2 ERC20, firma EIP-712, llama contrato.
// Compatible con todos los contratos Acua (stake, mining, swap, fee collector).

import { ethers } from 'ethers'

export const WORLD_CHAIN_RPC_URL = 'https://worldchain-mainnet.g.alchemy.com/public'
export const WORLD_CHAIN_ID_NUM  = 480
export const PERMIT2_ADDR        = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const H2O_FEE_COLLECTOR          = '0xB58B80EF6db1B508A0241ac4565fe7c29F299d60'
const H2O_TOKEN                  = '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d'

export type WalletMode = 'minikit' | 'imported'

// ─── Permit2 EIP-712 ──────────────────────────────────────────────────────────
export function permit2Domain(chainId = WORLD_CHAIN_ID_NUM) {
  return { name: 'Permit2', chainId, verifyingContract: PERMIT2_ADDR }
}

const PERMIT_TYPES = {
  PermitTransferFrom: [
    { name: 'permitted',  type: 'TokenPermissions' },
    { name: 'spender',    type: 'address'          },
    { name: 'nonce',      type: 'uint256'          },
    { name: 'deadline',   type: 'uint256'          },
  ],
  TokenPermissions: [
    { name: 'token',  type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
}

// ─── ABIs (ethers direct calls) ───────────────────────────────────────────────
const ERC20_ALLOWANCE_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

const FEE_ABI = [{
  name: 'payFee', type: 'function', stateMutability: 'nonpayable',
  inputs: [{
    name: 'permit', type: 'tuple', components: [
      { name: 'permitted', type: 'tuple', components: [
        { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' },
      ]},
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
    ],
  }, { name: 'signature', type: 'bytes' }],
  outputs: [],
}]

const PERMIT_INPUT = {
  name: 'permit', type: 'tuple', components: [
    { name: 'permitted', type: 'tuple', components: [
      { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' },
    ]},
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ],
}

const STAKE_ABI_E    = [{ name: 'stake',         type: 'function', stateMutability: 'nonpayable', inputs: [PERMIT_INPUT, { name: 'signature', type: 'bytes' }], outputs: [] }]
const UNSTAKE_ABI_E  = [{ name: 'unstake',        type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }]
const CLAIM_ABI_E    = [{ name: 'claimRewards',   type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }]
const CLAIM_ALL_ABI_E= [{ name: 'claimAllRewards',type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }]
const CLAIM_PKG_ABI_E= [{ name: 'claimPackageRewards', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'packageId', type: 'uint256' }], outputs: [] }]

const BUY_PKG_ABI_E  = [{
  name: 'buyPackage', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'packageId', type: 'uint256' }, { name: 'units', type: 'uint256' },
    PERMIT_INPUT, { name: 'signature', type: 'bytes' },
  ], outputs: [],
}]

const SWAP_SINGLE_ABI_E = [{
  name: 'swapV3Single', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'tokenOut', type: 'address' }, { name: 'fee', type: 'uint24' },
    { name: 'amountOutMin', type: 'uint256' }, { name: 'usdcEquivalent', type: 'uint256' },
    PERMIT_INPUT, { name: 'signature', type: 'bytes' },
  ], outputs: [{ name: 'amountOut', type: 'uint256' }],
}]

const SWAP_MULTI_ABI_E = [{
  name: 'swapV3Multi', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'hopToken', type: 'address' }, { name: 'tokenOut', type: 'address' },
    { name: 'fee1', type: 'uint24' }, { name: 'fee2', type: 'uint24' },
    { name: 'amountOutMin', type: 'uint256' }, { name: 'usdcEquivalent', type: 'uint256' },
    PERMIT_INPUT, { name: 'signature', type: 'bytes' },
  ], outputs: [{ name: 'amountOut', type: 'uint256' }],
}]

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function makeNonce(): bigint {
  const arr = new Uint32Array(2)
  crypto.getRandomValues(arr)
  return BigInt(arr[0]) * 65536n + BigInt(arr[1] & 0xffff)
}

export function makeDeadline(offsetSecs = 3600): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSecs)
}

export function connectWallet(wallet: ethers.Wallet): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(WORLD_CHAIN_RPC_URL)
  return wallet.connect(provider)
}

// ─── Core: Sign Permit2 EIP-712 ───────────────────────────────────────────────
export async function signPermit2(
  wallet: ethers.Wallet,
  token: string, amount: bigint, spender: string,
  nonce: bigint, deadline: bigint,
  chainId = WORLD_CHAIN_ID_NUM,
): Promise<string> {
  return wallet.signTypedData(
    permit2Domain(chainId),
    PERMIT_TYPES,
    { permitted: { token, amount }, spender, nonce, deadline },
  )
}

// ─── Core: Ensure Permit2 allowance ───────────────────────────────────────────
export async function ensurePermit2Allowance(
  wallet: ethers.Wallet,
  tokenAddr: string, amount: bigint,
  onStatus?: (msg: string) => void,
): Promise<void> {
  const token   = new ethers.Contract(tokenAddr, ERC20_ALLOWANCE_ABI, wallet)
  const current = BigInt((await token.allowance(wallet.address, PERMIT2_ADDR)).toString())
  if (current >= amount) return
  onStatus?.('Aprobando Permit2...')
  const tx = await token.approve(PERMIT2_ADDR, ethers.MaxUint256)
  onStatus?.('Esperando aprobación...')
  await tx.wait()
}

// ─── Fee collector ────────────────────────────────────────────────────────────
export async function payFeeEthers(
  wallet: ethers.Wallet, feeAmount: bigint,
  onStatus?: (msg: string) => void,
): Promise<void> {
  if (feeAmount === 0n) return
  await ensurePermit2Allowance(wallet, H2O_TOKEN, feeAmount, onStatus)
  const nonce = makeNonce(); const deadline = makeDeadline()
  const sig = await signPermit2(wallet, H2O_TOKEN, feeAmount, H2O_FEE_COLLECTOR, nonce, deadline)
  const fc = new ethers.Contract(H2O_FEE_COLLECTOR, FEE_ABI, wallet)
  onStatus?.('Pagando comisión H2O...')
  const tx = await fc.payFee(
    { permitted: { token: H2O_TOKEN, amount: feeAmount }, nonce, deadline }, sig,
  )
  onStatus?.('Confirmando comisión...')
  await tx.wait()
}

// ─── Stake ────────────────────────────────────────────────────────────────────
export async function stakeEthers(
  wallet: ethers.Wallet,
  contractAddr: string, tokenAddr: string, amount: bigint, feeAmount: bigint,
  onStatus?: (msg: string) => void,
): Promise<ethers.TransactionReceipt> {
  const w = connectWallet(wallet)
  if (feeAmount > 0n) await payFeeEthers(w, feeAmount, onStatus)
  await ensurePermit2Allowance(w, tokenAddr, amount, onStatus)
  const nonce = makeNonce(); const deadline = makeDeadline()
  const sig = await signPermit2(w, tokenAddr, amount, contractAddr, nonce, deadline)
  const c = new ethers.Contract(contractAddr, STAKE_ABI_E, w)
  onStatus?.('Firmando stake...')
  const tx = await c.stake({ permitted: { token: tokenAddr, amount }, nonce, deadline }, sig)
  onStatus?.('Confirmando stake...')
  return tx.wait()
}

export async function unstakeEthers(
  wallet: ethers.Wallet, contractAddr: string, feeAmount: bigint,
  onStatus?: (msg: string) => void,
): Promise<ethers.TransactionReceipt> {
  const w = connectWallet(wallet)
  if (feeAmount > 0n) await payFeeEthers(w, feeAmount, onStatus)
  onStatus?.('Firmando unstake...')
  const tx = await new ethers.Contract(contractAddr, UNSTAKE_ABI_E, w).unstake()
  onStatus?.('Confirmando unstake...')
  return tx.wait()
}

export async function claimEthers(
  wallet: ethers.Wallet, contractAddr: string, feeAmount: bigint,
  onStatus?: (msg: string) => void,
): Promise<ethers.TransactionReceipt> {
  const w = connectWallet(wallet)
  if (feeAmount > 0n) await payFeeEthers(w, feeAmount, onStatus)
  onStatus?.('Firmando claim...')
  const tx = await new ethers.Contract(contractAddr, CLAIM_ABI_E, w).claimRewards()
  onStatus?.('Confirmando claim...')
  return tx.wait()
}

// ─── Mining ───────────────────────────────────────────────────────────────────
export async function buyMiningEthers(
  wallet: ethers.Wallet,
  contractAddr: string, payToken: string,
  packageId: number, units: number, totalCost: bigint, feeAmount: bigint,
  onStatus?: (msg: string) => void,
): Promise<ethers.TransactionReceipt> {
  const w = connectWallet(wallet)
  if (feeAmount > 0n) await payFeeEthers(w, feeAmount, onStatus)
  await ensurePermit2Allowance(w, payToken, totalCost, onStatus)
  const nonce = makeNonce(); const deadline = makeDeadline()
  const sig = await signPermit2(w, payToken, totalCost, contractAddr, nonce, deadline)
  const c = new ethers.Contract(contractAddr, BUY_PKG_ABI_E, w)
  onStatus?.('Firmando compra...')
  const tx = await c.buyPackage(
    packageId, units,
    { permitted: { token: payToken, amount: totalCost }, nonce, deadline }, sig,
  )
  onStatus?.('Confirmando compra...')
  return tx.wait()
}

export async function claimMiningAllEthers(
  wallet: ethers.Wallet, contractAddr: string,
  onStatus?: (msg: string) => void,
): Promise<ethers.TransactionReceipt> {
  const w = connectWallet(wallet)
  onStatus?.('Firmando claim de minería...')
  const tx = await new ethers.Contract(contractAddr, CLAIM_ALL_ABI_E, w).claimAllRewards()
  onStatus?.('Confirmando claim...')
  return tx.wait()
}

export async function claimMiningPkgEthers(
  wallet: ethers.Wallet, contractAddr: string, packageId: number,
  onStatus?: (msg: string) => void,
): Promise<ethers.TransactionReceipt> {
  const w = connectWallet(wallet)
  onStatus?.('Firmando claim...')
  const tx = await new ethers.Contract(contractAddr, CLAIM_PKG_ABI_E, w).claimPackageRewards(packageId)
  onStatus?.('Confirmando claim...')
  return tx.wait()
}

export async function claimUTH2Ethers(
  wallet: ethers.Wallet, contractAddr: string,
  onStatus?: (msg: string) => void,
): Promise<ethers.TransactionReceipt> {
  const w = connectWallet(wallet)
  onStatus?.('Firmando claim H2O...')
  const tx = await new ethers.Contract(contractAddr, CLAIM_ABI_E, w).claimRewards()
  onStatus?.('Confirmando claim...')
  return tx.wait()
}

// ─── Swap ─────────────────────────────────────────────────────────────────────
export async function swapEthers(
  wallet: ethers.Wallet,
  routerAddr: string, fromToken: string, toToken: string,
  amount: bigint, minOut: bigint, usdcEquiv: bigint,
  fee: number, fee2?: number, hopToken?: string,
  onStatus?: (msg: string) => void,
): Promise<ethers.ContractTransactionReceipt | null> {
  const w = connectWallet(wallet)
  await ensurePermit2Allowance(w, fromToken, amount, onStatus)
  const nonce = makeNonce(); const deadline = makeDeadline()
  const sig = await signPermit2(w, fromToken, amount, routerAddr, nonce, deadline)
  const permitArg = { permitted: { token: fromToken, amount }, nonce, deadline }

  onStatus?.('Firmando swap...')
  let tx: ethers.ContractTransactionResponse
  if (hopToken && fee2 !== undefined) {
    tx = await new ethers.Contract(routerAddr, SWAP_MULTI_ABI_E, w)
      .swapV3Multi(hopToken, toToken, fee, fee2, minOut, usdcEquiv, permitArg, sig)
  } else {
    tx = await new ethers.Contract(routerAddr, SWAP_SINGLE_ABI_E, w)
      .swapV3Single(toToken, fee, minOut, usdcEquiv, permitArg, sig)
  }
  onStatus?.('Confirmando swap...')
  return tx.wait()
}

// ─── Import wallet from private key ───────────────────────────────────────────
export function walletFromPK(privateKey: string): { signer: ethers.Wallet; address: string } | { error: string } {
  try {
    let pk = privateKey.trim()
    if (!pk.startsWith('0x')) pk = '0x' + pk
    const signer = new ethers.Wallet(pk)
    return { signer, address: signer.address }
  } catch {
    return { error: 'Clave privada inválida. Verifica el formato (64 hex o con 0x).' }
  }
}
