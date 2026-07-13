// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AcuaAutoStake
 * @notice Multi-token auto-compounding stake: los rewards se reinvierten
 *         automáticamente al saldo de stake del usuario.
 *
 * Comisiones:
 *   Stake   5%  -> 4% owner2 | 1% rewardFund
 *   Unstake 5%  -> 4% owner2 | 1% rewardFund
 *   Claim   10% -> 8% owner2 | 1% rewardFund | 1% caller (procesador)
 *
 * Cola de reclamos: cualquier usuario puede llamar claimFor(token, user)
 * si la posición lleva >= 10 min sin reclamar. El caller recibe 1% del reward.
 *
 * APR variable por token, máximo 100%.
 * Multi-owner. Permit2 para depósitos y fondeo.
 */
contract AcuaAutoStake {

    // ─── Constants ───────────────────────────────────────────────────────────
    address public constant PERMIT2      = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 public constant MAX_APR_BPS  = 10_000; // 100%
    uint256 public constant CLAIM_COOLDOWN = 10 minutes;
    uint256 public constant BPS_BASE     = 10_000;

    // ─── Fee config ──────────────────────────────────────────────────────────
    uint256 public stakeFeeBps   = 500;  // 5%
    uint256 public unstakeFeeBps = 500;  // 5%
    uint256 public claimFeeBps   = 1000; // 10%

    // ─── Ownership ───────────────────────────────────────────────────────────
    address public owner2;
    mapping(address => bool) public isOwner;
    address[] public owners;

    // ─── Token registry ──────────────────────────────────────────────────────
    struct TokenConfig {
        bool    allowed;
        uint256 aprBps;      // 10000 = 100% APR
        uint256 rewardFund;  // tokens allocated as reward pool (tracked internally)
    }
    mapping(address => TokenConfig) public tokens;
    address[] public tokenList;

    // ─── User positions ──────────────────────────────────────────────────────
    struct Position {
        uint256 amount;       // staked net of fees
        uint256 lastClaimed;  // unix timestamp
    }
    mapping(address => mapping(address => Position)) public positions; // token -> user -> pos

    // Staker enumeration (per token)
    mapping(address => address[])                    internal _stakers;
    mapping(address => mapping(address => uint256))  internal _stakerIdx;
    mapping(address => mapping(address => bool))     internal _isStaker;

    // ─── Events ──────────────────────────────────────────────────────────────
    event Staked(address indexed token, address indexed user, uint256 gross, uint256 net);
    event Unstaked(address indexed token, address indexed user, uint256 gross, uint256 net);
    event Claimed(address indexed token, address indexed user, uint256 net, address indexed processor, uint256 processorEarned);
    event TokenAdded(address indexed token, uint256 aprBps);
    event AprSet(address indexed token, uint256 aprBps);
    event FundAdded(address indexed token, uint256 amount);
    event OwnerAdded(address indexed newOwner);
    event OwnerRemoved(address indexed removed);

    // ─── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyOwner() { require(isOwner[msg.sender], "Not owner"); _; }

    // ─── Constructor ─────────────────────────────────────────────────────────
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

    function addToken(address token, uint256 aprBps) external onlyOwner {
        require(token != address(0), "Zero token");
        require(!tokens[token].allowed, "Already added");
        require(aprBps <= MAX_APR_BPS, "APR > 100%");
        tokens[token] = TokenConfig({ allowed: true, aprBps: aprBps, rewardFund: 0 });
        tokenList.push(token);
        emit TokenAdded(token, aprBps);
    }

    function setApr(address token, uint256 aprBps) external onlyOwner {
        require(tokens[token].allowed, "Token not allowed");
        require(aprBps <= MAX_APR_BPS, "APR > 100%");
        tokens[token].aprBps = aprBps;
        emit AprSet(token, aprBps);
    }

    function setFees(uint256 _stake, uint256 _unstake, uint256 _claim) external onlyOwner {
        require(_stake <= 1000, "Stake fee > 10%");
        require(_unstake <= 1000, "Unstake fee > 10%");
        require(_claim <= 2000, "Claim fee > 20%");
        stakeFeeBps   = _stake;
        unstakeFeeBps = _unstake;
        claimFeeBps   = _claim;
    }

    // =========================================================================
    // Funding (reward pool)
    // =========================================================================

    /// @notice Fondear el pool de recompensas con Permit2 (sin approve previo).
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

    /// @notice Fondear con transferFrom estándar (requiere approve previo).
    function fundRewardsDirect(address token, uint256 amount) external onlyOwner {
        require(tokens[token].allowed, "Token not allowed");
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "Transfer failed");
        tokens[token].rewardFund += amount;
        emit FundAdded(token, amount);
    }

    // =========================================================================
    // Staking
    // =========================================================================

    /// @notice Depositar tokens vía Permit2 (sin approve previo).
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

        // Stake fee: 5% (4% owner2 + 1% rewardFund)
        uint256 fee    = amount * stakeFeeBps / BPS_BASE;
        uint256 net    = amount - fee;
        if (fee > 0) {
            uint256 toOwner2 = fee * 4 / 5; // 80% of fee = 4% of amount
            uint256 toFund   = fee - toOwner2;
            if (toOwner2 > 0) _safeTransfer(token, owner2, toOwner2);
            tokens[token].rewardFund += toFund;
        }

        _addToPosition(token, msg.sender, net);
        emit Staked(token, msg.sender, amount, net);
    }

    /// @notice Retirar tokens. Aplica 5% de comisión de salida.
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
    // Auto-compound claim (puede llamarlo cualquiera)
    // =========================================================================

    /**
     * @notice Procesa el auto-reinvest de un usuario.
     *         Cualquiera puede llamarlo si han pasado >= 10 minutos desde el último reclamo.
     *         El llamante recibe 1% del reward como incentivo.
     *         El 90% del reward se añade al stake del usuario (auto-compound).
     */
    function claimFor(address token, address user) external returns (uint256 netToStake) {
        Position storage pos = positions[token][user];
        require(pos.amount > 0, "No stake");
        require(block.timestamp >= pos.lastClaimed + CLAIM_COOLDOWN, "Cooldown active");

        uint256 reward = _pendingReward(token, user);
        require(reward > 0, "No reward");
        require(tokens[token].rewardFund >= reward, "Reward fund empty");

        // Deduct from fund BEFORE any transfers (CEI pattern)
        tokens[token].rewardFund -= reward;

        // Update timestamp
        pos.lastClaimed = block.timestamp;

        // Claim fee breakdown:
        //   1% of reward -> rewardFund
        //   1% of reward -> caller (procesador)
        //   8% of reward -> owner2
        //  90% of reward -> user's stake (auto-compound)
        uint256 toFund   = reward * 100 / BPS_BASE; // 1%
        uint256 toCaller = reward * 100 / BPS_BASE; // 1%
        uint256 toOwner2 = reward * claimFeeBps / BPS_BASE - toFund - toCaller;
        netToStake       = reward - toFund - toCaller - toOwner2;

        tokens[token].rewardFund += toFund;
        if (toCaller > 0) _safeTransfer(token, msg.sender, toCaller);
        if (toOwner2 > 0) _safeTransfer(token, owner2, toOwner2);

        // Auto-compound: el net va al stake del usuario
        pos.amount += netToStake;

        emit Claimed(token, user, netToStake, msg.sender, toCaller);
    }

    /**
     * @notice Procesar múltiples posiciones en un batch.
     */
    function claimForBatch(address token, address[] calldata users) external {
        for (uint256 i = 0; i < users.length; i++) {
            Position storage pos = positions[token][users[i]];
            if (pos.amount == 0) continue;
            if (block.timestamp < pos.lastClaimed + CLAIM_COOLDOWN) continue;
            uint256 reward = _pendingReward(token, users[i]);
            if (reward == 0) continue;
            if (tokens[token].rewardFund < reward) break; // no more funds

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
    // View functions
    // =========================================================================

    function pendingReward(address token, address user) external view returns (uint256) {
        return _pendingReward(token, user);
    }

    function stakersCount(address token) external view returns (uint256) {
        return _stakers[token].length;
    }

    /**
     * @notice Lista paginada de posiciones elegibles para reclamo (cooldown cumplido).
     */
    function getClaimablePositions(
        address token,
        uint256 offset,
        uint256 limit
    ) external view returns (
        address[] memory users,
        uint256[] memory stakes,
        uint256[] memory rewards,
        uint256[] memory elapsedSeconds
    ) {
        address[] storage arr = _stakers[token];
        uint256 total = arr.length;
        uint256 now_  = block.timestamp;

        // Count
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

    /**
     * @notice Todas las posiciones (paginadas) — para el panel de minería.
     */
    function getAllPositions(
        address token,
        uint256 offset,
        uint256 limit
    ) external view returns (
        address[] memory users,
        uint256[] memory stakes,
        uint256[] memory pending,
        uint256[] memory lastClaimed_
    ) {
        address[] storage arr = _stakers[token];
        uint256 end = offset + limit > arr.length ? arr.length : offset + limit;
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

    function getOwners() external view returns (address[] memory) { return owners; }
    function getTokenList() external view returns (address[] memory) { return tokenList; }

    /// @notice Retiro de emergencia (solo owner).
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
        TokenConfig storage cfg = tokens[token];
        // reward = amount * APR% * elapsed / 1year
        return pos.amount * cfg.aprBps * elapsed / (BPS_BASE * 365 days);
    }

    function _addToPosition(address token, address user, uint256 amount) internal {
        if (!_isStaker[token][user]) {
            _isStaker[token][user] = true;
            _stakerIdx[token][user] = _stakers[token].length;
            _stakers[token].push(user);
            positions[token][user].lastClaimed = block.timestamp;
        }
        positions[token][user].amount += amount;
    }

    function _removeStaker(address token, address user) internal {
        if (!_isStaker[token][user]) return;
        uint256 idx = _stakerIdx[token][user];
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
