// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

/**
 * @title  H2OStake3
 * @notice H2O 2.0 Staking v3 — igual al stake H2O viejo pero con referidos integrados.
 *
 * ─── Mecánica de recompensas ────────────────────────────────────────────────
 *   Modelo Synthetix: el APR es de MERCADO, no lo configura el owner.
 *   APR efectivo ≈ rewardPool / totalStaked  (sube si hay más pool, baja si hay más staked)
 *   El owner sólo puede configurar los % de comisiones y fondear el pool.
 *
 * ─── Comisiones (configurables por owner, cap 20% c/u) ──────────────────────
 *   depositFeeBps  (default 0%)  → split pool/owners
 *   withdrawFeeBps (default 0%)  → split pool/owners
 *   claimFeeBps    (default 0%)  → split pool/owners
 *   feeToPoolBps   (default 100%) → qué parte de la comisión va al pool
 *
 * ─── Sistema de Referidos (15% sobre claim, integrado) ─────────────────────
 *   Sólo aplica para usuarios que tienen un referidor registrado:
 *     5% del gross → referrer  (invitador)
 *     5% del gross → usuario   (bonus devuelto)
 *     5% del gross → owner2    (fee sistema)
 *   Usuario neto: gross × 90%  (85% base + 5% bonus = 90%)
 *   Sin referidor → 100% al usuario.
 *
 * ─── Sin cola de retiros ni reclamos ────────────────────────────────────────
 *   unstake(amount) → pago inmediato
 *   claimRewards()  → pago inmediato
 *
 * Token:   0x08131A6f780AEF79E86518c4A10c06387Ec74636
 * Owner2:  0xc2ef127734f296952de75c1b58a6cec605cc2e59
 */

interface IH2O3Token {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

contract H2OStake3 {

    // ─── Addresses ────────────────────────────────────────────────────────────
    IH2O3Token public constant TOKEN        = IH2O3Token(0x08131A6f780AEF79E86518c4A10c06387Ec74636);
    address    public constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // ─── Constants ────────────────────────────────────────────────────────────
    uint256 public constant REWARD_DURATION = 365 days;
    uint256 public constant MAX_FEE_BPS     = 2_000;   // 20% cap por comisión
    uint256 public constant MAX_BPS         = 10_000;

    // Referral — hardcodeado, no configurable
    uint256 public constant REF_REFERRER_BPS = 500;   // 5% → invitador
    uint256 public constant REF_REFEREE_BPS  = 500;   // 5% → usuario (bonus)
    uint256 public constant REF_OWNER2_BPS   = 500;   // 5% → owner2

    // ─── Owners ───────────────────────────────────────────────────────────────
    address public owner;
    address public owner2;
    bool    public paused;

    // ─── Fees (configurables por owner) ───────────────────────────────────────
    uint256 public depositFeeBps  = 0;      // sin comisión por defecto
    uint256 public withdrawFeeBps = 0;      // sin comisión por defecto
    uint256 public claimFeeBps    = 0;      // sin comisión por defecto
    uint256 public feeToPoolBps   = 10_000; // 100% de cada fee va al pool

    // ─── Reward State (Synthetix-style) ───────────────────────────────────────
    uint256 public totalStaked;
    uint256 public rewardPool;
    uint256 public rewardRate;            // tokens/seg × 1e18 / totalStaked
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    // ─── Global stats ─────────────────────────────────────────────────────────
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public totalClaimed;
    uint256 public totalFeesPaid;
    uint256 public totalReferralsPaid;
    uint256 public totalFunded;
    uint256 public totalUsersCount;
    uint256 public totalReferralLinks;

    mapping(address => bool) private _isUser;

    // ─── Referral ─────────────────────────────────────────────────────────────
    mapping(address => address)   public referredBy;
    mapping(address => address[]) private _referred;
    mapping(address => uint256)   public referralCount;
    mapping(address => uint256)   public referralEarnings;

    // ─── Events ───────────────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 net, uint256 fee, address indexed referrer);
    event Unstaked(address indexed user, uint256 net, uint256 fee);
    event Claimed(address indexed user, uint256 gross, uint256 net, uint256 claimFee, address indexed referrer, uint256 referrerAmt, uint256 owner2Amt);
    event Funded(address indexed funder, uint256 amount);
    event Registered(address indexed user, address indexed referrer);
    event FeesUpdated(uint256 depositBps, uint256 withdrawBps, uint256 claimBps, uint256 toPoolBps);
    event PausedUpdated(bool val);
    event Owner2Updated(address newOwner2);
    event EmergencyWithdraw(address to, uint256 amount);

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyOwner()  { require(msg.sender == owner || msg.sender == owner2, "not owner"); _; }
    modifier onlyOwner1() { require(msg.sender == owner, "only owner1"); _; }
    modifier notPaused()  { require(!paused, "paused"); _; }
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
    constructor(address _owner2) {
        require(_owner2 != address(0), "zero owner2");
        owner  = msg.sender;
        owner2 = _owner2;
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

    /// @notice APR actual ≈ rewardPool × 1e18 / totalStaked (retorna bps × 1e14 para usar en frontend)
    function currentAprBps() public view returns (uint256) {
        if (totalStaked == 0) return 0;
        return (rewardPool * MAX_BPS) / totalStaked;
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _permit2Transfer(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig,
        uint256 amount,
        address to
    ) internal {
        IPermit2(PERMIT2_ADDR).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: to, requestedAmount: amount }),
            msg.sender,
            sig
        );
    }

    function _distributeFee(uint256 fee) internal {
        if (fee == 0) return;
        uint256 toPool   = (fee * feeToPoolBps) / MAX_BPS;
        uint256 toOwners = fee - toPool;
        if (toPool > 0) { rewardPool += toPool; _recalcRewardRate(); }
        if (toOwners > 0) {
            uint256 half = toOwners / 2;
            if (half > 0 && owner != address(0))  TOKEN.transfer(owner,  half);
            uint256 rest = toOwners - half;
            if (rest > 0 && owner2 != address(0)) TOKEN.transfer(owner2, rest);
        }
        totalFeesPaid += fee;
    }

    function _recalcRewardRate() internal {
        rewardRate     = rewardPool / REWARD_DURATION;
        lastUpdateTime = block.timestamp;
    }

    function _registerRef(address user, address referrer) internal {
        referredBy[user] = referrer;
        _referred[referrer].push(user);
        referralCount[referrer]++;
        totalReferralLinks++;
        emit Registered(user, referrer);
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    /// @notice Registrar referidor manualmente (o desde link).
    function register(address referrer) external {
        require(referrer != address(0) && referrer != msg.sender, "invalid referrer");
        require(referredBy[msg.sender] == address(0), "already registered");
        _registerRef(msg.sender, referrer);
    }

    // ─── Stake via Permit2 (World App) ────────────────────────────────────────

    /**
     * @param permit      Permit2 struct
     * @param sig         Firma off-chain
     * @param grossAmount Cantidad a depositar
     * @param referrer    Pasar address(0) si no hay referido
     */
    function stake(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig,
        uint256 grossAmount,
        address referrer
    ) external notPaused updateReward(msg.sender) {
        require(grossAmount > 0, "zero amount");
        require(permit.permitted.token == address(TOKEN), "wrong token");
        require(permit.permitted.amount >= grossAmount,   "permit too small");

        if (referrer != address(0) && referrer != msg.sender && referredBy[msg.sender] == address(0)) {
            _registerRef(msg.sender, referrer);
        }
        _permit2Transfer(permit, sig, grossAmount, address(this));
        _processDeposit(msg.sender, grossAmount);
    }

    /// @notice Stake normal (ERC20 approve).
    function stakeNormal(uint256 grossAmount, address referrer) external notPaused updateReward(msg.sender) {
        require(grossAmount > 0, "zero amount");
        if (referrer != address(0) && referrer != msg.sender && referredBy[msg.sender] == address(0)) {
            _registerRef(msg.sender, referrer);
        }
        require(TOKEN.transferFrom(msg.sender, address(this), grossAmount), "transfer failed");
        _processDeposit(msg.sender, grossAmount);
    }

    function _processDeposit(address user, uint256 gross) internal {
        uint256 fee = (gross * depositFeeBps) / MAX_BPS;
        uint256 net = gross - fee;
        _distributeFee(fee);

        stakedBalance[user] += net;
        totalStaked         += net;
        totalDeposited      += gross;

        if (!_isUser[user]) { _isUser[user] = true; totalUsersCount++; }

        emit Staked(user, net, fee, referredBy[user]);
    }

    // ─── Unstake (inmediato, sin cola) ────────────────────────────────────────

    function unstake(uint256 amount) external notPaused updateReward(msg.sender) {
        require(amount > 0, "zero amount");
        require(stakedBalance[msg.sender] >= amount, "insufficient stake");

        stakedBalance[msg.sender] -= amount;
        totalStaked               -= amount;

        uint256 fee = (amount * withdrawFeeBps) / MAX_BPS;
        uint256 net = amount - fee;
        _distributeFee(fee);

        totalWithdrawn += amount;
        TOKEN.transfer(msg.sender, net);
        emit Unstaked(msg.sender, net, fee);
    }

    // ─── Claim (inmediato, sin cola) ──────────────────────────────────────────

    function claimRewards() external notPaused updateReward(msg.sender) {
        uint256 gross = rewards[msg.sender];
        require(gross > 0, "nothing to claim");
        rewards[msg.sender] = 0;

        // 1. Comisión de claim (configurable, va al pool/owners)
        uint256 claimFee = (gross * claimFeeBps) / MAX_BPS;
        _distributeFee(claimFee);
        uint256 afterFee = gross - claimFee;

        // 2. Referral (sólo si tiene referidor)
        address referrer = referredBy[msg.sender];
        uint256 toReferrer;
        uint256 toOwner2;
        uint256 toUser = afterFee;

        if (referrer != address(0)) {
            toReferrer = afterFee * REF_REFERRER_BPS / MAX_BPS;   // 5%
            // bonus al usuario (REF_REFEREE_BPS = 5%) ya está incluido en toUser
            // sólo sacamos del toUser lo que sale hacia afuera (referrer + owner2)
            toOwner2   = afterFee * REF_OWNER2_BPS  / MAX_BPS;    // 5%
            toUser     = afterFee - toReferrer - toOwner2;         // 90%

            if (toReferrer > 0) {
                TOKEN.transfer(referrer, toReferrer);
                referralEarnings[referrer] += toReferrer;
                totalReferralsPaid         += toReferrer;
            }
            if (toOwner2 > 0 && owner2 != address(0)) TOKEN.transfer(owner2, toOwner2);
        }

        TOKEN.transfer(msg.sender, toUser);
        totalClaimed += gross;

        emit Claimed(msg.sender, gross, toUser, claimFee, referrer, toReferrer, toOwner2);
    }

    // ─── Fondear el pool ──────────────────────────────────────────────────────

    /**
     * @notice Fondear via Permit2 (World App — owner o cualquiera).
     *         El owner lo usa desde World App para fondear el pool de recompensas.
     */
    function fundRewardPool(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig,
        uint256 amount
    ) external notPaused updateReward(address(0)) {
        require(amount > 0, "zero amount");
        require(permit.permitted.token == address(TOKEN), "wrong token");
        require(permit.permitted.amount >= amount, "permit too small");
        _permit2Transfer(permit, sig, amount, address(this));
        rewardPool  += amount;
        totalFunded += amount;
        _recalcRewardRate();
        emit Funded(msg.sender, amount);
    }

    /**
     * @notice Fondear via ERC20 normal (cualquiera).
     */
    function fundRewardPoolDirect(uint256 amount) external notPaused updateReward(address(0)) {
        require(amount > 0, "zero amount");
        require(TOKEN.transferFrom(msg.sender, address(this), amount), "transfer failed");
        rewardPool  += amount;
        totalFunded += amount;
        _recalcRewardRate();
        emit Funded(msg.sender, amount);
    }

    // ─── Config (sólo comisiones, no APR) ─────────────────────────────────────

    /**
     * @notice El owner SÓLO puede cambiar los % de comisiones — NO el APR.
     */
    function setFees(
        uint256 _depositBps,
        uint256 _withdrawBps,
        uint256 _claimBps,
        uint256 _toPoolBps
    ) external onlyOwner {
        require(_depositBps  <= MAX_FEE_BPS, "deposit fee too high");
        require(_withdrawBps <= MAX_FEE_BPS, "withdraw fee too high");
        require(_claimBps    <= MAX_FEE_BPS, "claim fee too high");
        require(_toPoolBps   <= MAX_BPS,     "toPool exceeds 100%");
        depositFeeBps  = _depositBps;
        withdrawFeeBps = _withdrawBps;
        claimFeeBps    = _claimBps;
        feeToPoolBps   = _toPoolBps;
        emit FeesUpdated(_depositBps, _withdrawBps, _claimBps, _toPoolBps);
    }

    function setPaused(bool val) external onlyOwner {
        paused = val;
        emit PausedUpdated(val);
    }

    function setOwner2(address newOwner2) external onlyOwner1 {
        require(newOwner2 != address(0), "zero address");
        owner2 = newOwner2;
        emit Owner2Updated(newOwner2);
    }

    function transferOwnership(address newOwner) external onlyOwner1 {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }

    function emergencyWithdraw(uint256 amount) external onlyOwner1 {
        TOKEN.transfer(owner, amount);
        emit EmergencyWithdraw(owner, amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getUserInfo(address user) external view returns (
        uint256 staked,
        uint256 pendingReward,
        address referrer,
        uint256 refEarnings,
        uint256 refCount
    ) {
        staked        = stakedBalance[user];
        pendingReward = earned(user);
        referrer      = referredBy[user];
        refEarnings   = referralEarnings[user];
        refCount      = referralCount[user];
    }

    function getGlobalStats() external view returns (
        uint256 _totalStaked,
        uint256 _rewardPool,
        uint256 _rewardRate,
        uint256 _aprBps,
        uint256 _totalDeposited,
        uint256 _totalWithdrawn,
        uint256 _totalClaimed,
        uint256 _totalFeesPaid,
        uint256 _totalReferralsPaid,
        uint256 _totalFunded,
        uint256 _totalUsers,
        uint256 _totalReferralLinks,
        uint256 _depositFeeBps,
        uint256 _withdrawFeeBps,
        uint256 _claimFeeBps
    ) {
        return (
            totalStaked,
            rewardPool,
            rewardRate,
            currentAprBps(),
            totalDeposited,
            totalWithdrawn,
            totalClaimed,
            totalFeesPaid,
            totalReferralsPaid,
            totalFunded,
            totalUsersCount,
            totalReferralLinks,
            depositFeeBps,
            withdrawFeeBps,
            claimFeeBps
        );
    }

    function getReferrals(address user) external view returns (address[] memory) {
        return _referred[user];
    }

    function contractBalance() external view returns (uint256) {
        return TOKEN.balanceOf(address(this));
    }
}
