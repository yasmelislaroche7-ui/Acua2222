// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AcuaBridgeWLD v3-lean
 * @notice Bridge SUSHI World Chain ↔ BNB Chain — lado World Chain.
 *
 * FLUJO WLD→BNB  (usuario quiere SUSHI en BNB):
 *   1. deposit(permit, sig, amount, destBNBAddr) via Permit2 (gasless).
 *   2. Owner click "Aprobar" → Panel TX1: BNBContract.releaseToUser(dest, net).
 *   3. Panel TX2: markFulfilled(id) → SUSHI queda como liquidez (fundPool).
 *
 * FLUJO BNB→WLD  (usuario quiere SUSHI en World Chain):
 *   1. Usuario deposita en AcuaBridgeBNB.
 *   2. Owner click "Aprobar" → Panel TX1: releaseToUser(dest, net).
 *   3. Panel TX2: BNBContract.markFulfilled(id).
 *
 * SPLIT: deposit() > splitThreshold → sub-requests automáticos de chunkSize.
 * COMISIÓN: membershipFeeBps % de fees → owner2 al llamar withdrawFees().
 * POOLS: fundPool (owner), userPool (pendientes), feePool (comisiones).
 */
contract AcuaBridgeWLD {

    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address public owner;
    address public owner2;
    address public immutable SUSHI;

    // ── Peer contract (BNB side) — changeable ─────────────────────────────────
    address public peerContract;

    event PeerContractChanged(address indexed prev, address indexed next);

    // ── Config ────────────────────────────────────────────────────────────────
    uint256 public flatFee          = 1_000 * 1e18;
    uint256 public minAmount        = 10_000 * 1e18;
    uint256 public splitThreshold   = 100_000 * 1e18;
    uint256 public chunkSize        = 10_000 * 1e18;
    uint256 public membershipFeeBps = 1_000;
    bool    public paused;

    // ── Pools ─────────────────────────────────────────────────────────────────
    uint256 public fundPool;
    uint256 public userPool;
    uint256 public feePool;
    uint256 public totalBridged;
    uint256 public totalVolume;
    uint256 public totalFeesCollected;

    // ── Request ───────────────────────────────────────────────────────────────
    struct BridgeRequest {
        address user;
        address destAddress;
        uint256 amount;
        uint256 fee;
        uint256 net;
        uint256 createdAt;
        bool    fulfilled;
        bool    cancelled;
        uint256 parentId;
    }

    mapping(uint256 => BridgeRequest) public requests;
    uint256 public totalRequests;

    uint256[] private _waitingList;
    mapping(uint256 => uint256) private _waitingIndex;

    // ── Events ────────────────────────────────────────────────────────────────
    event RequestCreated(uint256 indexed id, address indexed user, address indexed destAddress, uint256 amount, uint256 fee, uint256 net, uint256 parentId);
    event RequestFulfilled(uint256 indexed id);
    event RequestCancelled(uint256 indexed id, address user, uint256 refund);
    event ReleasedToUser(address indexed dest, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event FeesWithdrawn(address indexed to, uint256 amount, uint256 toOwner2);
    event ConfigChanged(bytes32 indexed key, uint256 val);
    event Paused(bool state);

    modifier onlyOwner() {
        require(msg.sender == owner || msg.sender == owner2, "not owner");
        _;
    }
    modifier notPaused() { require(!paused, "bridge paused"); _; }

    constructor(address _sushi, address _owner, address _owner2) {
        require(_sushi != address(0) && _owner != address(0), "zero addr");
        SUSHI  = _sushi;
        owner  = _owner;
        owner2 = _owner2;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // USER: depositar SUSHI en WLD para recibir en BNB (Permit2 gasless)
    // ─────────────────────────────────────────────────────────────────────────

    function deposit(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature,
        uint256 amount,
        address destAddress
    ) external notPaused returns (uint256 firstId) {
        require(amount >= minAmount, "below minimum");
        require(permit.permitted.token == SUSHI, "wrong token");
        require(permit.permitted.amount >= amount, "permit amount low");
        require(destAddress != address(0), "zero dest");

        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            signature
        );

        unchecked { totalVolume += amount; }

        if (amount > splitThreshold) {
            firstId = _createSplit(msg.sender, destAddress, amount);
        } else {
            firstId = _createRequest(msg.sender, destAddress, amount, 0);
        }
    }

    function _createSplit(address user, address dest, uint256 total) internal returns (uint256 firstId) {
        uint256 remaining = total;
        bool    isFirst   = true;
        while (remaining >= minAmount) {
            uint256 chunk = remaining > chunkSize ? chunkSize : remaining;
            uint256 id    = _createRequest(user, dest, chunk, isFirst ? 0 : firstId);
            if (isFirst) { firstId = id; isFirst = false; }
            remaining -= chunk;
        }
        if (remaining > 0) {
            require(IERC20(SUSHI).transfer(user, remaining), "refund failed");
        }
    }

    function _createRequest(address user, address dest, uint256 amount, uint256 parentId) internal returns (uint256 id) {
        uint256 fee = amount >= flatFee ? flatFee : amount / 10;
        require(amount > fee, "fee exceeds amount");
        uint256 net = amount - fee;

        id = totalRequests++;
        requests[id] = BridgeRequest({
            user: user, destAddress: dest, amount: amount, fee: fee, net: net,
            createdAt: block.timestamp, fulfilled: false, cancelled: false, parentId: parentId
        });

        unchecked {
            userPool           += amount;
            feePool            += fee;
            totalFeesCollected += fee;
        }
        _addToWaiting(id);
        emit RequestCreated(id, user, dest, amount, fee, net, parentId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OWNER: marcar WLD→BNB como completado
    // ─────────────────────────────────────────────────────────────────────────

    function markFulfilled(uint256 id) external onlyOwner {
        BridgeRequest storage req = requests[id];
        require(!req.fulfilled && !req.cancelled, "already done");
        req.fulfilled = true;
        _removeFromWaiting(id);
        unchecked {
            userPool     -= req.amount;
            fundPool     += req.net;
            totalBridged += req.net;
        }
        emit RequestFulfilled(id);
    }

    function markFulfilledBatch(uint256[] calldata ids) external onlyOwner {
        for (uint256 i; i < ids.length; ) {
            BridgeRequest storage req = requests[ids[i]];
            if (!req.fulfilled && !req.cancelled) {
                req.fulfilled = true;
                _removeFromWaiting(ids[i]);
                unchecked {
                    userPool     -= req.amount;
                    fundPool     += req.net;
                    totalBridged += req.net;
                }
                emit RequestFulfilled(ids[i]);
            }
            unchecked { ++i; }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OWNER: liberar SUSHI en WLD a usuario (BNB→WLD)
    // ─────────────────────────────────────────────────────────────────────────

    function releaseToUser(address dest, uint256 amount) external onlyOwner notPaused {
        require(dest != address(0), "zero addr");
        require(fundPool >= amount, "insufficient fund pool");
        unchecked { fundPool -= amount; }
        require(IERC20(SUSHI).transfer(dest, amount), "transfer failed");
        unchecked { totalBridged += amount; }
        emit ReleasedToUser(dest, amount);
    }

    function processP2P(
        address dest,
        uint256 amount,
        uint256[] calldata wldToBnbIds
    ) external onlyOwner notPaused {
        require(dest != address(0), "zero addr");
        require(userPool >= amount, "insufficient user pool");
        uint256 covered;
        for (uint256 i; i < wldToBnbIds.length; ) {
            BridgeRequest storage req = requests[wldToBnbIds[i]];
            if (!req.fulfilled && !req.cancelled) {
                req.fulfilled = true;
                _removeFromWaiting(wldToBnbIds[i]);
                unchecked {
                    covered      += req.amount;
                    totalBridged += req.net;
                }
                emit RequestFulfilled(wldToBnbIds[i]);
            }
            unchecked { ++i; }
        }
        require(covered >= amount, "covered < amount");
        unchecked { userPool -= amount; }
        require(IERC20(SUSHI).transfer(dest, amount), "transfer failed");
        emit ReleasedToUser(dest, amount);
    }

    function cancel(uint256 id) external onlyOwner {
        BridgeRequest storage req = requests[id];
        require(!req.fulfilled && !req.cancelled, "already done");
        req.cancelled = true;
        _removeFromWaiting(id);
        uint256 refund = req.amount;
        unchecked { userPool -= req.amount; }
        require(IERC20(SUSHI).transfer(req.user, refund), "refund failed");
        emit RequestCancelled(id, req.user, refund);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OWNER: fondeo via Permit2 / retiro
    // ─────────────────────────────────────────────────────────────────────────

    function fund(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature,
        uint256 amount
    ) external onlyOwner {
        require(permit.permitted.token == SUSHI, "wrong token");
        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            signature
        );
        unchecked { fundPool += amount; }
        emit Funded(msg.sender, amount);
    }

    function withdraw(uint256 amount, address to) external onlyOwner {
        require(to != address(0), "zero addr");
        require(fundPool >= amount, "insufficient fund pool");
        unchecked { fundPool -= amount; }
        require(IERC20(SUSHI).transfer(to, amount), "transfer failed");
        emit Withdrawn(to, amount);
    }

    function withdrawFees(address to) external onlyOwner {
        require(to != address(0), "zero addr");
        uint256 total = feePool;
        require(total > 0, "no fees");
        feePool = 0;
        uint256 toOwner2 = (total * membershipFeeBps) / 10_000;
        uint256 toMain   = total - toOwner2;
        if (toOwner2 > 0 && owner2 != address(0)) {
            require(IERC20(SUSHI).transfer(owner2, toOwner2), "fee2 failed");
        } else {
            toMain += toOwner2;
        }
        require(IERC20(SUSHI).transfer(to, toMain), "fee failed");
        emit FeesWithdrawn(to, toMain, toOwner2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CONFIG
    // ─────────────────────────────────────────────────────────────────────────

    function setFlatFee(uint256 _fee) external onlyOwner {
        flatFee = _fee;
        emit ConfigChanged("flatFee", _fee);
    }

    function setMinAmount(uint256 _min) external onlyOwner {
        minAmount = _min;
        emit ConfigChanged("minAmount", _min);
    }

    function setSplitThreshold(uint256 _threshold) external onlyOwner {
        splitThreshold = _threshold;
        emit ConfigChanged("splitThreshold", _threshold);
    }

    function setChunkSize(uint256 _chunk) external onlyOwner {
        require(_chunk >= minAmount, "chunk < min");
        chunkSize = _chunk;
        emit ConfigChanged("chunkSize", _chunk);
    }

    function setMembershipFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= 5_000, "max 50%");
        membershipFeeBps = _bps;
        emit ConfigChanged("membershipFeeBps", _bps);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function setOwner(address _owner) external {
        require(msg.sender == owner, "not main owner");
        require(_owner != address(0), "zero addr");
        owner = _owner;
    }

    function setOwner2(address _owner2) external onlyOwner {
        owner2 = _owner2;
    }

    function setPeerContract(address _peer) external onlyOwner {
        emit PeerContractChanged(peerContract, _peer);
        peerContract = _peer;
    }

    /// @notice Anyone (e.g. UI routing 2% stake fees) can donate SUSHI to fundPool via permit.
    function receiveFee(uint256 amount) external {
        require(amount > 0, "zero");
        require(IERC20(SUSHI).transferFrom(msg.sender, address(this), amount), "transfer failed");
        unchecked { fundPool += amount; }
        emit Funded(msg.sender, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VIEWS
    // ─────────────────────────────────────────────────────────────────────────

    function isOwner(address addr) external view returns (bool) {
        return addr == owner || addr == owner2;
    }

    function contractBalance() external view returns (uint256) {
        return IERC20(SUSHI).balanceOf(address(this));
    }

    function waitingCount() external view returns (uint256) {
        return _waitingList.length;
    }

    function getWaitingRequests(uint256 offset, uint256 limit)
        external view returns (BridgeRequest[] memory out, uint256[] memory ids)
    {
        uint256 total = _waitingList.length;
        uint256 end   = offset + limit > total ? total : offset + limit;
        uint256 len   = end > offset ? end - offset : 0;
        out = new BridgeRequest[](len);
        ids = new uint256[](len);
        for (uint256 i; i < len; ) {
            ids[i] = _waitingList[offset + i];
            out[i] = requests[ids[i]];
            unchecked { ++i; }
        }
    }

    function getRequest(uint256 id) external view returns (BridgeRequest memory) {
        return requests[id];
    }

    function getStats() external view returns (
        uint256 _totalRequests,
        uint256 _waitingCount,
        uint256 _fundPool,
        uint256 _userPool,
        uint256 _feePool,
        uint256 _totalBridged,
        uint256 _totalVolume,
        uint256 _totalFeesCollected,
        uint256 _flatFee,
        uint256 _minAmount,
        bool    _paused
    ) {
        _totalRequests      = totalRequests;
        _waitingCount       = _waitingList.length;
        _fundPool           = fundPool;
        _userPool           = userPool;
        _feePool            = feePool;
        _totalBridged       = totalBridged;
        _totalVolume        = totalVolume;
        _totalFeesCollected = totalFeesCollected;
        _flatFee            = flatFee;
        _minAmount          = minAmount;
        _paused             = paused;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL: waiting list O(1) remove
    // ─────────────────────────────────────────────────────────────────────────

    function _addToWaiting(uint256 id) internal {
        _waitingIndex[id] = _waitingList.length + 1;
        _waitingList.push(id);
    }

    function _removeFromWaiting(uint256 id) internal {
        uint256 idx1 = _waitingIndex[id];
        if (idx1 == 0) return;
        uint256 idx  = idx1 - 1;
        uint256 last = _waitingList[_waitingList.length - 1];
        _waitingList[idx] = last;
        _waitingIndex[last] = idx + 1;
        _waitingList.pop();
        delete _waitingIndex[id];
    }
}
