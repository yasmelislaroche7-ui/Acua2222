// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AcuaBridgeWLD v3
 * @notice Bridge SUSHI World Chain ↔ BNB Chain — lado World Chain.
 *
 * FLUJO WLD→BNB  (usuario quiere SUSHI en BNB):
 *   1. Usuario llama deposit(permit, sig, amount, destBNBAddr).
 *   2. SUSHI entra al contrato (userPool).  Fee → feePool.
 *   3. Se emite RequestCreated con un ID único.
 *   4. Owner ve la lista; hace click "Aprobar" en el panel.
 *   5. Panel lee automáticamente req.destAddress y req.net.
 *   6. Panel envía TX en BNB: BNBContract.releaseToUser(destAddress, net).
 *   7. Panel llama aquí: markFulfilled(id)  →  userPool -= amount, fundPool += net.
 *      El SUSHI queda en el contrato como liquidez para el sentido inverso.
 *
 * FLUJO BNB→WLD  (usuario quiere SUSHI en World Chain):
 *   1. Usuario deposita en AcuaBridgeBNB; destAddress = wallet WLD.
 *   2. Owner hace click "Aprobar" en el panel.
 *   3. Panel lee automáticamente req.destAddress y req.net del contrato BNB.
 *   4. Panel llama aquí: releaseToUser(destAddress, net)  →  fundPool -= net, transfer.
 *   5. Panel llama en BNB: BNBContract.markFulfilled(id).
 *
 * SPLIT AUTOMÁTICO  (>splitThreshold SUSHI):
 *   - deposit() crea sub-requests de chunkSize automáticamente.
 *
 * COMISIÓN FLAT:
 *   - flatFee SUSHI por sub-request.  membershipFeeBps % → owner2 al retirar fees.
 *
 * POOLS:
 *   - fundPool:    SUSHI fondeado por owner (o acumulado de WLD→BNB procesados).
 *   - userPool:    SUSHI bloqueado de solicitudes WLD→BNB pendientes.
 *   - feePool:     Fees acumulados.
 */
contract AcuaBridgeWLD {

    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address public owner;
    address public owner2;

    address public immutable SUSHI;

    // ── Config ────────────────────────────────────────────────────────────────
    uint256 public flatFee          = 1_000 * 1e18;
    uint256 public minAmount        = 10_000 * 1e18;
    uint256 public splitThreshold   = 100_000 * 1e18;
    uint256 public chunkSize        = 10_000 * 1e18;
    uint256 public membershipFeeBps = 1_000;  // 10% → owner2
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
        address destAddress; // wallet destino en BNB (o WLD si es inverso)
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

    // ── Waiting list ──────────────────────────────────────────────────────────
    uint256[] private _waitingList;
    mapping(uint256 => uint256) private _waitingIndex;

    // ── Events ────────────────────────────────────────────────────────────────
    event RequestCreated(uint256 indexed id, address indexed user, address indexed destAddress, uint256 amount, uint256 fee, uint256 net, uint256 parentId);
    event RequestFulfilled(uint256 indexed id);
    event RequestCancelled(uint256 indexed id, address user, uint256 refund);
    event ReleasedToUser(address indexed dest, uint256 amount, string source);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event FeesWithdrawn(address indexed to, uint256 amount, uint256 toOwner2);
    event FlatFeeChanged(uint256 oldFee, uint256 newFee);
    event MinAmountChanged(uint256 oldMin, uint256 newMin);
    event SplitThresholdChanged(uint256 old, uint256 newVal);
    event ChunkSizeChanged(uint256 old, uint256 newVal);
    event MembershipFeeBpsChanged(uint256 old, uint256 newVal);
    event Paused(bool state);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event Owner2Changed(address indexed oldOwner2, address indexed newOwner2);

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
    // USER: deposit SUSHI en WLD para recibir SUSHI en BNB
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deposita SUSHI via Permit2 (gasless). destAddress = wallet en BNB.
     *   Si amount > splitThreshold → sub-requests automáticos de chunkSize.
     */
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
            user:        user,
            destAddress: dest,
            amount:      amount,
            fee:         fee,
            net:         net,
            createdAt:   block.timestamp,
            fulfilled:   false,
            cancelled:   false,
            parentId:    parentId
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
    // OWNER: marcar WLD→BNB como completado (después de enviar en BNB)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Marca una solicitud WLD→BNB como procesada.
     *   El SUSHI del usuario queda en el contrato (fundPool) como liquidez
     *   disponible para futuras solicitudes BNB→WLD. Sin hash de TX.
     */
    function markFulfilled(uint256 id) external onlyOwner {
        BridgeRequest storage req = requests[id];
        require(!req.fulfilled && !req.cancelled, "already done");
        req.fulfilled = true;
        _removeFromWaiting(id);
        unchecked {
            userPool     -= req.amount;
            fundPool     += req.net;   // net queda como liquidez para BNB→WLD
            totalBridged += req.net;
        }
        emit RequestFulfilled(id);
    }

    /**
     * @notice Marca múltiples solicitudes WLD→BNB como procesadas en un solo TX.
     */
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
    // OWNER: liberar SUSHI en WLD a usuario (viene BNB→WLD)
    // El panel lee automáticamente destAddress y net del contrato BNB.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Envía SUSHI desde fundPool al usuario WLD (BNB→WLD).
     *   destAddress y amount los lee el panel del contrato BNB automáticamente.
     *   El owner solo hace click "Aprobar" — no tipea nada.
     */
    function releaseToUser(address dest, uint256 amount) external onlyOwner notPaused {
        require(dest != address(0), "zero addr");
        require(fundPool >= amount, "insufficient fund pool");
        unchecked { fundPool -= amount; }
        require(IERC20(SUSHI).transfer(dest, amount), "transfer failed");
        unchecked { totalBridged += amount; }
        emit ReleasedToUser(dest, amount, "fund");
    }

    /**
     * @notice Libera a múltiples usuarios BNB→WLD en un solo TX.
     */
    function releaseToUserBatch(
        address[] calldata dests,
        uint256[] calldata amounts
    ) external onlyOwner notPaused {
        require(dests.length == amounts.length, "length mismatch");
        for (uint256 i; i < dests.length; ) {
            require(dests[i] != address(0), "zero addr");
            uint256 amt = amounts[i];
            require(fundPool >= amt, "insufficient fund pool");
            unchecked { fundPool -= amt; }
            require(IERC20(SUSHI).transfer(dests[i], amt), "transfer failed");
            unchecked { totalBridged += amt; }
            emit ReleasedToUser(dests[i], amt, "fund-batch");
            unchecked { ++i; }
        }
    }

    /**
     * @notice P2P: usa SUSHI del userPool (de WLD→BNB pendientes) para pagar
     *   a usuarios BNB→WLD. Marca las solicitudes WLD→BNB como completadas.
     *   El panel selecciona automáticamente los IDs a consumir.
     *   dest = dirección WLD del usuario BNB→WLD.
     *   wldToBnbIds = IDs de solicitudes WLD→BNB cuyos fondos se utilizan.
     */
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
        emit ReleasedToUser(dest, amount, "p2p");
    }

    /**
     * @notice Cancela una solicitud y devuelve SUSHI al usuario.
     */
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
    // OWNER: fondeo / retiro
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

    function withdrawAll(address to) external onlyOwner {
        uint256 amt = fundPool;
        require(amt > 0, "empty");
        fundPool = 0;
        require(IERC20(SUSHI).transfer(to, amt), "transfer failed");
        emit Withdrawn(to, amt);
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
        emit FlatFeeChanged(flatFee, _fee);
        flatFee = _fee;
    }

    function setMinAmount(uint256 _min) external onlyOwner {
        emit MinAmountChanged(minAmount, _min);
        minAmount = _min;
    }

    function setSplitThreshold(uint256 _threshold) external onlyOwner {
        emit SplitThresholdChanged(splitThreshold, _threshold);
        splitThreshold = _threshold;
    }

    function setChunkSize(uint256 _chunk) external onlyOwner {
        require(_chunk >= minAmount, "chunk < min");
        emit ChunkSizeChanged(chunkSize, _chunk);
        chunkSize = _chunk;
    }

    function setMembershipFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= 5_000, "max 50%");
        emit MembershipFeeBpsChanged(membershipFeeBps, _bps);
        membershipFeeBps = _bps;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function setOwner(address _owner) external {
        require(msg.sender == owner, "not main owner");
        require(_owner != address(0), "zero addr");
        emit OwnerChanged(owner, _owner);
        owner = _owner;
    }

    function setOwner2(address _owner2) external onlyOwner {
        emit Owner2Changed(owner2, _owner2);
        owner2 = _owner2;
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

    function getWaitingList() external view returns (uint256[] memory) {
        return _waitingList;
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

    function getRequests(uint256 offset, uint256 limit) external view returns (BridgeRequest[] memory out) {
        uint256 end = offset + limit > totalRequests ? totalRequests : offset + limit;
        out = new BridgeRequest[](end > offset ? end - offset : 0);
        for (uint256 i = offset; i < end; ) {
            out[i - offset] = requests[i];
            unchecked { ++i; }
        }
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
