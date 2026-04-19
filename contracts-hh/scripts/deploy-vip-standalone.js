// scripts/deploy-vip-standalone.js
// Despliega H2OVIPStandalone en World Chain (independiente del stake)
//
// Uso:
//   cd contracts-hh
//   npx hardhat run scripts/deploy-vip-standalone.js --network worldchain
//
// Requiere:
//   PRIVATE_KEY en .env  (wallet que será el owner del contrato)

const hre = require("hardhat");

const UTH2  = "0x9eA8653640E22A5b69887985BB75d496dc97022a";
const H2O   = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deploy H2OVIPStandalone — World Chain");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployer :", deployer.address);

  const balance = await deployer.getBalance();
  console.log("  Balance  :", hre.ethers.utils.formatEther(balance), "ETH");

  if (balance.isZero()) {
    console.error("\n  ❌ Sin ETH para gas. Fondea la wallet del deployer.");
    process.exitCode = 1;
    return;
  }

  console.log("\n  Argumentos del constructor:");
  console.log("    UTH2 :", UTH2);
  console.log("    H2O  :", H2O);

  const Factory  = await hre.ethers.getContractFactory("H2OVIPStandalone");
  const contract = await Factory.deploy(UTH2, H2O);
  await contract.deployed();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅ H2OVIPStandalone desplegado en:", contract.address);
  console.log("  Owner    :", deployer.address);
  console.log("  VIP price: 1 UTH2/mes (modificable con setVipPrice)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n  PRÓXIMOS PASOS:");
  console.log("  1. Actualiza H2O_VIP_ADDRESS en lib/h2oStaking.ts con:", contract.address);
  console.log("  2. Fondea el contrato con H2O para rewards:");
  console.log("       npx hardhat run scripts/fund-vip.js --network worldchain");
  console.log("  3. (Opcional) Verifica en el explorador:");
  console.log("       npx hardhat verify --network worldchain", contract.address, UTH2, H2O);
  console.log("");
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message || err);
  process.exitCode = 1;
});
