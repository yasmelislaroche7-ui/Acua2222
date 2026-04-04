import pkg from "hardhat";
const { ethers } = pkg;

// 🧠 EDITA SOLO LOS MONTOS (o borra líneas si no quieres fondear ese pool)
const FUNDING_PLAN = [
  { symbol:"WLD",    token:"0x2cFc85d8E48F8EAB294be644d9E25C3030863003", staking:"0x224C31214989F8F22E036c4a8Ae294B9Ce339f74", amount:"0.1" },
  { symbol:"FIRE",   token:"0x22c40632c13a7f3cae9c343480607d886832c686", staking:"0xC799a6D13735bAc407183e0d8Acb6F07dfF072DD", amount:"500" },
  { symbol:"SUSHI",  token:"0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38", staking:"0x31c25e2E5331F02F15fD43340079303EfE02625c", amount:"200" },
  { symbol:"USDC",   token:"0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", staking:"0x21075B62a6459D76534938BAD4EE7146a5AF1c1a", amount:"0.1" },
  { symbol:"wCOP",   token:"0x8a1d45e102e886510e891d2ec656a708991e2d76", staking:"0x68E3EcF55DFE392D7A9D8D8aB129A20D52A2bB70", amount:"500" },
  { symbol:"wARS",   token:"0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", staking:"0xf3b9162726D2034af1677bAbD1D667c2c4A0A46A", amount:"100" },
  { symbol:"BTCH2O", token:"0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484", staking:"0x965934aE4b292816a694e7b9cDd41E873AeC32A0", amount:"2000" },
  { symbol:"AIR",    token:"0xDBA88118551d5Adf16a7AB943403Aea7ea06762b", staking:"0xfc548193a52cCF151cD2BE34D59a14Be119c5cE1", amount:"2000" },
];

// ===== ABIs =====
const ERC20 = [
  "function approve(address spender,uint256 amount) returns(bool)",
  "function decimals() view returns(uint8)"
];

const STAKING_ABI = [
  "function depositRewards(uint256 amount)"
];

async function fundPool(plan, signer) {
  if (plan.amount === "0") {
    console.log(`Skipping ${plan.symbol}`);
    return;
  }

  console.log(`\n--- Funding ${plan.symbol} with ${plan.amount} ---`);

  const token = new ethers.Contract(plan.token, ERC20, signer);
  const staking = new ethers.Contract(plan.staking, STAKING_ABI, signer);

  const decimals = await token.decimals();
  const amount = ethers.parseUnits(plan.amount, decimals);

  console.log("Approving...");
  await (await token.approve(plan.staking, amount)).wait();

  console.log("Depositing rewards...");
  await (await staking.depositRewards(amount)).wait();

  console.log(`✅ ${plan.symbol} funded`);
}

async function main() {
  const [admin] = await ethers.getSigners();
  console.log("Admin wallet:", admin.address);

  for (const plan of FUNDING_PLAN) {
    await fundPool(plan, admin);
  }

  console.log("\n🎉 Funding script finished");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});