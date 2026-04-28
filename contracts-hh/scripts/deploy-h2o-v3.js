/**
 * deploy-h2o-v3.js
 * Despliega AcuaH2OV3LP en World Chain, agrega todos los pools listados por el owner,
 * configura las price routes y los pools auxiliares (USDC/WLD y WLD/H2O).
 *
 * Uso:
 *   cd contracts-hh
 *   PRIVATE_KEY=0x... npx hardhat run scripts/deploy-h2o-v3.js --network worldchain
 */

const { ethers, run } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ─── Constantes World Chain ───────────────────────────────────────────────────
const NPM_ADDRESS = "0xec12a9F9a09f50550686363766Cc153D03c27b5e"; // Uniswap V3 NonfungiblePositionManager World Chain
const V3_FACTORY  = "0x7a5028BDa40e7B173C278C5342087826455ea25a";
const V3_INIT_CODE_HASH = "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";

// ─── Tokens ───────────────────────────────────────────────────────────────────
const T = {
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

// ─── Fee tiers ────────────────────────────────────────────────────────────────
const FEE_LOW    = 500;   // 0.05% (estables)
const FEE_MEDIUM = 3000;  // 0.30% (estandar)

// Tick spacing por fee (Uniswap V3 estandar)
const TICK_SPACING = { 100: 1, 500: 10, 3000: 60, 10000: 200 };

function fullRangeTicks(fee) {
  const spacing = TICK_SPACING[fee];
  if (!spacing) throw new Error("unknown fee tier " + fee);
  // Min/Max tick valido para tick spacing dado: floor(-887272/spacing)*spacing y techo
  const MIN_TICK = -887272;
  const MAX_TICK =  887272;
  const lower = Math.ceil(MIN_TICK / spacing) * spacing;
  const upper = Math.floor(MAX_TICK / spacing) * spacing;
  return { tickLower: lower, tickUpper: upper };
}

// Para UTH2/USDC 1:1 estable: tick centrado donde 1 UTH2 = 1 USDC
// USDC=6dec, UTH2=18dec. USDC < UTH2 (0x79... < 0x9e...) => USDC=token0, UTH2=token1.
// price token1/token0 = (10^18 raw UTH2) / (10^6 raw USDC) = 10^12
// tick = log_1.0001(10^12) ≈ 276324 ; tickSpacing 10 => 276320
// Rango estrecho de +/- 0.5%  -> +/- ~50 ticks
const UTH2_USDC_TICK_CENTER = 276320;
const UTH2_USDC_TICK_LOWER  = UTH2_USDC_TICK_CENTER - 50;
const UTH2_USDC_TICK_UPPER  = UTH2_USDC_TICK_CENTER + 50;

// ─── Pares a registrar ────────────────────────────────────────────────────────
// "comingSoon" para todos los pares con H2O (vacio por ahora).
const PAIRS = [
  { a: T.WLD,  b: T.SUSHI,  fee: FEE_MEDIUM, comingSoon: false, label: "WLD/SUSHI"  },
  { a: T.WLD,  b: T.USDC,   fee: FEE_MEDIUM, comingSoon: false, label: "WLD/USDC"   },
  { a: T.WLD,  b: T.BTCH2O, fee: FEE_MEDIUM, comingSoon: false, label: "WLD/BTCH2O" },
  { a: T.USDC, b: T.SUSHI,  fee: FEE_MEDIUM, comingSoon: false, label: "USDC/SUSHI" },
  { a: T.WETH, b: T.WLD,    fee: FEE_MEDIUM, comingSoon: false, label: "WETH/WLD"   },
  { a: T.WETH, b: T.USDC,   fee: FEE_MEDIUM, comingSoon: false, label: "WETH/USDC"  },
  { a: T.WBTC, b: T.WLD,    fee: FEE_MEDIUM, comingSoon: false, label: "WBTC/WLD"   },
  { a: T.WETH, b: T.SUSHI,  fee: FEE_MEDIUM, comingSoon: false, label: "WETH/SUSHI" },
  { a: T.WLD,  b: T.VIBE,   fee: FEE_MEDIUM, comingSoon: false, label: "WLD/VIBE"   },
  { a: T.WLD,  b: T.ORO,    fee: FEE_MEDIUM, comingSoon: false, label: "WLD/ORO"    },
  { a: T.WLD,  b: T.ORB,    fee: FEE_MEDIUM, comingSoon: false, label: "WLD/ORB"    },
  { a: T.WLD,  b: T.PUF,    fee: FEE_MEDIUM, comingSoon: false, label: "WLD/PUF"    },
  { a: T.WLD,  b: T.wARS,   fee: FEE_MEDIUM, comingSoon: false, label: "WLD/wARS"   },
  { a: T.WLD,  b: T.oXAUT,  fee: FEE_MEDIUM, comingSoon: false, label: "WLD/oXAUT"  },
  { a: T.WLD,  b: T.AIR,    fee: FEE_MEDIUM, comingSoon: false, label: "WLD/AIR"    },
  { a: T.UTH2, b: T.USDC,   fee: FEE_LOW,    comingSoon: false, label: "UTH2/USDC", stable: true },
];

// ─── Pool address computation ─────────────────────────────────────────────────
function computePoolAddress(tokenA, tokenB, fee) {
  const [t0, t1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  const salt = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "uint24"],
      [t0, t1, fee]
    )
  );
  return ethers.utils.getCreate2Address(V3_FACTORY, salt, V3_INIT_CODE_HASH);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deploy AcuaH2OV3LP — World Chain");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployer :", deployer.address);
  console.log("  Balance  :", ethers.utils.formatEther(await deployer.getBalance()), "ETH");

  // 1. Deploy
  const Factory = await ethers.getContractFactory("AcuaH2OV3LP");
  console.log("\n[1/4] Desplegando contrato...");
  const c = await Factory.deploy(NPM_ADDRESS);
  await c.deployed();
  console.log("      AcuaH2OV3LP:", c.address);

  // 2. Configurar pool helpers (USDC/WLD y WLD/H2O para pricing oracle)
  const usdcWldPool = computePoolAddress(T.USDC, T.WLD, FEE_MEDIUM);
  const wldH2oPool  = computePoolAddress(T.WLD,  T.H2O, FEE_MEDIUM);
  console.log("\n[2/4] Configurando pools de pricing...");
  console.log("      USDC/WLD pool (3000):", usdcWldPool);
  console.log("      WLD/H2O  pool (3000):", wldH2oPool);
  await (await c.setUsdcWldPool(usdcWldPool)).wait();
  await (await c.setWldH2OPool(wldH2oPool)).wait();

  // 3. Agregar pares
  console.log("\n[3/4] Agregando pares...");
  const addedPools = [];
  for (let i = 0; i < PAIRS.length; i++) {
    const p = PAIRS[i];
    let tickLower, tickUpper;
    if (p.stable) {
      tickLower = UTH2_USDC_TICK_LOWER;
      tickUpper = UTH2_USDC_TICK_UPPER;
    } else {
      ({ tickLower, tickUpper } = fullRangeTicks(p.fee));
    }
    const poolAddr = computePoolAddress(p.a, p.b, p.fee);
    const tx = await c.addPool(p.a, p.b, p.fee, tickLower, tickUpper, poolAddr, p.comingSoon);
    await tx.wait();
    addedPools.push({ id: i, label: p.label, pool: poolAddr, fee: p.fee, tickLower, tickUpper, comingSoon: p.comingSoon, ...(p.stable ? { stable: true } : {}) });
    console.log(`      [${i}] ${p.label.padEnd(12)} fee=${p.fee} ticks=[${tickLower}, ${tickUpper}] pool=${poolAddr}`);
  }

  // 4. Configurar price routes (token -> WLD via pool)
  console.log("\n[4/4] Configurando price routes...");
  // Para cada token NO base (no WLD/USDC/H2O), apuntar a un pool WLD/token con FEE_MEDIUM
  const tokensWithRoute = [
    { token: T.SUSHI,  pool: computePoolAddress(T.WLD, T.SUSHI,  FEE_MEDIUM), isToUsdc: false, sym: "SUSHI"  },
    { token: T.BTCH2O, pool: computePoolAddress(T.WLD, T.BTCH2O, FEE_MEDIUM), isToUsdc: false, sym: "BTCH2O" },
    { token: T.WETH,   pool: computePoolAddress(T.WLD, T.WETH,   FEE_MEDIUM), isToUsdc: false, sym: "WETH"   },
    { token: T.WBTC,   pool: computePoolAddress(T.WLD, T.WBTC,   FEE_MEDIUM), isToUsdc: false, sym: "WBTC"   },
    { token: T.VIBE,   pool: computePoolAddress(T.WLD, T.VIBE,   FEE_MEDIUM), isToUsdc: false, sym: "VIBE"   },
    { token: T.ORO,    pool: computePoolAddress(T.WLD, T.ORO,    FEE_MEDIUM), isToUsdc: false, sym: "ORO"    },
    { token: T.ORB,    pool: computePoolAddress(T.WLD, T.ORB,    FEE_MEDIUM), isToUsdc: false, sym: "ORB"    },
    { token: T.PUF,    pool: computePoolAddress(T.WLD, T.PUF,    FEE_MEDIUM), isToUsdc: false, sym: "PUF"    },
    { token: T.wARS,   pool: computePoolAddress(T.WLD, T.wARS,   FEE_MEDIUM), isToUsdc: false, sym: "wARS"   },
    { token: T.oXAUT,  pool: computePoolAddress(T.WLD, T.oXAUT,  FEE_MEDIUM), isToUsdc: false, sym: "oXAUT"  },
    { token: T.AIR,    pool: computePoolAddress(T.WLD, T.AIR,    FEE_MEDIUM), isToUsdc: false, sym: "AIR"    },
    // UTH2 -> USDC -> WLD -> H2O
    { token: T.UTH2,   pool: computePoolAddress(T.UTH2, T.USDC,  FEE_LOW),    isToUsdc: true,  sym: "UTH2"   },
  ];
  const tokens   = tokensWithRoute.map(x => x.token);
  const pools    = tokensWithRoute.map(x => x.pool);
  const isUsdc   = tokensWithRoute.map(x => x.isToUsdc);
  await (await c.setPriceRoutesBatch(tokens, pools, isUsdc)).wait();
  for (const r of tokensWithRoute) console.log(`      ${r.sym.padEnd(7)} -> ${r.isToUsdc ? "USDC" : "WLD"} pool ${r.pool}`);

  // ─── Output ─────────────────────────────────────────────────────────────────
  const outFile = path.join(__dirname, "..", "deployed-h2o-v3.json");
  const output = {
    deployedAt: new Date().toISOString(),
    network: "worldchain",
    chainId: 480,
    deployer: deployer.address,
    contract: c.address,
    npm: NPM_ADDRESS,
    pricing: { usdcWldPool, wldH2oPool },
    pools: addedPools,
    routes: tokensWithRoute,
    fees: { depositBps: 200, withdrawBps: 200, claimBps: 2000 },
  };
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log("\n→ Guardado en", outFile);

  // ─── Verify (opcional) ──────────────────────────────────────────────────────
  if (process.env.WORLD_SCAN || process.env.WORLD_KEY) {
    console.log("\n[verify] verificando en worldscan...");
    try {
      await run("verify:verify", { address: c.address, constructorArguments: [NPM_ADDRESS] });
      console.log("verified");
    } catch (e) {
      console.log("verify failed:", e.message || e);
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✓ Listo. Recuerda fondear con scripts/fund-h2o-v3.js");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
