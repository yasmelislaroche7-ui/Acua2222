/**
 * deploy-bridge-bnb.js
 * Script de deploy de AcuaBridgeBNB en BNB Chain (Chain ID 56)
 *
 * USO:
 *   cd contracts-hh
 *   PRIVATE_KEY=0x... npx hardhat run scripts/deploy-bridge-bnb.js --network bnbchain
 *
 * REQUISITOS:
 *   - PRIVATE_KEY en .env o como variable de entorno
 *   - BNB en la wallet del deployer (ver estimado de costos abajo)
 *   - Añadir red "bnbchain" en hardhat.config.js (ver instrucciones abajo)
 *
 * ═══════════════════════════════════════════════════════════════════
 * ESTIMADO DE COSTOS EN BNB CHAIN  (AcuaBridgeBNB v3-lean)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Versión lean: eliminados releaseToUserBatch, getRequests, getWaitingList,
 * withdrawAll y 5 eventos individuales → ~25% menos bytecode que v2.
 *
 * Gas estimado para el deploy completo:
 *   - Deploy contrato:       ~1 350 000 gas  (era ~1 800 000)
 *   - setFlatFee():          ~    28 000 gas
 *   - setMinAmount():        ~    28 000 gas
 *   - setSplitThreshold():   ~    28 000 gas
 *   - setChunkSize():        ~    28 000 gas
 *   - setMembershipFeeBps(): ~    28 000 gas
 *   TOTAL GAS:               ~1 490 000 gas  (era ~1 950 000)
 *
 * Gas price en BNB — MÍNIMO DE RED = 1 gwei (hard floor desde Feb 2024):
 *   - Normal:   3 gwei  (validators prefieren ≥ 3 gwei para inclusión rápida)
 *   - Alto:     5 gwei
 *   ⚠️  NO usar < 1 gwei — los validadores rechazan el TX.
 *
 * Costo del deploy completo:
 *   - A 1 gwei:  1 490 000 × 1e-9 = 0.00149 BNB ≈ $0.90
 *   - A 3 gwei:  1 490 000 × 3e-9 = 0.00447 BNB ≈ $2.7
 *   - A 5 gwei:  1 490 000 × 5e-9 = 0.00745 BNB ≈ $4.5
 *
 * RECOMENDACIÓN: Tener mínimo 0.02 BNB en la wallet antes de deployer.
 *   Esto cubre el deploy + approve SUSHI + fund() + 3-5 txs de prueba.
 *   Precio BNB estimado: $600 → 0.02 BNB = ~$12
 *
 * PARA FONDEAR EL CONTRATO después del deploy:
 *   - Transferir SUSHI a la dirección del contrato via fund()
 *   - Requiere approve(SUSHI_BNB, bridgeAddress, amount) previo
 *   - El gas de fund() es ~50 000 gas = ~$0.09 a 3 gwei
 *
 * ═══════════════════════════════════════════════════════════════════
 * CONFIGURAR hardhat.config.js — añadir esta red:
 * ═══════════════════════════════════════════════════════════════════
 *
 *   networks: {
 *     bnbchain: {
 *       url: 'https://bsc-dataseed1.binance.org',
 *       chainId: 56,
 *       accounts: [process.env.PRIVATE_KEY],
 *       gasPrice: 3000000000, // 3 gwei
 *     },
 *   },
 *
 * ═══════════════════════════════════════════════════════════════════
 */

require('dotenv').config()
const { ethers } = require('hardhat')

// ─── Configura estas direcciones antes de hacer deploy ───────────────────────
const CONFIG = {
  // SUSHI token en BNB Chain
  SUSHI_BNB: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38',

  // Owner principal
  OWNER: '0x5474C309e985c6B4Fc623acf01AdE604dA781e52',

  // Owner secundario (recibe 10% de fees)
  OWNER2: '0xc2ef127734f296952de75c1b58a6cec605cc2e59',

  // Parámetros iniciales
  FLAT_FEE:           ethers.parseEther('1000'),
  MIN_AMOUNT:         ethers.parseEther('10000'),
  SPLIT_THRESHOLD:    ethers.parseEther('100000'),
  CHUNK_SIZE:         ethers.parseEther('10000'),
  MEMBERSHIP_FEE_BPS: 1000,
}
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners()
  const network    = await ethers.provider.getNetwork()
  const feeData    = await ethers.provider.getFeeData()

  console.log('═══════════════════════════════════════════════════')
  console.log(' AcuaBridgeBNB — Deploy en BNB Chain')
  console.log('═══════════════════════════════════════════════════')
  console.log(' Network  :', network.name, '(chainId', network.chainId.toString(), ')')
  console.log(' Deployer :', deployer.address)

  const balance = await ethers.provider.getBalance(deployer.address)
  console.log(' Balance  :', ethers.formatEther(balance), 'BNB')

  const gasPrice = feeData.gasPrice ?? ethers.parseUnits('3', 'gwei')
  const estGas   = 1_490_000n  // v3-lean: ~25% menos bytecode que v2
  const estCost  = gasPrice * estGas
  console.log(' Gas price:', ethers.formatUnits(gasPrice, 'gwei'), 'gwei')
  console.log(' Est. costo deploy:', ethers.formatEther(estCost), 'BNB')

  if (balance < estCost * 2n) {
    console.warn('\n⚠️  ADVERTENCIA: Balance bajo. Recomendado >= 0.02 BNB')
    console.warn('   Balance actual:', ethers.formatEther(balance), 'BNB')
  }

  console.log()
  console.log(' SUSHI    :', CONFIG.SUSHI_BNB)
  console.log(' Owner    :', CONFIG.OWNER)
  console.log(' Owner2   :', CONFIG.OWNER2)
  console.log(' FlatFee  :', ethers.formatEther(CONFIG.FLAT_FEE), 'SUSHI')
  console.log(' Min      :', ethers.formatEther(CONFIG.MIN_AMOUNT), 'SUSHI')
  console.log(' SplitAt  :', ethers.formatEther(CONFIG.SPLIT_THRESHOLD), 'SUSHI')
  console.log(' ChunkSz  :', ethers.formatEther(CONFIG.CHUNK_SIZE), 'SUSHI')
  console.log(' MemFee % :', CONFIG.MEMBERSHIP_FEE_BPS / 100, '%')
  console.log('───────────────────────────────────────────────────')

  if (network.chainId.toString() !== '56') {
    throw new Error(`Chain ID incorrecto: esperaba 56 (BNB Chain), got ${network.chainId}`)
  }

  console.log('\n🚀 Desplegando AcuaBridgeBNB...')
  const Factory = await ethers.getContractFactory('AcuaBridgeBNB')
  const bridge  = await Factory.deploy(CONFIG.SUSHI_BNB, CONFIG.OWNER, CONFIG.OWNER2)
  await bridge.waitForDeployment()
  const address = await bridge.getAddress()
  console.log(' ✅ AcuaBridgeBNB desplegado en:', address)

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

  const stats = await bridge.getStats()
  console.log('\n📊 Stats verificados:')
  console.log(' flatFee   :', ethers.formatEther(stats._flatFee), 'SUSHI')
  console.log(' minAmount :', ethers.formatEther(stats._minAmount), 'SUSHI')
  console.log(' paused    :', stats._paused)

  console.log('\n═══════════════════════════════════════════════════')
  console.log(' RESULTADO FINAL')
  console.log('═══════════════════════════════════════════════════')
  console.log(' AcuaBridgeBNB:', address)
  console.log()
  console.log(' ⚠️  IMPORTANTE: Copia esta dirección en')
  console.log('    components/bnb-bridge-panel.tsx → BRIDGE_BNB_ADDRESS')
  console.log()
  console.log(' 🔗 Verificar en BscScan:')
  console.log(`    https://bscscan.com/address/${address}`)
  console.log()
  console.log(' 📋 PRÓXIMOS PASOS:')
  console.log('    1. Aprobar SUSHI al contrato: approve(AcuaBridgeBNB, amount)')
  console.log('    2. Fondear el contrato: fund(amount)')
  console.log('    3. Actualizar BRIDGE_BNB_ADDRESS en el panel')
  console.log('    4. Conectar con AcuaBridgeWLD en World Chain')
  console.log('═══════════════════════════════════════════════════')

  const fs = require('fs')
  const result = {
    network:      'bnbchain',
    chainId:      56,
    deployer:     deployer.address,
    AcuaBridgeBNB: address,
    deployedAt:   new Date().toISOString(),
    gasPrice:     gasPrice.toString(),
    estimatedCostBNB: ethers.formatEther(estCost),
    config: {
      SUSHI_BNB:          CONFIG.SUSHI_BNB,
      OWNER:              CONFIG.OWNER,
      OWNER2:             CONFIG.OWNER2,
      flatFee:            CONFIG.FLAT_FEE.toString(),
      minAmount:          CONFIG.MIN_AMOUNT.toString(),
      splitThreshold:     CONFIG.SPLIT_THRESHOLD.toString(),
      chunkSize:          CONFIG.CHUNK_SIZE.toString(),
      membershipFeeBps:   CONFIG.MEMBERSHIP_FEE_BPS,
    },
  }
  fs.writeFileSync('deployed-bridge-bnb.json', JSON.stringify(result, null, 2))
  console.log('\n💾 Resultado guardado en deployed-bridge-bnb.json')
}

main().catch(e => { console.error(e); process.exit(1) })
