/**
 * deploy-h2o-funding-proxy.js
 * Despliega H2OFundingProxy en World Chain (chainId 480).
 *
 * Permite al owner2 fondear el rewardPool de H2OStake3 usando Permit2
 * (sin approve separado) directamente desde World App / MiniKit.
 *
 * USO:
 *   cd contracts-hh
 *   echo "n" | PRIVATE_KEY=0x... npx hardhat run scripts/deploy-h2o-funding-proxy.js --network worldchain
 */

require('dotenv').config()
const { ethers } = require('hardhat')
const fs         = require('fs')

const CONFIG = {
  OWNER2:         '0xc2ef127734f296952de75c1b58a6cec605cc2e59',
  STAKE_CONTRACT: '0x357EE95386a7a07418731F8688BAF62582E4cf51', // H2OStake3
  H2O2_TOKEN:     '0x08131A6f780AEF79E86518c4A10c06387Ec74636', // H2O 2.0
}

async function main() {
  const [deployer] = await ethers.getSigners()
  const network    = await ethers.provider.getNetwork()
  const balance    = await ethers.provider.getBalance(deployer.address)

  console.log('═══════════════════════════════════════════════════')
  console.log(' H2OFundingProxy — Deploy en World Chain')
  console.log('═══════════════════════════════════════════════════')
  console.log(' Network       :', network.name, '(chainId', network.chainId.toString(), ')')
  console.log(' Deployer      :', deployer.address)
  console.log(' Balance       :', ethers.utils.formatEther(balance), 'ETH')
  console.log(' Owner2        :', CONFIG.OWNER2)
  console.log(' StakeContract :', CONFIG.STAKE_CONTRACT, '(H2OStake3)')
  console.log(' H2O 2.0 Token :', CONFIG.H2O2_TOKEN)
  console.log('───────────────────────────────────────────────────')

  if (network.chainId.toString() !== '480') {
    throw new Error(`Chain ID incorrecto: esperaba 480 (World Chain), got ${network.chainId}`)
  }

  console.log('\n🚀 Desplegando H2OFundingProxy...')
  const Factory  = await ethers.getContractFactory('H2OFundingProxy')
  const contract = await Factory.deploy(CONFIG.OWNER2, CONFIG.STAKE_CONTRACT, CONFIG.H2O2_TOKEN)
  await contract.deployed()
  const address = contract.address
  console.log(' ✅ H2OFundingProxy desplegado en:', address)

  const owner  = await contract.owner()
  const owner2 = await contract.owner2()
  const stake  = await contract.stakeContract()
  const token  = await contract.token()

  console.log('\n📊 Estado verificado:')
  console.log(' owner         :', owner)
  console.log(' owner2        :', owner2)
  console.log(' stakeContract :', stake)
  console.log(' token         :', token)

  const result = {
    network:       'worldchain',
    chainId:       480,
    contract:      address,
    deployer:      deployer.address,
    owner:         owner,
    owner2:        owner2,
    stakeContract: stake,
    h2o2Token:     token,
    deployedAt:    new Date().toISOString(),
    description:   'H2OFundingProxy — fondea H2OStake3 via Permit2 desde World App',
  }
  fs.writeFileSync('deployed-h2o-funding-proxy.json', JSON.stringify(result, null, 2))

  console.log('\n═══════════════════════════════════════════════════')
  console.log(' RESULTADO FINAL')
  console.log('═══════════════════════════════════════════════════')
  console.log(' H2OFundingProxy:', address)
  console.log()
  console.log(' FLUJO DE USO (desde World App):')
  console.log('   1. owner2 firma Permit2 {token: H2O2, spender: este contrato, amount: X}')
  console.log('   2. Llama fund(permit, sig, amount) → fondea H2OStake3 automáticamente')
  console.log()
  console.log(' 🔗 Verificar en WorldScan:')
  console.log(`    https://worldscan.org/address/${address}`)
  console.log('═══════════════════════════════════════════════════')
  console.log('\n💾 Resultado guardado en deployed-h2o-funding-proxy.json')
}

main().catch(e => { console.error(e); process.exit(1) })
