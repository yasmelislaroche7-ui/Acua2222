// deploy-autostake.js
// npx hardhat run scripts/deploy-autostake.js --network worldchain
//
// Después del deploy:
//   1. Actualiza ACUA_AUTOSTAKE_ADDRESS en lib/autostake.ts
//   2. Cambia DEPLOYED = true en lib/autostake.ts
//   3. Llama addToken(H2O_TOKEN, 5000) para 50% APR inicial

const { ethers } = require('hardhat')
const fs = require('fs')
const path = require('path')

const H2O_TOKEN = '0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd'
const OWNER2    = '0xc2ef127734f296952de75c1b58a6cec605cc2e59'
const INITIAL_APR_BPS = 5000  // 50% APR inicial para H2O

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deployer:', deployer.address)
  console.log('Balance:', ethers.formatEther(await deployer.provider.getBalance(deployer.address)), 'ETH')

  console.log('\n--- Deploying AcuaAutoStake ---')
  const Factory = await ethers.getContractFactory('AcuaAutoStake')
  const contract = await Factory.deploy(OWNER2)
  await contract.waitForDeployment()
  const address = await contract.getAddress()
  console.log('AcuaAutoStake deployed at:', address)

  // Add H2O as first staking token
  console.log('\n--- Adding H2O token (50% APR) ---')
  const tx = await contract.addToken(H2O_TOKEN, INITIAL_APR_BPS)
  await tx.wait()
  console.log('H2O added with', INITIAL_APR_BPS / 100, '% APR')

  // Save to deployed file
  const outFile = path.join(__dirname, 'deployed-autostake.json')
  const data = {
    network: 'worldchain',
    contract: address,
    owner2: OWNER2,
    h2oToken: H2O_TOKEN,
    initialAprBps: INITIAL_APR_BPS,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  }
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2))
  console.log('\nSaved to:', outFile)

  console.log('\n=== NEXT STEPS ===')
  console.log('1. Update lib/autostake.ts:')
  console.log(`   ACUA_AUTOSTAKE_ADDRESS = '${address}'`)
  console.log('   DEPLOYED = true')
  console.log('2. Fund the reward pool via AutoStake Admin panel')
  console.log('3. Users can now stake H2O at', INITIAL_APR_BPS / 100, '% APR')
}

main().catch(err => { console.error(err); process.exit(1) })
