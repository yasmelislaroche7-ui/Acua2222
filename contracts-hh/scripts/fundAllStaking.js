import { ethers } from "hardhat";

const TOKENS = {
  WLD:   '0x2cFc85d8E48F8EAB294be644d9E25C3030863003',
  FIRE:  '0x22c40632c13a7f3cae9c343480607d886832c686',
  SUSHI: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38',
  USDC:  '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1',
  wCOP:  '0x8a1d45e102e886510e891d2ec656a708991e2d76',
  wARS:  '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d',
  BTCH2O:'0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484',
  AIR:   '0xDBA88118551d5Adf16a7AB943403Aea7ea06762b',
};

const STAKING = {
  WLD:   '0x224C31214989F8F22E036c4a8Ae294B9Ce339f74',
  FIRE:  '0xC799a6D13735bAc407183e0d8Acb6F07dfF072DD',
  SUSHI: '0x31c25e2E5331F02F15fD43340079303EfE02625c',
  USDC:  '0x21075B62a6459D76534938BAD4EE7146a5AF1c1a',
  wCOP:  '0x68E3EcF55DFE392D7A9D8D8aB129A20D52A2bB70',
  wARS:  '0xf3b9162726D2034af1677bAbD1D667c2c4A0A46A',
  BTCH2O:'0x965934aE4b292816a694e7b9cDd41E873AeC32A0',
  AIR:   '0xfc548193a52cCF151cD2BE34D59a14Be119c5cE1',
};

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() view returns (uint8)"
];

const STAKING_ABI = [
  "function depositRewards(uint256 amount) external"
];

// 🔧 EDITA AQUÍ CUANTO QUIERES FONDEAR POR TOKEN
const FUND_AMOUNTS = {
  WLD: "0.1",
  FIRE: "500",
  SUSHI: "200",
  USDC: "0.1",
  wCOP: "300",
  wARS: "100",
  BTCH2O: "500",
  AIR: "1000",
};

async function fundToken(symbol, signer) {
  const tokenAddr = TOKENS[symbol];
  const stakingAddr = STAKING[symbol];

  const token = await ethers.getContractAt(ERC20_ABI, tokenAddr, signer);
  const staking = await ethers.getContractAt(STAKING_ABI, stakingAddr, signer);

  const decimals = await token.decimals();
  const amount = ethers.parseUnits(FUND_AMOUNTS[symbol], decimals);

  console.log(`\n--- Funding ${symbol} ---`);
  console.log("Amount:", FUND_AMOUNTS[symbol]);

  const tx1 = await token.approve(stakingAddr, amount);
  await tx1.wait();
  console.log("Approve OK");

  const tx2 = await staking.depositRewards(amount);
  await tx2.wait();
  console.log("Deposit OK ✅");
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Funding wallet:", signer.address);

  for (const symbol of Object.keys(FUND_AMOUNTS)) {
    await fundToken(symbol, signer);
  }

  console.log("\n🎉 ALL STAKING CONTRACTS FUNDED");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});