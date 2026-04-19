const { ethers } = require("hardhat");
const deployment = require("../deployed-staking-v2-addresses.json");

const FUNDING_PLAN = [
  { symbol: "WBTC", amount: "0.000015" },
  { symbol: "oXAUT", amount: "0.00014" },
  { symbol: "ORO", amount: "410" },
  { symbol: "EURC", amount: "0" },
  { symbol: "WDD", amount: "30" },
  { symbol: "ORB", amount: "3500" },
  { symbol: "WETH", amount: "0.00012" },
  { symbol: "PUF", amount: "200" },
  { symbol: "uDOGE", amount: "0.5" },
  { symbol: "uSOL", amount: "0.003" },
  { symbol: "VIBE", amount: "300000" },
  { symbol: "UTH₂", amount: "0.4" },
  { symbol: "DIAMANTE", amount: "0.3" },
  { symbol: "wBRL", amount: "0" },
  { symbol: "BILLBOARD", amount: "440" },
  { symbol: "Cash", amount: "1" },
  { symbol: "AION", amount: "0" },
  { symbol: "SAMA", amount: "30" },
  { symbol: "APE", amount: "470" },
  { symbol: "GFY", amount: "14" },
  { symbol: "VEN", amount: "400" },
];

const ERC20 = [
  "function approve(address spender,uint256 amount) returns(bool)",
  "function decimals() view returns(uint8)"
];

const STAKING = [
  "function depositRewards(uint256 amount)"
];

function tokenBySymbol(symbol) {
  return deployment.tokens.find(token => token.symbol === symbol);
}

async function main() {
  const [admin] = await ethers.getSigners();
  console.log("Admin wallet:", admin.address);

  for (const item of FUNDING_PLAN) {
    if (item.amount === "0") {
      console.log(`Skipping ${item.symbol}`);
      continue;
    }

    const token = tokenBySymbol(item.symbol);
    if (!token) throw new Error(`Token not found: ${item.symbol}`);
    const stakingAddress = deployment.contracts[token.key];
    if (!stakingAddress) throw new Error(`Staking not found: ${item.symbol}`);

    const erc20 = new ethers.Contract(token.token, ERC20, admin);
    const staking = new ethers.Contract(stakingAddress, STAKING, admin);
    const decimals = await erc20.decimals();
    const amount = ethers.utils.parseUnits(item.amount, decimals);

    console.log(`Funding ${item.symbol}: ${item.amount}`);
    await (await erc20.approve(stakingAddress, amount)).wait();
    await (await staking.depositRewards(amount)).wait();
    console.log(`${item.symbol} funded`);
  }

  console.log("Funding script finished");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});