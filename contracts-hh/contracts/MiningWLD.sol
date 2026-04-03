// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title MiningWLD
 * @notice Multi-reward mining contract — users buy packages (priced in WLD).
 *         Each package has a different reward token:
 *           0 → H2O   1 → FIRE   2 → BTCH2O   3 → WLD   4 → wARS   5 → wCOP   6 → UTH2
 *         - Permanent mining: buy once, mine forever
 *         - Stack packages to increase power
 *         - Package payments go equally to 2 owners
 *         - Permit2 for World App compatibility
 *         - 2 configurable owners
 *         - Pause and emergency withdraw
 */
contract MiningWLD {
    // ── Constants ───────────────────────────────────────────────────────────────
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 public constant MAX_PACKAGES = 7;
    uint256 public constant SECONDS_PER_DAY = 86400;

    // ── Tokens ───────────────────────────────────────────────────────────────────
    address public immutable WLD_TOKEN;   // payment token
    address[7] public rewardTokens;       // one reward token per package

    // ── Owners ───────────────────────────────────────────────────────────────────
    address[2] public owners;

    // ── Packages ─────────────────────────────────────────────────────────────────
    struct Package {
        uint256 priceWLD;          // cost in WLD (18 decimals)
        uint256 dailyRewardYield;  // reward token earned per day per unit (18 decimals)
        bool active;
    }
    Package[7] public packages;

    // ── User Mining State ────────────────────────────────────────────────────────
    struct UserPackage {
        uint256 units;
        uint256 lastClaimTime;
        uint256 pendingRewards;
    }
    mapping(address => UserPackage[7]) public userPackages;

    // ── State ────────────────────────────────────────────────────────────────────
    bool public paused;

    // ── Events ───────────────────────────────────────────────────────────────────
    event PackagePurchased(address indexed user, uint256 indexed packageId, uint256 units, uint256 totalPaid);
    event RewardsClaimed(address indexed user, uint256 indexed packageId, uint256 amount, address rewardToken);
    event PackageConfigured(uint256 indexed packageId, uint256 price, uint256 dailyYield);
    event OwnerChanged(uint256 indexed index, address indexed newOwner);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);

    // ── Modifiers ─────────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owners[0] || msg.sender == owners[1], "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────────
    constructor(
        address wldToken,
        address h2oToken,
        address fireToken,
        address btch2oToken,
        address warsToken,
        address wcopToken,
        address uth2Token,
        address owner1,
        address owner2
    ) {
        require(wldToken != address(0), "Zero WLD");
        require(owner1 != address(0), "Zero owner");
        WLD_TOKEN = wldToken;

        // Reward tokens per package
        rewardTokens[0] = h2oToken;
        rewardTokens[1] = fireToken;
        rewardTokens[2] = btch2oToken;
        rewardTokens[3] = wldToken;   // Package 4 rewards in WLD
        rewardTokens[4] = warsToken;
        rewardTokens[5] = wcopToken;
        rewardTokens[6] = uth2Token;

        owners[0] = owner1;
        owners[1] = owner2 != address(0) ? owner2 : owner1;

        // Default packages
        _initPackage(0, 5e18,   10e18);   // 5 WLD  → 10 H2O/day
        _initPackage(1, 10e18,  8e18);    // 10 WLD → 8 FIRE/day
        _initPackage(2, 15e18,  5e18);    // 15 WLD → 5 BTCH2O/day
        _initPackage(3, 20e18,  6e18);    // 20 WLD → 6 WLD/day
        _initPackage(4, 30e18,  100e18);  // 30 WLD → 100 wARS/day
        _initPackage(5, 25e18,  80e18);   // 25 WLD → 80 wCOP/day
        _initPackage(6, 50e18,  12e18);   // 50 WLD → 12 UTH2/day
    }

    function _initPackage(uint256 id, uint256 price, uint256 daily) internal {
        packages[id] = Package({ priceWLD: price, dailyRewardYield: daily, active: true });
    }

    // ── Internal helpers ──────────────────────────────────────────────────────────

    function _pendingForPackage(address user, uint256 pkgId) internal view returns (uint256) {
        UserPackage storage up = userPackages[user][pkgId];
        if (up.units == 0) return up.pendingRewards;
        uint256 elapsed = block.timestamp - up.lastClaimTime;
        uint256 earned = up.units * packages[pkgId].dailyRewardYield * elapsed / SECONDS_PER_DAY;
        return up.pendingRewards + earned;
    }

    function _receiveViaPermit2(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature,
        uint256 amount
    ) internal {
        require(permit.permitted.token == WLD_TOKEN, "Wrong token");
        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            signature
        );
    }

    // ── User Functions ────────────────────────────────────────────────────────────

    /// @notice Buy mining package(s) via Permit2 (WLD payment)
    function buyPackage(
        uint256 packageId,
        uint256 units,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external whenNotPaused {
        require(packageId < MAX_PACKAGES, "Invalid package");
        require(units > 0, "Zero units");
        Package storage pkg = packages[packageId];
        require(pkg.active, "Package inactive");

        uint256 totalCost = pkg.priceWLD * units;
        require(permit.permitted.amount >= totalCost, "Insufficient permit amount");

        _receiveViaPermit2(permit, signature, totalCost);

        // Split payment equally to owners
        uint256 half = totalCost / 2;
        IERC20(WLD_TOKEN).transfer(owners[0], half);
        IERC20(WLD_TOKEN).transfer(owners[1], totalCost - half);

        // Checkpoint rewards before adding units
        UserPackage storage up = userPackages[msg.sender][packageId];
        if (up.lastClaimTime > 0 && up.units > 0) {
            up.pendingRewards = _pendingForPackage(msg.sender, packageId);
        }
        up.lastClaimTime = block.timestamp;
        up.units += units;

        emit PackagePurchased(msg.sender, packageId, units, totalCost);
    }

    /// @notice Claim rewards for a specific package
    function claimPackageRewards(uint256 packageId) external whenNotPaused {
        require(packageId < MAX_PACKAGES, "Invalid package");
        UserPackage storage up = userPackages[msg.sender][packageId];
        require(up.units > 0 || up.pendingRewards > 0, "No mining power");

        uint256 earned = _pendingForPackage(msg.sender, packageId);
        require(earned > 0, "No rewards");

        up.pendingRewards = 0;
        up.lastClaimTime = block.timestamp;

        address rewardToken = rewardTokens[packageId];
        require(IERC20(rewardToken).balanceOf(address(this)) >= earned, "Insufficient reserve");
        IERC20(rewardToken).transfer(msg.sender, earned);

        emit RewardsClaimed(msg.sender, packageId, earned, rewardToken);
    }

    /// @notice Claim all rewards across all packages
    function claimAllRewards() external whenNotPaused {
        for (uint256 i = 0; i < MAX_PACKAGES; i++) {
            UserPackage storage up = userPackages[msg.sender][i];
            if (up.units == 0 && up.pendingRewards == 0) continue;

            uint256 earned = _pendingForPackage(msg.sender, i);
            if (earned == 0) continue;

            up.pendingRewards = 0;
            up.lastClaimTime = block.timestamp;

            address rewardToken = rewardTokens[i];
            if (IERC20(rewardToken).balanceOf(address(this)) >= earned) {
                IERC20(rewardToken).transfer(msg.sender, earned);
                emit RewardsClaimed(msg.sender, i, earned, rewardToken);
            }
        }
    }

    // ── Views ──────────────────────────────────────────────────────────────────────

    function pendingPerPackage(address user) external view returns (uint256[7] memory result) {
        for (uint256 i = 0; i < MAX_PACKAGES; i++) {
            result[i] = _pendingForPackage(user, i);
        }
    }

    function getUserPackages(address user) external view returns (UserPackage[7] memory) {
        return userPackages[user];
    }

    function getAllPackages() external view returns (Package[7] memory) {
        return packages;
    }

    function getRewardTokens() external view returns (address[7] memory) {
        return rewardTokens;
    }

    /// @notice Daily yield per package for user
    function userDailyYield(address user) external view returns (uint256[7] memory daily) {
        for (uint256 i = 0; i < MAX_PACKAGES; i++) {
            daily[i] = userPackages[user][i].units * packages[i].dailyRewardYield;
        }
    }

    // ── Owner Functions ────────────────────────────────────────────────────────────

    function setPackage(uint256 id, uint256 priceWLD, uint256 dailyYield, bool active) external onlyOwner {
        require(id < MAX_PACKAGES, "Invalid id");
        packages[id] = Package({ priceWLD: priceWLD, dailyRewardYield: dailyYield, active: active });
        emit PackageConfigured(id, priceWLD, dailyYield);
    }

    function setOwner(uint256 index, address addr) external onlyOwner {
        require(index < 2, "Invalid index");
        require(addr != address(0), "Zero address");
        owners[index] = addr;
        emit OwnerChanged(index, addr);
    }

    function pause() external onlyOwner { paused = true; emit Paused(msg.sender); }
    function unpause() external onlyOwner { paused = false; emit Unpaused(msg.sender); }

    function emergencyWithdraw(address token, uint256 amount, address to) external onlyOwner {
        require(to != address(0), "Zero to");
        IERC20(token).transfer(to, amount);
        emit EmergencyWithdraw(token, to, amount);
    }
}
