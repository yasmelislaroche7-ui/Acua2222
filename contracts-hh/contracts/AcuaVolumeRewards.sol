// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AcuaVolumeRewards
 * @notice Monthly UTH2 rewards based on USDC swap volume.
 *         Volume is recorded by the authorised AcuaSwapRouter.
 *         Tiers and rewards are fully configurable by owner.
 *
 * Period: 30-day rolling windows (block.timestamp / PERIOD).
 * Each tier is claimable once per period once the threshold is reached.
 */
contract AcuaVolumeRewards {

    // ─── Constants ────────────────────────────────────────────────────────────
    address public constant UTH2   = 0x9eA8653640E22A5b69887985BB75d496dc97022a;
    uint256 public constant PERIOD = 30 days;
    uint256 public constant MAX_TIERS = 8;

    // ─── Config ───────────────────────────────────────────────────────────────
    address public owner;
    address public swapRouter;
    uint256 public numTiers = 4;

    /// @notice Tier thresholds in USDC-6-decimals (1e6 = 1 USDC)
    uint256[8] public tierThresholds;
    /// @notice UTH2 reward per tier in 18-decimals
    uint256[8] public tierRewards;

    // ─── State ────────────────────────────────────────────────────────────────
    mapping(address => mapping(uint256 => uint256)) public volume;
    mapping(address => mapping(uint256 => mapping(uint256 => bool))) public claimed;
    uint256 public totalDistributed;

    // ─── Events ───────────────────────────────────────────────────────────────
    event VolumeRecorded(address indexed user, uint256 indexed monthId, uint256 added, uint256 total);
    event RewardClaimed(address indexed user, uint256 indexed monthId, uint256 uth2Amount);
    event Funded(address indexed by, uint256 amount);
    event TiersUpdated(uint256 numTiers);

    modifier onlyOwner()  { require(msg.sender == owner,       "Not owner");       _; }
    modifier onlyRouter() { require(msg.sender == swapRouter || msg.sender == owner, "Not authorized"); _; }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _swapRouter) {
        owner      = msg.sender;
        swapRouter = _swapRouter;

        // Default 4-tier table
        tierThresholds[0] = 1_000_000;       // 1 USDC
        tierThresholds[1] = 10_000_000;      // 10 USDC
        tierThresholds[2] = 100_000_000;     // 100 USDC
        tierThresholds[3] = 1_000_000_000;   // 1000 USDC

        tierRewards[0] = 0.0001 ether;
        tierRewards[1] = 0.001  ether;
        tierRewards[2] = 0.01   ether;
        tierRewards[3] = 0.1    ether;
    }

    // ─── Period helpers ───────────────────────────────────────────────────────

    function currentMonth() public view returns (uint256) {
        return block.timestamp / PERIOD;
    }

    /**
     * @notice Returns timing info for the current period.
     * @return monthId         Current 30-day period index
     * @return periodStart     Unix timestamp when current period began
     * @return periodEnd       Unix timestamp when current period ends
     * @return secondsLeft     Seconds until next period reset
     */
    function getPeriodInfo() external view returns (
        uint256 monthId,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 secondsLeft
    ) {
        monthId     = currentMonth();
        periodStart = monthId * PERIOD;
        periodEnd   = (monthId + 1) * PERIOD;
        secondsLeft = periodEnd > block.timestamp ? periodEnd - block.timestamp : 0;
    }

    /**
     * @notice Returns all active tiers in one call.
     * @return thresholds  Array of USDC-6-dec threshold amounts (length = numTiers)
     * @return rewards     Array of UTH2-18-dec reward amounts (length = numTiers)
     */
    function getAllTiers() external view returns (
        uint256[] memory thresholds,
        uint256[] memory rewards
    ) {
        thresholds = new uint256[](numTiers);
        rewards    = new uint256[](numTiers);
        for (uint256 i; i < numTiers; ++i) {
            thresholds[i] = tierThresholds[i];
            rewards[i]    = tierRewards[i];
        }
    }

    // ─── Record swap volume ───────────────────────────────────────────────────

    function recordSwap(address user, uint256 usdcAmount) external onlyRouter {
        uint256 monthId = currentMonth();
        volume[user][monthId] += usdcAmount;
        emit VolumeRecorded(user, monthId, usdcAmount, volume[user][monthId]);
    }

    // ─── Claim rewards ────────────────────────────────────────────────────────

    function claimRewards(uint256 monthId) external {
        address user    = msg.sender;
        uint256 userVol = volume[user][monthId];
        require(userVol > 0, "No volume this month");

        uint256 totalUTH2;
        for (uint256 i; i < numTiers; ++i) {
            if (userVol >= tierThresholds[i] && !claimed[user][monthId][i]) {
                claimed[user][monthId][i] = true;
                totalUTH2 += tierRewards[i];
            }
        }

        require(totalUTH2 > 0, "All tiers claimed or not reached");

        uint256 available = IERC20(UTH2).balanceOf(address(this));
        require(available >= totalUTH2, "Insufficient UTH2 - wait for restock");

        totalDistributed += totalUTH2;
        IERC20(UTH2).transfer(user, totalUTH2);
        emit RewardClaimed(user, monthId, totalUTH2);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    /**
     * @notice Pending rewards for user at given monthId.
     * @return uth2Amount   Claimable UTH2
     * @return userVolume   Accumulated USDC-6-dec volume
     * @return tierStatus   0=not reached, 1=claimable, 2=already claimed (length = numTiers)
     */
    function pendingRewards(address user, uint256 monthId)
        external view
        returns (uint256 uth2Amount, uint256 userVolume, uint8[] memory tierStatus)
    {
        userVolume = volume[user][monthId];
        tierStatus = new uint8[](numTiers);
        for (uint256 i; i < numTiers; ++i) {
            if (claimed[user][monthId][i]) {
                tierStatus[i] = 2;
            } else if (userVolume >= tierThresholds[i]) {
                tierStatus[i] = 1;
                uth2Amount += tierRewards[i];
            }
        }
    }

    function pendingNow(address user)
        external view
        returns (uint256 uth2Amount, uint256 userVolume, uint8[] memory tierStatus)
    {
        return this.pendingRewards(user, currentMonth());
    }

    // ─── Fund UTH2 ────────────────────────────────────────────────────────────

    function fundUTH2(uint256 amount) external {
        require(amount > 0, "Zero amount");
        IERC20(UTH2).transferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setSwapRouter(address _router) external onlyOwner {
        swapRouter = _router;
    }

    /**
     * @notice Update tier configuration.
     * @param n           Number of active tiers (1-8)
     * @param thresholds  USDC-6-dec thresholds (must be ascending)
     * @param rewards     UTH2-18-dec rewards per tier
     */
    function setTiers(
        uint256 n,
        uint256[8] calldata thresholds,
        uint256[8] calldata rewards
    ) external onlyOwner {
        require(n >= 1 && n <= MAX_TIERS, "Bad tier count");
        for (uint256 i = 1; i < n; ++i) {
            require(thresholds[i] > thresholds[i-1], "Thresholds not ascending");
        }
        numTiers = n;
        for (uint256 i; i < MAX_TIERS; ++i) {
            tierThresholds[i] = thresholds[i];
            tierRewards[i]    = rewards[i];
        }
        emit TiersUpdated(n);
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero addr");
        owner = newOwner;
    }

    function emergencyWithdraw(uint256 amount) external onlyOwner {
        IERC20(UTH2).transfer(owner, amount);
    }

    function adminRecordVolume(address user, uint256 usdcAmount) external onlyOwner {
        uint256 monthId = currentMonth();
        volume[user][monthId] += usdcAmount;
        emit VolumeRecorded(user, monthId, usdcAmount, volume[user][monthId]);
    }
}
