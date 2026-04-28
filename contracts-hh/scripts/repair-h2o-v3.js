// SPDX-License-Identifier: MIT
// Repara estado on-chain del AcuaH2OV3LP:
//  - Desactiva pools duplicadas (12, 14, 16, 18, 20) y la UTH2/USDC fee=500 invalida (19)
//  - Agrega la UTH2/USDC fee=100 real con direccion 0x5cF66b...
//  - Actualiza price route de UTH2 al pool correcto
//  - Reescribe deployed-h2o-v3.json

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const CONTRACT = "0xC1feC35ea295EE867e41D1b80a23809C39ac6868";
const TX_OPTS = { gasLimit: 200000 };
const TX_OPTS_ADDPOOL = { gasLimit: 350000 };
const TX_OPTS_BATCH = { gasLimit: 200000 };

// Pools a desactivar (duplicadas + UTH2/USDC fee=500 invalida)
const TO_DEACTIVATE = [12, 14, 16, 18, 19, 20];

// Pool real UTH2/USDC fee=100 en World Chain
const UTH2_USDC_REAL = {
  USDC: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
  UTH2: "0x9eA8653640E22A5b69887985BB75d496dc97022a",
  fee: 100,
  pool: "0x5cF66b817a35B84bbaB03f6774B0CB78C140A981",
  tickLower: 276223,
  tickUpper: 276423,
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const c = await ethers.getContractAt("AcuaH2OV3LP", CONTRACT);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", ethers.utils.formatEther(await deployer.getBalance()), "ETH");

  // 1. Desactivar duplicadas
  console.log("\n[1/4] Desactivando pools duplicadas/invalidas...");
  for (const id of TO_DEACTIVATE) {
    try {
      const p = await c.getPool(id);
      if (!p.active && p.comingSoon) { console.log(`  [${id}] ya desactivada, salto`); continue; }
      const tx = await c.setPoolStatus(id, false, true, TX_OPTS);
      await tx.wait();
      console.log(`  [${id}] desactivada (tx ${tx.hash})`);
    } catch (e) {
      console.log(`  [${id}] err: ${e.message.slice(0,80)}`);
    }
  }

  // 2. Agregar UTH2/USDC fee=100 real
  console.log("\n[2/4] Agregando UTH2/USDC fee=100 real...");
  const beforeCount = Number(await c.poolsCount());
  // Verificar que no este ya: comparar pool addr en cualquier slot
  let alreadyExists = false;
  for (let i = 0; i < beforeCount; i++) {
    const p = await c.getPool(i);
    if (p.poolAddr.toLowerCase() === UTH2_USDC_REAL.pool.toLowerCase() && p.active) {
      console.log(`  ya existe activa en pool id ${i}, salto add`);
      alreadyExists = true; break;
    }
  }
  if (!alreadyExists) {
    const a = UTH2_USDC_REAL.USDC < UTH2_USDC_REAL.UTH2 ? UTH2_USDC_REAL.USDC : UTH2_USDC_REAL.UTH2;
    const b = UTH2_USDC_REAL.USDC < UTH2_USDC_REAL.UTH2 ? UTH2_USDC_REAL.UTH2 : UTH2_USDC_REAL.USDC;
    const tx = await c.addPool(a, b, UTH2_USDC_REAL.fee, UTH2_USDC_REAL.tickLower, UTH2_USDC_REAL.tickUpper, UTH2_USDC_REAL.pool, false, TX_OPTS_ADDPOOL);
    await tx.wait();
    console.log(`  agregada como pool id ${beforeCount} (tx ${tx.hash})`);
  }

  // 3. Actualizar price route de UTH2 -> USDC -> WLD -> H2O usando pool fee=100 real
  console.log("\n[3/4] Actualizando price route de UTH2...");
  const route = await c.priceRoutes(UTH2_USDC_REAL.UTH2);
  if (route.pool.toLowerCase() === UTH2_USDC_REAL.pool.toLowerCase()) {
    console.log("  ya configurada al pool real, salto");
  } else {
    const tx = await c.setPriceRoutesBatch([UTH2_USDC_REAL.UTH2], [UTH2_USDC_REAL.pool], [true], TX_OPTS_BATCH);
    await tx.wait();
    console.log(`  ✓ UTH2 route -> ${UTH2_USDC_REAL.pool} (tx ${tx.hash})`);
  }

  // 4. Reescribir deployed-h2o-v3.json con el estado on-chain final
  console.log("\n[4/4] Regenerando deployed-h2o-v3.json...");
  const finalCount = Number(await c.poolsCount());
  const all = await c.getAllPools();
  const TOKEN_SYM = {
    "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d": "H2O",
    "0x2cFc85d8E48F8EAB294be644d9E25C3030863003": "WLD",
    "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1": "USDC",
    "0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38": "SUSHI",
    "0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484": "BTCH2O",
    "0x4200000000000000000000000000000000000006": "WETH",
    "0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3": "WBTC",
    "0x696aD02f0c7d68915ea39cA6e60934f7a8900FB1": "VIBE",
    "0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63": "ORO",
    "0xF3F92A60e6004f3982F0FdE0d43602fC0a30a0dB": "ORB",
    "0x1aE3498f1B417fe31BE544B04B711F27Ba437bd3": "PUF",
    "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d": "wARS",
    "0x30974f73A4ac9E606Ed80da928e454977ac486D2": "oXAUT",
    "0xDBA88118551d5Adf16a7AB943403Aea7ea06762b": "AIR",
    "0x9eA8653640E22A5b69887985BB75d496dc97022a": "UTH2",
  };
  const sym = (a) => TOKEN_SYM[ethers.utils.getAddress(a)] || a.slice(0,6);
  const pools = [];
  for (let i = 0; i < finalCount; i++) {
    const p = all[i];
    pools.push({
      id: i,
      label: `${sym(p.token0)}/${sym(p.token1)}`,
      pool: p.poolAddr,
      fee: Number(p.fee),
      tickLower: Number(p.tickLower),
      tickUpper: Number(p.tickUpper),
      active: p.active,
      comingSoon: p.comingSoon,
      ...(Number(p.fee) === 100 || (Number(p.fee) === 500 && p.tickUpper - p.tickLower < 1000) ? { stable: true } : {}),
    });
  }
  const outFile = path.join(__dirname, "..", "deployed-h2o-v3.json");
  let existing = {}; try { existing = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch {}
  const out = {
    ...existing,
    repairedAt: new Date().toISOString(),
    contract: CONTRACT,
    network: "worldchain",
    chainId: 480,
    pools,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`  ✓ Escrito con ${pools.length} pools (${pools.filter(p=>p.active).length} activas)`);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✓ Reparacion completa");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch(e => { console.error(e); process.exit(1); });
