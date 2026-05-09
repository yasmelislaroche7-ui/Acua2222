// deploy-chat.js — Deploy AcuaGlobalChat to World Chain
const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const owner2     = "0x5474c309e985c6b4fc623acf01ade604da781e52";

  console.log("\n" + "━".repeat(50));
  console.log("  Deploy AcuaGlobalChat → World Chain");
  console.log("━".repeat(50));
  console.log(`  Deployer : ${deployer.address}`);
  console.log(`  owner2   : ${owner2}`);

  const Factory  = await hre.ethers.getContractFactory("AcuaGlobalChat");
  const contract = await Factory.deploy(owner2);
  await contract.deployed();

  console.log(`\n  ✅ AcuaGlobalChat deployed: ${contract.address}`);

  const out = {
    contract:   contract.address,
    owner2,
    deployer:   deployer.address,
    network:    "worldchain",
    chainId:    480,
    deployedAt: new Date().toISOString(),
  };
  const outPath = path.join(__dirname, "../deployed-chat.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`  Saved → ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
