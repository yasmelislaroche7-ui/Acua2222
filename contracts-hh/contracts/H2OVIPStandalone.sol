// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title H2OVIPStandalone
 * @notice Contrato VIP totalmente independiente del stake de H2O.
 *
 * Flujo de suscripción
 * --------------------
 * 1. Usuario firma un Permit2 en World App (sin approve).
 * 2. buyVIPWithPermit2() jala UTH2 del usuario a este contrato.
 * 3. El UTH2 queda aquí — el owner lo retira con withdrawUTH2() cuando quiera.
 * 4. El usuario queda registrado como holder de rewards (1 share, primera compra).
 *
 * Flujo de rewards (H2O)
 * -----------------------
 * 1. El owner fondea el contrato con H2O via depositRewards().
 * 2. Se fija rewardRate = amount / 365 days → rewards/segundo.
 * 3. Los holders acumulan H2O por segundo proporcional a sus shares.
 * 4. Cada usuario reclama 24/7 llamando a claimOwnerVip().
 *
 * Notas
 * -----
 * - vipPrice es configurable por el owner.
 * - 1 share por usuario (primera compra únicamente).
 * - Sin conexión al contrato de stake de H2O.
 */
contract H2OVIPStandalone {

    uint256 constant SCALE   = 1e18;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address public immutable UTH2;
    address public immutable H2O;

    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _uth2, address _h2o) {
        UTH2  = _uth2;
        H2O   = _h2o;
        owner = msg.sender;
    }

    // ── VIP subscription tracking ─────────────────────────────────────────

    uint256 public constant vipDuration = 30 days;
    uint256 public vipPrice = 1e18; // 1 UTH2 por mes (18 decimales)

    mapping(address => uint256) public vipExpire;

    // ── H2O reward pool (Synthetix-style per-share) ───────────────────────

    uint256 public rewardRate;     // H2O wei/segundo (total para todos los holders)
    uint256 public periodFinish;   // timestamp en que terminan los rewards
    uint256 public lastUpdate;     // último update del pool
    uint256 public rewardPerShare; // H2O acumulado por share × SCALE

    mapping(address => uint256) public holderShares;
    uint256 public totalHolderShares;
    mapping(address => uint256) public rewardDebt; // snapshot de rewardPerShare por usuario

    // ── Reward math ────────────────────────────────────────────────────────

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function _rewardPerShare() internal view returns (uint256) {
        if (totalHolderShares == 0) return rewardPerShare;
        uint256 ts = lastTimeRewardApplicable();
        if (ts <= lastUpdate) return rewardPerShare;
        return rewardPerShare + (ts - lastUpdate) * rewardRate * SCALE / totalHolderShares;
    }

    function _updatePool() internal {
        rewardPerShare = _rewardPerShare();
        lastUpdate = lastTimeRewardApplicable();
    }

    /// @notice Reward H2O pendiente de reclamar para un usuario
    function pendingReward(address user) external view returns (uint256) {
        uint256 share = holderShares[user];
        if (share == 0) return 0;
        uint256 rps = _rewardPerShare();
        if (rps <= rewardDebt[user]) return 0;
        return share * (rps - rewardDebt[user]) / SCALE;
    }

    // ── Buy VIP via Permit2 ────────────────────────────────────────────────

    /**
     * @notice Comprar o extender suscripción VIP usando UTH2 via Permit2.
     *         World App maneja la firma — sin approve() previo.
     *
     * @param months_  Meses a comprar (1-12)
     * @param permit   Permit2 struct
     * @param sig      Firma Permit2 de World App
     */
    function buyVIPWithPermit2(
        uint256 months_,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig
    ) external {
        require(months_ > 0 && months_ <= 12, "invalid months");
        uint256 cost = vipPrice * months_;
        require(permit.permitted.token == UTH2, "wrong token");
        require(permit.permitted.amount >= cost, "amount too low");

        // Jalar UTH2 del usuario a este contrato via Permit2
        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails(address(this), cost),
            msg.sender,
            sig
        );
        // UTH2 queda aquí — owner lo retira con withdrawUTH2()

        // Actualizar expiración VIP
        uint256 start = vipExpire[msg.sender] > block.timestamp
            ? vipExpire[msg.sender]
            : block.timestamp;
        vipExpire[msg.sender] = start + vipDuration * months_;

        // Registrar como holder de rewards (solo en la primera compra)
        if (holderShares[msg.sender] == 0) {
            _updatePool();
            holderShares[msg.sender] = 1;
            totalHolderShares += 1;
            rewardDebt[msg.sender] = rewardPerShare;
        }
    }

    // ── Claim H2O rewards ─────────────────────────────────────────────────

    /**
     * @notice Reclamar H2O acumulado del pool de rewards VIP.
     *         Las recompensas se acumulan por segundo — se puede reclamar 24/7.
     */
    function claimOwnerVip() external {
        _updatePool();

        uint256 share = holderShares[msg.sender];
        require(share > 0, "not a VIP holder");

        uint256 pending = share * (rewardPerShare - rewardDebt[msg.sender]) / SCALE;
        require(pending > 0, "nothing to claim");

        rewardDebt[msg.sender] = rewardPerShare;
        IERC20(H2O).transfer(msg.sender, pending);
    }

    // ── View helpers ──────────────────────────────────────────────────────

    function isVIP(address user) external view returns (bool) {
        return vipExpire[user] > block.timestamp;
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    /**
     * @notice Fondear el contrato con H2O para pagar rewards VIP.
     *         Los H2O se distribuyen linealmente en 365 días.
     *         Solo el owner puede llamar esto.
     * @param amount  Cantidad de H2O (18 decimales) a depositar
     */
    function depositRewards(uint256 amount) external onlyOwner {
        IERC20(H2O).transferFrom(msg.sender, address(this), amount);
        _updatePool();
        rewardRate    = amount / 365 days;
        lastUpdate    = block.timestamp;
        periodFinish  = block.timestamp + 365 days;
    }

    /**
     * @notice Retirar UTH2 acumulado de las suscripciones VIP.
     * @param amount  Cantidad a retirar (0 = retirar todo)
     */
    function withdrawUTH2(uint256 amount) external onlyOwner {
        if (amount == 0) {
            amount = IERC20(UTH2).balanceOf(address(this));
        }
        require(amount > 0, "no UTH2");
        IERC20(UTH2).transfer(owner, amount);
    }

    /**
     * @notice Cambiar el precio de la suscripción VIP en UTH2.
     * @param newPrice  Precio por mes en UTH2 (18 decimales)
     */
    function setVipPrice(uint256 newPrice) external onlyOwner {
        require(newPrice > 0, "price > 0");
        vipPrice = newPrice;
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }

    /// @notice Recuperar cualquier token enviado al contrato por error.
    function rescueToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }
}
