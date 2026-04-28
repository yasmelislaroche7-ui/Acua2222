const { ethers } = require("hardhat");
async function main() {
  const c = await ethers.getContractAt("AcuaH2OV3LP", "0xC1feC35ea295EE867e41D1b80a23809C39ac6868");
  const count = await c.poolsCount();
  console.log("poolsCount on-chain:", count.toString());
  const all = await c.getAllPools();
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    console.log(`[${i}] t0=${p.token0.slice(0,10)} t1=${p.token1.slice(0,10)} fee=${p.fee} pool=${p.poolAddr} active=${p.active} comingSoon=${p.comingSoon}`);
  }
  // Verify UTH2/USDC pool exists on chain
  console.log("\n--- UTH2/USDC pool check ---");
  const uth2usdcPool = "0x71f9736330e2E682388288263276459c8A567760";
  const code = await ethers.provider.getCode(uth2usdcPool);
  console.log("pool code length:", (code.length-2)/2, "bytes (0 = not deployed)");
  if (code.length > 2) {
    const pool = new ethers.Contract(uth2usdcPool, ["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)","function liquidity() view returns (uint128)","function token0() view returns (address)","function token1() view returns (address)"], ethers.provider);
    try {
      const t0 = await pool.token0(); const t1 = await pool.token1();
      const liq = await pool.liquidity(); const s0 = await pool.slot0();
      console.log("token0:", t0); console.log("token1:", t1);
      console.log("liquidity:", liq.toString()); console.log("sqrtPriceX96:", s0[0].toString(), "tick:", s0[1].toString());
    } catch (e) { console.log("ERR slot0:", e.message); }
  }
  // Try estimateAprBps for pool 15
  console.log("\n--- estimateAprBps each pool ---");
  for (let i = 0; i < count; i++) {
    try { const apr = await c.estimateAprBps(i); console.log(`[${i}] APR bps = ${apr.toString()}`); }
    catch (e) { console.log(`[${i}] APR ERR: ${e.message.slice(0,100)}`); }
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
