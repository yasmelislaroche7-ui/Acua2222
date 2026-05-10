// deploy-chatv2.js — deploys AcuaGlobalChatV2 to World Chain
const { ethers } = require('ethers')
const fs   = require('fs')
const path = require('path')

const OWNER2   = '0x5474c309e985c6b4fc623acf01ade604da781e52'
const RPC_URL  = 'https://worldchain-mainnet.g.alchemy.com/v2/bVo646pb8L7_W_nahCoqW'
const CHAIN_ID = 480

async function main() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY env var missing')

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL)
  const wallet   = new ethers.Wallet(pk, provider)
  const deployer = wallet.address

  console.log('Deployer :', deployer)
  const bal = await provider.getBalance(deployer)
  console.log('Balance  :', ethers.utils.formatEther(bal), 'ETH (World Chain)')

  // Get actual on-chain gas price (very low on World Chain ~0.001 gwei)
  const feeData  = await provider.getFeeData()
  const gasPrice = feeData.gasPrice || ethers.utils.parseUnits('0.002', 'gwei')
  // Use 3x actual gas price as maxFeePerGas (safe buffer, but keeps cost tiny)
  const maxFee   = gasPrice.mul(3)
  const maxPrio  = gasPrice

  console.log('Gas price:', ethers.utils.formatUnits(gasPrice, 'gwei'), 'gwei')
  console.log('MaxFee   :', ethers.utils.formatUnits(maxFee,   'gwei'), 'gwei')

  // Estimate max deploy cost
  const gasLimitEstimate = ethers.BigNumber.from(4_000_000) // upper bound
  const maxCost = maxFee.mul(gasLimitEstimate)
  console.log('Max deploy cost (est):', ethers.utils.formatEther(maxCost), 'ETH')

  if (bal.lt(maxCost)) {
    throw new Error(`Insufficient balance: have ${ethers.utils.formatEther(bal)} ETH, need ~${ethers.utils.formatEther(maxCost)} ETH`)
  }

  // Read compiled artifact
  const artifactPath = path.join(__dirname, '../artifacts/contracts/AcuaGlobalChatV2.sol/AcuaGlobalChatV2.json')
  if (!fs.existsSync(artifactPath)) {
    throw new Error('Artifact not found — run: cd contracts-hh && npx hardhat compile')
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet)

  // The relayer = deployer wallet (server key pays relay gas)
  const relayer = deployer

  console.log('\nDeploying AcuaGlobalChatV2...')
  console.log('  owner2  :', OWNER2)
  console.log('  relayer :', relayer)

  const contract = await factory.deploy(OWNER2, relayer, {
    gasLimit: 4_000_000,
    maxFeePerGas:         maxFee,
    maxPriorityFeePerGas: maxPrio,
  })

  console.log('  TX hash :', contract.deployTransaction.hash)
  console.log('  Waiting for confirmations...')
  const receipt = await contract.deployTransaction.wait(2)

  const addr = contract.address
  console.log('\n✅  AcuaGlobalChatV2 deployed!')
  console.log('    Address  :', addr)
  console.log('    Gas used :', receipt.gasUsed.toString())

  // Save deployment info
  const info = { contract: addr, relayer, chain: CHAIN_ID, owner2: OWNER2, ts: new Date().toISOString() }
  const outPath = path.join(__dirname, '../deployed-chatv2.json')
  fs.writeFileSync(outPath, JSON.stringify(info, null, 2))
  console.log('Saved to:', outPath)
}

main().catch(e => { console.error('\n❌ Deploy failed:', e.message || e); process.exit(1) })
