const { ethers } = require("hardhat");
const { CONTRACT } = require("./config");

async function fundToken(symbol, tokenAddress, amountHuman) {
  const [signer] = await ethers.getSigners();

  const erc20Abi = [
    "function transfer(address to,uint256 amount) returns(bool)",
    "function decimals() view returns(uint8)"
  ];

  const token = new ethers.Contract(tokenAddress, erc20Abi, signer);

  const decimals = await token.decimals();
  const amount = ethers.utils.parseUnits(amountHuman, decimals);

  console.log(`\nFondeando ${symbol}...`);
  const tx = await token.transfer(CONTRACT, amount);
  console.log(`${symbol} TX:`, tx.hash);
  await tx.wait();
  console.log(`${symbol} fondeado ✅`);
}

async function main() {

  // ⚠️ EDITA AQUI LOS MONTOS QUE QUIERAS FONDEAR
  // puedes poner 1, 1000, 50000, etc

  const tokens = [
    { symbol: "H2O",   address: "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d", amount: "5000" },
    { symbol: "WCOP",  address: "0x8a1d45e102e886510e891d2ec656a708991e2d76", amount: "50" },
    { symbol: "WARS",  address: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", amount: "40" },
    { symbol: "FIRE",  address: "0x22c40632c13a7f3cae9c343480607d886832c686", amount: "10000" },
    { symbol: "BTCH2O",address: "0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484", amount: "100000" },
    { symbol: "WLD",   address: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003", amount: "3" },
    { symbol: "UTH2",  address: "0x9eA8653640E22A5b69887985BB75d496dc97022a", amount: "1000" },
  ];

  for (const t of tokens) {
    await fundToken(t.symbol, t.address, t.amount);
  }

  console.log("\n🚀 CONTRATO FONDEADO CON TODOS LOS TOKENS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});