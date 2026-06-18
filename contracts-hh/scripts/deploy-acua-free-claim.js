// deploy-acua-free-claim.js
// Deploys AcuaFreeClaim — multi-token free claim contract
// Run: cd contracts-hh && npx hardhat run scripts/deploy-acua-free-claim.js --network worldchain

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const OWNER  = deployer.address;
  const OWNER2 = "0xc2ef127734f296952de75c1b58a6cec605cc2e59";

  const Factory = await ethers.getContractFactory("AcuaFreeClaim");
  const contract = await Factory.deploy(OWNER, OWNER2);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("AcuaFreeClaim deployed to:", address);

  const info = {
    deployedAt:  new Date().toISOString(),
    network:     "worldchain",
    chainId:     480,
    deployer:    deployer.address,
    owner2:      OWNER2,
    contract:    address,
    description: "AcuaFreeClaim — multi-token free claim with admin panel, Permit2 funding",
  };

  const outPath = path.join(__dirname, "../deployed-acua-free-claim.json");
  fs.writeFileSync(outPath, JSON.stringify(info, null, 2));
  console.log("Saved to:", outPath);
}

main().catch(console.error);
