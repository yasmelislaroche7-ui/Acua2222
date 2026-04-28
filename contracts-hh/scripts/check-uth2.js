const { ethers } = require("hardhat");
async function main() {
  const FACTORY = "0x7a5028BDa40e7B173C278C5342087826455ea25a";
  const factory = new ethers.Contract(FACTORY, ["function getPool(address,address,uint24) view returns (address)"], ethers.provider);
  const UTH2 = "0x9eA8653640E22A5b69887985BB75d496dc97022a";
  const USDC = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1";
  const WLD  = "0x2cFc85d8E48F8EAB294be644d9E25C3030863003";
  const H2O  = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";
  console.log("--- UTH2 pool checks ---");
  for (const [pair, t0, t1] of [["UTH2/USDC",UTH2,USDC],["UTH2/WLD",UTH2,WLD],["UTH2/H2O",UTH2,H2O]]) {
    for (const fee of [100, 500, 3000, 10000]) {
      const a = await factory.getPool(t0, t1, fee);
      if (a !== "0x0000000000000000000000000000000000000000") {
        const code = await ethers.provider.getCode(a);
        let liq = "?";
        try { const p = new ethers.Contract(a, ["function liquidity() view returns (uint128)"], ethers.provider); liq = (await p.liquidity()).toString(); } catch {}
        console.log(`${pair} fee=${fee} -> ${a} (code=${code.length>2?'DEPLOYED':'NONE'} liq=${liq})`);
      }
    }
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
