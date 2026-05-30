/**
 * deploy-new-h2o-staking.js
 * Despliega NewH2OStaking con fees: 5% depósito / 5% retiro / 15% claim
 * Todas las comisiones van al owner (feeToPoolBps = 0)
 *
 * Run: npx hardhat run scripts/deploy-new-h2o-staking.js --network worldchain
 */
const { ethers } = require('hardhat')

const H2O_TOKEN   = '0x08131A6f780AEF79E86518c4A10c06387Ec74636'
const OWNER_ADDR  = '0x54F0D557E8042eC70974d2e85331BE5D66fFe5F4'

async function main() {
  const [signer] = await ethers.getSigners()
  console.log('Deployer:', signer.address)
  console.log('Balance:', ethers.utils.formatEther(await signer.getBalance()), 'ETH/WLD')

  const Factory = await ethers.getContractFactory('NewH2OStaking', signer)
  console.log('\nDesplegando NewH2OStaking...')
  console.log('  TOKEN  :', H2O_TOKEN)
  console.log('  OWNER  :', OWNER_ADDR)
  console.log('  Fees   : 5% depósito / 5% retiro / 15% claim / 0% a pool (100% al owner)')

  const contract = await Factory.deploy(H2O_TOKEN, OWNER_ADDR)
  console.log('\nTX hash:', contract.deployTransaction.hash)
  await contract.deployed()

  console.log('\n✅ Desplegado en:', contract.address)

  // Verify fees
  const [dep, wit, clm, toPool] = await Promise.all([
    contract.depositFeeBps(),
    contract.withdrawFeeBps(),
    contract.claimFeeBps(),
    contract.feeToPoolBps(),
  ])
  console.log('\n=== Fees verificados ===')
  console.log('depositFeeBps :', dep.toString(), '(' + Number(dep)/100 + '%)')
  console.log('withdrawFeeBps:', wit.toString(), '(' + Number(wit)/100 + '%)')
  console.log('claimFeeBps   :', clm.toString(), '(' + Number(clm)/100 + '%)')
  console.log('feeToPoolBps  :', toPool.toString(), '(' + Number(toPool)/100 + '% al pool)')

  const owners = await contract.getOwners()
  console.log('\nOwners:', owners)

  console.log('\n=== ACTUALIZA EL FRONTEND ===')
  console.log('NEW_H2O_STAKE_ADDRESS =', contract.address)
  console.log('\nActualiza en components/new-h2o-panel.tsx:')
  console.log("  const CONTRACT = '" + contract.address + "'")
}

main().catch(e => { console.error(e); process.exit(1) })
