const { ethers, run } = require("hardhat");
const fs = require("fs");

const SECOND_OWNER = "0xc2ef127734f296952de75c1b58a6cec605cc2e59";

const TOKENS = [
  { key: "WBTC", symbol: "WBTC", token: "0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3", decimals: 8 },
  { key: "oXAUT", symbol: "oXAUT", token: "0x30974f73A4ac9E606Ed80da928e454977ac486D2", decimals: 6 },
  { key: "ORO", symbol: "ORO", token: "0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63", decimals: 18 },
  { key: "EURC", symbol: "EURC", token: "0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B", decimals: 6 },
  { key: "WDD", symbol: "WDD", token: "0xEdE54d9c024ee80C85ec0a75eD2d8774c7Fbac9B", decimals: 18 },
  { key: "ORB", symbol: "ORB", token: "0xF3F92A60e6004f3982F0FdE0d43602fC0a30a0dB", decimals: 18 },
  { key: "WETH", symbol: "WETH", token: "0x4200000000000000000000000000000000000006", decimals: 18 },
  { key: "PUF", symbol: "PUF", token: "0x1aE3498f1B417fe31BE544B04B711F27Ba437bd3", decimals: 18 },
  { key: "uDOGE", symbol: "uDOGE", token: "0x12E96C2BFEA6E835CF8Dd38a5834fa61Cf723736", decimals: 18 },
  { key: "uSOL", symbol: "uSOL", token: "0x9B8Df6E244526ab5F6e6400d331DB28C8fdDdb55", decimals: 18 },
  { key: "VIBE", symbol: "VIBE", token: "0x696aD02f0c7d68915ea39cA6e60934f7a8900FB1", decimals: 18 },
  { key: "UTH2", symbol: "UTH₂", token: "0x9eA8653640E22A5b69887985BB75d496dc97022a", decimals: 18 },
  { key: "DIAMANTE", symbol: "DIAMANTE", token: "0x2ba918fec90Ca7AaC5753a2551593470815866e6", decimals: 18 },
  { key: "wBRL", symbol: "wBRL", token: "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0", decimals: 18 },
  { key: "BILLBOARD", symbol: "BILLBOARD", token: "0x7a8892E9687704F7BE8C26dfC5e51B6A86c8098B", decimals: 18 },
  { key: "Cash", symbol: "Cash", token: "0xbfdA4F50a2d5B9b864511579D7dfa1C72f118575", decimals: 18 },
  { key: "AION", symbol: "AION", token: "0x26064DD7821f351202c61f0deB97678eef265E36", decimals: 18 },
  { key: "SAMA", symbol: "SAMA", token: "0x24e2f756AF6558818083E78B1205D156542bCe80", decimals: 18 },
  { key: "APE", symbol: "APE", token: "0x13e20981D9bd3dC45e99802f06488C5AD7c28360", decimals: 18 },
  { key: "GFY", symbol: "GFY", token: "0x6A7B33B8A7f7B3535dc832ECD147F6dEC8A8e8Cf", decimals: 18 },
  { key: "VEN", symbol: "VEN", token: "0x1191a54c53DBe8487c3A258C2A4a84aAe7E936F5", decimals: 18 },
];

const PREDEPLOYED = {
  WBTC: "0x910535116dAF74402A3EEc40b48f90A5dC91e094",
  oXAUT: "0xE9bF5F63eE749F259DD41302b8e9C4A64b51f27a",
  ORO: "0x67a4AEdb3fCbf8227A9B5469013d5986c7D2fcE7",
  EURC: "0x7E3E4803EA39CFdf4527727F13e30cbbeaD3F498",
  WDD: "0x681a5a61B787B503c83e84dF2e8bCB9D5763E21E",
  ORB: "0xB84CDFB60De67714e11d5FF98820f72bb864b9b9",
  WETH: "0xF9930f602bD6CFe5EE8d63c32CE47Eecc72eE4f5",
  PUF: "0xfA8809F314A6D77A9232C07A7388a70504A8e81f",
  uDOGE: "0xAe0EfaED06bCc940bb8763d7d7AC9b8B954Be439",
  uSOL: "0x6f57857b3AC1F81FD196AbB406E91cb11062F938",
  VIBE: "0xC711cd08C591382ec8169f9aCE17Cd909813820f",
  UTH2: "0xef4EA65B1a819c1Ce93F65c8382f29e549474746",
  DIAMANTE: "0xb74A1CE7beBA1BbD2E5777a0cB219a0EC2c31C14",
  wBRL: "0x37776bb08C569A4019F5D372C02Ff9134E06D332",
  BILLBOARD: "0x92102C9f1Ad0709d8FA38f4b80E9AE3DbCc7df31",
  Cash: "0x13Fa130F183dFcc4c48b2B05236Eb8914f8c077A",
};

function writeOutput(addresses, deployerAddress) {
  const output = {
    deployedAt: new Date().toISOString(),
    owner1: deployerAddress,
    owner2: SECOND_OWNER,
    feeBps: 500,
    contracts: addresses,
    tokens: TOKENS,
  };
  fs.writeFileSync("./deployed-staking-v2-addresses.json", JSON.stringify(output, null, 2));
  return output;
}

async function verify(address, args) {
  try {
    await run("verify:verify", { address, constructorArguments: args });
    console.log(`verified ${address}`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (message.toLowerCase().includes("already verified")) {
      console.log(`already verified ${address}`);
    } else {
      console.log(`verification failed ${address}: ${message}`);
    }
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("UniversalStakingV2");
  const addresses = { ...PREDEPLOYED };
  console.log("Deployer:", deployer.address);
  console.log("Second owner:", SECOND_OWNER);
  console.log("Balance:", ethers.utils.formatEther(await deployer.getBalance()));

  for (const token of TOKENS) {
    if (addresses[token.key]) {
      console.log(`Skipping ${token.symbol}: ${addresses[token.key]}`);
      continue;
    }
    const args = [token.token, deployer.address, SECOND_OWNER];
    console.log(`Deploying ${token.symbol}`);
    const contract = await Factory.deploy(...args);
    await contract.deployed();
    addresses[token.key] = contract.address;
    console.log(`${token.symbol}: ${contract.address}`);
    writeOutput(addresses, deployer.address);
    await verify(contract.address, args);
  }

  const output = writeOutput(addresses, deployer.address);
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});