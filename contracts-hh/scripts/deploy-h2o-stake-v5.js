/**
 * deploy-h2o-stake-v5.js
 * Deploy H2OStakeV5 — H2O ACUA Company staking con comisión de 5% en depósito y retiro
 *
 * Uso:
 *   cd contracts-hh
 *   npx hardhat run scripts/deploy-h2o-stake-v5.js --network worldchain
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const OWNER2       = "0xc2ef127734f296952de75c1b58a6cec605cc2e59";
const ACUA_TOKEN   = "0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd";
const OUT_FILE     = path.join(__dirname, "..", "deployed-h2o-stake-v5.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await deployer.getBalance();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deploy H2OStakeV5 — H2O ACUA Company Staking (con comisión)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployer :", deployer.address);
  console.log("  Owner2   :", OWNER2);
  console.log("  Token    :", ACUA_TOKEN);
  console.log("  Balance  :", ethers.utils.formatEther(bal), "WLD");

  console.log("\n  Compilando...");
  const Factory = await ethers.getContractFactory("H2OStakeV5");

  console.log("  Deploying H2OStakeV5...");
  const contract = await Factory.deploy(OWNER2);
  await contract.deployed();
  console.log("  ✓ H2OStakeV5:", contract.address);

  const apr        = await contract.aprBps();
  const depFee      = await contract.depositFeeBps();
  const wdFee        = await contract.withdrawFeeBps();
  console.log("  APR default:", apr.toString(), "bps =", (apr / 100).toFixed(2) + "%");
  console.log("  Deposit fee:", depFee.toString(), "bps =", (depFee / 100).toFixed(2) + "%");
  console.log("  Withdraw fee:", wdFee.toString(), "bps =", (wdFee / 100).toFixed(2) + "%");

  const output = {
    deployedAt:  new Date().toISOString(),
    network:     "worldchain",
    chainId:     480,
    deployer:    deployer.address,
    owner:       deployer.address,
    owner2:      OWNER2,
    contract:    contract.address,
    token:       ACUA_TOKEN,
    aprBps:      apr.toNumber(),
    depositFeeBps:  depFee.toNumber(),
    withdrawFeeBps: wdFee.toNumber(),
    maxAprBps:      100000,
    maxFeeBps:      2000,
    features:    "instant-withdraw, instant-claim, per-second-rewards, referrals, Permit2, 5%-deposit-fee, 5%-withdraw-fee, variable-apr-max-1000%",
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log("  ✓ Guardado en deployed-h2o-stake-v5.json");

  console.log("\n━━ SIGUIENTE PASO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Fondear el contrato con tokens ACUA antes de abrir stake.");
  console.log("  Contrato:", contract.address);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
