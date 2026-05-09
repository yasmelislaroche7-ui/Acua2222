#!/usr/bin/env node
/**
 * claim-swap-fees.js
 * Retira las comisiones acumuladas en AcuaSwapRouterV2 (y opcionalmente V1).
 *
 * Uso:
 *   PRIVATE_KEY=0x... node scripts/claim-swap-fees.js
 *   PRIVATE_KEY=0x... node scripts/claim-swap-fees.js --dry-run
 *
 * El script:
 *  1. Consulta ownerFees(signer, token) para cada token conocido
 *  2. Muestra el balance pendiente
 *  3. Llama claimFeesBatch([tokensConSaldo]) en cada contrato
 */

const { ethers } = require('ethers')

const RPC           = 'https://worldchain-mainnet.g.alchemy.com/public'
const ROUTER_V2     = '0xA2FD6cd36a661E270FC7AdaA82D0d22f4660706d'

// Tokens conocidos en World Chain
const TOKENS = {
  H2O:    { address: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', decimals: 18 },
  WLD:    { address: '0x2cFc85d8E48F8EAB294be644d9E25C3030863003', decimals: 18 },
  USDC:   { address: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', decimals: 6  },
  SUSHI:  { address: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38', decimals: 18 },
  FIRE:   { address: '0x22c40632c13a7f3cae9c343480607d886832c686', decimals: 18 },
  AIR:    { address: '0xDBA88118551d5Adf16a7AB943403Aea7ea06762b', decimals: 18 },
  BTCH2O: { address: '0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484', decimals: 18 },
  UTH2:   { address: '0x9eA8653640E22A5b69887985BB75d496dc97022a', decimals: 18 },
  wCOP:   { address: '0x8a1d45e102e886510e891d2ec656a708991e2d76', decimals: 18 },
  wARS:   { address: '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d', decimals: 18 },
}

const ROUTER_ABI = [
  'function ownerFees(address feeOwner, address token) view returns (uint256)',
  'function claimFees(address token) nonpayable',
  'function claimFeesBatch(address[] tokens) nonpayable',
  'function feeOwners(uint256) view returns (address)',
  'function swapFeeBps() view returns (uint256)',
  'function h2oFeeBps() view returns (uint256)',
  'function owner() view returns (address)',
]

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) { console.error('ERROR: PRIVATE_KEY env var no configurada'); process.exit(1) }

  const provider = new ethers.JsonRpcProvider(RPC)
  const signer   = new ethers.Wallet(pk, provider)
  const addr     = await signer.getAddress()
  const router   = new ethers.Contract(ROUTER_V2, ROUTER_ABI, signer)

  const [swapFeeBps, h2oFeeBps, owner] = await Promise.all([
    router.swapFeeBps(),
    router.h2oFeeBps(),
    router.owner(),
  ])

  console.log('═══════════════════════════════════════════════')
  console.log('  ACUA SwapRouterV2 — Retiro de Comisiones')
  console.log('═══════════════════════════════════════════════')
  console.log(`Signer   : ${addr}`)
  console.log(`Owner    : ${owner}`)
  console.log(`SwapFee  : ${swapFeeBps} bps (${Number(swapFeeBps)/100}%)`)
  console.log(`H2O Fee  : ${h2oFeeBps} bps (${Number(h2oFeeBps)/100}%)`)
  if (DRY_RUN) console.log('MODO: DRY RUN — no se enviarán transacciones\n')

  // Consultar fees pendientes para esta wallet
  console.log('\nConsultando fees acumuladas...\n')
  const entries = Object.entries(TOKENS)
  const feeResults = await Promise.all(
    entries.map(([symbol, meta]) =>
      router.ownerFees(addr, meta.address)
        .then(amt => ({ symbol, address: meta.address, decimals: meta.decimals, amount: amt }))
        .catch(() => ({ symbol, address: meta.address, decimals: meta.decimals, amount: 0n }))
    )
  )

  const withBalance = feeResults.filter(r => r.amount > 0n)
  const empty       = feeResults.filter(r => r.amount === 0n)

  if (withBalance.length === 0) {
    console.log('Sin fees pendientes para esta wallet en ningún token.')
    console.log('\nTokens consultados:')
    empty.forEach(r => console.log(`  ${r.symbol.padEnd(8)}: 0`))
    console.log('\nNota: verifica que tu address sea un feeOwner del contrato.')
    return
  }

  console.log('Fees pendientes:')
  withBalance.forEach(r => {
    const fmt = ethers.formatUnits(r.amount, r.decimals)
    console.log(`  ✓ ${r.symbol.padEnd(8)}: ${fmt}`)
  })
  if (empty.length > 0) {
    console.log('\nSin balance:')
    empty.forEach(r => console.log(`  - ${r.symbol.padEnd(8)}: 0`))
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Se llamaría claimFeesBatch con:', withBalance.map(r => r.symbol).join(', '))
    return
  }

  // Ejecutar claimFeesBatch
  console.log('\nEnviando claimFeesBatch...')
  const tokenAddrs = withBalance.map(r => r.address)
  const tx = await router.claimFeesBatch(tokenAddrs)
  console.log(`TX hash : ${tx.hash}`)
  console.log('Esperando confirmación...')
  const receipt = await tx.wait()
  console.log(`✓ Confirmada en bloque ${receipt.blockNumber}`)

  // Verificar que quedaron en 0
  console.log('\nVerificando saldos post-retiro...')
  await Promise.all(
    withBalance.map(async r => {
      const after = await router.ownerFees(addr, r.address).catch(() => 0n)
      const fmt = ethers.formatUnits(after, r.decimals)
      console.log(`  ${r.symbol.padEnd(8)}: ${after === 0n ? '✓ 0 (retirado)' : fmt + ' (pendiente)'}`)
    })
  )
  console.log('\n¡Retiro completado!')
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
