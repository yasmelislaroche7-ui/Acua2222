// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NewH2OStaking
 * @notice Production-ready H2O 2.0 staking contract with:
 *   - Synthetix-style per-second reward accumulation
 *   - Configurable deposit (5%), withdrawal (7%), claim fees (all in bps)
 *   - Permit2 support (World App + normal wallets)
 *   - Anyone can fund the reward pool (users, contracts, owners)
 *   - Multi-owner management (up to 5 owners)
 *   - Connect / disconnect external contracts (referral, fund manager, etc.)
 *   - Reward fee split: % to pool, % to owner wallets (all configurable)
 *   - Emergency pause + emergency withdraw
 *
 * Fee flow (example, all configurable):
 *   deposit fee (5%)  → feeToPool (60%) + feeToOwners (40%)
 *   withdraw fee (7%) → feeToPool (60%) + feeToOwners (40%)
 *   claim fee         → feeToPool (60%) + feeToOwners (40%)
 */

interface IERC20New {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IPermit2New {
    struct TokenPermissions { address token; uint256 amount; }
    struct PermitTransferFrom { TokenPermissions permitted; uint256 nonce; uint256 deadline; }
    struct SignatureTransferDetails { address to; uint256 requestedAmount; }
    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}

interface IReferralSystemV2 {
    function notifyStake(address user, uint256 amount) external;
    function notifyClaim(address user, uint256 rewardAmount) external returns (uint256 referralFeeDeducted);
}

interface IFundManagerNew {
    function receiveFee(uint256 amount) external;
}

contract NewH2OStaking {

    // ─── Constants ────────────────────────────────────────────────────────────
    uint256 public constant MAX_BPS       = 10_000;
    uint256 public constant MAX_FEE_BPS   = 2_000;   // 20 % hard cap per fee type
    uint256 public constant MAX_OWNERS    = 5;
    uint256 public constant MAX_CONTRACTS = 10;
    uint256 public constant REWARD_DURATION = 365 days;

    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // ─── Config ───────────────────────────────────────────────────────────────
    address public token;

    uint256 public depositFeeBps  = 500;    // 5 %
    uint256 public withdrawFeeBps = 500;    // 5 %
    uint256 public claimFeeBps    = 1_500;  // 15 %

    /// Of collected fees: how many bps go back into the reward pool.
    /// 0 = 100% to owners. Sin referido → toda la comisión va al owner.
    uint256 public feeToPoolBps   = 0; // 0% a pool, 100% al owner
    /// Remainder goes to owner wallets equally.

    // ─── Owner & Contract Management ─────────────────────────────────────────
    address[] public owners;

    /// External contracts (referral, fund manager, etc.)
    address[] public connectedContracts;

    /// Named slots for known integrations (optional — zero = not set)
    address public referralContract;
    address public fundManagerContract;

    bool public paused;

    // ─── Staking State ────────────────────────────────────────────────────────
    uint256 public totalStaked;
    uint256 public rewardPool;
    uint256 public rewardRate;          // tokens per second (scaled ×1e18)
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    // ─── Events ───────────────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 amount, uint256 fee);
    event Unstaked(address indexed user, uint256 amount, uint256 fee);
    event RewardClaimed(address indexed user, uint256 reward);
    event RewardPoolFunded(address indexed from, uint256 amount);
    event FeeDistributed(uint256 toPool, uint256 toOwners);
    event ContractConnected(address indexed addr, string role);
    event ContractDisconnected(address indexed addr);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event FeeConfigUpdated(uint256 depositBps, uint256 withdrawBps, uint256 claimBps);
    event FeeDistConfigUpdated(uint256 toPoolBps);
    event Paused(bool paused);

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(_isOwner(msg.sender), "NewH2OStaking: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "NewH2OStaking: paused");
        _;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp;
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _token, address _initialOwner) {
        require(_token != address(0), "zero token");
        require(_initialOwner != address(0), "zero owner");
        token = _token;
        owners.push(_initialOwner);
        lastUpdateTime = block.timestamp;
    }

    // ─── Reward Math ──────────────────────────────────────────────────────────

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        uint256 elapsed = block.timestamp - lastUpdateTime;
        return rewardPerTokenStored + (elapsed * rewardRate * 1e18) / totalStaked;
    }

    function earned(address account) public view returns (uint256) {
        return (stakedBalance[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18
            + rewards[account];
    }

    // ─── Stake via Permit2 (World App) ────────────────────────────────────────

    function stake(
        IPermit2New.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external whenNotPaused updateReward(msg.sender) {
        uint256 amount = permit.permitted.amount;
        require(amount > 0, "zero amount");

        IPermit2New(PERMIT2).permitTransferFrom(
            permit,
            IPermit2New.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            signature
        );

        _processDeposit(msg.sender, amount);
    }

    /// @notice Normal stake (wallet approves contract directly, no Permit2).
    function stakeNormal(uint256 amount) external whenNotPaused updateReward(msg.sender) {
        require(amount > 0, "zero amount");
        require(IERC20New(token).transferFrom(msg.sender, address(this), amount), "transfer failed");
        _processDeposit(msg.sender, amount);
    }

    function _processDeposit(address user, uint256 gross) internal {
        uint256 fee = (gross * depositFeeBps) / MAX_BPS;
        uint256 net = gross - fee;
        stakedBalance[user] += net;
        totalStaked += net;
        _distributeFee(fee);
        // Notify referral contract if connected
        if (referralContract != address(0)) {
            try IReferralSystemV2(referralContract).notifyStake(user, net) {} catch {}
        }
        emit Staked(user, net, fee);
    }

    // ─── Unstake ──────────────────────────────────────────────────────────────

    function unstake(uint256 amount) external whenNotPaused updateReward(msg.sender) {
        require(amount > 0, "zero amount");
        require(stakedBalance[msg.sender] >= amount, "insufficient stake");

        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;

        uint256 fee = (amount * withdrawFeeBps) / MAX_BPS;
        uint256 net = amount - fee;
        _distributeFee(fee);

        // Auto-claim pending rewards
        uint256 pending = rewards[msg.sender];
        if (pending > 0) {
            rewards[msg.sender] = 0;
            _sendReward(msg.sender, pending);
        }

        require(IERC20New(token).transfer(msg.sender, net), "transfer failed");
        emit Unstaked(msg.sender, net, fee);
    }

    // ─── Claim ────────────────────────────────────────────────────────────────

    function claimRewards() external whenNotPaused updateReward(msg.sender) {
        uint256 pending = rewards[msg.sender];
        require(pending > 0, "nothing to claim");
        rewards[msg.sender] = 0;

        uint256 fee = (pending * claimFeeBps) / MAX_BPS;
        _distributeFee(fee);

        uint256 net = pending - fee;

        // Let referral contract deduct its share and pay referrers
        if (referralContract != address(0)) {
            try IReferralSystemV2(referralContract).notifyClaim(msg.sender, net) returns (uint256 deducted) {
                net = net > deducted ? net - deducted : 0;
            } catch {}
        }

        _sendReward(msg.sender, net);
        emit RewardClaimed(msg.sender, net);
    }

    function _sendReward(address user, uint256 amount) internal {
        if (amount == 0) return;
        require(IERC20New(token).transfer(user, amount), "reward transfer failed");
    }

    // ─── Fee Distribution ─────────────────────────────────────────────────────

    function _distributeFee(uint256 fee) internal {
        if (fee == 0) return;
        uint256 toPool  = (fee * feeToPoolBps) / MAX_BPS;
        uint256 toOwners = fee - toPool;

        // Fund back into reward pool
        if (toPool > 0) {
            rewardPool += toPool;
            _recalcRewardRate();
        }

        // Split among owners
        if (toOwners > 0 && owners.length > 0) {
            uint256 perOwner = toOwners / owners.length;
            uint256 dust = toOwners - perOwner * owners.length;
            for (uint256 i = 0; i < owners.length; i++) {
                if (owners[i] != address(0) && perOwner > 0) {
                    IERC20New(token).transfer(owners[i], perOwner);
                }
            }
            // Dust back to pool
            if (dust > 0) { rewardPool += dust; _recalcRewardRate(); }
        }

        emit FeeDistributed(toPool, toOwners);
    }

    // ─── Fund Reward Pool ─────────────────────────────────────────────────────

    /**
     * @notice Anyone can fund the reward pool directly.
     *         The reward rate is recalculated to spread newly added tokens
     *         over REWARD_DURATION from now.
     */
    function fundRewardPool(uint256 amount) external whenNotPaused {
        require(amount > 0, "zero amount");
        require(IERC20New(token).transferFrom(msg.sender, address(this), amount), "transfer failed");
        rewardPool += amount;
        _recalcRewardRate();
        emit RewardPoolFunded(msg.sender, amount);
    }

    /// @notice Same but via Permit2 (World App + gasless).
    function fundRewardPoolPermit2(
        IPermit2New.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external whenNotPaused {
        uint256 amount = permit.permitted.amount;
        require(amount > 0, "zero amount");
        IPermit2New(PERMIT2).permitTransferFrom(
            permit,
            IPermit2New.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            signature
        );
        rewardPool += amount;
        _recalcRewardRate();
        emit RewardPoolFunded(msg.sender, amount);
    }

    /// @notice Called by FundManager to deposit rewards (IFundReceiver interface).
    function depositRewards(uint256 amount) external {
        require(amount > 0, "zero amount");
        require(IERC20New(token).transferFrom(msg.sender, address(this), amount), "transfer failed");
        rewardPool += amount;
        _recalcRewardRate();
        emit RewardPoolFunded(msg.sender, amount);
    }

    function _recalcRewardRate() internal updateReward(address(0)) {
        rewardRate = rewardPool / REWARD_DURATION;
        lastUpdateTime = block.timestamp;
    }

    // ─── Fee Config ───────────────────────────────────────────────────────────

    function setFees(uint256 _depositBps, uint256 _withdrawBps, uint256 _claimBps) external onlyOwner {
        require(_depositBps <= MAX_FEE_BPS && _withdrawBps <= MAX_FEE_BPS && _claimBps <= MAX_FEE_BPS, "fee too high");
        depositFeeBps  = _depositBps;
        withdrawFeeBps = _withdrawBps;
        claimFeeBps    = _claimBps;
        emit FeeConfigUpdated(_depositBps, _withdrawBps, _claimBps);
    }

    function setFeeDistribution(uint256 _toPoolBps) external onlyOwner {
        require(_toPoolBps <= MAX_BPS, "exceeds 100%");
        feeToPoolBps = _toPoolBps;
        emit FeeDistConfigUpdated(_toPoolBps);
    }

    // ─── Contract Connections ─────────────────────────────────────────────────

    function setReferralContract(address _referral) external onlyOwner {
        referralContract = _referral;
        emit ContractConnected(_referral, "referral");
    }

    function setFundManagerContract(address _fundManager) external onlyOwner {
        fundManagerContract = _fundManager;
        emit ContractConnected(_fundManager, "fundManager");
    }

    function connectContract(address contractAddr) external onlyOwner {
        require(contractAddr != address(0), "zero address");
        require(connectedContracts.length < MAX_CONTRACTS, "max contracts");
        connectedContracts.push(contractAddr);
        emit ContractConnected(contractAddr, "generic");
    }

    function disconnectContract(uint256 index) external onlyOwner {
        require(index < connectedContracts.length, "out of bounds");
        emit ContractDisconnected(connectedContracts[index]);
        connectedContracts[index] = address(0);
    }

    function disconnectReferral() external onlyOwner {
        emit ContractDisconnected(referralContract);
        referralContract = address(0);
    }

    function disconnectFundManager() external onlyOwner {
        emit ContractDisconnected(fundManagerContract);
        fundManagerContract = address(0);
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
        revert("owner not found");
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
        IERC20New(token).transfer(to, amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getStakeInfo(address user) external view returns (
        uint256 staked,
        uint256 pendingReward,
        uint256 poolBalance,
        uint256 currentRewardRate
    ) {
        return (
            stakedBalance[user],
            earned(user),
            rewardPool,
            rewardRate
        );
    }

    function contractBalance() external view returns (uint256) {
        return IERC20New(token).balanceOf(address(this));
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _isOwner(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == addr) return true;
        }
        return false;
    }
}
