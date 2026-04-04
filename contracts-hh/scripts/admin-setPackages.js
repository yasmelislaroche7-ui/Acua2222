import { ethers } from "ethers"

const RPC = "https://worldchain-mainnet.g.alchemy.com/public"
const PRIVATE_KEY = "TU_PRIVATE_KEY"
const CONTRACT = "0xD2E227D30bC94D6FfD4eCf6b56141429C801E228"

const ABI = [
  "function setPackage(uint256 id, uint256 priceWLD, uint256 dailyYield, bool active)"
]

const provider = new ethers.JsonRpcProvider(RPC)
const wallet = new ethers.Wallet(PRIVATE_KEY, provider)
const contract = new ethers.Contract(CONTRACT, ABI, wallet)

const packages = [
  { price:"0.01", yearly:"10" },
  { price:"0.05", yearly:"50" },
  { price:"0.1", yearly:"100" },
  { price:"0.3", yearly:"250" },
  { price:"0.5", yearly:"320" },
  { price:"1", yearly:"500" },
  { price:"5", yearly:"1500" },
]

async function main() {
  for (let i = 0; i < packages.length; i++) {

    const priceWei = ethers.parseUnits(packages[i].price, 18)

    const daily = Number(packages[i].yearly) / 365
    const dailyWei = ethers.parseUnits(daily.toString(), 18)

    console.log("Setting package", i)

    const tx = await contract.setPackage(i, priceWei, dailyWei, true)
    await tx.wait()

    console.log("Paquete", i, "actualizado ✅")
  }

  console.log("🎉 TODOS LOS PAQUETES LISTOS")
}

main()