// Segunda ronda de reparacion: desactiva pools que no tienen pool real en Uniswap
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const c = await ethers.getContractAt("AcuaH2OV3LP", "0xC1feC35ea295EE867e41D1b80a23809C39ac6868");
  const TX = { gasLimit: 200000 };

  // De audit-pools.json: ids 7 (WETH/SUSHI) y 8 (WLD/VIBE) NO existen en Uniswap
  for (const id of [7, 8]) {
    const p = await c.getPool(id);
    if (!p.active && p.comingSoon) { console.log(`[${id}] ya desactivada`); continue; }
    const tx = await c.setPoolStatus(id, false, true, TX);
    await tx.wait();
    console.log(`[${id}] desactivada (no existe en Uniswap)  tx=${tx.hash}`);
  }

  // Regenerar JSON
  const audit = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "audit-pools.json"), "utf8"));
  const noLiqIds = new Set(audit.issues.filter(x => x.status === "NO_LIQ").map(x => x.id));
  const all = await c.getAllPools();
  const SYMS = {
    "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d": "H2O", "0x2cFc85d8E48F8EAB294be644d9E25C3030863003": "WLD",
    "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1": "USDC","0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38": "SUSHI",
    "0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484":"BTCH2O","0x4200000000000000000000000000000000000006":"WETH",
    "0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3":"WBTC","0x696aD02f0c7d68915ea39cA6e60934f7a8900FB1":"VIBE",
    "0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63":"ORO","0xF3F92A60e6004f3982F0FdE0d43602fC0a30a0dB":"ORB",
    "0x1aE3498f1B417fe31BE544B04B711F27Ba437bd3":"PUF","0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d":"wARS",
    "0x30974f73A4ac9E606Ed80da928e454977ac486D2":"oXAUT","0xDBA88118551d5Adf16a7AB943403Aea7ea06762b":"AIR",
    "0x9eA8653640E22A5b69887985BB75d496dc97022a":"UTH2",
  };
  const sym = a => SYMS[ethers.utils.getAddress(a)] || a.slice(0,6);
  const pools = [];
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    pools.push({
      id: i, label: `${sym(p.token0)}/${sym(p.token1)}`, pool: p.poolAddr, fee: Number(p.fee),
      tickLower: Number(p.tickLower), tickUpper: Number(p.tickUpper),
      active: p.active, comingSoon: p.comingSoon,
      needsInit: noLiqIds.has(i),
      ...(Number(p.fee) === 100 || (Number(p.fee) === 500 && p.tickUpper - p.tickLower < 1000) ? { stable: true } : {}),
    });
  }
  const outFile = path.join(__dirname, "..", "deployed-h2o-v3.json");
  let existing = {}; try { existing = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch {}
  const out = { ...existing, repairedAt: new Date().toISOString(), pools };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  const refreshed = await c.getAllPools();
  const activeCount = refreshed.filter(p => p.active).length;
  console.log(`\nEscrito JSON con ${pools.length} pools (${activeCount} activas tras esta reparacion)`);
}
main().catch(e=>{console.error(e);process.exit(1)});
