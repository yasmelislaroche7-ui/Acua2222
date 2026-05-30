// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

/**
 * @title  H2OStake2
 * @notice H2O 2.0 staking — mercado anual APR, token 1:1, referidos integrados.
 *
 * Token:   0x08131A6f780AEF79E86518c4A10c06387Ec74636 (H2O 2.0)
 * Deposit: 1:1, cero comisión de entrada
 * Retiro:  cola 48h FIFO, cero comisión
 * Claim:   inmediato; si el usuario tiene referido:
 *            15% del gross se reparte:
 *              5% → invitador (referrer)
 *              5% → invitado  (referee, el propio usuario — bonus devuelto)
 *              5% → owner2
 *          Net usuario = gross − 5%(referrer) − 5%(owner2) + 5%(bonus) = gross × 90%
 *          Sin referido → usuario recibe 100% del gross.
 *
 * Funding: cualquiera puede fondear via Permit2 (World App) o ERC20 directo.
 * Stats:   mapeo completo on-chain (totalDeposited, totalWithdrawn, totalClaimed,
 *          totalFeesPaid, totalReferralsPaid, totalFunded, totalUsers, etc.)
 */

interface IH2O2Token {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

contract H2OStake2 {

    // ─── Addresses ───────────────────────────────────────────────────────────
    IH2O2Token public constant TOKEN       = IH2O2Token(0x08131A6f780AEF79E86518c4A10c06387Ec74636);
    address    public constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // ─── Constants ───────────────────────────────────────────────────────────
    uint256 public constant SECONDS_PER_YEAR   = 365 days;
    uint256 public constant WITHDRAW_DELAY     = 48 hours;
    uint256 public constant MAX_APR_BPS        = 100_000;  // 1000 % hard cap
    uint256 public constant MAX_PROCESS        = 30;

    // Referral fee split (bps out of 10_000)
    uint256 public constant REF_REFERRER_BPS   = 500;  // 5 %
    uint256 public constant REF_REFEREE_BPS    = 500;  // 5 % (returned to user)
    uint256 public constant REF_OWNER2_BPS     = 500;  // 5 %

    // ─── Owners ──────────────────────────────────────────────────────────────
    address public owner;
    address public owner2;
    bool    public paused;

    // ─── APR ─────────────────────────────────────────────────────────────────
    uint256 public aprBps = 1_200;   // 12 % APR (mercado — configurable)

    // ─── Global stats ────────────────────────────────────────────────────────
    uint256 public totalStaked;
    uint256 public fundPool;
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public totalClaimed;
    uint256 public totalFeesPaid;        // sum paid to referrer + owner2
    uint256 public totalReferralsPaid;   // sum paid to referrers
    uint256 public totalFunded;          // total funded externally
    uint256 public totalUsersCount;      // ever staked
    uint256 public totalReferralLinks;   // registrations
    uint256 public totalPendingWithdrawals;
    uint256 public totalPaidWithdrawals;

    // ─── Per-user stats ───────────────────────────────────────────────────────
    mapping(address => uint256) public totalDepositedBy;
    mapping(address => uint256) public totalWithdrawnBy;
    mapping(address => uint256) public totalClaimedBy;
    mapping(address => uint256) public totalFeesEarnedByRef;  // referrer earnings

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

    // ─── Withdraw queue ───────────────────────────────────────────────────────
    struct WithdrawReq {
        address user;
        uint256 amount;
        uint256 requestedAt;
        uint256 readyAt;
        uint256 paidAt;
        bool    paid;
    }

    WithdrawReq[] public withdrawQueue;
    uint256 public  nextWithdrawIdx;
    mapping(address => uint256) public pendingWithdrawId;  // 0 = none, 1-indexed

    // ─── Referral ────────────────────────────────────────────────────────────
    mapping(address => address)   public referredBy;          // user → referrer
    mapping(address => address[]) private _referred;          // referrer → all users
    mapping(address => uint256)   public referralCount;       // how many invited
    mapping(address => uint256)   public referralEarnings;    // referrer income

    // ─── Events ──────────────────────────────────────────────────────────────
    event Staked(
        address indexed user,
        uint256 amount,
        address indexed referrer
    );
    event WithdrawRequested(
        address indexed user,
        uint256 indexed queueIdx,
        uint256 amount,
        uint256 readyAt
    );
    event WithdrawPaid(
        address indexed user,
        uint256 indexed queueIdx,
        uint256 amount
    );
    event Claimed(
        address indexed user,
        uint256 gross,
        uint256 netToUser,
        address indexed referrer,
        uint256 referrerAmt,
        uint256 refereeBonus,
        uint256 owner2Amt
    );
    event Registered(
        address indexed user,
        address indexed referrer
    );
    event Funded(address indexed funder, uint256 amount);
    event AprUpdated(uint256 newAprBps);
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

    function _processQueue() internal {
        uint256 len = withdrawQueue.length;
        uint256 processed = 0;
        while (nextWithdrawIdx < len && processed < MAX_PROCESS) {
            WithdrawReq storage req = withdrawQueue[nextWithdrawIdx];
            if (req.paid) { nextWithdrawIdx++; processed++; continue; }
            if (block.timestamp < req.readyAt) break;
            if (fundPool < req.amount)         break;

            fundPool               -= req.amount;
            totalPendingWithdrawals -= req.amount;
            totalPaidWithdrawals   += req.amount;
            req.paid    = true;
            req.paidAt  = block.timestamp;
            pendingWithdrawId[req.user] = 0;

            TOKEN.transfer(req.user, req.amount);
            emit WithdrawPaid(req.user, nextWithdrawIdx, req.amount);

            nextWithdrawIdx++;
            processed++;
        }
    }

    // ─── Registration ────────────────────────────────────────────────────────

    /**
     * @notice Registrar un referidor manualmente.
     *         Útil para usuarios que ya tienen la app instalada.
     *         También se llama automáticamente en stake() si se pasa referrer.
     */
    function register(address referrer) external {
        require(referrer != address(0),    "zero referrer");
        require(referrer != msg.sender,    "self-referral");
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

    /**
     * @notice Depositar H2O vía Permit2 (World App, gasless).
     * @param permit      Permit2 struct (token, amount, nonce, deadline).
     * @param sig         Firma off-chain.
     * @param grossAmount Cantidad a depositar (1:1, sin comisión de entrada).
     * @param referrer    Pasa address(0) si no hay referido, o la dirección del
     *                    invitador para auto-registrar en el primer depósito.
     */
    function stake(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig,
        uint256 grossAmount,
        address referrer
    ) external notPaused {
        require(grossAmount > 0, "zero amount");
        require(permit.permitted.token == address(TOKEN), "wrong token");
        require(permit.permitted.amount >= grossAmount,   "permit too small");

        // Auto-registro si viene con ref y aún no está registrado
        if (referrer != address(0) && referrer != msg.sender && referredBy[msg.sender] == address(0)) {
            _registerRef(msg.sender, referrer);
        }

        _permit2Transfer(permit, sig, grossAmount, address(this));
        _doStake(msg.sender, grossAmount);
    }

    /**
     * @notice Depositar H2O vía ERC20 approve normal (sin Permit2).
     */
    function stakeNormal(uint256 grossAmount, address referrer) external notPaused {
        require(grossAmount > 0, "zero amount");
        if (referrer != address(0) && referrer != msg.sender && referredBy[msg.sender] == address(0)) {
            _registerRef(msg.sender, referrer);
        }
        require(TOKEN.transferFrom(msg.sender, address(this), grossAmount), "transfer failed");
        _doStake(msg.sender, grossAmount);
    }

    function _doStake(address user, uint256 amount) internal {
        _snapshotRewards(user);

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

        s.amount        += amount;
        totalStaked     += amount;
        totalDeposited  += amount;
        fundPool        += amount;
        totalDepositedBy[user] += amount;

        emit Staked(user, amount, referredBy[user]);
        _processQueue();
    }

    // ─── Withdraw ────────────────────────────────────────────────────────────

    function requestWithdrawal(uint256 amount) external notPaused {
        require(amount > 0, "zero amount");
        require(pendingWithdrawId[msg.sender] == 0, "withdrawal already pending");

        StakeInfo storage s = stakes[msg.sender];
        require(s.amount >= amount, "insufficient stake");

        _snapshotRewards(msg.sender);
        s.amount        -= amount;
        totalStaked     -= amount;
        totalWithdrawn  += amount;
        totalWithdrawnBy[msg.sender] += amount;
        totalPendingWithdrawals      += amount;

        uint256 readyAt = block.timestamp + WITHDRAW_DELAY;
        withdrawQueue.push(WithdrawReq({
            user:        msg.sender,
            amount:      amount,
            requestedAt: block.timestamp,
            readyAt:     readyAt,
            paidAt:      0,
            paid:        false
        }));
        uint256 idx = withdrawQueue.length - 1;
        pendingWithdrawId[msg.sender] = idx + 1;

        emit WithdrawRequested(msg.sender, idx, amount, readyAt);
        _processQueue();
    }

    function triggerQueue() external { _processQueue(); }

    // ─── Claim ───────────────────────────────────────────────────────────────

    /**
     * @notice Reclamar recompensas acumuladas.
     *
     * Distribución cuando hay referido (15% total del gross):
     *   5% → referrer (invitador)
     *   5% → referee  (el propio usuario — bonus devuelto)
     *   5% → owner2
     *   Usuario recibe gross × 90% total (85% base + 5% bonus = 90%).
     *
     * Sin referido: usuario recibe gross × 100%.
     */
    function claimRewards() external notPaused {
        _snapshotRewards(msg.sender);
        uint256 gross = stakes[msg.sender].accRewards;
        require(gross > 0, "no rewards");
        require(fundPool >= gross, "insufficient fund pool");

        stakes[msg.sender].accRewards = 0;
        fundPool -= gross;

        address referrer = referredBy[msg.sender];
        uint256 toReferrer;
        uint256 toReferee;   // bonus devuelto al usuario
        uint256 toOwner2;
        uint256 netToUser;

        if (referrer != address(0)) {
            toReferrer = gross * REF_REFERRER_BPS / 10_000;
            toReferee  = gross * REF_REFEREE_BPS  / 10_000;
            toOwner2   = gross * REF_OWNER2_BPS   / 10_000;
            // El usuario recibe el gross minus las partes que salen del pool
            // toward externas (referrer + owner2), más el bonus que vuelve a él.
            netToUser  = gross - toReferrer - toOwner2;
            // (netToUser incluye toReferee ya que se calcula como gross - salidas externas)

            // Actualizar estadísticas
            totalFeesPaid      += toReferrer + toOwner2;
            totalReferralsPaid += toReferrer;
            referralEarnings[referrer] += toReferrer;

            // Pagos
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
        _processQueue();
    }

    // ─── Fondeo del pool ─────────────────────────────────────────────────────

    /**
     * @notice Fondear el pool via Permit2 (World App).
     *         Cualquier owner puede fondear.
     */
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
        _processQueue();
    }

    /**
     * @notice Fondear el pool via ERC20 approve normal.
     *         Cualquiera puede fondear (usuarios, contratos, bots).
     */
    function fundDirect(uint256 amount) external {
        require(amount > 0, "zero amount");
        require(TOKEN.transferFrom(msg.sender, address(this), amount), "transfer failed");
        fundPool    += amount;
        totalFunded += amount;
        emit Funded(msg.sender, amount);
        _processQueue();
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setApr(uint256 newAprBps) external onlyOwner {
        require(newAprBps <= MAX_APR_BPS, "exceeds max APR");
        aprBps = newAprBps;
        emit AprUpdated(newAprBps);
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
        bool    hasPendingWithdraw,
        uint256 withdrawReadyAt,
        address referrer,
        uint256 refEarnings,
        uint256 refCount
    ) {
        staked   = stakes[user].amount;
        rewards  = pendingRewards(user);
        uint256 wId = pendingWithdrawId[user];
        if (wId > 0) {
            hasPendingWithdraw = true;
            withdrawReadyAt    = withdrawQueue[wId - 1].readyAt;
        }
        referrer    = referredBy[user];
        refEarnings = referralEarnings[user];
        refCount    = referralCount[user];
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
        uint256 _withdrawQueueLen,
        uint256 _totalPendingWithdrawals,
        uint256 _totalPaidWithdrawals
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
            withdrawQueue.length,
            totalPendingWithdrawals,
            totalPaidWithdrawals
        );
    }

    function getReferrals(address user) external view returns (address[] memory) {
        return _referred[user];
    }

    function getWithdrawReq(address user) external view returns (WithdrawReq memory) {
        uint256 id = pendingWithdrawId[user];
        require(id > 0, "no pending withdrawal");
        return withdrawQueue[id - 1];
    }

    function getWithdrawPage(uint256 offset, uint256 limit) external view
        returns (WithdrawReq[] memory)
    {
        uint256 len = withdrawQueue.length;
        if (offset >= len) return new WithdrawReq[](0);
        uint256 end = offset + limit > len ? len : offset + limit;
        WithdrawReq[] memory out = new WithdrawReq[](end - offset);
        for (uint256 i = offset; i < end; i++) out[i - offset] = withdrawQueue[i];
        return out;
    }

    function stakerCount() external view returns (uint256) { return _stakers.length; }
    function getStaker(uint256 idx) external view returns (address) { return _stakers[idx]; }
    function contractBalance() external view returns (uint256) { return TOKEN.balanceOf(address(this)); }
}
