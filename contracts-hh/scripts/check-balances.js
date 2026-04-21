const { ethers } = require("hardhat");
async function main() {
  const UTH2 = "0x9eA8653640E22A5b69887985BB75d496dc97022a";
  const VOL_OLD = "0x81D9a0c80eAD28B1A7364fa73684Cc78e497FA48";
  const [signer] = await ethers.getSigners();
  const erc = new ethers.Contract(UTH2, ["function balanceOf(address) view returns (uint256)"], signer);
  console.log("Old volume UTH2 balance:", ethers.utils.formatEther(await erc.balanceOf(VOL_OLD)));
  console.log("Owner UTH2 balance:", ethers.utils.formatEther(await erc.balanceOf(signer.address)));
  const eth = await signer.getBalance();
  console.log("Owner ETH:", ethers.utils.formatEther(eth));
}
main().catch(e => { console.error(e); process.exit(1); });
