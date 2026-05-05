/**
 * deploy-bridge-wld.js
 * Script de deploy de AcuaBridgeWLD en World Chain (Chain ID 480)
 *
 * USO:
 *   cd contracts-hh
 *   PRIVATE_KEY=0x... npx hardhat run scripts/deploy-bridge-wld.js --network worldchain
 *
 * REQUISITOS:
 *   - PRIVATE_KEY en .env o como variable de entorno
 *   - Fondos en World Chain (gas = 0 para usuarios, pero el deployer necesita algo de ETH/WLD)
 *   - hardhat.config.js apuntando a worldchain (chainId 480)
 *
 * COSTOS ESTIMADOS (World Chain):
 *   - Gas deploy: ~1 800 000 gas
 *   - Gas price WLD: ~0.001 gwei (casi gratis vía World App)
 *   - Costo real: < 0.001 WLD
 */

require('dotenv').config()
const { ethers } = require('hardhat')

// ─── Configura estas direcciones antes de hacer deploy ───────────────────────
const CONFIG = {
  // SUSHI token en World Chain
  SUSHI_WLD: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38',

  // Owner principal (puede cambiar owner, retirar fondos, configurar)
  OWNER: '0x5474C309e985c6B4Fc623acf01AdE604dA781e52',

  // Owner secundario (mismo poder operativo, recibe 10% de fees)
  OWNER2: '0xc2ef127734f296952de75c1b58a6cec605cc2e59',

  // Parámetros iniciales (todos configurables post-deploy)
  FLAT_FEE:         ethers.parseEther('1000'),    // 1 000 SUSHI
  MIN_AMOUNT:       ethers.parseEther('10000'),   // 10 000 SUSHI mínimo
  SPLIT_THRESHOLD:  ethers.parseEther('100000'),  // auto-split si > 100 000
  CHUNK_SIZE:       ethers.parseEther('10000'),   // chunks de 10 000
  MEMBERSHIP_FEE_BPS: 1000,                       // 10% → owner2
}
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners()
  const network    = await ethers.provider.getNetwork()

  console.log('═══════════════════════════════════════════════════')
  console.log(' AcuaBridgeWLD — Deploy en World Chain')
  console.log('═══════════════════════════════════════════════════')
  console.log(' Network  :', network.name, '(chainId', network.chainId.toString(), ')')
  console.log(' Deployer :', deployer.address)
  console.log(' Balance  :', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'ETH')
  console.log()
  console.log(' SUSHI    :', CONFIG.SUSHI_WLD)
  console.log(' Owner    :', CONFIG.OWNER)
  console.log(' Owner2   :', CONFIG.OWNER2)
  console.log(' FlatFee  :', ethers.formatEther(CONFIG.FLAT_FEE), 'SUSHI')
  console.log(' Min      :', ethers.formatEther(CONFIG.MIN_AMOUNT), 'SUSHI')
  console.log(' SplitAt  :', ethers.formatEther(CONFIG.SPLIT_THRESHOLD), 'SUSHI')
  console.log(' ChunkSz  :', ethers.formatEther(CONFIG.CHUNK_SIZE), 'SUSHI')
  console.log(' MemFee % :', CONFIG.MEMBERSHIP_FEE_BPS / 100, '%')
  console.log('───────────────────────────────────────────────────')

  // Verifica que es World Chain
  if (network.chainId.toString() !== '480') {
    throw new Error(`Chain ID incorrecto: esperaba 480 (World Chain), got ${network.chainId}`)
  }

  // Deploy
  console.log('\n🚀 Desplegando AcuaBridgeWLD...')
  const Factory = await ethers.getContractFactory('AcuaBridgeWLD')
  const bridge  = await Factory.deploy(CONFIG.SUSHI_WLD, CONFIG.OWNER, CONFIG.OWNER2)
  await bridge.waitForDeployment()
  const address = await bridge.getAddress()
  console.log(' ✅ AcuaBridgeWLD desplegado en:', address)

  // Configurar parámetros post-deploy
  console.log('\n⚙️  Configurando parámetros iniciales...')
  const tx1 = await bridge.setFlatFee(CONFIG.FLAT_FEE)
  await tx1.wait()
  console.log(' ✅ flatFee = 1 000 SUSHI')

  const tx2 = await bridge.setMinAmount(CONFIG.MIN_AMOUNT)
  await tx2.wait()
  console.log(' ✅ minAmount = 10 000 SUSHI')

  const tx3 = await bridge.setSplitThreshold(CONFIG.SPLIT_THRESHOLD)
  await tx3.wait()
  console.log(' ✅ splitThreshold = 100 000 SUSHI')

  const tx4 = await bridge.setChunkSize(CONFIG.CHUNK_SIZE)
  await tx4.wait()
  console.log(' ✅ chunkSize = 10 000 SUSHI')

  const tx5 = await bridge.setMembershipFeeBps(CONFIG.MEMBERSHIP_FEE_BPS)
  await tx5.wait()
  console.log(' ✅ membershipFeeBps = 10%')

  // Verificación
  const stats = await bridge.getStats()
  console.log('\n📊 Stats verificados:')
  console.log(' flatFee   :', ethers.formatEther(stats._flatFee), 'SUSHI')
  console.log(' minAmount :', ethers.formatEther(stats._minAmount), 'SUSHI')
  console.log(' paused    :', stats._paused)

  console.log('\n═══════════════════════════════════════════════════')
  console.log(' RESULTADO FINAL')
  console.log('═══════════════════════════════════════════════════')
  console.log(' AcuaBridgeWLD:', address)
  console.log()
  console.log(' ⚠️  IMPORTANTE: Copia esta dirección en')
  console.log('    components/bnb-bridge-panel.tsx → BRIDGE_WLD_ADDRESS')
  console.log()
  console.log(' 🔗 Verificar en WorldScan:')
  console.log(`    https://worldscan.org/address/${address}`)
  console.log('═══════════════════════════════════════════════════')

  // Guardar resultado
  const fs = require('fs')
  const result = {
    network:      'worldchain',
    chainId:      480,
    deployer:     deployer.address,
    AcuaBridgeWLD: address,
    deployedAt:   new Date().toISOString(),
    config: {
      SUSHI_WLD:          CONFIG.SUSHI_WLD,
      OWNER:              CONFIG.OWNER,
      OWNER2:             CONFIG.OWNER2,
      flatFee:            CONFIG.FLAT_FEE.toString(),
      minAmount:          CONFIG.MIN_AMOUNT.toString(),
      splitThreshold:     CONFIG.SPLIT_THRESHOLD.toString(),
      chunkSize:          CONFIG.CHUNK_SIZE.toString(),
      membershipFeeBps:   CONFIG.MEMBERSHIP_FEE_BPS,
    },
  }
  fs.writeFileSync('deployed-bridge-wld.json', JSON.stringify(result, null, 2))
  console.log('\n💾 Resultado guardado en deployed-bridge-wld.json')
}

main().catch(e => { console.error(e); process.exit(1) })
