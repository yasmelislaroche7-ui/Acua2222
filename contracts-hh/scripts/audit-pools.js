// Audita todas las pools activas: existencia, liquidez, slot0
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const c = await ethers.getContractAt("AcuaH2OV3LP", "0xC1feC35ea295EE867e41D1b80a23809C39ac6868");
  const all = await c.getAllPools();
  const POOL_ABI = ["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)","function liquidity() view returns (uint128)","function token0() view returns (address)","function token1() view returns (address)","function fee() view returns (uint24)"];
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
  const FACTORY = new ethers.Contract("0x7a5028BDa40e7B173C278C5342087826455ea25a",
    ["function getPool(address,address,uint24) view returns (address)"], ethers.provider);

  const issues = [];
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    if (!p.active) continue;
    const code = await ethers.provider.getCode(p.poolAddr);
    let liq = "-", spX = "-", tick = "-", realAddr = "-";
    try {
      const realA = await FACTORY.getPool(p.token0, p.token1, p.fee);
      realAddr = realA === ethers.constants.AddressZero ? "NONE" : realA;
      if (code.length > 2) {
        const pool = new ethers.Contract(p.poolAddr, POOL_ABI, ethers.provider);
        const l = await pool.liquidity(); liq = l.toString();
        const s = await pool.slot0(); spX = s[0].toString(); tick = s[1].toString();
      }
    } catch (e) {}
    const exists = code.length > 2;
    const matches = realAddr === p.poolAddr;
    const initialized = spX !== "0" && spX !== "-";
    const status = !exists ? "NO_POOL" : !matches ? "WRONG_ADDR" : !initialized ? "NOT_INIT" : liq === "0" ? "NO_LIQ" : "OK";
    console.log(`[${String(i).padStart(2)}] ${(sym(p.token0)+"/"+sym(p.token1)).padEnd(14)} fee=${String(p.fee).padStart(5)} ${status.padEnd(11)} liq=${liq.slice(0,12).padEnd(13)} tick=${tick}`);
    if (status !== "OK") issues.push({ id: i, label: `${sym(p.token0)}/${sym(p.token1)}`, fee: Number(p.fee), status, configured: p.poolAddr, real: realAddr });
  }

  console.log("\n--- Resumen issues ---");
  console.log(JSON.stringify(issues, null, 2));
  fs.writeFileSync(path.join(__dirname, "..", "audit-pools.json"), JSON.stringify({ issues, auditedAt: new Date().toISOString() }, null, 2));
}
main().catch(e=>{console.error(e);process.exit(1)});
