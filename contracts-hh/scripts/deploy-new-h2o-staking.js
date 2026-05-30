/**
 * deploy-new-h2o-staking.js
 * Despliega NewH2OStaking v2 con referidos integrados
 *
 * Fees:
 *   - Depósito:  5% → owners
 *   - Retiro:    5% → owners
 *   - Claim:     15% SIEMPRE (hardcoded, no configurable)
 *       Con referido:    5% → referrer | 5% → owner | 5% bonus → usuario (usuario neto 90%)
 *       Sin referido:    15% → owner                             (usuario neto 85%)
 *
 * Run: npx hardhat run scripts/deploy-new-h2o-staking.js --network worldchain
 */
const { ethers } = require('hardhat')
const fs = require('fs')
const path = require('path')

const H2O_TOKEN  = '0x08131A6f780AEF79E86518c4A10c06387Ec74636'
const OWNER_ADDR = '0x54F0D557E8042eC70974d2e85331BE5D66fFe5F4'

async function main() {
  const [signer] = await ethers.getSigners()
  console.log('Deployer:', signer.address)

  let bal
  try { bal = await signer.provider.getBalance(signer.address) } catch { bal = await signer.getBalance() }
  const fmtEther = ethers.formatEther || ethers.utils.formatEther
  console.log('Balance:', fmtEther(bal), 'ETH/WLD')

  const Factory = await ethers.getContractFactory('NewH2OStaking', signer)
  console.log('\nDesplegando NewH2OStaking v2 (con referidos integrados)...')
  console.log('  TOKEN  :', H2O_TOKEN)
  console.log('  OWNER  :', OWNER_ADDR)
  console.log('  Depósito fee : 5%')
  console.log('  Retiro fee   : 5%')
  console.log('  Claim fee    : 15% (hardcoded, no configurable)')
  console.log('    Con referido → 5% referrer + 5% owner + 5% bonus usuario (neto 90%)')
  console.log('    Sin referido → 15% owner (neto 85%)')

  const contract = await Factory.deploy(H2O_TOKEN, OWNER_ADDR)
  const deployTx = contract.deploymentTransaction ? contract.deploymentTransaction() : contract.deployTransaction
  console.log('\nTX hash:', deployTx?.hash || '(unknown)')

  if (contract.waitForDeployment) {
    await contract.waitForDeployment()
  } else {
    await contract.deployed()
  }

  const contractAddress = contract.target || contract.address
  console.log('\n✅ Desplegado en:', contractAddress)

  // Verificar constantes y fees
  const [dep, wit, clm, refBps, bonusBps, ownerBps, ownersArr] = await Promise.all([
    contract.depositFeeBps(),
    contract.withdrawFeeBps(),
    contract.claimFeeBps(),
    contract.REF_REFERRER_BPS(),
    contract.REF_BONUS_BPS(),
    contract.REF_OWNER_BPS(),
    contract.getOwners(),
  ])

  console.log('\n=== Fees verificados ===')
  console.log('depositFeeBps  :', dep.toString(), '→', Number(dep)/100 + '%')
  console.log('withdrawFeeBps :', wit.toString(), '→', Number(wit)/100 + '%')
  console.log('claimFeeBps    :', clm.toString(), '→', Number(clm)/100 + '% (hardcoded)')
  console.log('REF_REFERRER   :', refBps.toString(), '→', Number(refBps)/100 + '%  (→ referrer cuando hay invitado)')
  console.log('REF_BONUS      :', bonusBps.toString(), '→', Number(bonusBps)/100 + '%  (→ bonus usuario cuando hay invitado)')
  console.log('REF_OWNER      :', ownerBps.toString(), '→', Number(ownerBps)/100 + '%  (→ owner cuando hay invitado)')
  console.log('\nOwners:', ownersArr)

  // Guardar dirección
  const outPath = path.join(__dirname, '..', 'deployed-new-h2o-staking.json')
  const record = {
    contract: contractAddress,
    token: H2O_TOKEN,
    owner: OWNER_ADDR,
    fees: {
      depositFeeBps: Number(dep),
      withdrawFeeBps: Number(wit),
      claimFeeBps: Number(clm),
      refReferrerBps: Number(refBps),
      refBonusBps: Number(bonusBps),
      refOwnerBps: Number(ownerBps),
    },
    description: 'NewH2OStaking v2 — referidos ilimitados integrados, 15% claim fee siempre',
    deployedAt: new Date().toISOString(),
  }
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2))
  console.log('\nGuardado en:', outPath)

  console.log('\n=== ACTUALIZA EL FRONTEND ===')
  console.log('En components/new-h2o-panel.tsx, línea 15:')
  console.log("  const CONTRACT = '" + contractAddress + "'")
}

main().catch(e => { console.error(e); process.exit(1) })
