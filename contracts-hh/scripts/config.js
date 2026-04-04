exports.CONTRACT = "0xD2E227D30bC94D6FfD4eCf6b56141429C801E228";

exports.ABI = [
  "function setPackage(uint256 id,uint256 priceWLD,uint256 dailyYield,bool active)",
  "function WLD_TOKEN() view returns(address)",
  "function rewardTokens(uint256) view returns(address)",
  "function emergencyWithdraw(address token,uint256 amount,address to)"
];