// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AcuaBridgeBNB
 * @notice Bridge de SUSHI entre BNB Chain y World Chain — lado BNB.
 *
 * Flujo de depósito (usuario quiere enviar SUSHI a World Chain desde BNB):
 *   1. Usuario llama approve(SUSHI_BNB, AcuaBridgeBNB, amount) en el token.
 *   2. Usuario llama deposit(amount) → SUSHI se bloquea en el contrato.
 *   3. El contrato emite RequestCreated(id, user, amount, fee, net).
 *   4. El owner lee el evento y envía SUSHI en World Chain al usuario.
 *   5. El owner llama fulfill(id) para marcar como completada.
 *
 * Flujo de retiro (usuario recibe SUSHI en BNB desde World Chain):
 *   1. El owner ve el evento en World Chain (AcuaBridgeWLD).
 *   2. El owner llama release(user, amount) aquí para enviar SUSHI en BNB.
 *
 * Bridge inteligente:
 *   - Si hay liquidez suficiente, el owner puede procesar inmediatamente.
 *   - Si no hay liquidez, el owner la fondea antes de procesar.
 *   - Pausa de emergencia si no hay fondos.
 *
 * Gas: pagado por el usuario (BNB) al depositar y por el owner al fondear/liberar.
 */
contract AcuaBridgeBNB {

    address public owner;
    address public immutable SUSHI; // SUSHI en BNB Chain

    uint256 public feeBps;          // comisión bps (default 200 = 2%)
    uint256 public minAmount;       // mínimo en wei SUSHI
    bool    public paused;

    uint256 public totalRequests;
    uint256 public totalVolume;
    uint256 public totalFees;

    struct BridgeRequest {
        address user;
        uint256 amount;    // bruto depositado
        uint256 fee;       // fee cobrado
        uint256 net;       // neto a recibir en World Chain
        uint256 createdAt;
        bool    fulfilled;
        bool    cancelled;
    }

    mapping(uint256 => BridgeRequest) public requests;

    event RequestCreated(uint256 indexed id, address indexed user, uint256 amount, uint256 fee, uint256 net);
    event RequestFulfilled(uint256 indexed id, string wldTxHash);
    event RequestCancelled(uint256 indexed id);
    event Released(address indexed user, uint256 amount);
    event Funded(uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event FeeChanged(uint256 oldBps, uint256 newBps);
    event MinChanged(uint256 oldMin, uint256 newMin);
    event Paused(bool state);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier notPaused() {
        require(!paused, "bridge paused");
        _;
    }

    constructor(address _sushi, address _owner) {
        require(_sushi != address(0) && _owner != address(0), "zero addr");
        SUSHI    = _sushi;
        owner    = _owner;
        feeBps   = 200;    // 2%
        minAmount = 1e17;  // 0.1 SUSHI
    }

    // ────────────────────────────────────────────────────────────────────────
    // USER: deposita SUSHI en BNB para recibir SUSHI en World Chain
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deposita SUSHI para bridge hacia World Chain.
     * @dev Requiere approve previo del token SUSHI.
     *      Gas pagado por el usuario en BNB.
     */
    function deposit(uint256 amount) external notPaused returns (uint256 id) {
        require(amount >= minAmount, "below minimum");

        // Pull SUSHI from user (necesita approve previo)
        bool ok = IERC20(SUSHI).transferFrom(msg.sender, address(this), amount);
        require(ok, "transfer failed");

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 net = amount - fee;

        id = totalRequests++;
        requests[id] = BridgeRequest({
            user:      msg.sender,
            amount:    amount,
            fee:       fee,
            net:       net,
            createdAt: block.timestamp,
            fulfilled: false,
            cancelled: false
        });

        unchecked {
            totalVolume += amount;
            totalFees   += fee;
        }

        emit RequestCreated(id, msg.sender, amount, fee, net);
    }

    // ────────────────────────────────────────────────────────────────────────
    // OWNER: mark fulfilled / release / fund
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Marca como completada (owner ya envió SUSHI en World Chain).
     */
    function fulfill(uint256 id, string calldata wldTxHash) external onlyOwner {
        BridgeRequest storage req = requests[id];
        require(!req.fulfilled && !req.cancelled, "already done");
        req.fulfilled = true;
        emit RequestFulfilled(id, wldTxHash);
    }

    /**
     * @notice Cancela y devuelve SUSHI al usuario.
     */
    function cancel(uint256 id) external onlyOwner {
        BridgeRequest storage req = requests[id];
        require(!req.fulfilled && !req.cancelled, "already done");
        req.cancelled = true;
        IERC20(SUSHI).transfer(req.user, req.amount);
        emit RequestCancelled(id);
    }

    /**
     * @notice Libera SUSHI al usuario en BNB (viene de WLD → BNB).
     */
    function release(address user, uint256 amount) external onlyOwner notPaused {
        require(user != address(0), "zero addr");
        require(IERC20(SUSHI).balanceOf(address(this)) >= amount, "insufficient liquidity");
        IERC20(SUSHI).transfer(user, amount);
        emit Released(user, amount);
    }

    /**
     * @notice Owner fondea el contrato con SUSHI (transferFrom normal en BNB).
     *         Gas pagado por owner en BNB.
     */
    function fund(uint256 amount) external onlyOwner {
        bool ok = IERC20(SUSHI).transferFrom(msg.sender, address(this), amount);
        require(ok, "transfer failed");
        emit Funded(amount);
    }

    /**
     * @notice Retira SUSHI del contrato.
     */
    function withdraw(uint256 amount, address to) external onlyOwner {
        require(to != address(0), "zero addr");
        IERC20(SUSHI).transfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function withdrawAll(address to) external onlyOwner {
        withdraw(IERC20(SUSHI).balanceOf(address(this)), to);
    }

    // ────────────────────────────────────────────────────────────────────────
    // CONFIG
    // ────────────────────────────────────────────────────────────────────────

    function setFee(uint256 _bps) external onlyOwner {
        require(_bps <= 1000, "max 10%");
        emit FeeChanged(feeBps, _bps);
        feeBps = _bps;
    }

    function setMinAmount(uint256 _min) external onlyOwner {
        emit MinChanged(minAmount, _min);
        minAmount = _min;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function setOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "zero addr");
        emit OwnerChanged(owner, _owner);
        owner = _owner;
    }

    // ────────────────────────────────────────────────────────────────────────
    // VIEWS
    // ────────────────────────────────────────────────────────────────────────

    function liquidity() external view returns (uint256) {
        return IERC20(SUSHI).balanceOf(address(this));
    }

    function getRequest(uint256 id) external view returns (BridgeRequest memory) {
        return requests[id];
    }

    function getRequests(uint256 offset, uint256 limit) external view returns (BridgeRequest[] memory out) {
        uint256 end = offset + limit;
        if (end > totalRequests) end = totalRequests;
        out = new BridgeRequest[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            out[i - offset] = requests[i];
        }
    }

    /**
     * @notice Verifica si hay liquidez suficiente para procesar un monto.
     */
    function canProcess(uint256 amount) external view returns (bool) {
        return IERC20(SUSHI).balanceOf(address(this)) >= amount;
    }
}
