// scripts/deploy.js
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const H2O  = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";
  const UTH2 = "0x9eA8653640E22A5b69887985BB75d496dc97022a";

  console.log("Deploying with:", deployer.address);

  const Factory = await hre.ethers.getContractFactory("H2OUniversalStakingFinal");

  const contract = await Factory.deploy(H2O, UTH2);

  // 👇 ethers v5 usa deployed()
  await contract.deployed();

  console.log("H2OUniversalStakingFinal deployed to:", contract.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});