/**
 * withdraw-h2o-v3.js
 * Retira TODO el balance del contrato AcuaH2OV3LP para una lista de tokens
 * (incluye H2O reserve + comisiones acumuladas en cualquier token).
 *
 * Uso:
 *   cd contracts-hh
 *   PRIVATE_KEY=0x... npx hardhat run scripts/withdraw-h2o-v3.js --network worldchain
 *
 *   Opcional: TO=0xRecipient para enviar a otra wallet (default: wallet del signer)
 */

const { ethers } = require("hardhat");
const path = require("path");
const fs = require("fs");

// Lista de tokens a evaluar para withdraw (todos los del swap + H2O)
const TOKENS = {
  H2O:    "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d",
  WLD:    "0x2cFc85d8E48F8EAB294be644d9E25C3030863003",
  USDC:   "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
  SUSHI:  "0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38",
  BTCH2O: "0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484",
  WETH:   "0x4200000000000000000000000000000000000006",
  WBTC:   "0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3",
  VIBE:   "0x696aD02f0c7d68915ea39cA6e60934f7a8900FB1",
  ORO:    "0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63",
  ORB:    "0xF3F92A60e6004f3982F0FdE0d43602fC0a30a0dB",
  PUF:    "0x1aE3498f1B417fe31BE544B04B711F27Ba437bd3",
  wARS:   "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d",
  oXAUT:  "0x30974f73A4ac9E606Ed80da928e454977ac486D2",
  AIR:    "0xDBA88118551d5Adf16a7AB943403Aea7ea06762b",
  UTH2:   "0x9eA8653640E22A5b69887985BB75d496dc97022a",
};

const ABI = [
  "function withdrawAll(address token, address to)",
  "function contractTokenBalance(address token) view returns (uint256)",
  "function ownerCollectedFees(address) view returns (uint256)",
  "function owner() view returns (address)",
];
const ERC20_ABI = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];

async function main() {
  const deployedFile = path.join(__dirname, "..", "deployed-h2o-v3.json");
  if (!fs.existsSync(deployedFile)) throw new Error("Falta deployed-h2o-v3.json — corre deploy primero");
  const deployed = JSON.parse(fs.readFileSync(deployedFile, "utf8"));
  const TARGET = deployed.contract;

  const [signer] = await ethers.getSigners();
  const TO = process.env.TO || signer.address;
  const c = new ethers.Contract(TARGET, ABI, signer);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Withdraw All AcuaH2OV3LP");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Wallet :", signer.address);
  console.log("  Target :", TARGET);
  console.log("  Recv   :", TO);

  const ownerOnChain = await c.owner();
  if (ownerOnChain.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`No eres owner. Owner on-chain: ${ownerOnChain}`);
  }

  for (const [sym, addr] of Object.entries(TOKENS)) {
    try {
      const bal = await c.contractTokenBalance(addr);
      const accFee = await c.ownerCollectedFees(addr);
      if (bal.eq(0)) {
        console.log(`  · ${sym.padEnd(7)} balance=0   (commissions registradas: ${accFee.toString()})`);
        continue;
      }
      const t = new ethers.Contract(addr, ERC20_ABI, signer);
      let dec = 18; let label = sym;
      try { dec = await t.decimals(); } catch {}
      try { label = await t.symbol(); } catch {}
      const tx = await c.withdrawAll(addr, TO);
      await tx.wait();
      console.log(`  ✓ ${sym.padEnd(7)} retirado ${ethers.utils.formatUnits(bal, dec)} ${label} (tx ${tx.hash.slice(0,10)}…)`);
    } catch (e) {
      console.log(`  ✖ ${sym.padEnd(7)} error: ${e.message || e}`);
    }
  }

  console.log("\n  ✓ Listo");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
