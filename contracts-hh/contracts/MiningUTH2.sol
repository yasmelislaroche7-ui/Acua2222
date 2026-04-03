// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title MiningUTH2
 * @notice H2O mining contract — users buy packages (priced in UTH2) to permanently mine H2O.
 *         - 7 packages, each with a UTH2 price and H2O daily yield
 *         - Permanent mining: buy once, mine forever
 *         - Stack packages to increase mining power
 *         - Package payments go equally to 2 owners
 *         - Permit2 for World App compatibility
 *         - 2 configurable owners
 *         - Pause and emergency withdraw
 */
contract MiningUTH2 {
    // ── Constants ───────────────────────────────────────────────────────────────
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 public constant MAX_PACKAGES = 7;
    uint256 public constant SECONDS_PER_DAY = 86400;

    // ── Tokens ───────────────────────────────────────────────────────────────────
    address public immutable UTH2_TOKEN;  // payment token
    address public immutable H2O_TOKEN;   // reward token

    // ── Owners ───────────────────────────────────────────────────────────────────
    address[2] public owners;

    // ── Packages ─────────────────────────────────────────────────────────────────
    struct Package {
        uint256 priceUTH2;        // cost in UTH2 (18 decimals)
        uint256 dailyH2OYield;    // H2O earned per day per unit (18 decimals)
        bool active;
    }
    Package[7] public packages;

    // ── User Mining State ────────────────────────────────────────────────────────
    struct UserPackage {
        uint256 units;            // number of times this package was purchased
        uint256 lastClaimTime;    // last time rewards were claimed
        uint256 pendingRewards;   // unclaimed rewards
    }
    mapping(address => UserPackage[7]) public userPackages;

    // ── State ────────────────────────────────────────────────────────────────────
    bool public paused;

    // ── Events ───────────────────────────────────────────────────────────────────
    event PackagePurchased(address indexed user, uint256 indexed packageId, uint256 units, uint256 totalPaid);
    event RewardsClaimed(address indexed user, uint256 amount);
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
    constructor(address uth2Token, address h2oToken, address owner1, address owner2) {
        require(uth2Token != address(0) && h2oToken != address(0), "Zero token");
        require(owner1 != address(0), "Zero owner");
        UTH2_TOKEN = uth2Token;
        H2O_TOKEN = h2oToken;
        owners[0] = owner1;
        owners[1] = owner2 != address(0) ? owner2 : owner1;

        // Default packages (owner can update)
        _initPackage(0, 10e18,  10e18);   // 10 UTH2 → 10 H2O/day
        _initPackage(1, 25e18,  28e18);   // 25 UTH2 → 28 H2O/day
        _initPackage(2, 50e18,  60e18);   // 50 UTH2 → 60 H2O/day
        _initPackage(3, 100e18, 130e18);  // 100 UTH2 → 130 H2O/day
        _initPackage(4, 250e18, 350e18);  // 250 UTH2 → 350 H2O/day
        _initPackage(5, 500e18, 750e18);  // 500 UTH2 → 750 H2O/day
        _initPackage(6, 1000e18,1600e18); // 1000 UTH2 → 1600 H2O/day
    }

    function _initPackage(uint256 id, uint256 price, uint256 daily) internal {
        packages[id] = Package({ priceUTH2: price, dailyH2OYield: daily, active: true });
    }

    // ── Internal helpers ──────────────────────────────────────────────────────────

    function _pendingForPackage(address user, uint256 pkgId) internal view returns (uint256) {
        UserPackage storage up = userPackages[user][pkgId];
        if (up.units == 0) return up.pendingRewards;
        uint256 elapsed = block.timestamp - up.lastClaimTime;
        uint256 earned = up.units * packages[pkgId].dailyH2OYield * elapsed / SECONDS_PER_DAY;
        return up.pendingRewards + earned;
    }

    function _totalPending(address user) internal view returns (uint256 total) {
        for (uint256 i = 0; i < MAX_PACKAGES; i++) {
            total += _pendingForPackage(user, i);
        }
    }

    function _updateUserPackage(address user, uint256 pkgId) internal {
        UserPackage storage up = userPackages[user][pkgId];
        if (up.lastClaimTime > 0 && up.units > 0) {
            up.pendingRewards = _pendingForPackage(user, pkgId);
        }
        up.lastClaimTime = block.timestamp;
    }

    function _receiveViaPermit2(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature,
        uint256 amount,
        address expectedToken
    ) internal {
        require(permit.permitted.token == expectedToken, "Wrong token");
        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            signature
        );
    }

    // ── User Functions ────────────────────────────────────────────────────────────

    /// @notice Buy mining package(s) via Permit2 (UTH2 payment)
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

        uint256 totalCost = pkg.priceUTH2 * units;
        require(permit.permitted.amount >= totalCost, "Insufficient permit amount");

        _receiveViaPermit2(permit, signature, totalCost, UTH2_TOKEN);

        // Split payment equally to owners
        uint256 half = totalCost / 2;
        IERC20(UTH2_TOKEN).transfer(owners[0], half);
        IERC20(UTH2_TOKEN).transfer(owners[1], totalCost - half);

        // Update user mining state (checkpoint rewards before adding units)
        _updateUserPackage(msg.sender, packageId);
        userPackages[msg.sender][packageId].units += units;
        if (userPackages[msg.sender][packageId].lastClaimTime == 0) {
            userPackages[msg.sender][packageId].lastClaimTime = block.timestamp;
        }

        emit PackagePurchased(msg.sender, packageId, units, totalCost);
    }

    /// @notice Claim all accumulated H2O rewards
    function claimRewards() external whenNotPaused {
        uint256 total = 0;
        for (uint256 i = 0; i < MAX_PACKAGES; i++) {
            UserPackage storage up = userPackages[msg.sender][i];
            if (up.units > 0 || up.pendingRewards > 0) {
                uint256 earned = _pendingForPackage(msg.sender, i);
                up.pendingRewards = 0;
                up.lastClaimTime = block.timestamp;
                total += earned;
            }
        }
        require(total > 0, "No rewards");
        require(IERC20(H2O_TOKEN).balanceOf(address(this)) >= total, "Insufficient H2O reserve");
        IERC20(H2O_TOKEN).transfer(msg.sender, total);
        emit RewardsClaimed(msg.sender, total);
    }

    // ── Views ──────────────────────────────────────────────────────────────────────

    function pendingRewards(address user) external view returns (uint256) {
        return _totalPending(user);
    }

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

    /// @notice Daily yield for user across all packages
    function userDailyYield(address user) external view returns (uint256 daily) {
        for (uint256 i = 0; i < MAX_PACKAGES; i++) {
            daily += userPackages[user][i].units * packages[i].dailyH2OYield;
        }
    }

    // ── Owner Functions ────────────────────────────────────────────────────────────

    function setPackage(uint256 id, uint256 priceUTH2, uint256 dailyYield, bool active) external onlyOwner {
        require(id < MAX_PACKAGES, "Invalid id");
        packages[id] = Package({ priceUTH2: priceUTH2, dailyH2OYield: dailyYield, active: active });
        emit PackageConfigured(id, priceUTH2, dailyYield);
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
