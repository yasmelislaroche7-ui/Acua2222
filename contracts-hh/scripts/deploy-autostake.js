// deploy-autostake.js
// npx hardhat run scripts/deploy-autostake.js --network worldchain
const { ethers } = require('hardhat')
const fs = require('fs')
const path = require('path')

const H2O_TOKEN       = '0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd'
const OWNER2          = '0xc2ef127734f296952de75c1b58a6cec605cc2e59'
const INITIAL_APR_BPS = 5000  // 50% APR
const MIN_STAKE_H2O   = ethers.utils.parseUnits('1000', 18) // 1000 H2O minimum

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deployer:', deployer.address)
  const bal = await deployer.provider.getBalance(deployer.address)
  console.log('Balance:', ethers.utils.formatEther(bal), 'ETH')

  console.log('\n--- Deploying AcuaAutoStake ---')
  const Factory  = await ethers.getContractFactory('AcuaAutoStake')
  const contract = await Factory.deploy(OWNER2)
  await contract.deployed()
  const address = contract.address
  console.log('AcuaAutoStake deployed at:', address)

  console.log('\n--- Adding H2O token (50% APR, 1000 H2O min stake) ---')
  const tx = await contract.addToken(H2O_TOKEN, INITIAL_APR_BPS, MIN_STAKE_H2O)
  await tx.wait()
  console.log('H2O added.')

  const outFile = path.join(__dirname, 'deployed-autostake.json')
  fs.writeFileSync(outFile, JSON.stringify({
    contract: address,
    owner2: OWNER2,
    h2oToken: H2O_TOKEN,
    initialAprBps: INITIAL_APR_BPS,
    minStakeH2O: MIN_STAKE_H2O.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  }, null, 2))
  console.log('Saved to:', outFile)
  console.log('\nDONE — address:', address)
}

main().catch(e => { console.error(e); process.exit(1) })
