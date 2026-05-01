// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ReferralSystemV2
 * @notice New referral system for H2O 2.0 staking:
 *
 *   USER-FACING:  "Invite friends and earn 10% of their earnings permanently."
 *
 *   ACTUAL MECHANICS (configurable, hidden from users):
 *   When a user claims rewards, a `totalReferralBps` (default 10%) is deducted:
 *     - `userShareBps` (default 50% of 10% = 5%) → split between referrer & referee
 *       based on how many connected wallets are in the pair at claim time.
 *     - `ownerShareBps` (the remaining 50% of 10% = 5%) → silently forwarded to
 *       the FundManager / owner wallets (configured via ownerFeeWallet).
 *
 *   If BOTH wallets are connected (active stakers): each gets half of userShare.
 *   If only ONE is connected: that wallet gets the full userShare.
 *   "Connected" = has a non-zero stakedBalance on the staking contract.
 *
 *   Registration:
 *   - User must call `register(referrerAddress)` or the staking contract calls
 *     `notifyStake(user, amount)` with a referrer already set off-chain.
 *   - Links are permanent and cannot be changed.
 *
 *   The staking contract calls:
 *     - `notifyStake(user, amount)` on deposit (informational).
 *     - `notifyClaim(user, gross)` on claim — returns the total tokens to deduct.
 *       This contract then transfers the deducted amounts from its own balance
 *       (funded by the staking contract before calling, or via direct transfer).
 */

interface IERC20Ref {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IStakingForRef {
    function stakedBalance(address user) external view returns (uint256);
}

contract ReferralSystemV2 {

    // ─── Constants ────────────────────────────────────────────────────────────
    uint256 public constant MAX_BPS    = 10_000;
    uint256 public constant MAX_OWNERS = 5;

    // ─── Config ───────────────────────────────────────────────────────────────
    address public token;
    address public stakingContract;

    /// Total % deducted from each claim for the referral system.
    uint256 public totalReferralBps = 1_000;  // 10%

    /// Of the totalReferral, how much goes to actual referrer/referee (rest → owner).
    /// Default 500 bps = 50% of totalReferralBps → user portion = 5% of claim.
    uint256 public userSplitBps = 5_000;      // 50% of total referral → users

    /// Wallet that receives the owner's hidden share.
    address public ownerFeeWallet;

    // ─── Owner Management ─────────────────────────────────────────────────────
    address[] public owners;

    bool public paused;

    // ─── Referral State ───────────────────────────────────────────────────────
    /// user → their referrer
    mapping(address => address) public referredBy;

    /// referrer → total earned (for stats)
    mapping(address => uint256) public totalEarned;

    /// referrer → all users they referred
    mapping(address => address[]) private _referrals;

    // ─── Events ───────────────────────────────────────────────────────────────
    event Registered(address indexed user, address indexed referrer);
    event ReferralPaid(address indexed payer, address indexed referrer, address indexed referee, uint256 referrerAmt, uint256 refereeAmt);
    event OwnerFeePaid(address indexed to, uint256 amount);
    event ConfigUpdated(uint256 totalBps, uint256 userSplitBps);
    event StakingContractSet(address indexed addr);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event Paused(bool paused);

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(_isOwner(msg.sender), "Referral: not owner");
        _;
    }

    modifier onlyStaking() {
        require(msg.sender == stakingContract, "Referral: only staking");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Referral: paused");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _token, address _initialOwner, address _ownerFeeWallet) {
        require(_token != address(0), "zero token");
        require(_initialOwner != address(0), "zero owner");
        token = _token;
        owners.push(_initialOwner);
        ownerFeeWallet = _ownerFeeWallet != address(0) ? _ownerFeeWallet : _initialOwner;
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    /**
     * @notice Register a referrer for the caller.
     *         Can only be done once. Referrer cannot refer themselves.
     */
    function register(address referrer) external whenNotPaused {
        require(referrer != address(0), "zero referrer");
        require(referrer != msg.sender, "self-referral");
        require(referredBy[msg.sender] == address(0), "already registered");
        referredBy[msg.sender] = referrer;
        _referrals[referrer].push(msg.sender);
        emit Registered(msg.sender, referrer);
    }

    /**
     * @notice Called by the staking contract when a new user stakes.
     *         If the user is not yet registered and a referrer was passed
     *         via a ref link (stored off-chain and provided here), register them.
     *         Safe to call even if already registered — simply a no-op.
     */
    function notifyStake(address user, uint256 /*amount*/) external onlyStaking whenNotPaused {
        // Staking contract passes address(0) for referrer if none known.
        // Registration is done by the user directly via register().
        // This hook is informational / for future extensions.
    }

    /**
     * @notice Called by the staking contract when `user` claims rewards.
     * @param user        The claimer.
     * @param rewardAmount Gross reward amount before any referral deduction.
     * @return deducted   Total tokens deducted from user's reward.
     *
     * The staking contract MUST transfer `deducted` tokens to this contract
     * before (or after) calling this function, OR this contract must hold
     * sufficient balance (owner funds it directly).
     *
     * In the recommended flow:
     *   1. Staking contract computes gross reward.
     *   2. Staking contract calls notifyClaim — this function pays referrer/referee/owner.
     *   3. Staking contract sends (gross - deducted) to user.
     *
     * This contract pulls its share via transferFrom from the staking contract.
     */
    function notifyClaim(address user, uint256 rewardAmount)
        external
        onlyStaking
        whenNotPaused
        returns (uint256 deducted)
    {
        address referrer = referredBy[user];
        if (referrer == address(0)) return 0;  // no referrer → nothing deducted

        uint256 totalDeduct = (rewardAmount * totalReferralBps) / MAX_BPS;
        if (totalDeduct == 0) return 0;

        uint256 userTotal  = (totalDeduct * userSplitBps)  / MAX_BPS;
        uint256 ownerTotal = totalDeduct - userTotal;

        // Pull tokens from staking contract
        require(
            IERC20Ref(token).transferFrom(stakingContract, address(this), totalDeduct),
            "Referral: pull failed"
        );

        // Determine which wallets are "connected" (have active stake)
        bool referrerActive = stakingContract != address(0) &&
            IStakingForRef(stakingContract).stakedBalance(referrer) > 0;
        bool refereeActive  = stakingContract != address(0) &&
            IStakingForRef(stakingContract).stakedBalance(user) > 0;

        uint256 toReferrer;
        uint256 toReferee;

        if (referrerActive && refereeActive) {
            // Both connected → split equally
            toReferrer = userTotal / 2;
            toReferee  = userTotal - toReferrer;
        } else if (referrerActive) {
            toReferrer = userTotal;
        } else if (refereeActive) {
            toReferee = userTotal;
        } else {
            // Neither active → their share goes to owner (dust)
            ownerTotal += userTotal;
        }

        // Pay referrer
        if (toReferrer > 0) {
            IERC20Ref(token).transfer(referrer, toReferrer);
            totalEarned[referrer] += toReferrer;
        }

        // Pay referee (the claimer — bonus on top of their base reward)
        if (toReferee > 0) {
            IERC20Ref(token).transfer(user, toReferee);
        }

        // Pay hidden owner share
        if (ownerTotal > 0 && ownerFeeWallet != address(0)) {
            IERC20Ref(token).transfer(ownerFeeWallet, ownerTotal);
            emit OwnerFeePaid(ownerFeeWallet, ownerTotal);
        }

        emit ReferralPaid(user, referrer, user, toReferrer, toReferee);
        return totalDeduct;
    }

    // ─── Config ───────────────────────────────────────────────────────────────

    /**
     * @param _totalBps    Total % deducted from claims (e.g. 1000 = 10%).
     * @param _userSplitBps Of that total, what % goes to referrer+referee (e.g. 5000 = 50%).
     *                     The other 50% goes silently to ownerFeeWallet.
     */
    function setConfig(uint256 _totalBps, uint256 _userSplitBps) external onlyOwner {
        require(_totalBps <= 3_000, "max 30% referral");
        require(_userSplitBps <= MAX_BPS, "exceeds 100%");
        totalReferralBps = _totalBps;
        userSplitBps     = _userSplitBps;
        emit ConfigUpdated(_totalBps, _userSplitBps);
    }

    function setOwnerFeeWallet(address wallet) external onlyOwner {
        require(wallet != address(0), "zero address");
        ownerFeeWallet = wallet;
    }

    function setStakingContract(address _staking) external onlyOwner {
        stakingContract = _staking;
        emit StakingContractSet(_staking);
    }

    function disconnectStaking() external onlyOwner {
        stakingContract = address(0);
    }

    // ─── Owner Management ─────────────────────────────────────────────────────

    function addOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        require(!_isOwner(newOwner), "already owner");
        require(owners.length < MAX_OWNERS, "max owners");
        owners.push(newOwner);
        emit OwnerAdded(newOwner);
    }

    function removeOwner(address ownerAddr) external onlyOwner {
        require(owners.length > 1, "need at least 1 owner");
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == ownerAddr) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                emit OwnerRemoved(ownerAddr);
                return;
            }
        }
        revert("not found");
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    // ─── Pause / Emergency ────────────────────────────────────────────────────

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        IERC20Ref(token).transfer(to, amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getReferrals(address referrer) external view returns (address[] memory) {
        return _referrals[referrer];
    }

    function getReferralInfo(address user) external view returns (
        address referrer,
        uint256 referrerEarned
    ) {
        referrer = referredBy[user];
        referrerEarned = totalEarned[referrer];
    }

    function contractBalance() external view returns (uint256) {
        return IERC20Ref(token).balanceOf(address(this));
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _isOwner(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == addr) return true;
        }
        return false;
    }
}
