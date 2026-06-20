const { ethers } = require("hardhat");
const deployment = require("../deployed-staking-v2-addresses.json");

// ── Tokens del JSON de staking-v2 (se omiten todos con amount "0") ──────────
const FUNDING_PLAN = [
  { symbol: "WBTC",     amount: "0" },
  { symbol: "oXAUT",    amount: "0" },
  { symbol: "ORO",      amount: "0" },
  { symbol: "EURC",     amount: "0" },
  { symbol: "WDD",      amount: "0" },
  { symbol: "ORB",      amount: "0" },
  { symbol: "WETH",     amount: "0" },
  { symbol: "PUF",      amount: "0" },
  { symbol: "uDOGE",    amount: "0" },
  { symbol: "uSOL",     amount: "0" },
  { symbol: "VIBE",     amount: "0" },
  { symbol: "UTH₂",     amount: "0" },
  { symbol: "DIAMANTE", amount: "0" },
  { symbol: "wBRL",     amount: "0" },
  { symbol: "BILLBOARD",amount: "0" },
  { symbol: "Cash",     amount: "0" },
  { symbol: "AION",     amount: "0" },
  { symbol: "SAMA",     amount: "0" },
  { symbol: "APE",      amount: "0" },
  { symbol: "GFY",      amount: "0" },
  { symbol: "VEN",      amount: "0" },
];

// ── Tokens con dirección directa (new-contracts.ts / STAKING_CONTRACTS) ─────
// Edita solo el amount del token que quieras fondear; deja 0 los demás.
const DIRECT_PLAN = [
  { symbol: "wARS",  token: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", staking: "0xf3b9162726D2034af1677bAbD1D667c2c4A0A46A", amount: "46000" },
  { symbol: "WLD",   token: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003", staking: "0x224C31214989F8F22E036c4a8Ae294B9Ce339f74", amount: "0" },
  { symbol: "FIRE",  token: "0x22c40632c13a7f3cae9c343480607d886832c686", staking: "0xC799a6D13735bAc407183e0d8Acb6F07dfF072DD", amount: "0" },
  { symbol: "SUSHI", token: "0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38", staking: "0x31c25e2E5331F02F15fD43340079303EfE02625c", amount: "0" },
  { symbol: "wCOP",  token: "0x8a1d45e102e886510e891d2ec656a708991e2d76", staking: "0x68E3EcF55DFE392D7A9D8D8aB129A20D52A2bB70", amount: "0" },
  { symbol: "BTCH2O",token: "0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484", staking: "0x965934aE4b292816a694e7b9cDd41E873AeC32A0", amount: "0" },
  { symbol: "AIR",   token: "0xDBA88118551d5Adf16a7AB943403Aea7ea06762b", staking: "0xfc548193a52cCF151cD2BE34D59a14Be119c5cE1", amount: "0" },
];

const ERC20 = [
  "function approve(address spender,uint256 amount) returns(bool)",
  "function decimals() view returns(uint8)"
];

const STAKING = [
  "function depositRewards(uint256 amount)"
];

function tokenBySymbol(symbol) {
  return deployment.tokens.find(t => t.symbol === symbol);
}

async function main() {
  const [admin] = await ethers.getSigners();
  console.log("Admin wallet:", admin.address);

  // ── Sección 1: tokens del JSON de staking-v2 ────────────────────────────
  for (const item of FUNDING_PLAN) {
    if (item.amount === "0") {
      console.log(`Skipping ${item.symbol}`);
      continue;
    }

    const token = tokenBySymbol(item.symbol);
    if (!token) throw new Error(`Token not found: ${item.symbol}`);
    const stakingAddress = deployment.contracts[token.key];
    if (!stakingAddress) throw new Error(`Staking not found: ${item.symbol}`);

    const erc20   = new ethers.Contract(token.token, ERC20, admin);
    const staking = new ethers.Contract(stakingAddress, STAKING, admin);
    const decimals = await erc20.decimals();
    const amount   = ethers.utils.parseUnits(item.amount, decimals);

    console.log(`Funding ${item.symbol}: ${item.amount}`);
    await (await erc20.approve(stakingAddress, amount)).wait();
    await (await staking.depositRewards(amount)).wait();
    console.log(`✅ ${item.symbol} funded`);
  }

  // ── Sección 2: tokens directos (new-contracts.ts) ───────────────────────
  for (const item of DIRECT_PLAN) {
    if (item.amount === "0") {
      console.log(`Skipping ${item.symbol}`);
      continue;
    }

    const erc20   = new ethers.Contract(item.token,   ERC20,   admin);
    const staking = new ethers.Contract(item.staking, STAKING, admin);
    const decimals = await erc20.decimals();
    const amount   = ethers.utils.parseUnits(item.amount, decimals);

    console.log(`Funding ${item.symbol}: ${item.amount} → staking ${item.staking}`);
    await (await erc20.approve(item.staking, amount)).wait();
    console.log(`  approve OK`);
    await (await staking.depositRewards(amount)).wait();
    console.log(`✅ ${item.symbol} funded`);
  }

  console.log("\n🚀 Funding script terminado");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
