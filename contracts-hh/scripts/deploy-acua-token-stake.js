// deploy-acua-token-stake.js
// Deploys AcuaTokenStake for token 0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd
// Run: cd contracts-hh && npx hardhat run scripts/deploy-acua-token-stake.js --network worldchain

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const TOKEN   = "0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd"; // H2O Acua Company
  const OWNER2  = "0xc2ef127734f296952de75c1b58a6cec605cc2e59";

  const Factory = await ethers.getContractFactory("AcuaTokenStake");
  const contract = await Factory.deploy(TOKEN, OWNER2);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("AcuaTokenStake deployed to:", address);
  console.log("Token:  ", TOKEN);
  console.log("Owner:  ", deployer.address);
  console.log("Owner2: ", OWNER2);

  const info = {
    deployedAt:   new Date().toISOString(),
    network:      "worldchain",
    chainId:      480,
    deployer:     deployer.address,
    owner2:       OWNER2,
    contract:     address,
    token:        TOKEN,
    description:  "AcuaTokenStake — staking H2O Acua Company, same as H2O 2.0 (48h queue + referrals)",
    aprBps:       1200,
    referral:     "15% en claims con referido: 5% referrer + 5% bonus usuario + 5% owner2",
  };

  const outPath = path.join(__dirname, "../deployed-acua-token-stake.json");
  fs.writeFileSync(outPath, JSON.stringify(info, null, 2));
  console.log("Saved to:", outPath);
}

main().catch(console.error);
