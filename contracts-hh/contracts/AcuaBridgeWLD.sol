// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AcuaBridgeWLD
 * @notice Bridge de SUSHI entre World Chain y BNB Chain — lado World Chain.
 *
 * Flujo de depósito (usuario quiere enviar SUSHI a BNB):
 *   1. Usuario llama deposit(permit, sig, amount) → SUSHI se bloquea en el contrato.
 *   2. El contrato emite RequestCreated(id, user, amount, fee, net).
 *   3. El owner lee el evento y envía SUSHI en BNB al usuario (via AcuaBridgeBNB).
 *   4. El owner llama fulfill(id) para marcar la solicitud como completada.
 *
 * Flujo de retiro (usuario quiere recibir SUSHI desde BNB):
 *   1. El owner recibe SUSHI en BNB vía AcuaBridgeBNB.
 *   2. El owner llama release(user, amount) en este contrato para liberar SUSHI.
 *
 * Características:
 *   - 1:1 ratio SUSHI WLD ↔ SUSHI BNB
 *   - Comisión configurable (default 200 bps = 2%)
 *   - Mínimo configurable (default equivalente a 0.2 USDC)
 *   - Fondeo: owner puede depositar SUSHI vía Permit2 para mantener liquidez
 *   - Bridge inteligente: si hay saldo suficiente, puede procesarse instantáneamente
 *   - Pausa de emergencia
 */
contract AcuaBridgeWLD {

    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address public owner;
    address public immutable SUSHI;   // SUSHI en World Chain

    uint256 public feeBps;            // comisión en bps (default 200 = 2%)
    uint256 public minAmount;         // mínimo en wei SUSHI (≈ 0.2 USDC)
    bool    public paused;

    uint256 public totalRequests;
    uint256 public totalVolume;
    uint256 public totalFees;

    struct BridgeRequest {
        address user;
        uint256 amount;   // bruto depositado
        uint256 fee;      // fee cobrado
        uint256 net;      // neto a recibir en destino
        uint256 createdAt;
        bool    fulfilled;
        bool    cancelled;
    }

    mapping(uint256 => BridgeRequest) public requests;

    event RequestCreated(uint256 indexed id, address indexed user, uint256 amount, uint256 fee, uint256 net);
    event RequestFulfilled(uint256 indexed id, string bnbTxHash);
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
        feeBps   = 200;            // 2%
        minAmount = 1e17;          // 0.1 SUSHI ≈ ~0.2 USDC dependiendo del precio
    }

    // ────────────────────────────────────────────────────────────────────────
    // USER: deposit SUSHI en World Chain para recibir SUSHI en BNB
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deposita SUSHI para bridge hacia BNB.
     *         Usa Permit2 SignatureTransfer (igual que staking).
     */
    function deposit(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature,
        uint256 amount
    ) external notPaused returns (uint256 id) {
        require(amount >= minAmount, "below minimum");
        require(permit.permitted.token == SUSHI, "wrong token");
        require(permit.permitted.amount >= amount, "permit amount low");

        // Pull tokens via Permit2
        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            signature
        );

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
     * @notice Marca una solicitud como completada (owner ya envió SUSHI en BNB).
     */
    function fulfill(uint256 id, string calldata bnbTxHash) external onlyOwner {
        BridgeRequest storage req = requests[id];
        require(!req.fulfilled && !req.cancelled, "already done");
        req.fulfilled = true;
        emit RequestFulfilled(id, bnbTxHash);
    }

    /**
     * @notice Cancela una solicitud y devuelve SUSHI al usuario.
     */
    function cancel(uint256 id) external onlyOwner {
        BridgeRequest storage req = requests[id];
        require(!req.fulfilled && !req.cancelled, "already done");
        req.cancelled = true;
        IERC20(SUSHI).transfer(req.user, req.amount); // devuelve el monto bruto
        emit RequestCancelled(id);
    }

    /**
     * @notice Libera SUSHI al usuario (cuando viene de BNB → WLD).
     *         El owner recibe SUSHI en BNB vía AcuaBridgeBNB y luego llama este.
     */
    function release(address user, uint256 amount) external onlyOwner notPaused {
        require(user != address(0), "zero addr");
        require(IERC20(SUSHI).balanceOf(address(this)) >= amount, "insufficient liquidity");
        IERC20(SUSHI).transfer(user, amount);
        emit Released(user, amount);
    }

    /**
     * @notice Owner fondea el contrato con SUSHI vía Permit2.
     */
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
        emit Funded(amount);
    }

    /**
     * @notice Owner retira SUSHI del contrato (fees + liquidez).
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
}
