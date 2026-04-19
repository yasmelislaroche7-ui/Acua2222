// scripts/deploy-vip.js
// Deploys the standalone H2OVIPSubscription contract to World Chain
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const UTH2 = "0x9eA8653640E22A5b69887985BB75d496dc97022a";
  const H2O  = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";

  console.log("Deploying H2OVIPSubscription with:", deployer.address);
  console.log("Balance:", (await deployer.getBalance()).toString());

  const Factory = await hre.ethers.getContractFactory("H2OVIPSubscription");
  const contract = await Factory.deploy(UTH2, H2O);
  await contract.deployed();

  console.log("✅ H2OVIPSubscription deployed to:", contract.address);
  console.log("UTH2:", UTH2);
  console.log("H2O:", H2O);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
