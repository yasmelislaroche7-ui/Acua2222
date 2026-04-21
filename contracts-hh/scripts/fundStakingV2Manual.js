const { ethers } = require("hardhat");
const deployment = require("../deployed-staking-v2-addresses.json");

const FUNDING_PLAN = [
  { symbol: "WBTC", amount: "0.000006" },
  { symbol: "oXAUT", amount: "0.00006" },
  { symbol: "ORO", amount: "184" },
  { symbol: "EURC", amount: "0" },
  { symbol: "WDD", amount: "117" },
  { symbol: "ORB", amount: "2600" },
  { symbol: "WETH", amount: "0.000037" },
  { symbol: "PUF", amount: "76" },
  { symbol: "uDOGE", amount: "1.3" },
  { symbol: "uSOL", amount: "0.007" },
  { symbol: "VIBE", amount: "600000" },
  { symbol: "UTH₂", amount: "1" },
  { symbol: "DIAMANTE", amount: "0.6" },
  { symbol: "wBRL", amount: "0.007" },
  { symbol: "BILLBOARD", amount: "50" },
  { symbol: "Cash", amount: "45" },
  { symbol: "AION", amount: "1020" },
  { symbol: "SAMA", amount: "160" },
  { symbol: "APE", amount: "41" },
  { symbol: "GFY", amount: "18" },
  { symbol: "VEN", amount: "90" },
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