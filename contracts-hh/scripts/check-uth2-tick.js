const { ethers } = require("hardhat");
async function main() {
  const pool = new ethers.Contract("0x5cF66b817a35B84bbaB03f6774B0CB78C140A981",
    ["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)","function tickSpacing() view returns (int24)","function token0() view returns (address)","function token1() view returns (address)"],
    ethers.provider);
  const t0 = await pool.token0(); const t1 = await pool.token1();
  const sp = await pool.tickSpacing(); const s0 = await pool.slot0();
  console.log("token0:", t0, "(USDC=0x79A0...?)");
  console.log("token1:", t1, "(UTH2=0x9eA8...?)");
  console.log("tickSpacing:", sp.toString());
  console.log("currentTick:", s0[1].toString());
  console.log("sqrtPriceX96:", s0[0].toString());
  // Suggest range +/- 100 ticks (rounded to spacing)
  const t = Number(s0[1]); const s = Number(sp);
  const lo = Math.floor((t - 100)/s)*s; const hi = Math.ceil((t + 100)/s)*s;
  console.log(`Suggested narrow range: [${lo}, ${hi}] (current tick ${t})`);
}
main().catch(e=>{console.error(e);process.exit(1)});
