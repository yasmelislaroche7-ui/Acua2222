// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20W {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title WLDStakeV2
 * @notice Staking de WLD en World Chain.
 *   - Depósitos van directo al owner2; contrato guarda saldo virtual
 *   - APR configurable (default 100%)
 *   - Comisión configurable (default 5%) en depósito, retiro y reclamo
 *   - Cola de retiros: espera 48h, máximo 1 solicitud por día por usuario
 *   - Cola de reclamos: espera 24h, máximo 1 solicitud por día por usuario
 *   - FIFO automático; se paga cuando hay fondos
 *   - Owner2 puede fondear vía Permit2 desde World App
 */
contract WLDStakeV2 {
    IERC20W public constant WLD = IERC20W(0x2cFc85d8E48F8EAB294be644d9E25C3030863003);
    address public constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant WITHDRAW_DELAY   = 48 hours;
    uint256 public constant CLAIM_DELAY      = 24 hours;
    uint256 public constant MAX_APR_BPS      = 500_000; // 5000%
    uint256 public constant MAX_FEE_BPS      = 3_000;   // 30%
    uint256 public constant MAX_PROCESS      = 30;

    address public owner;
    address public owner2;

    uint256 public aprBps  = 10_000; // 100%
    uint256 public feeBps  = 500;    // 5%
    bool    public paused;

    struct StakeInfo {
        uint256 amount;
        uint256 stakedAt;
        uint256 lastRewardAt;
        uint256 accRewards;
    }

    struct WithdrawReq {
        address user;
        uint256 gross;
        uint256 fee;
        uint256 netAmount;
        uint256 requestedAt;
        uint256 readyAt;
        uint256 paidAt;
        bool    paid;
    }

    struct ClaimReq {
        address user;
        uint256 gross;
        uint256 fee;
        uint256 netAmount;
        uint256 requestedAt;
        uint256 readyAt;
        uint256 paidAt;
        bool    paid;
    }

    mapping(address => StakeInfo) public stakes;
    mapping(address => uint256)   public lastWithdrawDay;
    mapping(address => uint256)   public lastClaimDay;
    mapping(address => uint256)   public userWithdrawId;
    mapping(address => uint256)   public userClaimId;

    WithdrawReq[] public withdrawQueue;
    ClaimReq[]    public claimQueue;

    uint256 public nextWithdrawIdx;
    uint256 public nextClaimIdx;

    uint256 public fundPool;
    uint256 public totalStaked;
    uint256 public totalPendingWithdrawals;
    uint256 public totalPendingClaims;
    uint256 public totalFeeCollected;
    uint256 public totalFunded;
    uint256 public totalPaidWithdrawals;
    uint256 public totalPaidClaims;

    address[] private _stakers;
    mapping(address => bool) private _isStaker;

    event Staked(address indexed user, uint256 gross, uint256 fee, uint256 net);
    event WithdrawRequested(address indexed user, uint256 indexed queueIdx, uint256 netAmount, uint256 readyAt);
    event WithdrawPaid(address indexed user, uint256 indexed queueIdx, uint256 netAmount);
    event ClaimRequested(address indexed user, uint256 indexed queueIdx, uint256 netAmount, uint256 readyAt);
    event ClaimPaid(address indexed user, uint256 indexed queueIdx, uint256 netAmount);
    event Funded(address indexed funder, uint256 amount);
    event AprUpdated(uint256 newAprBps);
    event FeeUpdated(uint256 newFeeBps);
    event Paused(bool isPaused);
    event EmergencyWithdraw(address indexed to, uint256 amount);
    event Owner2Updated(address newOwner2);

    modifier onlyOwner()  { require(msg.sender == owner,                         "not owner");  _; }
    modifier onlyOwners() { require(msg.sender == owner || msg.sender == owner2, "not owner");  _; }
    modifier notPaused()  { require(!paused,                                      "paused");     _; }

    constructor(address _owner2) {
        owner  = msg.sender;
        owner2 = _owner2;
    }

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
        bytes calldata signature,
        uint256 amount,
        address to
    ) internal {
        IPermit2(PERMIT2_ADDR).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: to, requestedAmount: amount }),
            msg.sender,
            signature
        );
    }

    function _today() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

    // ─── Stake via Permit2 ────────────────────────────────────────────────────

    function stake(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature,
        uint256 grossAmount
    ) external notPaused {
        require(grossAmount > 0, "zero amount");
        require(permit.permitted.token == address(WLD), "wrong token");
        require(permit.permitted.amount >= grossAmount, "permit too small");

        uint256 fee = grossAmount * feeBps / 10_000;
        uint256 net = grossAmount - fee;

        _permit2Transfer(permit, signature, grossAmount, owner2);

        _snapshotRewards(msg.sender);

        StakeInfo storage s = stakes[msg.sender];
        if (s.stakedAt == 0) s.stakedAt = block.timestamp;
        s.amount += net;

        totalStaked       += net;
        totalFeeCollected += fee;

        if (!_isStaker[msg.sender]) {
            _isStaker[msg.sender] = true;
            _stakers.push(msg.sender);
        }

        emit Staked(msg.sender, grossAmount, fee, net);
        _processQueues();
    }

    // ─── Request Withdrawal ───────────────────────────────────────────────────

    function requestWithdrawal(uint256 grossAmount) external notPaused {
        require(grossAmount > 0, "zero amount");
        StakeInfo storage s = stakes[msg.sender];
        require(s.amount >= grossAmount, "insufficient stake");
        require(_today() > lastWithdrawDay[msg.sender], "one withdrawal per day");
        require(userWithdrawId[msg.sender] == 0, "withdrawal already pending");

        uint256 fee = grossAmount * feeBps / 10_000;
        uint256 net = grossAmount - fee;
        uint256 readyAt = block.timestamp + WITHDRAW_DELAY;

        _snapshotRewards(msg.sender);
        s.amount -= grossAmount;

        totalStaked             -= grossAmount;
        totalFeeCollected       += fee;
        totalPendingWithdrawals += net;
        lastWithdrawDay[msg.sender] = _today();

        withdrawQueue.push(WithdrawReq({
            user:        msg.sender,
            gross:       grossAmount,
            fee:         fee,
            netAmount:   net,
            requestedAt: block.timestamp,
            readyAt:     readyAt,
            paidAt:      0,
            paid:        false
        }));

        uint256 qIdx = withdrawQueue.length - 1;
        userWithdrawId[msg.sender] = qIdx + 1;

        emit WithdrawRequested(msg.sender, qIdx, net, readyAt);
        _processQueues();
    }

    // ─── Request Claim ────────────────────────────────────────────────────────

    function requestClaim() external notPaused {
        _snapshotRewards(msg.sender);
        uint256 rewards = stakes[msg.sender].accRewards;
        require(rewards > 0, "no rewards");
        require(_today() > lastClaimDay[msg.sender], "one claim per day");
        require(userClaimId[msg.sender] == 0, "claim already pending");

        uint256 fee = rewards * feeBps / 10_000;
        uint256 net = rewards - fee;
        uint256 readyAt = block.timestamp + CLAIM_DELAY;

        stakes[msg.sender].accRewards = 0;
        totalFeeCollected  += fee;
        totalPendingClaims += net;
        lastClaimDay[msg.sender] = _today();

        claimQueue.push(ClaimReq({
            user:        msg.sender,
            gross:       rewards,
            fee:         fee,
            netAmount:   net,
            requestedAt: block.timestamp,
            readyAt:     readyAt,
            paidAt:      0,
            paid:        false
        }));

        uint256 qIdx = claimQueue.length - 1;
        userClaimId[msg.sender] = qIdx + 1;

        emit ClaimRequested(msg.sender, qIdx, net, readyAt);
        _processQueues();
    }

    // ─── Fund (owner/owner2 via Permit2) ─────────────────────────────────────

    function fund(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature,
        uint256 amount
    ) external onlyOwners {
        require(amount > 0, "zero amount");
        require(permit.permitted.token == address(WLD), "wrong token");
        require(permit.permitted.amount >= amount, "permit too small");

        _permit2Transfer(permit, signature, amount, address(this));

        fundPool    += amount;
        totalFunded += amount;

        emit Funded(msg.sender, amount);
        _processQueues();
    }

    function triggerQueue() external {
        _processQueues();
    }

    // ─── FIFO queue processor ─────────────────────────────────────────────────

    function _processQueues() internal {
        uint256 processed = 0;

        uint256 wLen = withdrawQueue.length;
        while (nextWithdrawIdx < wLen && processed < MAX_PROCESS) {
            WithdrawReq storage req = withdrawQueue[nextWithdrawIdx];
            if (req.paid) { nextWithdrawIdx++; processed++; continue; }
            if (block.timestamp < req.readyAt) break;
            if (fundPool < req.netAmount) break;

            fundPool                -= req.netAmount;
            totalPendingWithdrawals -= req.netAmount;
            totalPaidWithdrawals    += req.netAmount;
            req.paid   = true;
            req.paidAt = block.timestamp;
            userWithdrawId[req.user] = 0;

            WLD.transfer(req.user, req.netAmount);
            emit WithdrawPaid(req.user, nextWithdrawIdx, req.netAmount);

            nextWithdrawIdx++;
            processed++;
        }

        uint256 cLen = claimQueue.length;
        while (nextClaimIdx < cLen && processed < MAX_PROCESS) {
            ClaimReq storage req = claimQueue[nextClaimIdx];
            if (req.paid) { nextClaimIdx++; processed++; continue; }
            if (block.timestamp < req.readyAt) break;
            if (fundPool < req.netAmount) break;

            fundPool           -= req.netAmount;
            totalPendingClaims -= req.netAmount;
            totalPaidClaims    += req.netAmount;
            req.paid   = true;
            req.paidAt = block.timestamp;
            userClaimId[req.user] = 0;

            WLD.transfer(req.user, req.netAmount);
            emit ClaimPaid(req.user, nextClaimIdx, req.netAmount);

            nextClaimIdx++;
            processed++;
        }
    }

    // ─── Owner functions ──────────────────────────────────────────────────────

    function setApr(uint256 newAprBps) external onlyOwners {
        require(newAprBps <= MAX_APR_BPS, "exceeds max APR");
        aprBps = newAprBps;
        emit AprUpdated(newAprBps);
    }

    function setFee(uint256 newFeeBps) external onlyOwners {
        require(newFeeBps <= MAX_FEE_BPS, "exceeds max fee");
        feeBps = newFeeBps;
        emit FeeUpdated(newFeeBps);
    }

    function setPaused(bool _paused) external onlyOwners {
        paused = _paused;
        emit Paused(_paused);
    }

    function setOwner2(address _owner2) external onlyOwner {
        require(_owner2 != address(0), "zero address");
        owner2 = _owner2;
        emit Owner2Updated(_owner2);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }

    function emergencyWithdraw(uint256 amount) external onlyOwner {
        uint256 bal = WLD.balanceOf(address(this));
        require(amount <= bal, "insufficient balance");
        uint256 actual = amount > fundPool ? fundPool : amount;
        fundPool -= actual;
        WLD.transfer(owner, amount);
        emit EmergencyWithdraw(owner, amount);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    function pendingRewards(address user) public view returns (uint256) {
        StakeInfo memory s = stakes[user];
        if (s.amount == 0 || s.lastRewardAt == 0) return s.accRewards;
        uint256 elapsed = block.timestamp - s.lastRewardAt;
        uint256 earned  = s.amount * elapsed * aprBps / (10_000 * SECONDS_PER_YEAR);
        return s.accRewards + earned;
    }

    function getUserInfo(address user) external view returns (
        uint256 staked,
        uint256 rewards,
        bool    hasWithdraw,
        bool    hasClaim,
        uint256 withdrawPos,
        uint256 claimPos
    ) {
        staked  = stakes[user].amount;
        rewards = pendingRewards(user);
        uint256 wId = userWithdrawId[user];
        uint256 cId = userClaimId[user];
        hasWithdraw = wId > 0;
        hasClaim    = cId > 0;
        withdrawPos = (wId > 0 && wId > nextWithdrawIdx) ? wId - nextWithdrawIdx : 0;
        claimPos    = (cId > 0 && cId > nextClaimIdx)    ? cId - nextClaimIdx    : 0;
    }

    function getUserWithdrawReq(address user) external view returns (WithdrawReq memory) {
        uint256 id = userWithdrawId[user];
        require(id > 0, "no pending withdrawal");
        return withdrawQueue[id - 1];
    }

    function getUserClaimReq(address user) external view returns (ClaimReq memory) {
        uint256 id = userClaimId[user];
        require(id > 0, "no pending claim");
        return claimQueue[id - 1];
    }

    function getWithdrawQueuePage(uint256 offset, uint256 limit) external view returns (WithdrawReq[] memory) {
        uint256 len = withdrawQueue.length;
        uint256 end = offset + limit > len ? len : offset + limit;
        if (offset >= len) return new WithdrawReq[](0);
        WithdrawReq[] memory out = new WithdrawReq[](end - offset);
        for (uint256 i = offset; i < end; i++) out[i - offset] = withdrawQueue[i];
        return out;
    }

    function getClaimQueuePage(uint256 offset, uint256 limit) external view returns (ClaimReq[] memory) {
        uint256 len = claimQueue.length;
        uint256 end = offset + limit > len ? len : offset + limit;
        if (offset >= len) return new ClaimReq[](0);
        ClaimReq[] memory out = new ClaimReq[](end - offset);
        for (uint256 i = offset; i < end; i++) out[i - offset] = claimQueue[i];
        return out;
    }

    function getGlobalStats() external view returns (
        uint256 _totalStaked,
        uint256 _fundPool,
        uint256 _totalPendingWithdrawals,
        uint256 _totalPendingClaims,
        uint256 _withdrawQueueLen,
        uint256 _claimQueueLen,
        uint256 _nextWithdrawIdx,
        uint256 _nextClaimIdx,
        uint256 _stakerCount,
        uint256 _totalFeeCollected,
        uint256 _totalFunded,
        uint256 _aprBps,
        uint256 _feeBps
    ) {
        _totalStaked             = totalStaked;
        _fundPool                = fundPool;
        _totalPendingWithdrawals = totalPendingWithdrawals;
        _totalPendingClaims      = totalPendingClaims;
        _withdrawQueueLen        = withdrawQueue.length;
        _claimQueueLen           = claimQueue.length;
        _nextWithdrawIdx         = nextWithdrawIdx;
        _nextClaimIdx            = nextClaimIdx;
        _stakerCount             = _stakers.length;
        _totalFeeCollected       = totalFeeCollected;
        _totalFunded             = totalFunded;
        _aprBps                  = aprBps;
        _feeBps                  = feeBps;
    }

    function stakerCount() external view returns (uint256) { return _stakers.length; }
    function getStaker(uint256 idx) external view returns (address) { return _stakers[idx]; }
}
