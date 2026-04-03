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
 * @title UniversalStaking
 * @notice Staking contract for World Chain tokens.
 *         - Permit2 for World App compatibility
 *         - 3 configurable owners
 *         - 2% configurable fee on stake/unstake/claim
 *         - 10% of fees go to reward fund
 *         - Market-based APY (Synthetix-style reward accumulation)
 *         - Same token for deposit and rewards
 *         - Rewards accrue per second, claimable 24/7
 *         - Pause and emergency withdraw
 */
contract UniversalStaking {
    // ── Constants ───────────────────────────────────────────────────────────────
    uint256 public constant MAX_OWNERS = 3;
    uint256 public constant MAX_FEE_BPS = 1000; // max 10%
    uint256 public constant FEE_TO_REWARD_BPS = 1000; // 10% of fees → reward fund
    uint256 public constant BPS = 10000;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 public constant REWARD_DURATION = 365 days;

    // ── Token ────────────────────────────────────────────────────────────────────
    address public immutable TOKEN;

    // ── Owners ───────────────────────────────────────────────────────────────────
    address[3] public owners;
    uint256 public ownerCount;

    // ── Config ───────────────────────────────────────────────────────────────────
    uint256 public stakeFeeBps = 200;   // 2%
    uint256 public unstakeFeeBps = 200; // 2%
    uint256 public claimFeeBps = 200;   // 2%
    bool public paused;

    // ── Reward State (Synthetix-style) ───────────────────────────────────────────
    uint256 public rewardRate;           // tokens per second (total to all stakers)
    uint256 public periodFinish;         // timestamp when current reward period ends
    uint256 public rewardPerTokenStored; // accumulated reward per token (scaled 1e18)
    uint256 public lastUpdateTime;       // last time rewardPerTokenStored was updated
    uint256 public totalStaked;          // total tokens staked
    uint256 public rewardReserve;        // tokens reserved for rewards (not staked)

    // ── User State ───────────────────────────────────────────────────────────────
    struct UserInfo {
        uint256 staked;
        uint256 rewardPerTokenPaid;
        uint256 pendingReward;
        uint256 stakedAt;
        uint256 lastClaimAt;
    }
    mapping(address => UserInfo) public users;

    // ── Events ───────────────────────────────────────────────────────────────────
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

    // ── Modifiers ─────────────────────────────────────────────────────────────────
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

    // ── Constructor ───────────────────────────────────────────────────────────────
    constructor(address token, address owner1) {
        require(token != address(0), "Zero token");
        require(owner1 != address(0), "Zero owner");
        TOKEN = token;
        owners[0] = owner1;
        ownerCount = 1;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────────
    function _isOwner(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < MAX_OWNERS; i++) {
            if (owners[i] == addr) return true;
        }
        return false;
    }

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

    /// @notice APY in basis points (dynamic, based on reward rate vs total staked)
    function apyBps() external view returns (uint256) {
        if (totalStaked == 0 || rewardRate == 0) return 0;
        // APY = (rewardRate * 365 days * BPS) / totalStaked
        return rewardRate * 365 days * BPS / totalStaked;
    }

    function _distributeOwnerFee(uint256 amount) internal {
        if (amount == 0 || ownerCount == 0) return;
        uint256 share = amount / ownerCount;
        for (uint256 i = 0; i < MAX_OWNERS; i++) {
            if (owners[i] != address(0)) {
                IERC20(TOKEN).transfer(owners[i], share);
            }
        }
    }

    function _handleFee(uint256 amount, uint256 feeBps) internal returns (uint256 net) {
        if (feeBps == 0) return amount;
        uint256 fee = amount * feeBps / BPS;
        uint256 toReward = fee * FEE_TO_REWARD_BPS / BPS;
        uint256 toOwners = fee - toReward;
        // toReward stays in contract as rewards — add to rewardReserve and update rate
        rewardReserve += toReward;
        _distributeOwnerFee(toOwners);
        return amount - fee;
    }

    // ── Permit2 helper ────────────────────────────────────────────────────────────
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

    // ── User Functions ────────────────────────────────────────────────────────────

    /// @notice Stake tokens via Permit2
    function stake(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external whenNotPaused updateReward(msg.sender) {
        uint256 amount = permit.permitted.amount;
        require(amount > 0, "Zero amount");
        require(permit.permitted.token == TOKEN, "Wrong token");

        _receiveViaPermit2(permit, signature, amount);

        uint256 net = _handleFee(amount, stakeFeeBps);

        users[msg.sender].staked += net;
        if (users[msg.sender].stakedAt == 0) users[msg.sender].stakedAt = block.timestamp;
        users[msg.sender].lastClaimAt = block.timestamp;
        totalStaked += net;

        emit Staked(msg.sender, net, amount - net);
    }

    /// @notice Unstake tokens
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

        IERC20(TOKEN).transfer(msg.sender, net);
        emit Unstaked(msg.sender, net, staked - net);
    }

    /// @notice Claim accumulated rewards
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
        IERC20(TOKEN).transfer(msg.sender, net);
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

    // ── Owner Functions ────────────────────────────────────────────────────────────

    /// @notice Deposit reward tokens (no permit, owner calls directly with prior approval)
    function depositRewards(uint256 amount) external onlyOwner updateReward(address(0)) {
        require(amount > 0, "Zero amount");
        IERC20(TOKEN).transferFrom(msg.sender, address(this), amount);
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
        // Reset rewardReserve since it's now committed to rate
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

    /// @notice Emergency withdraw any ERC20 from the contract
    function emergencyWithdraw(address token, uint256 amount, address to) external onlyOwner {
        require(to != address(0), "Zero to");
        IERC20(token).transfer(to, amount);
        emit EmergencyWithdraw(token, to, amount);
    }

    // ── Views ──────────────────────────────────────────────────────────────────────

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
        return IERC20(TOKEN).balanceOf(address(this));
    }
}
