// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AcuaAutoStake v2
 * @notice Multi-token auto-compounding stake con cola de reclamos pública.
 *
 * Comisiones:
 *   Stake   5%  -> 4% owner2 | 1% rewardFund
 *   Unstake 5%  -> 4% owner2 | 1% rewardFund
 *   Claim   10% -> 8% owner2 | 1% rewardFund | 1% caller (procesador)
 *
 * Cola pública: getClaimablePositions() visible para todos.
 * El procesador que llame claimFor() gana 1% del reward.
 * Stake mínimo por token: ajustable por owners.
 * Permit2 para depósitos y fondeo sin approve previo.
 */
contract AcuaAutoStake {

    address public constant PERMIT2     = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 public constant MAX_APR_BPS = 10_000; // 100%
    uint256 public constant CLAIM_COOLDOWN = 10 minutes;
    uint256 public constant BPS_BASE    = 10_000;

    // ─── Fee config ──────────────────────────────────────────────────────────
    uint256 public stakeFeeBps   = 500;
    uint256 public unstakeFeeBps = 500;
    uint256 public claimFeeBps   = 1000;

    // ─── Ownership ───────────────────────────────────────────────────────────
    address public owner2;
    mapping(address => bool) public isOwner;
    address[] public owners;

    // ─── Token registry ──────────────────────────────────────────────────────
    struct TokenConfig {
        bool    allowed;
        uint256 aprBps;
        uint256 rewardFund;
        uint256 minStake;   // minimum net amount to stake
    }
    mapping(address => TokenConfig) public tokens;
    address[] public tokenList;

    // ─── Positions ───────────────────────────────────────────────────────────
    struct Position {
        uint256 amount;
        uint256 lastClaimed;
    }
    mapping(address => mapping(address => Position)) public positions; // token->user->pos

    mapping(address => address[])                   internal _stakers;
    mapping(address => mapping(address => uint256)) internal _stakerIdx;
    mapping(address => mapping(address => bool))    internal _isStaker;

    // ─── Events ──────────────────────────────────────────────────────────────
    event Staked(address indexed token, address indexed user, uint256 gross, uint256 net);
    event Unstaked(address indexed token, address indexed user, uint256 gross, uint256 net);
    event Claimed(address indexed token, address indexed user, uint256 net, address indexed processor, uint256 processorEarned);
    event TokenAdded(address indexed token, uint256 aprBps, uint256 minStake);
    event AprSet(address indexed token, uint256 aprBps);
    event MinStakeSet(address indexed token, uint256 minStake);
    event FundAdded(address indexed token, uint256 amount);
    event OwnerAdded(address indexed newOwner);
    event OwnerRemoved(address indexed removed);

    modifier onlyOwner() { require(isOwner[msg.sender], "Not owner"); _; }

    constructor(address _owner2) {
        isOwner[msg.sender] = true;
        owners.push(msg.sender);
        owner2 = _owner2;
    }

    // =========================================================================
    // Owner management
    // =========================================================================

    function addOwner(address addr) external onlyOwner {
        require(!isOwner[addr], "Already owner");
        isOwner[addr] = true;
        owners.push(addr);
        emit OwnerAdded(addr);
    }

    function removeOwner(address addr) external onlyOwner {
        require(isOwner[addr], "Not owner");
        require(addr != msg.sender, "Cannot remove self");
        isOwner[addr] = false;
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == addr) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }
        emit OwnerRemoved(addr);
    }

    function setOwner2(address addr) external onlyOwner {
        require(addr != address(0), "Zero address");
        owner2 = addr;
    }

    // =========================================================================
    // Token management
    // =========================================================================

    function addToken(address token, uint256 aprBps, uint256 minStakeAmount) external onlyOwner {
        require(token != address(0), "Zero token");
        require(!tokens[token].allowed, "Already added");
        require(aprBps <= MAX_APR_BPS, "APR > 100%");
        tokens[token] = TokenConfig({ allowed: true, aprBps: aprBps, rewardFund: 0, minStake: minStakeAmount });
        tokenList.push(token);
        emit TokenAdded(token, aprBps, minStakeAmount);
    }

    function setApr(address token, uint256 aprBps) external onlyOwner {
        require(tokens[token].allowed, "Token not allowed");
        require(aprBps <= MAX_APR_BPS, "APR > 100%");
        tokens[token].aprBps = aprBps;
        emit AprSet(token, aprBps);
    }

    /// @notice Adjust minimum stake amount per token. 0 = no minimum.
    function setMinStake(address token, uint256 minStakeAmount) external onlyOwner {
        require(tokens[token].allowed, "Token not allowed");
        tokens[token].minStake = minStakeAmount;
        emit MinStakeSet(token, minStakeAmount);
    }

    function setFees(uint256 _stake, uint256 _unstake, uint256 _claim) external onlyOwner {
        require(_stake <= 1000 && _unstake <= 1000 && _claim <= 2000, "Fees too high");
        stakeFeeBps   = _stake;
        unstakeFeeBps = _unstake;
        claimFeeBps   = _claim;
    }

    // =========================================================================
    // Funding
    // =========================================================================

    function fundRewardsPermit2(
        address token,
        uint256 amount,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external onlyOwner {
        require(tokens[token].allowed, "Token not allowed");
        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            signature
        );
        tokens[token].rewardFund += amount;
        emit FundAdded(token, amount);
    }

    function fundRewardsDirect(address token, uint256 amount) external onlyOwner {
        require(tokens[token].allowed, "Token not allowed");
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "Transfer failed");
        tokens[token].rewardFund += amount;
        emit FundAdded(token, amount);
    }

    // =========================================================================
    // Staking
    // =========================================================================

    function stakeWithPermit2(
        address token,
        uint256 amount,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external {
        require(tokens[token].allowed, "Token not allowed");
        require(amount > 0, "Zero amount");

        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            signature
        );

        uint256 fee  = amount * stakeFeeBps / BPS_BASE;
        uint256 net  = amount - fee;

        // Check minimum stake (net of fee)
        uint256 minS = tokens[token].minStake;
        require(minS == 0 || net >= minS, "Below minimum stake");

        if (fee > 0) {
            uint256 toOwner2 = fee * 4 / 5;
            uint256 toFund   = fee - toOwner2;
            if (toOwner2 > 0) _safeTransfer(token, owner2, toOwner2);
            tokens[token].rewardFund += toFund;
        }

        _addToPosition(token, msg.sender, net);
        emit Staked(token, msg.sender, amount, net);
    }

    function unstake(address token, uint256 amount) external {
        Position storage pos = positions[token][msg.sender];
        require(pos.amount >= amount && amount > 0, "Invalid amount");

        uint256 fee = amount * unstakeFeeBps / BPS_BASE;
        uint256 net = amount - fee;

        pos.amount -= amount;
        if (pos.amount == 0) _removeStaker(token, msg.sender);

        if (fee > 0) {
            uint256 toOwner2 = fee * 4 / 5;
            uint256 toFund   = fee - toOwner2;
            if (toOwner2 > 0) _safeTransfer(token, owner2, toOwner2);
            tokens[token].rewardFund += toFund;
        }

        _safeTransfer(token, msg.sender, net);
        emit Unstaked(token, msg.sender, amount, net);
    }

    // =========================================================================
    // Auto-compound claim (anyone can call)
    // =========================================================================

    function claimFor(address token, address user) external returns (uint256 netToStake) {
        Position storage pos = positions[token][user];
        require(pos.amount > 0, "No stake");
        require(block.timestamp >= pos.lastClaimed + CLAIM_COOLDOWN, "Cooldown active");

        uint256 reward = _pendingReward(token, user);
        require(reward > 0, "No reward");
        require(tokens[token].rewardFund >= reward, "Insufficient reward fund");

        tokens[token].rewardFund -= reward;
        pos.lastClaimed = block.timestamp;

        uint256 toFund   = reward * 100 / BPS_BASE; // 1%
        uint256 toCaller = reward * 100 / BPS_BASE; // 1%
        uint256 toOwner2 = reward * claimFeeBps / BPS_BASE - toFund - toCaller; // 8%
        netToStake       = reward - toFund - toCaller - toOwner2; // 90%

        tokens[token].rewardFund += toFund;
        if (toCaller > 0) _safeTransfer(token, msg.sender, toCaller);
        if (toOwner2 > 0) _safeTransfer(token, owner2, toOwner2);

        // Auto-compound
        pos.amount += netToStake;

        emit Claimed(token, user, netToStake, msg.sender, toCaller);
    }

    function claimForBatch(address token, address[] calldata users) external {
        for (uint256 i = 0; i < users.length; i++) {
            Position storage pos = positions[token][users[i]];
            if (pos.amount == 0) continue;
            if (block.timestamp < pos.lastClaimed + CLAIM_COOLDOWN) continue;
            uint256 reward = _pendingReward(token, users[i]);
            if (reward == 0) continue;
            if (tokens[token].rewardFund < reward) break;

            tokens[token].rewardFund -= reward;
            pos.lastClaimed = block.timestamp;

            uint256 toFund   = reward * 100 / BPS_BASE;
            uint256 toCaller = reward * 100 / BPS_BASE;
            uint256 toOwner2 = reward * claimFeeBps / BPS_BASE - toFund - toCaller;
            uint256 net      = reward - toFund - toCaller - toOwner2;

            tokens[token].rewardFund += toFund;
            if (toCaller > 0) _safeTransfer(token, msg.sender, toCaller);
            if (toOwner2 > 0) _safeTransfer(token, owner2, toOwner2);
            positions[token][users[i]].amount += net;

            emit Claimed(token, users[i], net, msg.sender, toCaller);
        }
    }

    // =========================================================================
    // View functions (public — visible for everyone)
    // =========================================================================

    function pendingReward(address token, address user) external view returns (uint256) {
        return _pendingReward(token, user);
    }

    function stakersCount(address token) external view returns (uint256) {
        return _stakers[token].length;
    }

    /// @notice Returns ALL stakers (paginated) for public display.
    function getAllPositions(address token, uint256 offset, uint256 limit)
        external view returns (
            address[] memory users,
            uint256[] memory stakes,
            uint256[] memory pending,
            uint256[] memory lastClaimed_
        )
    {
        address[] storage arr = _stakers[token];
        uint256 end   = offset + limit > arr.length ? arr.length : offset + limit;
        uint256 count = end > offset ? end - offset : 0;
        users        = new address[](count);
        stakes       = new uint256[](count);
        pending      = new uint256[](count);
        lastClaimed_ = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            address u = arr[offset + i];
            Position storage p = positions[token][u];
            users[i]        = u;
            stakes[i]       = p.amount;
            pending[i]      = _pendingReward(token, u);
            lastClaimed_[i] = p.lastClaimed;
        }
    }

    /// @notice Returns only positions eligible for claim (cooldown met). Public.
    function getClaimablePositions(address token, uint256 offset, uint256 limit)
        external view returns (
            address[] memory users,
            uint256[] memory stakes,
            uint256[] memory rewards,
            uint256[] memory elapsedSeconds
        )
    {
        address[] storage arr = _stakers[token];
        uint256 total = arr.length;
        uint256 now_  = block.timestamp;

        uint256 count = 0;
        for (uint256 i = offset; i < total && count < limit; i++) {
            address u = arr[i];
            Position storage p = positions[token][u];
            if (p.amount > 0 && now_ >= p.lastClaimed + CLAIM_COOLDOWN) count++;
        }

        users          = new address[](count);
        stakes         = new uint256[](count);
        rewards        = new uint256[](count);
        elapsedSeconds = new uint256[](count);

        uint256 idx = 0;
        for (uint256 i = offset; i < total && idx < count; i++) {
            address u = arr[i];
            Position storage p = positions[token][u];
            if (p.amount > 0 && now_ >= p.lastClaimed + CLAIM_COOLDOWN) {
                users[idx]          = u;
                stakes[idx]         = p.amount;
                rewards[idx]        = _pendingReward(token, u);
                elapsedSeconds[idx] = now_ - p.lastClaimed;
                idx++;
            }
        }
    }

    function getOwners() external view returns (address[] memory) { return owners; }
    function getTokenList() external view returns (address[] memory) { return tokenList; }

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        _safeTransfer(token, msg.sender, amount);
    }

    // =========================================================================
    // Internal
    // =========================================================================

    function _pendingReward(address token, address user) internal view returns (uint256) {
        Position storage pos = positions[token][user];
        if (pos.amount == 0) return 0;
        uint256 elapsed = block.timestamp - pos.lastClaimed;
        return pos.amount * tokens[token].aprBps * elapsed / (BPS_BASE * 365 days);
    }

    function _addToPosition(address token, address user, uint256 amount) internal {
        if (!_isStaker[token][user]) {
            _isStaker[token][user]       = true;
            _stakerIdx[token][user]      = _stakers[token].length;
            _stakers[token].push(user);
            positions[token][user].lastClaimed = block.timestamp;
        }
        positions[token][user].amount += amount;
    }

    function _removeStaker(address token, address user) internal {
        if (!_isStaker[token][user]) return;
        uint256 idx  = _stakerIdx[token][user];
        address[] storage arr = _stakers[token];
        address last = arr[arr.length - 1];
        arr[idx] = last;
        _stakerIdx[token][last] = idx;
        arr.pop();
        delete _isStaker[token][user];
        delete _stakerIdx[token][user];
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        bool ok = IERC20(token).transfer(to, amount);
        require(ok, "Transfer failed");
    }
}
