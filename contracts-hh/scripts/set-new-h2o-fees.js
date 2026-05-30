/**
 * set-new-h2o-fees.js
 * Actualiza fees del contrato NewH2OStaking:
 *   depositFeeBps  = 500  (5%)
 *   withdrawFeeBps = 500  (5%)
 *   claimFeeBps    = 1500 (15%)
 *
 * Run: npx hardhat run scripts/set-new-h2o-fees.js --network worldchain
 */
const { ethers } = require('hardhat')

const CONTRACT = '0x57A5f1557AFc8FE41203ff5cB6D6423cC607B69e'

const ABI = [
  'function depositFeeBps() view returns (uint256)',
  'function withdrawFeeBps() view returns (uint256)',
  'function claimFeeBps() view returns (uint256)',
  'function feeToPoolBps() view returns (uint256)',
  'function setFees(uint256 depositBps, uint256 withdrawBps, uint256 claimBps) nonpayable',
  'function setFeeDistribution(uint256 toPoolBps) nonpayable',
  'function getOwners() view returns (address[])',
]

async function main() {
  const [signer] = await ethers.getSigners()
  console.log('Signer:', signer.address)

  const c = new ethers.Contract(CONTRACT, ABI, signer)

  // Read current fees
  const [dep, wit, clm, toPool] = await Promise.all([
    c.depositFeeBps(), c.withdrawFeeBps(), c.claimFeeBps(), c.feeToPoolBps(),
  ])
  console.log('\n=== Fees actuales ===')
  console.log('depositFeeBps :', dep.toString(), '(' + (Number(dep)/100).toFixed(0) + '%)')
  console.log('withdrawFeeBps:', wit.toString(), '(' + (Number(wit)/100).toFixed(0) + '%)')
  console.log('claimFeeBps   :', clm.toString(), '(' + (Number(clm)/100).toFixed(0) + '%)')
  console.log('feeToPoolBps  :', toPool.toString(), '(' + (Number(toPool)/100).toFixed(0) + '%)')

  // Verify owner
  const owners = await c.getOwners()
  console.log('\nOwners:', owners)
  const isOwner = owners.map(o => o.toLowerCase()).includes(signer.address.toLowerCase())
  if (!isOwner) { console.error('ERROR: signer no es owner'); process.exit(1) }

  // Set new fees: 5% / 5% / 15%
  const DEPOSIT  = 500   // 5%
  const WITHDRAW = 500   // 5%
  const CLAIM    = 1500  // 15%

  console.log('\n=== Ejecutando setFees(500, 500, 1500) ===')
  const tx1 = await c.setFees(DEPOSIT, WITHDRAW, CLAIM)
  console.log('TX:', tx1.hash)
  await tx1.wait()
  console.log('✓ Fees actualizados')

  // Verify
  const [dep2, wit2, clm2] = await Promise.all([
    c.depositFeeBps(), c.withdrawFeeBps(), c.claimFeeBps(),
  ])
  console.log('\n=== Fees nuevos ===')
  console.log('depositFeeBps :', dep2.toString(), '(' + (Number(dep2)/100).toFixed(0) + '%) ✓')
  console.log('withdrawFeeBps:', wit2.toString(), '(' + (Number(wit2)/100).toFixed(0) + '%) ✓')
  console.log('claimFeeBps   :', clm2.toString(), '(' + (Number(clm2)/100).toFixed(0) + '%) ✓')
}

main().catch(e => { console.error(e); process.exit(1) })
