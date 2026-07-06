// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

/**
 * @title  H2OStakeV5
 * @notice H2O ACUA Company staking — igual que V4 (APR configurable, recompensas
 *         por segundo, retiros y reclamos 24/7 sin tiempos de espera, referidos
 *         integrados) pero con comisión de 5% en depósito y 5% en retiro.
 *
 * Token:   0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd (H2O ACUA Company)
 * Deposit: comisión configurable (default 5%) — va directo a owner2
 * Retiro:  INSTANTÁNEO, sin cola, sin delay — comisión configurable (default 5%) va a owner2
 * Claim:   INSTANTÁNEO, sin cooldown — igual que V4 (comisión solo si hay referido)
 *
 * Distribución de recompensas cuando hay referido (15% del gross):
 *   5% → referrer (invitador)
 *   5% → referee  (usuario — bonus devuelto)
 *   5% → owner2
 *   Net usuario = gross × 90% (85% base + 5% bonus)
 * Sin referido → usuario recibe 100% del gross en claim.
 *
 * Funding: cualquiera puede fondear via Permit2 (World App) o ERC20 directo.
 */

interface IH2OV5Token {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

contract H2OStakeV5 {

    // ─── Addresses ───────────────────────────────────────────────────────────
    IH2OV5Token public constant TOKEN        = IH2OV5Token(0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd);
    address     public constant PERMIT2_ADDR  = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // ─── Constants ───────────────────────────────────────────────────────────
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant MAX_APR_BPS      = 100_000;  // 1000 % hard cap
    uint256 public constant MAX_FEE_BPS      = 2_000;    // 20 % hard cap on deposit/withdraw fee

    // Referral fee split (bps out of 10_000) — aplica solo al claim
    uint256 public constant REF_REFERRER_BPS = 500;  // 5 %
    uint256 public constant REF_REFEREE_BPS  = 500;  // 5 % (returned to user)
    uint256 public constant REF_OWNER2_BPS   = 500;  // 5 %

    // ─── Owners ──────────────────────────────────────────────────────────────
    address public owner;
    address public owner2;
    bool    public paused;

    // ─── APR & Fees ──────────────────────────────────────────────────────────
    uint256 public aprBps = 1_200;   // 12 % APR (mercado — configurable)
    uint256 public depositFeeBps  = 500;  // 5 % comisión de depósito → owner2
    uint256 public withdrawFeeBps = 500;  // 5 % comisión de retiro   → owner2

    // ─── Global stats ────────────────────────────────────────────────────────
    uint256 public totalStaked;
    uint256 public fundPool;          // tokens disponibles para retiros y claims
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public totalClaimed;
    uint256 public totalFeesPaid;
    uint256 public totalDepositFeesPaid;
    uint256 public totalWithdrawFeesPaid;
    uint256 public totalReferralsPaid;
    uint256 public totalFunded;
    uint256 public totalUsersCount;
    uint256 public totalReferralLinks;

    // ─── Per-user stats ───────────────────────────────────────────────────────
    mapping(address => uint256) public totalDepositedBy;
    mapping(address => uint256) public totalWithdrawnBy;
    mapping(address => uint256) public totalClaimedBy;

    // ─── Stake ───────────────────────────────────────────────────────────────
    struct StakeInfo {
        uint256 amount;
        uint256 stakedAt;
        uint256 lastRewardAt;
        uint256 accRewards;
    }

    mapping(address => StakeInfo) public stakes;
    address[] private _stakers;
    mapping(address => bool) private _isStaker;

    // ─── Referral ────────────────────────────────────────────────────────────
    mapping(address => address)   public referredBy;
    mapping(address => address[]) private _referred;
    mapping(address => uint256)   public referralCount;
    mapping(address => uint256)   public referralEarnings;

    // ─── Events ──────────────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 grossAmount, uint256 fee, uint256 netAmount, address indexed referrer);
    event Withdrawn(address indexed user, uint256 grossAmount, uint256 fee, uint256 netAmount);
    event Claimed(
        address indexed user,
        uint256 gross,
        uint256 netToUser,
        address indexed referrer,
        uint256 referrerAmt,
        uint256 refereeBonus,
        uint256 owner2Amt
    );
    event Registered(address indexed user, address indexed referrer);
    event Funded(address indexed funder, uint256 amount);
    event AprUpdated(uint256 newAprBps);
    event DepositFeeUpdated(uint256 newFeeBps);
    event WithdrawFeeUpdated(uint256 newFeeBps);
    event PausedUpdated(bool val);
    event Owner2Updated(address newOwner2);
    event EmergencyWithdraw(address to, uint256 amount);

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyOwner()  { require(msg.sender == owner || msg.sender == owner2, "not owner"); _; }
    modifier onlyOwner1() { require(msg.sender == owner, "only owner1"); _; }
    modifier notPaused()  { require(!paused, "paused"); _; }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _owner2) {
        require(_owner2 != address(0), "zero owner2");
        owner  = msg.sender;
        owner2 = _owner2;
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    function _snapshotRewards(address user) internal {
        StakeInfo storage s = stakes[user];
        if (s.amount > 0 && s.lastRewardAt > 0) {
            uint256 elapsed = block.timestamp - s.lastRewardAt;
            s.accRewards += s.amount * elapsed * aprBps / (10_000 * SECONDS_PER_YEAR);
        }
        s.lastRewardAt = block.timestamp;
    }

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

    // ─── Registration ────────────────────────────────────────────────────────

    function register(address referrer) external {
        require(referrer != address(0),   "zero referrer");
        require(referrer != msg.sender,   "self-referral");
        require(referredBy[msg.sender] == address(0), "already registered");
        _registerRef(msg.sender, referrer);
    }

    function _registerRef(address user, address referrer) internal {
        referredBy[user] = referrer;
        _referred[referrer].push(user);
        referralCount[referrer]++;
        totalReferralLinks++;
        emit Registered(user, referrer);
    }

    // ─── Stake via Permit2 ────────────────────────────────────────────────────

    function stake(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig,
        uint256 grossAmount,
        address referrer
    ) external notPaused {
        require(grossAmount > 0, "zero amount");
        require(permit.permitted.token == address(TOKEN), "wrong token");
        require(permit.permitted.amount >= grossAmount,   "permit too small");

        if (referrer != address(0) && referrer != msg.sender && referredBy[msg.sender] == address(0)) {
            _registerRef(msg.sender, referrer);
        }

        _permit2Transfer(permit, sig, grossAmount, address(this));
        _doStake(msg.sender, grossAmount);
    }

    /**
     * @notice Depositar via ERC20 approve normal (sin Permit2 / wallet importada).
     */
    function stakeNormal(uint256 grossAmount, address referrer) external notPaused {
        require(grossAmount > 0, "zero amount");
        if (referrer != address(0) && referrer != msg.sender && referredBy[msg.sender] == address(0)) {
            _registerRef(msg.sender, referrer);
        }
        require(TOKEN.transferFrom(msg.sender, address(this), grossAmount), "transfer failed");
        _doStake(msg.sender, grossAmount);
    }

    function _doStake(address user, uint256 grossAmount) internal {
        _snapshotRewards(user);

        uint256 fee = grossAmount * depositFeeBps / 10_000;
        uint256 netAmount = grossAmount - fee;

        StakeInfo storage s = stakes[user];
        if (s.stakedAt == 0) {
            s.stakedAt = block.timestamp;
            totalUsersCount++;
        }
        if (!_isStaker[user]) {
            _isStaker[user] = true;
            _stakers.push(user);
        }
        if (s.lastRewardAt == 0) s.lastRewardAt = block.timestamp;

        s.amount       += netAmount;
        totalStaked    += netAmount;
        totalDeposited += grossAmount;
        fundPool       += netAmount;
        totalDepositedBy[user] += grossAmount;

        if (fee > 0) {
            totalDepositFeesPaid += fee;
            totalFeesPaid        += fee;
            if (owner2 != address(0)) TOKEN.transfer(owner2, fee);
        }

        emit Staked(user, grossAmount, fee, netAmount, referredBy[user]);
    }

    // ─── Withdraw — INSTANTÁNEO, sin delay ────────────────────────────────────

    /**
     * @notice Retirar tokens stakeados de forma inmediata (24/7, sin cola).
     * @param amount Cantidad a retirar (sobre el balance stakeado). Pasa type(uint256).max para retirar todo.
     */
    function withdraw(uint256 amount) external notPaused {
        StakeInfo storage s = stakes[msg.sender];

        uint256 withdrawAmount = (amount == type(uint256).max) ? s.amount : amount;
        require(withdrawAmount > 0,            "zero amount");
        require(s.amount >= withdrawAmount,    "insufficient stake");
        require(fundPool >= withdrawAmount,    "insufficient pool");

        _snapshotRewards(msg.sender);

        uint256 fee = withdrawAmount * withdrawFeeBps / 10_000;
        uint256 netAmount = withdrawAmount - fee;

        s.amount       -= withdrawAmount;
        totalStaked    -= withdrawAmount;
        totalWithdrawn += withdrawAmount;
        fundPool       -= withdrawAmount;
        totalWithdrawnBy[msg.sender] += withdrawAmount;

        if (fee > 0) {
            totalWithdrawFeesPaid += fee;
            totalFeesPaid         += fee;
            if (owner2 != address(0)) TOKEN.transfer(owner2, fee);
        }
        TOKEN.transfer(msg.sender, netAmount);

        emit Withdrawn(msg.sender, withdrawAmount, fee, netAmount);
    }

    // ─── Claim — INSTANTÁNEO, sin cooldown ───────────────────────────────────

    /**
     * @notice Reclamar recompensas acumuladas (24/7, en cualquier momento).
     *         Sin comisión salvo que el usuario tenga referido (igual que V4).
     */
    function claimRewards() external notPaused {
        _snapshotRewards(msg.sender);
        uint256 gross = stakes[msg.sender].accRewards;
        require(gross > 0,           "no rewards");
        require(fundPool >= gross,   "insufficient fund pool");

        stakes[msg.sender].accRewards = 0;
        fundPool -= gross;

        address referrer = referredBy[msg.sender];
        uint256 toReferrer;
        uint256 toReferee;
        uint256 toOwner2;
        uint256 netToUser;

        if (referrer != address(0)) {
            toReferrer = gross * REF_REFERRER_BPS / 10_000;
            toReferee  = gross * REF_REFEREE_BPS  / 10_000;
            toOwner2   = gross * REF_OWNER2_BPS   / 10_000;
            netToUser  = gross - toReferrer - toOwner2;

            totalFeesPaid      += toReferrer + toOwner2;
            totalReferralsPaid += toReferrer;
            referralEarnings[referrer] += toReferrer;

            TOKEN.transfer(referrer, toReferrer);
            if (owner2 != address(0)) TOKEN.transfer(owner2, toOwner2);
            TOKEN.transfer(msg.sender, netToUser);
        } else {
            netToUser = gross;
            TOKEN.transfer(msg.sender, gross);
        }

        totalClaimed += gross;
        totalClaimedBy[msg.sender] += gross;

        emit Claimed(msg.sender, gross, netToUser, referrer, toReferrer, toReferee, toOwner2);
    }

    // ─── Fondeo del pool ──────────────────────────────────────────────────────

    function fund(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig,
        uint256 amount
    ) external onlyOwner {
        require(amount > 0, "zero amount");
        require(permit.permitted.token == address(TOKEN), "wrong token");
        require(permit.permitted.amount >= amount, "permit too small");
        _permit2Transfer(permit, sig, amount, address(this));
        fundPool    += amount;
        totalFunded += amount;
        emit Funded(msg.sender, amount);
    }

    function fundDirect(uint256 amount) external {
        require(amount > 0, "zero amount");
        require(TOKEN.transferFrom(msg.sender, address(this), amount), "transfer failed");
        fundPool    += amount;
        totalFunded += amount;
        emit Funded(msg.sender, amount);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setApr(uint256 newAprBps) external onlyOwner {
        require(newAprBps <= MAX_APR_BPS, "exceeds max APR");
        aprBps = newAprBps;
        emit AprUpdated(newAprBps);
    }

    function setDepositFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "exceeds max fee");
        depositFeeBps = newFeeBps;
        emit DepositFeeUpdated(newFeeBps);
    }

    function setWithdrawFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "exceeds max fee");
        withdrawFeeBps = newFeeBps;
        emit WithdrawFeeUpdated(newFeeBps);
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

    // ─── Views ───────────────────────────────────────────────────────────────

    function pendingRewards(address user) public view returns (uint256) {
        StakeInfo memory s = stakes[user];
        if (s.amount == 0 || s.lastRewardAt == 0) return s.accRewards;
        uint256 elapsed = block.timestamp - s.lastRewardAt;
        return s.accRewards + s.amount * elapsed * aprBps / (10_000 * SECONDS_PER_YEAR);
    }

    function getUserInfo(address user) external view returns (
        uint256 staked,
        uint256 rewards,
        address referrer,
        uint256 refEarnings,
        uint256 refCount,
        uint256 totalDep,
        uint256 totalWith,
        uint256 totalClaim
    ) {
        staked      = stakes[user].amount;
        rewards     = pendingRewards(user);
        referrer    = referredBy[user];
        refEarnings = referralEarnings[user];
        refCount    = referralCount[user];
        totalDep    = totalDepositedBy[user];
        totalWith   = totalWithdrawnBy[user];
        totalClaim  = totalClaimedBy[user];
    }

    function getGlobalStats() external view returns (
        uint256 _totalStaked,
        uint256 _fundPool,
        uint256 _totalDeposited,
        uint256 _totalWithdrawn,
        uint256 _totalClaimed,
        uint256 _totalFeesPaid,
        uint256 _totalReferralsPaid,
        uint256 _totalFunded,
        uint256 _totalUsers,
        uint256 _totalReferralLinks,
        uint256 _aprBps,
        uint256 _depositFeeBps,
        uint256 _withdrawFeeBps,
        bool    _paused
    ) {
        return (
            totalStaked,
            fundPool,
            totalDeposited,
            totalWithdrawn,
            totalClaimed,
            totalFeesPaid,
            totalReferralsPaid,
            totalFunded,
            totalUsersCount,
            totalReferralLinks,
            aprBps,
            depositFeeBps,
            withdrawFeeBps,
            paused
        );
    }

    function getStakers() external view returns (address[] memory) {
        return _stakers;
    }

    function getReferrals(address referrer) external view returns (address[] memory) {
        return _referred[referrer];
    }
}
