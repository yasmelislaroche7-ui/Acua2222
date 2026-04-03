const { ethers, run } = require("hardhat");

// ── Token addresses on World Chain ──────────────────────────────────────────
const TOKENS = {
  wCOP:  "0x8a1d45e102e886510e891d2ec656a708991e2d76",
  WLD:   "0x2cFc85d8E48F8EAB294be644d9E25C3030863003",
  USDC:  "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
  AIR:   "0xDBA88118551d5Adf16a7AB943403Aea7ea06762b",
  wARS:  "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d",
  SUSHI: "0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38",
  BTCH2O:"0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484",
  FIRE:  "0x22c40632c13a7f3cae9c343480607d886832c686",
  UTH2:  "0x9eA8653640E22A5b69887985BB75d496dc97022a",
  H2O:   "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d",
};

async function verifyContract(address, constructorArgs) {
  console.log(`  ↳ Verifying ${address} on WorldScan...`);
  try {
    await run("verify:verify", {
      address,
      constructorArguments: constructorArgs,
    });
    console.log(`  ✓ Verified!`);
  } catch (e) {
    if (e.message.includes("Already Verified") || e.message.toLowerCase().includes("already verified")) {
      console.log(`  ✓ Already verified`);
    } else {
      console.error(`  ✗ Verification failed: ${e.message}`);
    }
  }
}

async function deployAndVerify(contractName, args, label) {
  console.log(`\nDeploying ${label}...`);
  const Factory = await ethers.getContractFactory(contractName);
  const contract = await Factory.deploy(...args);
  await contract.deployed();
  const address = contract.address;
  console.log(`  ✓ Deployed at: ${address}`);
  // Verify simultaneously (run in background style - fire-and-forget then wait)
  await verifyContract(address, args);
  return address;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");

  const addresses = {};

  // ── 1. Deploy Universal Staking for each token ──────────────────────────────
  const stakingTokens = [
    { key: "stakingWLD",   token: TOKENS.WLD,   label: "Staking WLD"   },
    { key: "stakingFIRE",  token: TOKENS.FIRE,  label: "Staking FIRE"  },
    { key: "stakingSUSHI", token: TOKENS.SUSHI, label: "Staking SUSHI" },
    { key: "stakingUSDC",  token: TOKENS.USDC,  label: "Staking USDC"  },
    { key: "stakingwCOP",  token: TOKENS.wCOP,  label: "Staking wCOP"  },
    { key: "stakingwARS",  token: TOKENS.wARS,  label: "Staking wARS"  },
    { key: "stakingBTCH2O",token: TOKENS.BTCH2O,label: "Staking BTCH2O"},
    { key: "stakingAIR",   token: TOKENS.AIR,   label: "Staking AIR"   },
  ];

  for (const { key, token, label } of stakingTokens) {
    addresses[key] = await deployAndVerify(
      "UniversalStaking",
      [token, deployer.address],
      label
    );
    // Small delay between deployments to avoid nonce issues
    await new Promise(r => setTimeout(r, 3000));
  }

  // ── 2. Deploy MiningUTH2 ────────────────────────────────────────────────────
  addresses.miningUTH2 = await deployAndVerify(
    "MiningUTH2",
    [TOKENS.UTH2, TOKENS.H2O, deployer.address, deployer.address],
    "Mining UTH2 → H2O"
  );
  await new Promise(r => setTimeout(r, 3000));

  // ── 3. Deploy MiningWLD ─────────────────────────────────────────────────────
  addresses.miningWLD = await deployAndVerify(
    "MiningWLD",
    [
      TOKENS.WLD,
      TOKENS.H2O,
      TOKENS.FIRE,
      TOKENS.BTCH2O,
      TOKENS.wARS,
      TOKENS.wCOP,
      TOKENS.UTH2,
      deployer.address,
      deployer.address,
    ],
    "Mining WLD → Multi-reward"
  );

  // ── Output ──────────────────────────────────────────────────────────────────
  console.log("\n\n══════════════════════════════════════");
  console.log("DEPLOYED CONTRACT ADDRESSES:");
  console.log("══════════════════════════════════════");
  for (const [key, addr] of Object.entries(addresses)) {
    console.log(`${key.padEnd(20)}: ${addr}`);
  }
  console.log("══════════════════════════════════════");

  // Write addresses to a JSON file for the frontend to use
  const fs = require("fs");
  fs.writeFileSync(
    "./deployed-addresses.json",
    JSON.stringify(addresses, null, 2)
  );
  console.log("\nAddresses saved to contracts-hh/deployed-addresses.json");
}

main().catch(console.error);
