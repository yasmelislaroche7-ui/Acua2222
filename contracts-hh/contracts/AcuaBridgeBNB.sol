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
 *   1. Usuario llama approve(SUSHI_BNB, AcuaBridgeBNB, amount).
 *   2. Usuario llama deposit(amount, destAddress) → SUSHI se bloquea.
 *   3. El contrato emite RequestCreated(id, user, destAddress, amount, fee, net).
 *   4. El owner lee el evento y envía SUSHI en World Chain al destAddress.
 *   5. El owner llama fulfill(id, wldTxHash) para marcar como completada.
 *
 * Flujo de retiro (usuario recibe SUSHI en BNB desde World Chain):
 *   1. El owner ve el evento en World Chain (AcuaBridgeWLD).
 *   2. El owner llama release(user, amount) aquí → SUSHI va a la wallet del usuario.
 *
 * Multi-owner:
 *   - owner  (principal)
 *   - owner2 (secundario — 0x5474C309e985c6B4Fc623acf01AdE604dA781e52)
 *
 * Gas:
 *   - Optimizado para BNB Chain: uso mínimo de storage writes
 *   - unchecked en acumuladores
 *   - transferFrom directo (sin Permit2 — BNB no tiene Permit2 universal)
 *   - Fondeo del owner también con transferFrom (aprueba antes de llamar fund())
 */
contract AcuaBridgeBNB {

    address public owner;
    address public owner2; // 0x5474C309e985c6B4Fc623acf01AdE604dA781e52

    address public immutable SUSHI; // SUSHI en BNB Chain

    uint256 public feeBps;    // comisión bps (default 200 = 2%)
    uint256 public minAmount; // mínimo en wei SUSHI
    bool    public paused;

    uint256 public totalRequests;
    uint256 public totalVolume;
    uint256 public totalFees;

    struct BridgeRequest {
        address user;
        address destAddress; // wallet destino en World Chain
        uint256 amount;      // bruto depositado
        uint256 fee;         // fee cobrado
        uint256 net;         // neto a recibir en World Chain
        uint256 createdAt;
        bool    fulfilled;
        bool    cancelled;
    }

    mapping(uint256 => BridgeRequest) public requests;

    event RequestCreated(uint256 indexed id, address indexed user, address indexed destAddress, uint256 amount, uint256 fee, uint256 net);
    event RequestFulfilled(uint256 indexed id, string wldTxHash);
    event RequestCancelled(uint256 indexed id);
    event Released(address indexed user, uint256 amount);
    event Funded(uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event FeeChanged(uint256 oldBps, uint256 newBps);
    event MinChanged(uint256 oldMin, uint256 newMin);
    event Paused(bool state);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event Owner2Changed(address indexed oldOwner2, address indexed newOwner2);

    modifier onlyOwner() {
        require(msg.sender == owner || msg.sender == owner2, "not owner");
        _;
    }

    modifier notPaused() {
        require(!paused, "bridge paused");
        _;
    }

    /**
     * @param _sushi   Dirección del token SUSHI en BNB Chain
     * @param _owner   Owner principal
     * @param _owner2  Owner secundario (ej: 0x5474C309e985c6B4Fc623acf01AdE604dA781e52)
     */
    constructor(address _sushi, address _owner, address _owner2) {
        require(_sushi != address(0) && _owner != address(0), "zero addr");
        SUSHI    = _sushi;
        owner    = _owner;
        owner2   = _owner2;
        feeBps   = 200;    // 2%
        minAmount = 1e17;  // 0.1 SUSHI
    }

    // ────────────────────────────────────────────────────────────────────────
    // USER: deposita SUSHI en BNB para recibir SUSHI en World Chain
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deposita SUSHI para bridge hacia World Chain.
     * @param amount      Cantidad bruta de SUSHI
     * @param destAddress Dirección destino en World Chain (World Wallet o importada)
     * @dev Requiere approve() previo del token SUSHI al contrato.
     *      Gas optimizado: single storage write per request.
     */
    function deposit(uint256 amount, address destAddress) external notPaused returns (uint256 id) {
        require(amount >= minAmount, "below minimum");
        require(destAddress != address(0), "zero dest");

        // Pull SUSHI from user
        require(IERC20(SUSHI).transferFrom(msg.sender, address(this), amount), "transfer failed");

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 net = amount - fee;

        id = totalRequests++;
        requests[id] = BridgeRequest({
            user:        msg.sender,
            destAddress: destAddress,
            amount:      amount,
            fee:         fee,
            net:         net,
            createdAt:   block.timestamp,
            fulfilled:   false,
            cancelled:   false
        });

        unchecked {
            totalVolume += amount;
            totalFees   += fee;
        }

        emit RequestCreated(id, msg.sender, destAddress, amount, fee, net);
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
     * @notice Cancela y devuelve SUSHI al usuario original.
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
     *         El SUSHI va directamente a la wallet del usuario (destAddress del WLD request).
     */
    function release(address user, uint256 amount) external onlyOwner notPaused {
        require(user != address(0), "zero addr");
        require(IERC20(SUSHI).balanceOf(address(this)) >= amount, "insufficient liquidity");
        IERC20(SUSHI).transfer(user, amount);
        emit Released(user, amount);
    }

    /**
     * @notice Owner fondea el contrato con SUSHI.
     *         Requiere approve() previo del SUSHI al contrato.
     *         Gas en BNB es pagado por el owner en BNB.
     */
    function fund(uint256 amount) external onlyOwner {
        require(IERC20(SUSHI).transferFrom(msg.sender, address(this), amount), "transfer failed");
        emit Funded(amount);
    }

    /**
     * @notice Retira SUSHI del contrato (fees acumuladas + liquidez).
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

    /// @notice Solo el owner principal puede cambiar el owner principal
    function setOwner(address _owner) external {
        require(msg.sender == owner, "not main owner");
        require(_owner != address(0), "zero addr");
        emit OwnerChanged(owner, _owner);
        owner = _owner;
    }

    /// @notice Cualquier owner puede cambiar el owner2
    function setOwner2(address _owner2) external onlyOwner {
        emit Owner2Changed(owner2, _owner2);
        owner2 = _owner2;
    }

    // ────────────────────────────────────────────────────────────────────────
    // VIEWS — lectura gratuita (sin gas)
    // ────────────────────────────────────────────────────────────────────────

    function isOwner(address addr) external view returns (bool) {
        return addr == owner || addr == owner2;
    }

    /// @notice Verifica si hay liquidez suficiente para procesar un monto
    function canProcess(uint256 amount) external view returns (bool) {
        return IERC20(SUSHI).balanceOf(address(this)) >= amount;
    }

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
}
