// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CommissionManager
 * @notice Charges a flat fee (default: 1 H2O) on each registered transaction
 *         and distributes it across the ecosystem:
 *           - poolShareBps   → deposited into the staking reward pool
 *           - ownerShareBps  → split equally among owners
 *           - remainder      → kept in contract buffer
 *
 *   Any contract in the ecosystem can call `chargeCommission(user)` to pull
 *   1 H2O (or configured amount) from the user and distribute it.
 *   The user must have previously approved this contract for the token.
 *
 *   Owners can:
 *   - Change the flat commission amount
 *   - Change the distribution percentages
 *   - Connect / disconnect contracts that are authorized to charge commissions
 *   - Add / remove owners
 *   - Emergency pause + withdraw
 */

interface IERC20Comm {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IRewardPool {
    function depositRewards(uint256 amount) external;
}

contract CommissionManager {

    // ─── Constants ────────────────────────────────────────────────────────────
    uint256 public constant MAX_BPS       = 10_000;
    uint256 public constant MAX_OWNERS    = 5;
    uint256 public constant MAX_CONTRACTS = 20;

    // ─── Config ───────────────────────────────────────────────────────────────
    address public token;

    /// Flat commission per transaction (default 1 H2O = 1e18 if 18 decimals).
    uint256 public commissionAmount = 1e18;

    /// Basis points of the commission that go to the staking reward pool.
    uint256 public poolShareBps = 6_000;    // 60%
    /// Basis points that go to owner wallets.
    uint256 public ownerShareBps = 3_000;   // 30%
    /// Remainder (10%) stays in contract as buffer.

    /// Staking contract address that receives pool share via depositRewards().
    address public rewardPoolContract;

    // ─── Owner & Access ───────────────────────────────────────────────────────
    address[] public owners;

    /// Only these contracts are authorized to call chargeCommission().
    mapping(address => bool) public authorizedCallers;
    address[] public callerList;

    bool public paused;

    // ─── Stats ────────────────────────────────────────────────────────────────
    uint256 public totalCollected;
    uint256 public totalTransactions;

    // ─── Events ───────────────────────────────────────────────────────────────
    event CommissionCharged(address indexed user, address indexed caller, uint256 amount);
    event Distributed(uint256 toPool, uint256 toOwners, uint256 retained);
    event CallerAuthorized(address indexed caller);
    event CallerRevoked(address indexed caller);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ConfigUpdated(uint256 commissionAmount, uint256 poolShareBps, uint256 ownerShareBps);
    event RewardPoolSet(address indexed pool);
    event Paused(bool paused);

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(_isOwner(msg.sender), "CommissionManager: not owner");
        _;
    }

    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender] || _isOwner(msg.sender), "CommissionManager: unauthorized");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "CommissionManager: paused");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _token, address _initialOwner) {
        require(_token != address(0), "zero token");
        require(_initialOwner != address(0), "zero owner");
        token = _token;
        owners.push(_initialOwner);
    }

    // ─── Commission ───────────────────────────────────────────────────────────

    /**
     * @notice Charge `commissionAmount` tokens from `user`.
     *         Called by authorized ecosystem contracts on behalf of a user.
     *         User must have approved this contract for at least `commissionAmount`.
     */
    function chargeCommission(address user) external onlyAuthorized whenNotPaused returns (uint256 charged) {
        require(user != address(0), "zero user");
        charged = commissionAmount;
        if (charged == 0) return 0;

        require(
            IERC20Comm(token).transferFrom(user, address(this), charged),
            "CommissionManager: transfer failed"
        );

        totalCollected += charged;
        totalTransactions += 1;

        emit CommissionCharged(user, msg.sender, charged);
        _distribute(charged);
    }

    /**
     * @notice Anyone can manually fund the commission pool.
     *         Triggers distribution immediately.
     */
    function fund(uint256 amount) external whenNotPaused {
        require(amount > 0, "zero amount");
        require(IERC20Comm(token).transferFrom(msg.sender, address(this), amount), "transfer failed");
        totalCollected += amount;
        _distribute(amount);
    }

    // ─── Distribution ─────────────────────────────────────────────────────────

    function _distribute(uint256 amount) internal {
        uint256 toPool    = (amount * poolShareBps)  / MAX_BPS;
        uint256 toOwners  = (amount * ownerShareBps) / MAX_BPS;
        uint256 retained  = amount - toPool - toOwners;

        // Forward to staking reward pool
        if (toPool > 0 && rewardPoolContract != address(0)) {
            IERC20Comm(token).transfer(rewardPoolContract, toPool);
            try IRewardPool(rewardPoolContract).depositRewards(toPool) {} catch {}
        } else {
            retained += toPool;
        }

        // Split among owners
        if (toOwners > 0 && owners.length > 0) {
            uint256 perOwner = toOwners / owners.length;
            uint256 dust = toOwners - perOwner * owners.length;
            for (uint256 i = 0; i < owners.length; i++) {
                if (owners[i] != address(0) && perOwner > 0) {
                    IERC20Comm(token).transfer(owners[i], perOwner);
                }
            }
            retained += dust;
        }

        emit Distributed(toPool, toOwners, retained);
    }

    /**
     * @notice Distribute the contract's current idle balance.
     */
    function distributeBalance() external onlyOwner {
        uint256 bal = IERC20Comm(token).balanceOf(address(this));
        require(bal > 0, "nothing");
        _distribute(bal);
    }

    // ─── Config ───────────────────────────────────────────────────────────────

    function setConfig(
        uint256 _commissionAmount,
        uint256 _poolShareBps,
        uint256 _ownerShareBps
    ) external onlyOwner {
        require(_poolShareBps + _ownerShareBps <= MAX_BPS, "exceeds 100%");
        commissionAmount = _commissionAmount;
        poolShareBps     = _poolShareBps;
        ownerShareBps    = _ownerShareBps;
        emit ConfigUpdated(_commissionAmount, _poolShareBps, _ownerShareBps);
    }

    function setRewardPool(address _pool) external onlyOwner {
        rewardPoolContract = _pool;
        emit RewardPoolSet(_pool);
    }

    // ─── Caller Authorization ─────────────────────────────────────────────────

    function authorizeCaller(address caller) external onlyOwner {
        require(caller != address(0), "zero address");
        require(!authorizedCallers[caller], "already authorized");
        require(callerList.length < MAX_CONTRACTS, "max callers");
        authorizedCallers[caller] = true;
        callerList.push(caller);
        emit CallerAuthorized(caller);
    }

    function revokeCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = false;
        // Remove from list
        for (uint256 i = 0; i < callerList.length; i++) {
            if (callerList[i] == caller) {
                callerList[i] = callerList[callerList.length - 1];
                callerList.pop();
                break;
            }
        }
        emit CallerRevoked(caller);
    }

    function getAuthorizedCallers() external view returns (address[] memory) {
        return callerList;
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
        require(to != address(0), "zero address");
        IERC20Comm(token).transfer(to, amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getStats() external view returns (
        uint256 collected,
        uint256 transactions,
        uint256 contractBalance
    ) {
        return (
            totalCollected,
            totalTransactions,
            IERC20Comm(token).balanceOf(address(this))
        );
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _isOwner(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == addr) return true;
        }
        return false;
    }
}
