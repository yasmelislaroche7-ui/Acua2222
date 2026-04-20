// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AcuaVolumeRewards
 * @notice Tracks monthly swap volume per user and distributes UTH2 rewards.
 *
 * Volume is recorded by the authorized swap router in USDC units (6 decimals).
 * Each calendar month (30-day period) users accumulate volume and can claim UTH2
 * based on the highest tier they reached. Resets automatically each period.
 *
 * Tier table (USDC in, UTH2 out — each tier claimable once per month):
 *   Tier 0:    >= 1 USDC   → 0.0001 UTH2
 *   Tier 1:    >= 10 USDC  → 0.001  UTH2
 *   Tier 2:    >= 100 USDC → 0.01   UTH2
 *   Tier 3:    >= 1000 USDC→ 0.1    UTH2
 */
contract AcuaVolumeRewards {

    // ─── Constants ────────────────────────────────────────────────────────────
    address public constant UTH2 = 0x9eA8653640E22A5b69887985BB75d496dc97022a;

    /// @notice Period duration: ~30 days
    uint256 public constant PERIOD = 30 days;

    // ─── Config ───────────────────────────────────────────────────────────────
    address public owner;
    address public swapRouter; // only authorized caller of recordSwap

    /// @notice Tier thresholds in USDC-6-decimals (1e6 = 1 USDC)
    uint256[4] public tierThresholds = [
        1_000_000,       // 1 USDC
        10_000_000,      // 10 USDC
        100_000_000,     // 100 USDC
        1_000_000_000    // 1000 USDC
    ];

    /// @notice UTH2 reward per tier (18 decimals)
    uint256[4] public tierRewards = [
        0.0001 ether,   // 0.0001 UTH2
        0.001  ether,   // 0.001  UTH2
        0.01   ether,   // 0.01   UTH2
        0.1    ether    // 0.1    UTH2
    ];

    // ─── State ────────────────────────────────────────────────────────────────
    /// @notice volume[user][monthId] — USDC-6-dec units accumulated this period
    mapping(address => mapping(uint256 => uint256)) public volume;

    /// @notice claimed[user][monthId][tier] — whether user already claimed this tier
    mapping(address => mapping(uint256 => mapping(uint256 => bool))) public claimed;

    /// @notice Total UTH2 distributed so far
    uint256 public totalDistributed;

    // ─── Events ───────────────────────────────────────────────────────────────
    event VolumeRecorded(address indexed user, uint256 indexed monthId, uint256 added, uint256 total);
    event RewardClaimed(address indexed user, uint256 indexed monthId, uint256 uth2Amount);
    event Funded(address indexed by, uint256 amount);

    modifier onlyOwner()  { require(msg.sender == owner,       "Not owner");      _; }
    modifier onlyRouter() { require(msg.sender == swapRouter || msg.sender == owner, "Not authorized"); _; }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _swapRouter) {
        owner      = msg.sender;
        swapRouter = _swapRouter;
    }

    // ─── Period helpers ───────────────────────────────────────────────────────

    /// @notice Current 30-day period index
    function currentMonth() public view returns (uint256) {
        return block.timestamp / PERIOD;
    }

    // ─── Record swap volume (called by AcuaSwapRouter) ────────────────────────

    function recordSwap(address user, uint256 usdcAmount) external onlyRouter {
        uint256 monthId = currentMonth();
        volume[user][monthId] += usdcAmount;
        emit VolumeRecorded(user, monthId, usdcAmount, volume[user][monthId]);
    }

    // ─── Claim rewards ────────────────────────────────────────────────────────

    /**
     * @notice Claim all unlocked tier rewards for the given month.
     *         Pass currentMonth() for current period, or a past month to claim retroactively.
     */
    function claimRewards(uint256 monthId) external {
        address user    = msg.sender;
        uint256 userVol = volume[user][monthId];
        require(userVol > 0, "No volume this month");

        uint256 totalUTH2;
        for (uint256 i; i < 4; ++i) {
            if (userVol >= tierThresholds[i] && !claimed[user][monthId][i]) {
                claimed[user][monthId][i] = true;
                totalUTH2 += tierRewards[i];
            }
        }

        require(totalUTH2 > 0, "All tiers already claimed or not reached");

        uint256 available = IERC20(UTH2).balanceOf(address(this));
        require(available >= totalUTH2, "Insufficient UTH2 - wait for restock");

        totalDistributed += totalUTH2;
        IERC20(UTH2).transfer(user, totalUTH2);
        emit RewardClaimed(user, monthId, totalUTH2);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    /**
     * @notice Returns claimable UTH2, volume, and per-tier status for a given user+month.
     * @return uth2Amount   Total UTH2 claimable right now
     * @return userVolume   USDC-6-dec volume accumulated
     * @return tierStatus   Per-tier: 0=not reached, 1=claimable, 2=already claimed
     */
    function pendingRewards(address user, uint256 monthId)
        external view
        returns (uint256 uth2Amount, uint256 userVolume, uint8[4] memory tierStatus)
    {
        userVolume = volume[user][monthId];
        for (uint256 i; i < 4; ++i) {
            if (claimed[user][monthId][i]) {
                tierStatus[i] = 2;
            } else if (userVolume >= tierThresholds[i]) {
                tierStatus[i] = 1;
                uth2Amount += tierRewards[i];
            }
        }
    }

    /// @notice Convenience — returns pending for current month
    function pendingNow(address user)
        external view
        returns (uint256 uth2Amount, uint256 userVolume, uint8[4] memory tierStatus)
    {
        return this.pendingRewards(user, currentMonth());
    }

    // ─── Fund UTH2 ───────────────────────────────────────────────────────────

    /**
     * @notice Owner calls this after `UTH2.approve(AcuaVolumeRewards, amount)`.
     */
    function fundUTH2(uint256 amount) external {
        require(amount > 0, "Zero amount");
        IERC20(UTH2).transferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setSwapRouter(address _router) external onlyOwner {
        swapRouter = _router;
    }

    function setTiers(uint256[4] calldata thresholds, uint256[4] calldata rewards) external onlyOwner {
        tierThresholds = thresholds;
        tierRewards    = rewards;
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero addr");
        owner = newOwner;
    }

    function emergencyWithdraw(uint256 amount) external onlyOwner {
        IERC20(UTH2).transfer(owner, amount);
    }

    /// @notice Allow owner to manually record volume (for testing or corrections)
    function adminRecordVolume(address user, uint256 usdcAmount) external onlyOwner {
        uint256 monthId = currentMonth();
        volume[user][monthId] += usdcAmount;
        emit VolumeRecorded(user, monthId, usdcAmount, volume[user][monthId]);
    }
}
