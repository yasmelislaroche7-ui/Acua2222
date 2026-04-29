// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IClaimSource {
    function getStakeInfo(address staker) external view returns (uint256 tokensStaked, uint256 rewards);
}

/**
 * @title AcuaClaimManager
 * @notice Registro extensible de contratos de claim externos (estilo Thirdweb TokenStake).
 *         Cobra una comisión configurable por claim (default: 30%) en el reward token,
 *         pagada vía Permit2 SignatureTransfer y enviada DIRECTAMENTE al owner.
 *         El contrato no guarda fondos: el destino del transfer es siempre `owner`.
 *
 *         Flujo en frontend (MiniKit batch, una sola firma del usuario):
 *           tx[0] = claimContract.claimRewards()        // user recibe el reward
 *           tx[1] = manager.collectFee(id, permit, sig) // manager hala fee → owner
 *           permit2[0] = permit del reward token con manager como spender
 *
 *         Admin puede agregar / actualizar / eliminar claims sin redeploy.
 */
contract AcuaClaimManager {

    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    struct ClaimConfig {
        address claimContract;  // contrato externo de stake/claim
        address rewardToken;    // ERC20 que paga el claim (lo que cobra el fee)
        uint16  feeBps;         // 3000 = 30%. Sirve de tope on-chain y de hint para frontend.
        bool    active;
        string  name;           // etiqueta humana ("WDD", "ABC", ...)
    }

    address public owner;
    uint256 public claimCount;
    mapping(uint256 => ClaimConfig) public claims;

    event ClaimAdded(uint256 indexed id, address indexed claimContract, address indexed rewardToken, uint16 feeBps, string name);
    event ClaimUpdated(uint256 indexed id, address claimContract, address rewardToken, uint16 feeBps, bool active, string name);
    event ClaimRemoved(uint256 indexed id);
    event FeeCollected(uint256 indexed id, address indexed user, address indexed token, uint256 amount);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _owner) {
        require(_owner != address(0), "zero owner");
        owner = _owner;
    }

    // ─── Admin: gestionar claims ────────────────────────────────────────
    function addClaim(
        address claimContract,
        address rewardToken,
        uint16 feeBps,
        string calldata name
    ) external onlyOwner returns (uint256 id) {
        require(claimContract != address(0) && rewardToken != address(0), "zero addr");
        require(feeBps <= 10000, "feeBps too high");
        id = claimCount++;
        claims[id] = ClaimConfig(claimContract, rewardToken, feeBps, true, name);
        emit ClaimAdded(id, claimContract, rewardToken, feeBps, name);
    }

    function updateClaim(
        uint256 id,
        address claimContract,
        address rewardToken,
        uint16 feeBps,
        bool active,
        string calldata name
    ) external onlyOwner {
        require(id < claimCount, "bad id");
        require(claimContract != address(0) && rewardToken != address(0), "zero addr");
        require(feeBps <= 10000, "feeBps too high");
        claims[id] = ClaimConfig(claimContract, rewardToken, feeBps, active, name);
        emit ClaimUpdated(id, claimContract, rewardToken, feeBps, active, name);
    }

    function setClaimActive(uint256 id, bool active) external onlyOwner {
        require(id < claimCount, "bad id");
        require(claims[id].claimContract != address(0), "removed");
        claims[id].active = active;
        ClaimConfig memory cfg = claims[id];
        emit ClaimUpdated(id, cfg.claimContract, cfg.rewardToken, cfg.feeBps, cfg.active, cfg.name);
    }

    function setClaimFeeBps(uint256 id, uint16 feeBps) external onlyOwner {
        require(id < claimCount, "bad id");
        require(feeBps <= 10000, "feeBps too high");
        require(claims[id].claimContract != address(0), "removed");
        claims[id].feeBps = feeBps;
        ClaimConfig memory cfg = claims[id];
        emit ClaimUpdated(id, cfg.claimContract, cfg.rewardToken, cfg.feeBps, cfg.active, cfg.name);
    }

    function removeClaim(uint256 id) external onlyOwner {
        require(id < claimCount, "bad id");
        delete claims[id];
        emit ClaimRemoved(id);
    }

    function setOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "zero owner");
        emit OwnerChanged(owner, _owner);
        owner = _owner;
    }

    // ─── User entry: cobra fee directo al owner vía Permit2 ─────────────
    function collectFee(
        uint256 claimId,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external {
        ClaimConfig memory cfg = claims[claimId];
        require(cfg.active, "claim inactive");
        require(cfg.claimContract != address(0), "claim removed");
        require(permit.permitted.token == cfg.rewardToken, "wrong token");
        require(permit.permitted.amount > 0, "zero fee");

        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({
                to: owner,                                  // direct to owner, contract holds nothing
                requestedAmount: permit.permitted.amount
            }),
            msg.sender,
            signature
        );

        emit FeeCollected(claimId, msg.sender, cfg.rewardToken, permit.permitted.amount);
    }

    // ─── Views ──────────────────────────────────────────────────────────
    /// @notice Calcula el fee esperado en wei a partir del pendingReward del usuario.
    function previewFee(uint256 claimId, address user) external view returns (uint256 fee, uint256 pending) {
        ClaimConfig memory cfg = claims[claimId];
        if (!cfg.active || cfg.claimContract == address(0)) return (0, 0);
        try IClaimSource(cfg.claimContract).getStakeInfo(user) returns (uint256, uint256 r) {
            pending = r;
            fee = (pending * cfg.feeBps) / 10000;
        } catch {
            return (0, 0);
        }
    }

    /// @notice Retorna todos los claims registrados (incluye removidos como zero structs).
    function allClaims() external view returns (ClaimConfig[] memory list) {
        list = new ClaimConfig[](claimCount);
        for (uint256 i = 0; i < claimCount; i++) {
            list[i] = claims[i];
        }
    }
}
