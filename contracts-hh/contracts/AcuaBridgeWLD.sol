// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AcuaBridgeWLD v2
 * @notice Bridge SUSHI World Chain ↔ BNB Chain — lado World Chain.
 *
 * FLUJO WLD→BNB  (usuario quiere SUSHI en BNB):
 *   1. Usuario llama deposit(permit, sig, amount, destAddr).
 *   2. SUSHI queda bloqueado en el contrato (userPool).
 *   3. Se emite RequestCreated y el ID entra en waitingList.
 *   4. Owner ve la lista y llama fulfill(id, bnbTxHash) después de enviar en BNB.
 *   5. Si liquidez disponible en BNB → processFromFund en BNB; si no → P2P.
 *
 * FLUJO BNB→WLD  (usuario quiere SUSHI en WLD):
 *   1. Owner recibe SUSHI en BNB (vía AcuaBridgeBNB.deposit).
 *   2. Owner llama release(user, amount) aquí → SUSHI llega al usuario.
 *   3. Para release usa fundPool (liquidez propia) o releaseFromUsers (P2P offset).
 *
 * SPLIT AUTOMÁTICO  (>100 000 SUSHI):
 *   - deposit() acepta cualquier monto; si supera splitThreshold crea sub-requests
 *     de chunkSize automáticamente para facilitar el proceso manual.
 *
 * COMISIÓN FLAT:
 *   - flatFee SUSHI por cada sub-request (mínimo minAmount).
 *   - membershipFeeBps: % de los fees totales destinado a owner2 (default 10%).
 *
 * POOLS SEPARADOS:
 *   - fundPool:   SUSHI pre-fondeado por owners.
 *   - userPool:   SUSHI bloqueado de usuarios WLD→BNB pendientes.
 *   - feePool:    Fees acumulados (owner los retira con withdrawFees).
 *   - totalBridged: contador público acumulado.
 */
contract AcuaBridgeWLD {

    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address public owner;
    address public owner2;

    address public immutable SUSHI;

    // ── Config ───────────────────────────────────────────────────────────────
    uint256 public flatFee        = 1_000 * 1e18;    // 1 000 SUSHI por sub-request
    uint256 public minAmount      = 10_000 * 1e18;   // mínimo por sub-request
    uint256 public splitThreshold = 100_000 * 1e18;  // si supera → auto-split
    uint256 public chunkSize      = 10_000 * 1e18;   // tamaño de cada chunk
    uint256 public membershipFeeBps = 1_000;          // 10% → owner2 (de los fees)
    bool    public paused;

    // ── Pools ─────────────────────────────────────────────────────────────────
    uint256 public fundPool;    // SUSHI fondeado por owners
    uint256 public userPool;    // SUSHI bloqueado de usuarios pendientes WLD→BNB
    uint256 public feePool;     // Fees acumulados pendientes de retiro
    uint256 public totalBridged; // acumulado total procesado (lifetime)
    uint256 public totalVolume;
    uint256 public totalFeesCollected;

    // ── Request ───────────────────────────────────────────────────────────────
    struct BridgeRequest {
        address user;
        address destAddress;  // wallet en BNB
        uint256 amount;       // gross del chunk
        uint256 fee;          // flatFee cobrado
        uint256 net;          // amount - fee
        uint256 createdAt;
        bool    fulfilled;
        bool    cancelled;
        uint256 parentId;     // 0 = sin parent; >0 = chunk de un deposit grande
    }

    mapping(uint256 => BridgeRequest) public requests;
    uint256 public totalRequests;

    // ── Waiting list ──────────────────────────────────────────────────────────
    uint256[] private _waitingList;                       // IDs pendientes
    mapping(uint256 => uint256) private _waitingIndex;    // id → índice+1 en _waitingList

    // ── Events ────────────────────────────────────────────────────────────────
    event RequestCreated(uint256 indexed id, address indexed user, address indexed destAddress, uint256 amount, uint256 fee, uint256 net, uint256 parentId);
    event RequestFulfilled(uint256 indexed id, string bnbTxHash);
    event RequestCancelled(uint256 indexed id, address user, uint256 refund);
    event Released(address indexed user, uint256 amount, string source);
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
     * @notice Deposita SUSHI para bridge hacia BNB (usa Permit2 — gasless approve).
     *   Si amount > splitThreshold → se crean varios sub-requests de chunkSize.
     *   Si amount <= splitThreshold → se crea un solo request.
     *   Cada sub-request cobra flatFee.  Mínimo por chunk: minAmount.
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

        // Pull tokens una sola vez
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
        uint256 parentId  = type(uint256).max; // centinela antes del primer chunk
        bool    isFirst   = true;

        while (remaining >= minAmount) {
            uint256 chunk = remaining > chunkSize ? chunkSize : remaining;
            uint256 id    = _createRequest(user, dest, chunk, isFirst ? 0 : firstId);
            if (isFirst) { firstId = id; parentId = id; isFirst = false; }
            remaining -= chunk;
        }
        // Resto menor a minAmount: devolverlo al usuario
        if (remaining > 0) {
            require(IERC20(SUSHI).transfer(user, remaining), "refund failed");
        }
    }

    function _createRequest(address user, address dest, uint256 amount, uint256 parentId) internal returns (uint256 id) {
        uint256 fee = amount >= flatFee ? flatFee : amount / 10; // fallback 10% si fee > amount
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
    // OWNER: fulfillment / release / cancel
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Marca una solicitud WLD→BNB como completada.
     *   Llamar DESPUÉS de haber enviado los SUSHI en BNB.
     */
    function fulfill(uint256 id, string calldata bnbTxHash) external onlyOwner {
        BridgeRequest storage req = requests[id];
        require(!req.fulfilled && !req.cancelled, "already done");
        req.fulfilled = true;
        _removeFromWaiting(id);
        unchecked {
            userPool    -= req.amount;
            totalBridged += req.net;
        }
        emit RequestFulfilled(id, bnbTxHash);
    }

    /**
     * @notice Procesa múltiples solicitudes WLD→BNB de una vez.
     */
    function fulfillBatch(uint256[] calldata ids, string calldata bnbTxHash) external onlyOwner {
        for (uint256 i; i < ids.length; ) {
            BridgeRequest storage req = requests[ids[i]];
            if (!req.fulfilled && !req.cancelled) {
                req.fulfilled = true;
                _removeFromWaiting(ids[i]);
                unchecked {
                    userPool    -= req.amount;
                    totalBridged += req.net;
                }
                emit RequestFulfilled(ids[i], bnbTxHash);
            }
            unchecked { ++i; }
        }
    }

    /**
     * @notice Cancela una solicitud WLD→BNB y devuelve SUSHI al usuario.
     */
    function cancel(uint256 id) external onlyOwner {
        BridgeRequest storage req = requests[id];
        require(!req.fulfilled && !req.cancelled, "already done");
        req.cancelled = true;
        _removeFromWaiting(id);
        uint256 refund = req.amount; // devuelve TODO (incluyendo fee) al usuario
        unchecked { userPool -= req.amount; }
        require(IERC20(SUSHI).transfer(req.user, refund), "refund failed");
        emit RequestCancelled(id, req.user, refund);
    }

    /**
     * @notice Libera SUSHI en WLD a un usuario (viene BNB→WLD).
     *   Usa el fundPool (liquidez del owner).
     */
    function releaseFromFund(address user, uint256 amount) external onlyOwner notPaused {
        require(user != address(0), "zero addr");
        require(fundPool >= amount, "insufficient fund pool");
        unchecked { fundPool -= amount; }
        require(IERC20(SUSHI).transfer(user, amount), "transfer failed");
        emit Released(user, amount, "fund");
    }

    /**
     * @notice Libera SUSHI en WLD usando el userPool (P2P offset).
     *   Se usa cuando hay usuarios WLD→BNB cuyos SUSHI sirven para pagar BNB→WLD.
     *   ids[] = solicitudes WLD→BNB que se marcan fulfilled simultáneamente.
     *   La suma de sus .amount debe cubrir amount.
     */
    function releaseFromUsers(
        address user,
        uint256 amount,
        uint256[] calldata wldToBnbIds,
        string calldata bnbTxHash
    ) external onlyOwner notPaused {
        require(user != address(0), "zero addr");
        require(userPool >= amount, "insufficient user pool");

        // Marcar como fulfilled las solicitudes WLD→BNB consumidas
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
                emit RequestFulfilled(wldToBnbIds[i], bnbTxHash);
            }
            unchecked { ++i; }
        }
        require(covered >= amount, "covered < amount");

        unchecked { userPool -= amount; }
        require(IERC20(SUSHI).transfer(user, amount), "transfer failed");
        emit Released(user, amount, "users-p2p");
    }

    /**
     * @notice Lanzar release a múltiples usuarios en un solo tx.
     */
    function releaseBatch(
        address[] calldata users,
        uint256[] calldata amounts
    ) external onlyOwner notPaused {
        require(users.length == amounts.length, "length mismatch");
        for (uint256 i; i < users.length; ) {
            require(users[i] != address(0), "zero addr");
            uint256 amt = amounts[i];
            require(fundPool >= amt, "insufficient fund pool");
            unchecked { fundPool -= amt; }
            require(IERC20(SUSHI).transfer(users[i], amt), "transfer failed");
            emit Released(users[i], amt, "fund-batch");
            unchecked { ++i; }
        }
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
        fundPool = 0;
        require(IERC20(SUSHI).transfer(to, amt), "transfer failed");
        emit Withdrawn(to, amt);
    }

    /**
     * @notice Retira fees acumulados.  membershipFeeBps % va a owner2.
     */
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
            toMain += toOwner2; // si no hay owner2, todo al caller
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

    /// @notice Balance total del contrato (userPool + fundPool + feePool deben sumar esto)
    function contractBalance() external view returns (uint256) {
        return IERC20(SUSHI).balanceOf(address(this));
    }

    function waitingCount() external view returns (uint256) {
        return _waitingList.length;
    }

    function getWaitingList() external view returns (uint256[] memory) {
        return _waitingList;
    }

    /// @notice Devuelve datos completos de los requests pendientes (paginado)
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
    // INTERNAL: waiting list helpers (O(1) remove via swap-and-pop)
    // ─────────────────────────────────────────────────────────────────────────

    function _addToWaiting(uint256 id) internal {
        _waitingIndex[id] = _waitingList.length + 1; // 1-based
        _waitingList.push(id);
    }

    function _removeFromWaiting(uint256 id) internal {
        uint256 idx1 = _waitingIndex[id];
        if (idx1 == 0) return; // no estaba en la lista
        uint256 idx  = idx1 - 1;
        uint256 last = _waitingList[_waitingList.length - 1];
        _waitingList[idx] = last;
        _waitingIndex[last] = idx + 1;
        _waitingList.pop();
        delete _waitingIndex[id];
    }
}
