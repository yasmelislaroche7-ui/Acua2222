// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/**
 * @title UniversalStakingWithVip
 * @notice Staking H2O + suscripción VIP en UTH2 para perks.
 *         - Stake/reward: H2O
 *         - Suscripción VIP mensual: 1 UTH2
 *         - Permite renovar, controlar expiración, y ver quién es VIP.
 *         - Staking avanzado compatible World App (Permit2).
 */
contract UniversalStakingWithVip {
    // ---- CONSTANTS ----
    uint256 public constant MAX_OWNERS = 3;
    uint256 public constant MAX_FEE_BPS = 1000; // max 10%
    uint256 public constant FEE_TO_REWARD_BPS = 1000; // 10% of fees → reward fund
    uint256 public constant BPS = 10000;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 public constant REWARD_DURATION = 365 days;

    address public immutable H2O;
    address public immutable UTH2;

    // ---- OWNERS ----
    address[3] public owners;
    uint256 public ownerCount;

    // ---- FEE CONFIG ----
    uint256 public stakeFeeBps = 200;   // 2%
    uint256 public unstakeFeeBps = 200; // 2%
    uint256 public claimFeeBps = 200;   // 2%
    bool public paused;

    // ---- REWARD STATE (Synthetix-style) ----
    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public rewardPerTokenStored;
    uint256 public lastUpdateTime;
    uint256 public totalStaked;
    uint256 public rewardReserve;

    // ---- USER STATE ----
    struct UserInfo {
        uint256 staked;
        uint256 rewardPerTokenPaid;
        uint256 pendingReward;
        uint256 stakedAt;
        uint256 lastClaimAt;
    }
    mapping(address => UserInfo) public users;

    // ---- VIP SUBS ----
    uint256 public vipPrice = 1 ether; // 1 UTH2 mensual, 18 decimales
    uint256 public vipDuration = 30 days;

    mapping(address => uint256) public vipExpire; // hasta cuando tienes activo el VIP

    // ---- EVENTS ----
    event Staked(address indexed user, uint256 amount, uint256 fee);
    event Unstaked(address indexed user, uint256 amount, uint256 fee);
    event Claimed(address indexed user, uint256 amount, uint256 fee);
    event RewardsDeposited(address indexed depositor, uint256 amount, uint256 newRate, uint256 periodEnd);
    event FeeConfigured(uint256 stakeFeeBps, uint256 unstakeFeeBps, uint256 claimFeeBps);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);
    event VipPaid(address indexed user, uint256 expire);

    // ---- MODIFIERS ----
    modifier onlyOwner() {
        require(_isOwner(msg.sender), "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            users[account].pendingReward = earned(account);
            users[account].rewardPerTokenPaid = rewardPerTokenStored;
        }
        _;
    }

    // ---- CONSTRUCTOR ----
    constructor(address h2o, address uth2, address owner1) {
        require(h2o != address(0), "Zero H2O");
        require(uth2 != address(0), "Zero UTH2");
        require(owner1 != address(0), "Zero owner");
        H2O = h2o;
        UTH2 = uth2;
        owners[0] = owner1;
        ownerCount = 1;
    }

    // ---- OWNER HELPERS ----
    function _isOwner(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < MAX_OWNERS; i++) {
            if (owners[i] == addr) return true;
        }
        return false;
    }

    // ---- REWARD LOGIC ----
    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (
            (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18 / totalStaked
        );
    }

    function earned(address account) public view returns (uint256) {
        UserInfo storage u = users[account];
        return u.staked * (rewardPerToken() - u.rewardPerTokenPaid) / 1e18 + u.pendingReward;
    }

    function apyBps() external view returns (uint256) {
        if (totalStaked == 0 || rewardRate == 0) return 0;
        return rewardRate * 365 days * BPS / totalStaked;
    }

    function _distributeOwnerFee(uint256 amount) internal {
        if (amount == 0 || ownerCount == 0) return;
        uint256 share = amount / ownerCount;
        for (uint256 i = 0; i < MAX_OWNERS; i++) {
            if (owners[i] != address(0)) {
                IERC20(H2O).transfer(owners[i], share);
            }
        }
    }

    function _handleFee(uint256 amount, uint256 feeBps) internal returns (uint256 net) {
        if (feeBps == 0) return amount;
        uint256 fee = amount * feeBps / BPS;
        uint256 toReward = fee * FEE_TO_REWARD_BPS / BPS;
        uint256 toOwners = fee - toReward;
        rewardReserve += toReward;
        _distributeOwnerFee(toOwners);
        return amount - fee;
    }

    // ---- PERMIT2 HELPER (para H2O) ----
    function _receiveViaPermit2(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature,
        uint256 expectedAmount
    ) internal {
        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: expectedAmount }),
            msg.sender,
            signature
        );
    }

    // ---- STAKE / UNSTAKE / CLAIM (en H2O, como siempre) ----

    function stake(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external whenNotPaused updateReward(msg.sender) {
        uint256 amount = permit.permitted.amount;
        require(amount > 0, "Zero amount");
        require(permit.permitted.token == H2O, "Wrong token");

        _receiveViaPermit2(permit, signature, amount);

        uint256 net = _handleFee(amount, stakeFeeBps);

        users[msg.sender].staked += net;
        if (users[msg.sender].stakedAt == 0) users[msg.sender].stakedAt = block.timestamp;
        users[msg.sender].lastClaimAt = block.timestamp;
        totalStaked += net;

        emit Staked(msg.sender, net, amount - net);
    }

    function unstake() external whenNotPaused updateReward(msg.sender) {
        UserInfo storage u = users[msg.sender];
        uint256 staked = u.staked;
        require(staked > 0, "Nothing staked");

        // Auto-claim rewards first
        uint256 pending = u.pendingReward;
        if (pending > 0) {
            uint256 netReward = _claimInternal(pending, u);
            emit Claimed(msg.sender, netReward, pending - netReward);
        }

        uint256 net = _handleFee(staked, unstakeFeeBps);
        u.staked = 0;
        u.stakedAt = 0;
        totalStaked -= staked;

        IERC20(H2O).transfer(msg.sender, net);
        emit Unstaked(msg.sender, net, staked - net);
    }

    function claimRewards() external whenNotPaused updateReward(msg.sender) {
        UserInfo storage u = users[msg.sender];
        uint256 pending = u.pendingReward;
        require(pending > 0, "No rewards");

        uint256 net = _claimInternal(pending, u);
        emit Claimed(msg.sender, net, pending - net);
    }

    function _claimInternal(uint256 pending, UserInfo storage u) internal returns (uint256 net) {
        u.pendingReward = 0;
        u.lastClaimAt = block.timestamp;
        net = _handleClaimFee(pending);
        IERC20(H2O).transfer(msg.sender, net);
    }

    function _handleClaimFee(uint256 amount) internal returns (uint256 net) {
        if (claimFeeBps == 0) return amount;
        uint256 fee = amount * claimFeeBps / BPS;
        uint256 toReward = fee * FEE_TO_REWARD_BPS / BPS;
        uint256 toOwners = fee - toReward;
        rewardReserve += toReward;
        _distributeOwnerFee(toOwners);
        return amount - fee;
    }

    // ---- VIP (con UTH2) ----

    function isVip(address user) external view returns (bool) {
        return vipExpire[user] > block.timestamp;
    }

    function vipExpireAt(address user) external view returns (uint256) {
        return vipExpire[user];
    }

    function buyVIP(uint256 numMonths) external {
        require(numMonths > 0 && numMonths <= 12, "1 <= months <= 12");
        uint256 cost = vipPrice * numMonths;

        IERC20(UTH2).transferFrom(msg.sender, address(this), cost);

        // Si aún no eres VIP, inicia al tiempo actual
        uint256 prev = vipExpire[msg.sender];
        uint256 start = prev > block.timestamp ? prev : block.timestamp;
        vipExpire[msg.sender] = start + vipDuration * numMonths;

        emit VipPaid(msg.sender, vipExpire[msg.sender]);
    }

    // ---- ADMIN ----

    function setVipPrice(uint256 newPrice) external onlyOwner {
        require(newPrice > 0, "Zero price");
        vipPrice = newPrice;
    }

    function setVipDuration(uint256 dur) external onlyOwner {
        require(dur >= 1 days, "Too short");
        vipDuration = dur;
    }

    function depositRewards(uint256 amount) external onlyOwner updateReward(address(0)) {
        require(amount > 0, "Zero amount");
        IERC20(H2O).transferFrom(msg.sender, address(this), amount);
        rewardReserve += amount;
        _updateRewardRate();
        emit RewardsDeposited(msg.sender, amount, rewardRate, periodFinish);
    }

    function _updateRewardRate() internal {
        if (block.timestamp >= periodFinish) {
            rewardRate = rewardReserve / REWARD_DURATION;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (rewardReserve + leftover) / REWARD_DURATION;
        }
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + REWARD_DURATION;
        rewardReserve = 0;
    }

    function setStakeFee(uint256 bps) external onlyOwner {
        require(bps <= MAX_FEE_BPS, "Fee too high");
        stakeFeeBps = bps;
        emit FeeConfigured(stakeFeeBps, unstakeFeeBps, claimFeeBps);
    }

    function setUnstakeFee(uint256 bps) external onlyOwner {
        require(bps <= MAX_FEE_BPS, "Fee too high");
        unstakeFeeBps = bps;
        emit FeeConfigured(stakeFeeBps, unstakeFeeBps, claimFeeBps);
    }

    function setClaimFee(uint256 bps) external onlyOwner {
        require(bps <= MAX_FEE_BPS, "Fee too high");
        claimFeeBps = bps;
        emit FeeConfigured(stakeFeeBps, unstakeFeeBps, claimFeeBps);
    }

    function addOwner(address addr) external onlyOwner {
        require(addr != address(0), "Zero address");
        require(!_isOwner(addr), "Already owner");
        require(ownerCount < MAX_OWNERS, "Max owners reached");
        for (uint256 i = 0; i < MAX_OWNERS; i++) {
            if (owners[i] == address(0)) {
                owners[i] = addr;
                ownerCount++;
                emit OwnerAdded(addr);
                return;
            }
        }
    }

    function removeOwner(address addr) external onlyOwner {
        require(ownerCount > 1, "Need at least 1 owner");
        for (uint256 i = 0; i < MAX_OWNERS; i++) {
            if (owners[i] == addr) {
                owners[i] = address(0);
                ownerCount--;
                emit OwnerRemoved(addr);
                return;
            }
        }
        revert("Not found");
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function emergencyWithdraw(address token, uint256 amount, address to) external onlyOwner {
        require(to != address(0), "Zero to");
        IERC20(token).transfer(to, amount);
        emit EmergencyWithdraw(token, to, amount);
    }

    // ---- VIEWS ----

    function getStakeInfo(address user) external view returns (
        uint256 stakedAmount,
        uint256 stakedAt,
        uint256 lastClaimAt,
        uint256 pendingRewards,
        bool active
    ) {
        UserInfo storage u = users[user];
        return (u.staked, u.stakedAt, u.lastClaimAt, earned(user), u.staked > 0);
    }

    function getOwners() external view returns (address[3] memory) {
        return owners;
    }

    function contractTokenBalance() external view returns (uint256) {
        return IERC20(H2O).balanceOf(address(this));
    }
}