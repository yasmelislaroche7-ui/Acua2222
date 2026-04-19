export const H2O_STAKING_ADDRESS = "0x7730583E492D520CcBb3C06325A77EccAbAFa98e";

export const H2O_STAKING_ABI = [
  {
    "inputs":[
      {"internalType":"address","name":"_h2o","type":"address"},
      {"internalType":"address","name":"_uth2","type":"address"}
    ],
    "stateMutability":"nonpayable",
    "type":"constructor"
  },
  {"inputs":[{"internalType":"uint256","name":"months_","type":"uint256"}],"name":"buyVIP","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[],"name":"claimOwnerVip","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[],"name":"claimRefRewards","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[],"name":"claimRewards","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"depositRewards","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"address","name":"acc","type":"address"}],"name":"earned","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"address","name":"ref","type":"address"}],"name":"registerReferrer","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"unstake","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[],"name":"vipPrice","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
] as const;