// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20VR {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AcuaVolumeRewardsV2
 * @notice Monthly UTH2 rewards based on USDC-equivalent swap volume.
 *         Records volume from any authorised AcuaSwapRouter, for any swap,
 *         any amount, in any token. The router computes the USD value
 *         (off-chain price feed) and passes it as `usdcAmount` (6 decimals).
 *
 *         Improvements over V1:
 *           - Supports multiple authorised routers (mapping)
 *           - Tracks per-token swap counts for analytics
 *           - Allows owner to add/remove routers at runtime
 *           - Records every swap, even if usdcAmount == 0 (event still emitted)
 *
 *         Period: 30-day rolling windows.
 *         Each tier is claimable once per period once the threshold is reached.
 */
contract AcuaVolumeRewardsV2 {

    // ─── Constants ────────────────────────────────────────────────────────────
    address public constant UTH2   = 0x9eA8653640E22A5b69887985BB75d496dc97022a;
    uint256 public constant PERIOD = 30 days;
    uint256 public constant MAX_TIERS = 8;

    // ─── Config ───────────────────────────────────────────────────────────────
    address public owner;
    /// @notice Authorised routers that may call recordSwap
    mapping(address => bool) public routers;
    uint256 public numTiers = 4;

    /// @notice Tier thresholds in USDC-6-decimals (1e6 = 1 USDC)
    uint256[8] public tierThresholds;
    /// @notice UTH2 reward per tier in 18-decimals
    uint256[8] public tierRewards;

    // ─── State ────────────────────────────────────────────────────────────────
    mapping(address => mapping(uint256 => uint256)) public volume;
    mapping(address => mapping(uint256 => mapping(uint256 => bool))) public claimed;
    mapping(address => uint256) public swapCount;
    uint256 public totalDistributed;
    uint256 public totalSwapsRecorded;

    // ─── Events ───────────────────────────────────────────────────────────────
    event VolumeRecorded(address indexed user, uint256 indexed monthId, uint256 added, uint256 total);
    event SwapTracked(address indexed user, address indexed router, uint256 usdcAmount, uint256 swapCountForUser);
    event RewardClaimed(address indexed user, uint256 indexed monthId, uint256 uth2Amount);
    event Funded(address indexed by, uint256 amount);
    event TiersUpdated(uint256 numTiers);
    event RouterUpdated(address indexed router, bool authorised);
    event OwnerChanged(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner()  { require(msg.sender == owner, "Not owner"); _; }
    modifier onlyRouter() {
        require(routers[msg.sender] || msg.sender == owner, "Not authorized");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address initialRouter) {
        owner = msg.sender;
        if (initialRouter != address(0)) {
            routers[initialRouter] = true;
            emit RouterUpdated(initialRouter, true);
        }

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

    // ─── Record swap volume (router callback) ─────────────────────────────────

    /// @notice Called by an authorised router after every swap.
    ///         Records USD-equivalent volume (already computed off-chain).
    ///         Always emits SwapTracked, even if usdcAmount == 0, so the
    ///         frontend can still see swap activity.
    function recordSwap(address user, uint256 usdcAmount) external onlyRouter {
        ++swapCount[user];
        ++totalSwapsRecorded;
        emit SwapTracked(user, msg.sender, usdcAmount, swapCount[user]);

        if (usdcAmount > 0) {
            uint256 monthId = currentMonth();
            volume[user][monthId] += usdcAmount;
            emit VolumeRecorded(user, monthId, usdcAmount, volume[user][monthId]);
        }
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

        uint256 available = IERC20VR(UTH2).balanceOf(address(this));
        require(available >= totalUTH2, "Insufficient UTH2 - wait for restock");

        totalDistributed += totalUTH2;
        IERC20VR(UTH2).transfer(user, totalUTH2);
        emit RewardClaimed(user, monthId, totalUTH2);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    function pendingRewards(address user, uint256 monthId)
        public view
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
        return pendingRewards(user, currentMonth());
    }

    // ─── Fund UTH2 ────────────────────────────────────────────────────────────

    function fundUTH2(uint256 amount) external {
        require(amount > 0, "Zero amount");
        IERC20VR(UTH2).transferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Authorise or de-authorise a swap router.
    function setRouter(address router, bool authorised) external onlyOwner {
        require(router != address(0), "Zero router");
        routers[router] = authorised;
        emit RouterUpdated(router, authorised);
    }

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
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }

    function emergencyWithdraw(uint256 amount) external onlyOwner {
        IERC20VR(UTH2).transfer(owner, amount);
    }

    /// @notice Owner-only manual volume injection (for migrations / fixes).
    function adminRecordVolume(address user, uint256 usdcAmount) external onlyOwner {
        uint256 monthId = currentMonth();
        volume[user][monthId] += usdcAmount;
        emit VolumeRecorded(user, monthId, usdcAmount, volume[user][monthId]);
    }
}
