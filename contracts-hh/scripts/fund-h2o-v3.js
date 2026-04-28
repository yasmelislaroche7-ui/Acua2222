/**
 * fund-h2o-v3.js
 * Fondea AcuaH2OV3LP con 1000 H2O (transfer directo) para que el contrato
 * pueda pagar las recompensas en H2O cuando los usuarios hagan claim.
 *
 * Uso:
 *   cd contracts-hh
 *   PRIVATE_KEY=0x... npx hardhat run scripts/fund-h2o-v3.js --network worldchain
 */

const { ethers } = require("hardhat");
const path = require("path");
const fs = require("fs");

const FUND_AMOUNT = "100000"; // H2O
const H2O_TOKEN = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function main() {
  const deployedFile = path.join(__dirname, "..", "deployed-h2o-v3.json");
  if (!fs.existsSync(deployedFile)) throw new Error("Falta deployed-h2o-v3.json — corre deploy primero");
  const deployed = JSON.parse(fs.readFileSync(deployedFile, "utf8"));
  const TARGET = deployed.contract;

  const [signer] = await ethers.getSigners();
  const h2o = new ethers.Contract(H2O_TOKEN, ERC20_ABI, signer);
  const decimals = await h2o.decimals();
  const amount = ethers.utils.parseUnits(FUND_AMOUNT, decimals);
  const balance = await h2o.balanceOf(signer.address);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Fund AcuaH2OV3LP con", FUND_AMOUNT, "H2O");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Wallet :", signer.address);
  console.log("  Target :", TARGET);
  console.log("  H2O bal:", ethers.utils.formatUnits(balance, decimals));
  if (balance.lt(amount)) throw new Error("Balance H2O insuficiente");

  const tx = await h2o.transfer(TARGET, amount);
  console.log("  tx     :", tx.hash);
  await tx.wait();

  const newBal = await h2o.balanceOf(TARGET);
  console.log("  ✓ Contrato ahora tiene:", ethers.utils.formatUnits(newBal, decimals), "H2O");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
