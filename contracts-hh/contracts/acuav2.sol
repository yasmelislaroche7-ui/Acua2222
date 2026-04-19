// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from,address to,uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract H2OUniversalStakingFinal {

    uint256 constant BPS = 10000;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address public immutable H2O;
    address public immutable UTH2;

    constructor(address _h2o, address _uth2){
        H2O=_h2o;
        UTH2=_uth2;
        owners.push(msg.sender);
        ownerShares[msg.sender]=1;
        totalOwnerVipShares=1;
    }

    // -------------------------------------------------
    // OWNERS
    // -------------------------------------------------

    address[] public owners;
    mapping(address=>uint256) public ownerShares;
    uint256 public totalOwnerVipShares;

    modifier onlyOwner(){
        bool ok=false;
        for(uint i=0;i<owners.length;i++){
            if(owners[i]==msg.sender) ok=true;
        }
        require(ok,"not owner");
        _;
    }

    // -------------------------------------------------
    // FEES
    // -------------------------------------------------

    uint256 public depositFeeBps = 500;
    uint256 public withdrawFeeBps = 500;
    uint256 public claimFeeBps = 1000;

    // -------------------------------------------------
    // STAKING CORE
    // -------------------------------------------------

    uint256 public totalStaked;
    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdate;
    uint256 public rewardPerTokenStored;

    struct User {
        uint256 balance;
        uint256 rewardDebt;
        uint256 pending;
    }

    mapping(address=>User) public users;

    function rewardPerToken() public view returns(uint256){
        if(totalStaked==0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((block.timestamp-lastUpdate)*rewardRate*1e18/totalStaked);
    }

    function _updateReward(address acc) internal{
        rewardPerTokenStored=rewardPerToken();
        lastUpdate=block.timestamp;
        if(acc!=address(0)){
            users[acc].pending = earned(acc);
            users[acc].rewardDebt = rewardPerTokenStored;
        }
    }

    function earned(address acc) public view returns(uint256){
        User storage u=users[acc];
        return (u.balance*(rewardPerToken()-u.rewardDebt)/1e18)+u.pending;
    }

    // -------------------------------------------------
    // PERMIT2 STAKE
    // -------------------------------------------------

    function stake(IPermit2.PermitTransferFrom calldata permit,bytes calldata sig) external {
        _updateReward(msg.sender);

        uint256 amount = permit.permitted.amount;

        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails(address(this),amount),
            msg.sender,
            sig
        );

        uint256 fee = amount*depositFeeBps/BPS;
        uint256 net = amount-fee;

        ownerVipPool += fee;

        users[msg.sender].balance+=net;
        totalStaked+=net;
    }

    function unstake(uint256 amount) external {
        _updateReward(msg.sender);
        require(users[msg.sender].balance>=amount);

        uint256 fee = amount*withdrawFeeBps/BPS;
        uint256 net = amount-fee;

        ownerVipPool+=fee;

        users[msg.sender].balance-=amount;
        totalStaked-=amount;

        IERC20(H2O).transfer(msg.sender,net);
    }

    // -------------------------------------------------
    // REFERRAL SYSTEM (GLOBAL POOL)
    // -------------------------------------------------

    mapping(address=>address) public referrerOf;
    mapping(address=>uint256) public refCount;
    uint256 public totalRefShares;

    function registerReferrer(address ref) external {
        require(referrerOf[msg.sender]==address(0));
        require(ref!=msg.sender);
        referrerOf[msg.sender]=ref;
        refCount[ref]+=1;
        totalRefShares+=1;
    }

    uint256 public referralPool;
    mapping(address=>uint256) public refRewardDebt;
    uint256 public refPerShare;

    function _updateRefPool(uint256 amount) internal {
        if(totalRefShares==0){ ownerVipPool+=amount; return;}
        refPerShare += amount*1e18/totalRefShares;
    }

    function claimRefRewards() external {
        uint256 share = refCount[msg.sender];
        require(share>0);
        uint256 pending = share*(refPerShare-refRewardDebt[msg.sender])/1e18;
        refRewardDebt[msg.sender]=refPerShare;
        IERC20(H2O).transfer(msg.sender,pending);
    }

    // -------------------------------------------------
    // OWNER + VIP POOL
    // -------------------------------------------------

    uint256 public ownerVipPool;
    uint256 public ownerVipPerShare;
    mapping(address=>uint256) public ownerVipDebt;

    function _updateOwnerVip(uint256 amount) internal {
        ownerVipPerShare += amount*1e18/totalOwnerVipShares;
    }

    function claimOwnerVip() external {
        uint256 share = ownerShares[msg.sender];
        require(share>0);
        uint256 pending = share*(ownerVipPerShare-ownerVipDebt[msg.sender])/1e18;
        ownerVipDebt[msg.sender]=ownerVipPerShare;
        IERC20(H2O).transfer(msg.sender,pending);
    }

    // -------------------------------------------------
    // VIP SUBSCRIPTION (UTH2)
    // -------------------------------------------------

    uint256 public vipPrice = 1e18;
    uint256 public vipDuration = 30 days;
    mapping(address=>uint256) public vipExpire;

    function buyVIP(uint256 months_) external {
        IERC20(UTH2).transferFrom(msg.sender,address(this),vipPrice*months_);
        uint256 start = vipExpire[msg.sender]>block.timestamp?vipExpire[msg.sender]:block.timestamp;
        vipExpire[msg.sender]=start+vipDuration*months_;

        ownerShares[msg.sender]+=1;
        totalOwnerVipShares+=1;
    }

    // -------------------------------------------------
    // CLAIM REWARDS (SPLIT FEES)
    // -------------------------------------------------

    function claimRewards() external {
        _updateReward(msg.sender);

        uint256 reward = users[msg.sender].pending;
        require(reward>0);
        users[msg.sender].pending=0;

        uint256 fee = reward*claimFeeBps/BPS;
        uint256 net = reward-fee;

        uint256 refPart = fee/2;
        uint256 vipPart = fee-refPart;

        _updateRefPool(refPart);
        _updateOwnerVip(vipPart);

        IERC20(H2O).transfer(msg.sender,net);
    }

    // -------------------------------------------------
    // FUND REWARDS
    // -------------------------------------------------

    function depositRewards(uint256 amount) external onlyOwner{
        IERC20(H2O).transferFrom(msg.sender,address(this),amount);
        rewardRate = amount / 365 days;
        lastUpdate = block.timestamp;
        periodFinish = block.timestamp + 365 days;
    }
}