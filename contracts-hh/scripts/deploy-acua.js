// scripts/deploy.js
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  // Direcciones hardcodeadas según tu requerimiento
  const H2O = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";
  const UTH2 = "0x9eA8653640E22A5b69887985BB75d496dc97022a";

  console.log("Deploying with:", deployer.address);

  const Factory = await hre.ethers.getContractFactory("UniversalStakingWithVip");
  const contract = await Factory.deploy(
    H2O,
    UTH2,
    deployer.address // Primer owner
  );

  await contract.waitForDeployment?.();

  console.log("UniversalStakingWithVip deployed to:", contract.target || contract.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});