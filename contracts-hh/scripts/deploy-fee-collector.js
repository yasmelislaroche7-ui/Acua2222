// scripts/deploy-fee-collector.js
// Despliega H2OFeeCollector en World Chain
//
// Uso:
//   cd contracts-hh
//   PRIVATE_KEY=0x... npx hardhat run scripts/deploy-fee-collector.js --network worldchain

const hre = require("hardhat");

const H2O = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deploy H2OFeeCollector — World Chain");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployer :", deployer.address);

  const balance = await deployer.getBalance();
  console.log("  Balance  :", hre.ethers.utils.formatEther(balance), "ETH");

  if (balance.isZero()) {
    console.error("\n  Sin ETH para gas. Fondea la wallet del deployer.");
    process.exitCode = 1;
    return;
  }

  console.log("\n  Args constructor:");
  console.log("    H2O   :", H2O);
  console.log("    Owner :", deployer.address);
  console.log("    Fee   : 1 H2O (default, ajustable con setFee)");

  const Factory  = await hre.ethers.getContractFactory("H2OFeeCollector");
  const contract = await Factory.deploy(H2O, deployer.address);
  await contract.deployed();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  H2OFeeCollector desplegado en:", contract.address);
  console.log("  Owner :", deployer.address);
  console.log("  Fee   : 1 H2O por tx");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n  PRÓXIMO PASO:");
  console.log("  Actualiza H2O_FEE_COLLECTOR_ADDRESS en lib/feeCollector.ts con:");
  console.log("    " + contract.address);
  console.log("");
}

main().catch((err) => {
  console.error("\nError:", err.message || err);
  process.exitCode = 1;
});
