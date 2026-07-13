// admin-autostake.js — Agrega H2O principal al AutoStake + baja minStake
// Uso: node contracts-hh/admin-autostake.js
const { ethers } = require('ethers');

const RPC             = process.env.WLD_RPC_URL || 'https://worldchain-mainnet.g.alchemy.com/public';
const PK              = process.env.PRIVATE_KEY;
const AUTOSTAKE_ADDR  = '0x9a3B08D4debB17e494023A23ec21cB53Ab233062';
const H2O_MAIN        = '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d'; // H2O principal
const H2O_OLD         = '0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd'; // H2O viejo

const APR_BPS  = 5000;  // 50% APR
const MIN_STAKE = 0n;   // sin mínimo

if (!PK) { console.error('ERROR: PRIVATE_KEY no configurada'); process.exit(1); }

const ABI = [
  'function addToken(address token, uint256 aprBps, uint256 minStakeAmount) external',
  'function setMinStake(address token, uint256 minStakeAmount) external',
  'function tokens(address) view returns (bool allowed, uint256 aprBps, uint256 rewardFund, uint256 minStake)',
  'function getTokenList() view returns (address[])',
  'function isOwner(address) view returns (bool)',
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, { chainId: 480, name: 'worldchain' });
  const wallet   = new ethers.Wallet(PK, provider);
  const contract = new ethers.Contract(AUTOSTAKE_ADDR, ABI, wallet);

  console.log('Deployer:', wallet.address);
  const isOwner = await contract.isOwner(wallet.address);
  console.log('Is owner:', isOwner);
  if (!isOwner) { console.error('ERROR: wallet no es owner del contrato'); process.exit(1); }

  const feeData  = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? ethers.parseUnits('0.001', 'gwei');
  console.log('Gas price:', ethers.formatUnits(gasPrice, 'gwei'), 'gwei');

  // 1. Tokens actuales
  const tokenList = await contract.getTokenList();
  console.log('\nTokens actuales:', tokenList);

  // 2. Bajar minStake del token viejo
  const oldCfg = await contract.tokens(H2O_OLD);
  console.log('\nH2O viejo', H2O_OLD, '| allowed:', oldCfg.allowed, '| minStake:', ethers.formatUnits(oldCfg.minStake, 18));
  if (oldCfg.allowed && oldCfg.minStake > 0n) {
    console.log('  → Bajando minStake a 0...');
    const tx = await contract.setMinStake(H2O_OLD, 0n, { gasPrice });
    console.log('  TX:', tx.hash);
    await tx.wait();
    console.log('  ✓ minStake = 0');
  } else {
    console.log('  → minStake ya es 0, saltando');
  }

  // 3. Agregar H2O principal si no está
  const mainCfg = await contract.tokens(H2O_MAIN);
  console.log('\nH2O principal', H2O_MAIN, '| allowed:', mainCfg.allowed);
  if (mainCfg.allowed) {
    console.log('  → Ya está agregado');
    if (mainCfg.minStake > 0n) {
      const tx = await contract.setMinStake(H2O_MAIN, 0n, { gasPrice });
      console.log('  TX setMinStake:', tx.hash);
      await tx.wait();
      console.log('  ✓ minStake = 0');
    }
  } else {
    console.log('  → Agregando con APR 50%, minStake 0...');
    const tx = await contract.addToken(H2O_MAIN, APR_BPS, MIN_STAKE, { gasPrice });
    console.log('  TX addToken:', tx.hash);
    await tx.wait();
    console.log('  ✓ H2O principal agregado');
  }

  // 4. Resultado final
  const finalList = await contract.getTokenList();
  console.log('\nTokens finales:', finalList);
  console.log('\n✓ LISTO');
}

main().catch(e => { console.error('\nERROR:', e.message); process.exit(1); });
