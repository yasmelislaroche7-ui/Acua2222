// deploy-direct.js — bypasses hardhat CLI, deploys directly with ethers.js v5
const { ethers } = require('ethers');
const fs   = require('fs');
const path = require('path');

const RPC    = process.env.WLD_RPC_URL || 'https://worldchain-mainnet.gateway.tenderly.co';
const PK     = process.env.PRIVATE_KEY;
const TOKEN  = '0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd';
const OWNER2 = '0xc2ef127734f296952de75c1b58a6cec605cc2e59';

if (!PK || PK === '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') {
  console.error('ERROR: Real PRIVATE_KEY not set'); process.exit(1);
}

async function deployOne(label, Factory, args, wallet, provider) {
  const nonce    = await provider.getTransactionCount(wallet.address, 'pending');
  const feeData  = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.utils.parseUnits('0.001', 'gwei');
  console.log(`[${label}] nonce=${nonce} gasPrice=${ethers.utils.formatUnits(gasPrice,'gwei')}gwei`);

  const deployTx = await Factory.getDeployTransaction(...args);

  let gasLimit;
  try {
    gasLimit = await provider.estimateGas({ ...deployTx, from: wallet.address });
    gasLimit = gasLimit.mul(120).div(100); // +20% headroom
    console.log(`[${label}] estimatedGas=${gasLimit.toString()}`);
  } catch(e) {
    gasLimit = ethers.BigNumber.from(3_000_000);
    console.log(`[${label}] gas estimate failed (${e.message}), using ${gasLimit}`);
  }

  const bal = await provider.getBalance(wallet.address);
  const cost = gasLimit.mul(gasPrice);
  console.log(`[${label}] wallet balance=${ethers.utils.formatEther(bal)} WLD  estCost=${ethers.utils.formatEther(cost)} WLD`);

  if (bal.lt(cost)) {
    throw new Error(`Insufficient balance: need ${ethers.utils.formatEther(cost)} WLD, have ${ethers.utils.formatEther(bal)}`);
  }

  const contract = await Factory.deploy(...args, { gasLimit, gasPrice, nonce });
  console.log(`[${label}] tx hash: ${contract.deployTransaction.hash}`);
  console.log(`[${label}] waiting for confirmation...`);
  await contract.deployed();
  console.log(`[${label}] confirmed at: ${contract.address}`);
  return contract.address;
}

async function main() {
  const provider = new ethers.providers.JsonRpcProvider({ url: RPC }, { chainId: 480, name: 'worldchain' });
  const wallet   = new ethers.Wallet(PK, provider);
  console.log('Deployer:', wallet.address);

  const BASE = path.join(__dirname, 'artifacts/contracts');
  const stakeArt = JSON.parse(fs.readFileSync(BASE + '/AcuaTokenStake.sol/AcuaTokenStake.json'));
  const claimArt = JSON.parse(fs.readFileSync(BASE + '/AcuaFreeClaim.sol/AcuaFreeClaim.json'));

  const StakeFactory = new ethers.ContractFactory(stakeArt.abi, stakeArt.bytecode, wallet);
  const ClaimFactory = new ethers.ContractFactory(claimArt.abi, claimArt.bytecode, wallet);

  const stakeAddr = await deployOne('AcuaTokenStake', StakeFactory, [TOKEN, OWNER2], wallet, provider);
  const claimAddr = await deployOne('AcuaFreeClaim',  ClaimFactory, [wallet.address, OWNER2], wallet, provider);

  const stakeInfo = { deployedAt: new Date().toISOString(), network: 'worldchain', chainId: 480,
    deployer: wallet.address, owner2: OWNER2, contract: stakeAddr, token: TOKEN,
    description: 'AcuaTokenStake — staking H2O Acua Company (48h queue + referrals + Permit2)', aprBps: 1200 };
  const claimInfo = { deployedAt: new Date().toISOString(), network: 'worldchain', chainId: 480,
    deployer: wallet.address, owner2: OWNER2, contract: claimAddr,
    description: 'AcuaFreeClaim — multi-token free claim with admin panel, Permit2 funding' };

  fs.writeFileSync(path.join(__dirname, 'deployed-acua-token-stake.json'), JSON.stringify(stakeInfo, null, 2));
  fs.writeFileSync(path.join(__dirname, 'deployed-acua-free-claim.json'), JSON.stringify(claimInfo, null, 2));
  console.log('\n=== DEPLOYED ===');
  console.log('AcuaTokenStake:', stakeAddr);
  console.log('AcuaFreeClaim: ', claimAddr);
}

main().catch(e => { console.error('\nERROR:', e.message); process.exit(1); });
