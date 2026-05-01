// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FundManager
 * @notice Central hub that receives fees/funding and distributes them across
 *         the ecosystem according to configurable percentages:
 *           - rewardFundBps  → forwarded to the NewH2OStaking reward pool
 *           - ownerWalletBps → split equally among all owners
 *           - remainder      → kept in contract (manual emergency use)
 *
 * Anyone (users, other contracts, owners) can call `fund()` or send ETH/tokens.
 * Owners can connect / disconnect external contracts that also route fees here.
 * All percentages are expressed in basis points (1 bps = 0.01%).
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IFundReceiver {
    /// @notice Called when FundManager forwards funds to an external pool.
    function depositRewards(uint256 amount) external;
}

contract FundManager {

    // ─── Constants ────────────────────────────────────────────────────────────
    uint256 public constant MAX_BPS        = 10_000;
    uint256 public constant MAX_OWNERS     = 5;
    uint256 public constant MAX_CONTRACTS  = 10;

    // ─── State ────────────────────────────────────────────────────────────────
    address public token;                   // ERC-20 managed (new H2O)

    address[] public owners;

    /// Connected external contracts (staking, mining, etc.) that this manager
    /// can forward reward funds to.
    address[] public connectedContracts;

    /// Percentage of incoming funds routed to the reward pool (basis points).
    uint256 public rewardFundBps = 6_000;   // 60 %

    /// Percentage of incoming funds split among owners' wallets.
    uint256 public ownerWalletBps = 2_000;  // 20 %

    /// Percentage that stays in the contract (buffer / emergency).
    /// = MAX_BPS - rewardFundBps - ownerWalletBps (enforced on config update).

    /// Index of the connected contract that receives reward funds.
    /// If 0xFF, distribution is skipped (no receiver connected yet).
    uint8 public rewardReceiverIndex = 0xFF;

    bool public paused;

    // ─── Events ───────────────────────────────────────────────────────────────
    event Funded(address indexed from, uint256 amount);
    event Distributed(uint256 toRewardPool, uint256 toOwners, uint256 retained);
    event ContractConnected(address indexed contractAddr, uint256 index);
    event ContractDisconnected(address indexed contractAddr);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ConfigUpdated(uint256 rewardFundBps, uint256 ownerWalletBps);
    event Paused(bool paused);

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(_isOwner(msg.sender), "FundManager: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "FundManager: paused");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _token, address _initialOwner) {
        require(_token != address(0), "zero token");
        require(_initialOwner != address(0), "zero owner");
        token = _token;
        owners.push(_initialOwner);
    }

    // ─── Funding ──────────────────────────────────────────────────────────────

    /**
     * @notice Anyone can fund the manager with `amount` tokens.
     *         Automatically distributes according to current config.
     */
    function fund(uint256 amount) external whenNotPaused {
        require(amount > 0, "zero amount");
        require(
            IERC20(token).transferFrom(msg.sender, address(this), amount),
            "transfer failed"
        );
        emit Funded(msg.sender, amount);
        _distribute(amount);
    }

    /**
     * @notice Internal entry-point for other connected contracts routing fees here.
     *         Called by e.g. NewH2OStaking when collecting deposit/withdraw fees.
     */
    function receiveFee(uint256 amount) external whenNotPaused {
        // Caller must have already transferred `amount` tokens to this contract,
        // or this contract must have allowance. For simplicity we pull from caller.
        require(amount > 0, "zero amount");
        require(
            IERC20(token).transferFrom(msg.sender, address(this), amount),
            "transfer failed"
        );
        emit Funded(msg.sender, amount);
        _distribute(amount);
    }

    // ─── Distribution ─────────────────────────────────────────────────────────

    function _distribute(uint256 amount) internal {
        uint256 toReward  = (amount * rewardFundBps)   / MAX_BPS;
        uint256 toOwners  = (amount * ownerWalletBps)  / MAX_BPS;
        uint256 retained  = amount - toReward - toOwners;

        // Forward to reward pool
        if (toReward > 0 && rewardReceiverIndex != 0xFF && connectedContracts.length > rewardReceiverIndex) {
            address receiver = connectedContracts[rewardReceiverIndex];
            if (receiver != address(0)) {
                IERC20(token).transfer(receiver, toReward);
                IFundReceiver(receiver).depositRewards(toReward);
            } else {
                retained += toReward;
            }
        } else {
            retained += toReward;
        }

        // Split among owners
        if (toOwners > 0 && owners.length > 0) {
            uint256 perOwner = toOwners / owners.length;
            uint256 dust = toOwners - perOwner * owners.length;
            for (uint256 i = 0; i < owners.length; i++) {
                if (owners[i] != address(0)) {
                    IERC20(token).transfer(owners[i], perOwner);
                }
            }
            retained += dust;
        }

        emit Distributed(toReward, toOwners, retained);
    }

    /**
     * @notice Manually trigger distribution of the contract's current balance.
     *         Useful if tokens were sent directly (not via fund()).
     */
    function distributeBalance() external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "nothing to distribute");
        _distribute(bal);
    }

    // ─── Config ───────────────────────────────────────────────────────────────

    /**
     * @notice Update distribution percentages.
     * @param _rewardFundBps  Basis points for reward pool (e.g. 6000 = 60%).
     * @param _ownerWalletBps Basis points for owner wallets (e.g. 2000 = 20%).
     *        Remainder stays in contract.  Sum must be <= MAX_BPS.
     */
    function setDistribution(uint256 _rewardFundBps, uint256 _ownerWalletBps) external onlyOwner {
        require(_rewardFundBps + _ownerWalletBps <= MAX_BPS, "exceeds 100%");
        rewardFundBps  = _rewardFundBps;
        ownerWalletBps = _ownerWalletBps;
        emit ConfigUpdated(_rewardFundBps, _ownerWalletBps);
    }

    /// @notice Set which connected contract index receives the reward pool share.
    function setRewardReceiver(uint8 index) external onlyOwner {
        rewardReceiverIndex = index;
    }

    // ─── Contract Connections ─────────────────────────────────────────────────

    function connectContract(address contractAddr) external onlyOwner {
        require(contractAddr != address(0), "zero address");
        require(connectedContracts.length < MAX_CONTRACTS, "max contracts");
        connectedContracts.push(contractAddr);
        emit ContractConnected(contractAddr, connectedContracts.length - 1);
    }

    function disconnectContract(uint256 index) external onlyOwner {
        require(index < connectedContracts.length, "out of bounds");
        emit ContractDisconnected(connectedContracts[index]);
        connectedContracts[index] = address(0);
        // Reset reward receiver if it was pointing here
        if (rewardReceiverIndex == uint8(index)) rewardReceiverIndex = 0xFF;
    }

    function getConnectedContracts() external view returns (address[] memory) {
        return connectedContracts;
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

    // ─── Pause ────────────────────────────────────────────────────────────────

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    // ─── Emergency ────────────────────────────────────────────────────────────

    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero address");
        IERC20(token).transfer(to, amount);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _isOwner(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == addr) return true;
        }
        return false;
    }

    function contractBalance() external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
