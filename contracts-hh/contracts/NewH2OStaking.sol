// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NewH2OStaking v2
 * @notice H2O 2.0 staking con sistema de referidos integrado.
 *
 * Fee de claim: SIEMPRE 15% del bruto
 *   - Con referido:    5% → referrer | 5% → owner | 5% bonus devuelto al usuario → usuario neto 90%
 *   - Sin referido:    15% → owner                                                → usuario neto 85%
 *
 * Fee de depósito: 5% (configurable, cap 20%) → owners
 * Fee de retiro:   5% (configurable, cap 20%) → owners
 *
 * Referidos ilimitados: cada dirección puede referir a N personas sin límite.
 * Cada usuario tiene un solo referrer (se asigna una vez, inmutable).
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

contract NewH2OStaking {

    // ─── Global Constants ─────────────────────────────────────────────────
    uint256 public constant MAX_BPS           = 10_000;
    uint256 public constant MAX_FEE_BPS       = 2_000;   // 20% hard cap
    uint256 public constant MAX_OWNERS        = 5;
    uint256 public constant REWARD_DURATION   = 365 days;

    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // ─── Referral Constants (hardcoded, not configurable) ─────────────────
    // Claim fee = 15% always
    //   With referrer:    5% referrer + 5% owner + 5% bonus to user → user nets 90%
    //   Without referrer: 15% to owner → user nets 85%
    uint256 public constant claimFeeBps      = 1_500;  // 15% total (for UI compatibility)
    uint256 public constant REF_REFERRER_BPS =   500;  // 5%  → referrer
    uint256 public constant REF_OWNER_BPS    =   500;  // 5%  → owner  (with referrer)
    uint256 public constant REF_BONUS_BPS    =   500;  // 5%  → bonus returned to user
    // Without referrer: full claimFeeBps (15%) → owner

    // ─── Config ───────────────────────────────────────────────────────────
    address public token;

    uint256 public depositFeeBps  = 500;  // 5%
    uint256 public withdrawFeeBps = 500;  // 5%
    uint256 public feeToPoolBps   = 0;    // 0% to pool, 100% to owners (deposit/withdraw fees)

    // ─── Owner Management ─────────────────────────────────────────────────
    address[] public owners;
    bool public paused;

    // ─── Staking State ────────────────────────────────────────────────────
    uint256 public totalStaked;
    uint256 public rewardPool;
    uint256 public rewardRate;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    // ─── Referral State ───────────────────────────────────────────────────
    mapping(address => address)   public referredBy;       // user → their referrer
    mapping(address => uint256)   public referralCount;    // referrer → # of people they referred
    mapping(address => uint256)   public referralEarnings; // referrer → total H2O earned from refs

    uint256 public totalReferralsPaid;

    // ─── Events ───────────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 net, uint256 fee);
    event Unstaked(address indexed user, uint256 net, uint256 fee);
    event RewardClaimed(address indexed user, uint256 toUser, uint256 toReferrer, uint256 toOwner, address referrer);
    event RewardPoolFunded(address indexed from, uint256 amount);
    event FeeDistributed(uint256 toPool, uint256 toOwners);
    event ReferralRegistered(address indexed user, address indexed referrer);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event FeeConfigUpdated(uint256 depositBps, uint256 withdrawBps);
    event Paused(bool paused);

    // ─── Modifiers ────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(_isOwner(msg.sender), "not owner");
        _;
    }
    modifier whenNotPaused() {
        require(!paused, "paused");
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

    // ─── Constructor ──────────────────────────────────────────────────────
    constructor(address _token, address _initialOwner) {
        require(_token != address(0) && _initialOwner != address(0), "zero address");
        token = _token;
        owners.push(_initialOwner);
        lastUpdateTime = block.timestamp;
    }

    // ─── Reward Math ──────────────────────────────────────────────────────
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        uint256 elapsed = block.timestamp - lastUpdateTime;
        return rewardPerTokenStored + (elapsed * rewardRate * 1e18) / totalStaked;
    }

    function earned(address account) public view returns (uint256) {
        return (stakedBalance[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18
            + rewards[account];
    }

    // ─── Referral Registration ─────────────────────────────────────────────
    /**
     * @notice Registra un referrer. Solo se puede hacer UNA VEZ (inmutable).
     * @param referrer La dirección que te invitó. No puede ser cero ni uno mismo.
     */
    function register(address referrer) external {
        require(referredBy[msg.sender] == address(0), "already registered");
        require(referrer != address(0) && referrer != msg.sender, "invalid referrer");
        _registerRef(msg.sender, referrer);
    }

    function _registerRef(address user, address referrer) internal {
        referredBy[user] = referrer;
        referralCount[referrer]++;
        emit ReferralRegistered(user, referrer);
    }

    // ─── Stake via Permit2 (World App) ────────────────────────────────────
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

    /// @notice Stake via Permit2 + registrar referrer en el mismo TX.
    function stake(
        IPermit2New.PermitTransferFrom calldata permit,
        bytes calldata signature,
        address referrer
    ) external whenNotPaused updateReward(msg.sender) {
        uint256 amount = permit.permitted.amount;
        require(amount > 0, "zero amount");
        IPermit2New(PERMIT2).permitTransferFrom(
            permit,
            IPermit2New.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            signature
        );
        if (referrer != address(0) && referrer != msg.sender && referredBy[msg.sender] == address(0)) {
            _registerRef(msg.sender, referrer);
        }
        _processDeposit(msg.sender, amount);
    }

    /// @notice Stake estándar (aprobación ERC20 directa, sin Permit2).
    function stakeNormal(uint256 amount) external whenNotPaused updateReward(msg.sender) {
        require(amount > 0, "zero amount");
        require(IERC20New(token).transferFrom(msg.sender, address(this), amount), "transfer failed");
        _processDeposit(msg.sender, amount);
    }

    /// @notice Stake estándar + registrar referrer en el mismo TX.
    function stakeNormal(uint256 amount, address referrer) external whenNotPaused updateReward(msg.sender) {
        require(amount > 0, "zero amount");
        require(IERC20New(token).transferFrom(msg.sender, address(this), amount), "transfer failed");
        if (referrer != address(0) && referrer != msg.sender && referredBy[msg.sender] == address(0)) {
            _registerRef(msg.sender, referrer);
        }
        _processDeposit(msg.sender, amount);
    }

    function _processDeposit(address user, uint256 gross) internal {
        uint256 fee = (gross * depositFeeBps) / MAX_BPS;
        uint256 net = gross - fee;
        stakedBalance[user] += net;
        totalStaked += net;
        _distributeDepositWithdrawFee(fee);
        emit Staked(user, net, fee);
    }

    // ─── Unstake ──────────────────────────────────────────────────────────
    function unstake(uint256 amount) external whenNotPaused updateReward(msg.sender) {
        require(amount > 0, "zero amount");
        require(stakedBalance[msg.sender] >= amount, "insufficient stake");

        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;

        uint256 fee = (amount * withdrawFeeBps) / MAX_BPS;
        uint256 net = amount - fee;
        _distributeDepositWithdrawFee(fee);

        // Auto-claim pending rewards
        uint256 pending = rewards[msg.sender];
        if (pending > 0) {
            rewards[msg.sender] = 0;
            _sendClaimRewards(msg.sender, pending);
        }

        require(IERC20New(token).transfer(msg.sender, net), "transfer failed");
        emit Unstaked(msg.sender, net, fee);
    }

    // ─── Claim ────────────────────────────────────────────────────────────
    /**
     * @notice Reclama recompensas con lógica de referidos integrada.
     *
     * SIEMPRE se descuenta 15% del bruto (claimFeeBps = 1500):
     *   Con referrer:    5% → referrer | 5% → owner | 5% bonus → usuario  → usuario neto 90%
     *   Sin referrer:    15% → owner                                       → usuario neto 85%
     */
    function claimRewards() external whenNotPaused updateReward(msg.sender) {
        uint256 gross = rewards[msg.sender];
        require(gross > 0, "nothing to claim");
        rewards[msg.sender] = 0;
        _sendClaimRewards(msg.sender, gross);
    }

    function _sendClaimRewards(address user, uint256 gross) internal {
        uint256 totalFee = (gross * claimFeeBps) / MAX_BPS; // 15% siempre
        address ref      = referredBy[user];

        uint256 toUser;
        uint256 toOwner;
        uint256 toRef;

        if (ref != address(0)) {
            toRef   = (gross * REF_REFERRER_BPS) / MAX_BPS; // 5% → referrer
            uint256 bonus = (gross * REF_BONUS_BPS) / MAX_BPS; // 5% bonus → usuario
            toOwner = totalFee - toRef - bonus;               // 5% → owner
            toUser  = gross - totalFee + bonus;               // 90%

            if (toRef > 0) {
                IERC20New(token).transfer(ref, toRef);
                referralEarnings[ref] += toRef;
                totalReferralsPaid   += toRef;
            }
        } else {
            toOwner = totalFee;       // 15% → owner
            toUser  = gross - totalFee; // 85%
        }

        // Distribuye la parte del owner entre todos los owners
        if (toOwner > 0 && owners.length > 0) {
            uint256 perOwner = toOwner / owners.length;
            uint256 dust     = toOwner - (perOwner * owners.length);
            for (uint256 i = 0; i < owners.length; i++) {
                if (owners[i] != address(0) && perOwner > 0) {
                    IERC20New(token).transfer(owners[i], perOwner);
                }
            }
            if (dust > 0) { rewardPool += dust; _recalcRewardRate(); }
        }

        if (toUser > 0) IERC20New(token).transfer(user, toUser);
        emit RewardClaimed(user, toUser, toRef, toOwner, ref);
    }

    // ─── Fee Distribution (deposit / withdraw) ────────────────────────────
    function _distributeDepositWithdrawFee(uint256 fee) internal {
        if (fee == 0) return;
        uint256 toPool   = (fee * feeToPoolBps) / MAX_BPS;
        uint256 toOwners = fee - toPool;

        if (toPool > 0) { rewardPool += toPool; _recalcRewardRate(); }

        if (toOwners > 0 && owners.length > 0) {
            uint256 perOwner = toOwners / owners.length;
            uint256 dust     = toOwners - (perOwner * owners.length);
            for (uint256 i = 0; i < owners.length; i++) {
                if (owners[i] != address(0) && perOwner > 0) {
                    IERC20New(token).transfer(owners[i], perOwner);
                }
            }
            if (dust > 0) { rewardPool += dust; _recalcRewardRate(); }
        }

        emit FeeDistributed(toPool, toOwners);
    }

    // ─── Fund Reward Pool ─────────────────────────────────────────────────
    function fundRewardPool(uint256 amount) external whenNotPaused {
        require(amount > 0, "zero amount");
        require(IERC20New(token).transferFrom(msg.sender, address(this), amount), "transfer failed");
        rewardPool += amount;
        _recalcRewardRate();
        emit RewardPoolFunded(msg.sender, amount);
    }

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

    // ─── Fee Config (solo deposit/withdraw) ───────────────────────────────
    function setFees(uint256 _depositBps, uint256 _withdrawBps) external onlyOwner {
        require(_depositBps <= MAX_FEE_BPS && _withdrawBps <= MAX_FEE_BPS, "fee too high");
        depositFeeBps  = _depositBps;
        withdrawFeeBps = _withdrawBps;
        emit FeeConfigUpdated(_depositBps, _withdrawBps);
    }

    function setFeeDistribution(uint256 _toPoolBps) external onlyOwner {
        require(_toPoolBps <= MAX_BPS, "exceeds 100%");
        feeToPoolBps = _toPoolBps;
    }

    // ─── Owner Management ─────────────────────────────────────────────────
    function addOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0) && !_isOwner(newOwner), "invalid");
        require(owners.length < MAX_OWNERS, "max owners");
        owners.push(newOwner);
        emit OwnerAdded(newOwner);
    }

    function removeOwner(address ownerAddr) external onlyOwner {
        require(owners.length > 1, "need at least 1");
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

    function getOwners() external view returns (address[] memory) { return owners; }

    // ─── Pause / Emergency ────────────────────────────────────────────────
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero address");
        IERC20New(token).transfer(to, amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────
    function getStakeInfo(address user) external view returns (
        uint256 staked,
        uint256 pendingReward,
        uint256 poolBalance,
        uint256 currentRewardRate
    ) {
        return (stakedBalance[user], earned(user), rewardPool, rewardRate);
    }

    function getReferralInfo(address user) external view returns (
        address myReferrer,
        uint256 myReferralCount,
        uint256 myReferralEarnings
    ) {
        return (referredBy[user], referralCount[user], referralEarnings[user]);
    }

    function contractBalance() external view returns (uint256) {
        return IERC20New(token).balanceOf(address(this));
    }

    // ─── Helpers ──────────────────────────────────────────────────────────
    function _isOwner(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == addr) return true;
        }
        return false;
    }
}
