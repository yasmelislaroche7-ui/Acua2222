#!/usr/bin/env node
/**
 * withdraw-volume-rewards.js
 * Retira UTH2 acumulado en el contrato AcuaVolumeRewards.
 *
 * Uso:
 *   PRIVATE_KEY=0x... node scripts/withdraw-volume-rewards.js
 *   PRIVATE_KEY=0x... node scripts/withdraw-volume-rewards.js --dry-run
 *   PRIVATE_KEY=0x... node scripts/withdraw-volume-rewards.js --amount 1000
 *
 * El script:
 *  1. Muestra balance UTH2 del contrato y del owner
 *  2. Ejecuta emergencyWithdraw(amount) para retirar UTH2 al owner
 *  3. Si no se especifica --amount, retira TODO el balance del contrato
 */

const { ethers } = require('ethers')

const RPC            = 'https://worldchain-mainnet.g.alchemy.com/public'
const VOLUME_REWARDS = '0x81D9a0c80eAD28B1A7364fa73684Cc78e497FA48'
const UTH2_TOKEN     = '0x9eA8653640E22A5b69887985BB75d496dc97022a'

const VR_ABI = [
  'function owner() view returns (address)',
  'function UTH2() view returns (address)',
  'function totalDistributed() view returns (uint256)',
  'function currentMonth() view returns (uint256)',
  'function pendingNow(address user) view returns (uint256)',
  'function getPeriodInfo() view returns (uint256 monthId, uint256 periodStart, uint256 periodEnd, uint256 totalUTH2Distributed)',
  'function emergencyWithdraw(uint256 amount) nonpayable',
  'function fundUTH2(uint256 amount) nonpayable',
]

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]

const DRY_RUN = process.argv.includes('--dry-run')
const amtIdx  = process.argv.indexOf('--amount')
const amtArg  = amtIdx !== -1 ? process.argv[amtIdx + 1] : null

async function main() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) { console.error('ERROR: PRIVATE_KEY env var no configurada'); process.exit(1) }

  const provider = new ethers.JsonRpcProvider(RPC)
  const signer   = new ethers.Wallet(pk, provider)
  const addr     = await signer.getAddress()
  const vr       = new ethers.Contract(VOLUME_REWARDS, VR_ABI, signer)
  const uth2     = new ethers.Contract(UTH2_TOKEN, ERC20_ABI, provider)

  const [owner, totalDist, periodInfo, contractBal, ownerBal] = await Promise.all([
    vr.owner(),
    vr.totalDistributed(),
    vr.getPeriodInfo(),
    uth2.balanceOf(VOLUME_REWARDS),
    uth2.balanceOf(addr),
  ])

  console.log('═══════════════════════════════════════════════')
  console.log('  ACUA VolumeRewards — Retiro de UTH2')
  console.log('═══════════════════════════════════════════════')
  console.log(`Signer           : ${addr}`)
  console.log(`Owner            : ${owner}`)
  console.log(`Mes actual       : ${periodInfo[0]}`)
  console.log(`Total distribuido: ${ethers.formatEther(totalDist)} UTH2`)
  console.log(`Balance contrato : ${ethers.formatEther(contractBal)} UTH2`)
  console.log(`Balance owner    : ${ethers.formatEther(ownerBal)} UTH2`)
  if (DRY_RUN) console.log('MODO: DRY RUN — no se enviarán transacciones\n')

  if (addr.toLowerCase() !== owner.toLowerCase()) {
    console.error('\nERROR: tu wallet no es el owner del contrato. Solo el owner puede ejecutar emergencyWithdraw.')
    process.exit(1)
  }

  if (contractBal === 0n) {
    console.log('\nEl contrato tiene 0 UTH2. Nada que retirar.')
    return
  }

  // Determinar cuánto retirar
  let withdrawAmt: bigint
  if (amtArg) {
    withdrawAmt = ethers.parseEther(amtArg)
    if (withdrawAmt > contractBal) {
      console.error(`\nERROR: El contrato solo tiene ${ethers.formatEther(contractBal)} UTH2, pediste ${amtArg}`)
      process.exit(1)
    }
  } else {
    withdrawAmt = contractBal
  }

  console.log(`\nRetirando ${ethers.formatEther(withdrawAmt)} UTH2...`)

  if (DRY_RUN) {
    console.log('[DRY RUN] Se llamaría emergencyWithdraw(' + withdrawAmt.toString() + ')')
    return
  }

  const tx = await vr.emergencyWithdraw(withdrawAmt)
  console.log(`TX hash : ${tx.hash}`)
  console.log('Esperando confirmación...')
  const receipt = await tx.wait()
  console.log(`✓ Confirmada en bloque ${receipt.blockNumber}`)

  // Verificar balances post-retiro
  const [newContractBal, newOwnerBal] = await Promise.all([
    uth2.balanceOf(VOLUME_REWARDS),
    uth2.balanceOf(addr),
  ])
  console.log('\nBalances post-retiro:')
  console.log(`  Contrato : ${ethers.formatEther(newContractBal)} UTH2`)
  console.log(`  Tu wallet: ${ethers.formatEther(newOwnerBal)} UTH2`)
  console.log(`\n✓ Retiro de ${ethers.formatEther(withdrawAmt)} UTH2 completado!`)
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
