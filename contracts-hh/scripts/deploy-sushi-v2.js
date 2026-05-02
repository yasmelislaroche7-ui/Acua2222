const { ethers, run } = require("hardhat");
const fs = require("fs");
const path = require("path");

const OWNER2 = "0x5474c309e985c6b4fc623acf01ade604da781e52";
const OUT_FILE = path.join(__dirname, "../deployed-sushi-v2.json");

async function verify(address, args) {
  try {
    await run("verify:verify", { address, constructorArguments: args });
    console.log(`✓ verified ${address}`);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (msg.toLowerCase().includes("already verified")) {
      console.log(`✓ already verified ${address}`);
    } else {
      console.log(`⚠ verification failed: ${msg}`);
    }
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer :", deployer.address);
  console.log("Owner2   :", OWNER2);
  console.log("Balance  :", ethers.utils.formatEther(await deployer.getBalance()), "ETH");

  const Factory = await ethers.getContractFactory("SushiStakeV2");
  const args = [OWNER2];

  console.log("\nDeploying SushiStakeV2...");
  const contract = await Factory.deploy(...args);
  await contract.deployed();
  console.log("SushiStakeV2:", contract.address);

  const output = {
    deployedAt:  new Date().toISOString(),
    network:     "worldchain",
    chainId:     480,
    contract:    contract.address,
    owner:       deployer.address,
    owner2:      OWNER2,
    token:       "0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38",
    tokenSymbol: "SUSHI",
    decimals:    18,
    aprBps:      30000,
    feeBps:      500,
    withdrawDelay: 172800,
    claimDelay:    86400,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log("\nOutput saved to deployed-sushi-v2.json");
  console.log(JSON.stringify(output, null, 2));

  console.log("\nVerifying on WorldScan...");
  await verify(contract.address, args);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
