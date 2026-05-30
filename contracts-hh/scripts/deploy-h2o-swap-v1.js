/**
 * deploy-h2o-swap-v1.js
 * Despliega H2OSwapV1 en World Chain (chainId 480).
 *
 * USO:
 *   cd contracts-hh
 *   echo "n" | PRIVATE_KEY=0x... npx hardhat run scripts/deploy-h2o-swap-v1.js --network worldchain
 */

require('dotenv').config()
const { ethers } = require('hardhat')
const fs         = require('fs')

const CONFIG = {
  H2O_TOKEN: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', // H2O viejo
  OWNER2:    '0xc2ef127734f296952de75c1b58a6cec605cc2e59',
}

async function main() {
  const [deployer] = await ethers.getSigners()
  const network    = await ethers.provider.getNetwork()
  const balance    = await ethers.provider.getBalance(deployer.address)

  console.log('═══════════════════════════════════════════════════')
  console.log(' H2OSwapV1 — Deploy en World Chain')
  console.log('═══════════════════════════════════════════════════')
  console.log(' Network  :', network.name, '(chainId', network.chainId.toString(), ')')
  console.log(' Deployer :', deployer.address)
  console.log(' Balance  :', ethers.utils.formatEther(balance), 'ETH')
  console.log(' H2O      :', CONFIG.H2O_TOKEN)
  console.log(' Owner2   :', CONFIG.OWNER2)
  console.log('───────────────────────────────────────────────────')

  if (network.chainId.toString() !== '480') {
    throw new Error(`Chain ID incorrecto: esperaba 480 (World Chain), got ${network.chainId}`)
  }

  console.log('\n🚀 Desplegando H2OSwapV1...')
  const Factory  = await ethers.getContractFactory('H2OSwapV1')
  const contract = await Factory.deploy(CONFIG.H2O_TOKEN, CONFIG.OWNER2)
  await contract.deployed()
  const address = contract.address
  console.log(' ✅ H2OSwapV1 desplegado en:', address)

  const result = {
    network:    'worldchain',
    chainId:    480,
    contract:   address,
    deployer:   deployer.address,
    h2oToken:   CONFIG.H2O_TOKEN,
    owner2:     CONFIG.OWNER2,
    deployedAt: new Date().toISOString(),
    description: 'H2OSwapV1 — exchange H2O viejo como base, Permit2',
  }
  fs.writeFileSync('deployed-h2o-swap-v1.json', JSON.stringify(result, null, 2))

  console.log('\n═══════════════════════════════════════════════════')
  console.log(' RESULTADO FINAL')
  console.log('═══════════════════════════════════════════════════')
  console.log(' H2OSwapV1:', address)
  console.log()
  console.log(' PRÓXIMOS PASOS:')
  console.log('   1. Fondear H2O: fund(H2O, amount, permit, sig)')
  console.log('   2. Agregar pares: addPair(token, price, feeBps, symbol)')
  console.log()
  console.log(' 🔗 Verificar en WorldScan:')
  console.log(`    https://worldscan.org/address/${address}`)
  console.log('═══════════════════════════════════════════════════')
  console.log('\n💾 Resultado guardado en deployed-h2o-swap-v1.json')
}

main().catch(e => { console.error(e); process.exit(1) })
