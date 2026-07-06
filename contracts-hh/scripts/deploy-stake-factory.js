/**
 * deploy-stake-factory.js
 * Deploy AcuaStakeFactory — cualquier usuario crea su propio pool de staking
 * para cualquier token ERC20 en World Chain, pagando 2 USDC de cuota de creación.
 *
 * Uso:
 *   cd contracts-hh
 *   npx hardhat run scripts/deploy-stake-factory.js --network worldchain
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const ACUA_OWNER = "0xC2Ef127734F296952DE75c1B58A6Cec605Cc2E59";
const USDC       = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1";
const OUT_FILE   = path.join(__dirname, "..", "deployed-stake-factory.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await deployer.getBalance();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deploy AcuaStakeFactory — Stake-as-a-Service");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployer  :", deployer.address);
  console.log("  ACUA Owner:", ACUA_OWNER);
  console.log("  Fee token :", USDC, "(USDC World Chain)");
  console.log("  Balance   :", ethers.utils.formatEther(bal), "WLD");

  console.log("\n  Compilando...");
  const Factory = await ethers.getContractFactory("AcuaStakeFactory");

  console.log("  Deploying AcuaStakeFactory...");
  const contract = await Factory.deploy();
  await contract.deployed();
  console.log("  ✓ AcuaStakeFactory:", contract.address);

  const feeToken  = await contract.creationFeeToken();
  const feeAmount = await contract.creationFeeAmount();
  console.log("  Creation fee:", ethers.utils.formatUnits(feeAmount, 6), "USDC");
  console.log("  Fee token   :", feeToken);

  const output = {
    deployedAt:   new Date().toISOString(),
    network:      "worldchain",
    chainId:      480,
    deployer:     deployer.address,
    factoryOwner: deployer.address,
    acuaOwner:    ACUA_OWNER,
    contract:     contract.address,
    creationFeeToken:  feeToken,
    creationFeeAmount: feeAmount.toString(),
    maxAprBps:    100000,
    depositFeeBps:  500,
    withdrawFeeBps: 500,
    claimFeeBps:    500,
    creatorShareBps: 400,
    acuaShareBps:    100,
    features: "any-erc20-token, any-decimals, permit2, per-second-rewards, instant-withdraw, instant-claim, multi-owner-pools, variable-apr-max-1000%",
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log("  ✓ Guardado en deployed-stake-factory.json");

  console.log("\n━━ SIGUIENTE PASO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Cualquier usuario ya puede crear pools desde el panel.");
  console.log("  Contrato:", contract.address);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
