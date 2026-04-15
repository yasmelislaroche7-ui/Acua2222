const { ethers } = require("hardhat");
const deployment = require("../deployed-staking-v2-addresses.json");

const FUNDING_PLAN = [
  { symbol: "WBTC", amount: "0.000005" },
  { symbol: "oXAUT", amount: "0.00002" },
  { symbol: "ORO", amount: "2" },
  { symbol: "EURC", amount: "0" },
  { symbol: "WDD", amount: "10" },
  { symbol: "ORB", amount: "1000" },
  { symbol: "WETH", amount: "0.00003" },
  { symbol: "PUF", amount: "2" },
  { symbol: "uDOGE", amount: "0" },
  { symbol: "uSOL", amount: "0.001" },
  { symbol: "VIBE", amount: "100000" },
  { symbol: "UTH₂", amount: "0.1" },
  { symbol: "DIAMANTE", amount: "0.1" },
  { symbol: "wBRL", amount: "0.5" },
  { symbol: "BILLBOARD", amount: "0" },
  { symbol: "Cash", amount: "1" },
  { symbol: "AION", amount: "0" },
  { symbol: "SAMA", amount: "0" },
  { symbol: "APE", amount: "2" },
  { symbol: "GFY", amount: "10" },
  { symbol: "VEN", amount: "100" },
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