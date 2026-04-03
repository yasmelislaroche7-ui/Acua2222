const { run } = require("hardhat");
const addresses = require("../deployed-addresses.json");
const deployer = "0x54F0D557E8042eC70974d2e85331BE5D66fFe5F4";

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function verifyOne(address, args, name) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments: args,
    });
    console.log(`✓ Verified ${name} (${address})`);
  } catch (e) {
    if (e.message.toLowerCase().includes("already verified")) {
      console.log(`✓ Already verified ${name} (${address})`);
    } else {
      console.log(`✗ Failed ${name}: ${e.message.slice(0, 120)}`);
    }
  }
}

async function main() {
  const verifications = [
    { address: addresses.stakingWLD,    args: [TOKENS.WLD,    deployer], name: "Staking WLD"   },
    { address: addresses.stakingFIRE,   args: [TOKENS.FIRE,   deployer], name: "Staking FIRE"  },
    { address: addresses.stakingSUSHI,  args: [TOKENS.SUSHI,  deployer], name: "Staking SUSHI" },
    { address: addresses.stakingUSDC,   args: [TOKENS.USDC,   deployer], name: "Staking USDC"  },
    { address: addresses.stakingwCOP,   args: [TOKENS.wCOP,   deployer], name: "Staking wCOP"  },
    { address: addresses.stakingwARS,   args: [TOKENS.wARS,   deployer], name: "Staking wARS"  },
    { address: addresses.stakingBTCH2O, args: [TOKENS.BTCH2O, deployer], name: "Staking BTCH2O"},
    { address: addresses.stakingAIR,    args: [TOKENS.AIR,    deployer], name: "Staking AIR"   },
    { address: addresses.miningUTH2,    args: [TOKENS.UTH2, TOKENS.H2O, deployer, deployer], name: "Mining UTH2" },
    {
      address: addresses.miningWLD,
      args: [TOKENS.WLD, TOKENS.H2O, TOKENS.FIRE, TOKENS.BTCH2O, TOKENS.wARS, TOKENS.wCOP, TOKENS.UTH2, deployer, deployer],
      name: "Mining WLD"
    },
  ];

  // Sequential with 5-second delay to avoid rate limits
  for (const { address, args, name } of verifications) {
    await verifyOne(address, args, name);
    await sleep(5000);
  }
}

main().catch(console.error);
