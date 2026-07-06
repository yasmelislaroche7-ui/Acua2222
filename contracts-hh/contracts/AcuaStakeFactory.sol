// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

/**
 * @title  AcuaStakeFactory
 * @notice Factory que permite a CUALQUIER usuario crear su propio pool de staking
 *         para CUALQUIER token ERC20 (cualquier cantidad de decimales) en World Chain.
 *
 * Flujo de creación:
 *   - Pagar una cuota fija (por defecto 2 USDC) via Permit2 o approve normal.
 *   - La cuota de creación va 100% al dueño de ACUA (owner de la plataforma).
 *   - El creador define: token, nombre, símbolo, logo/imagen y APR inicial.
 *
 * Flujo de cada pool (igual que H2OStakeV5: recompensas por segundo, retiro y
 * reclamo instantáneos 24/7, fondeo vía Permit2 o ERC20 directo):
 *   - Depósito:  5% comisión → 4% al grupo de owners del pool, 1% al dueño de ACUA
 *   - Retiro:    5% comisión → 4% al grupo de owners del pool, 1% al dueño de ACUA
 *   - Reclamo:   5% comisión → 4% al grupo de owners del pool, 1% al dueño de ACUA
 *
 * El creador de un pool puede agregar/quitar "owners" adicionales en cualquier
 * momento. Todos los owners (creador + agregados) pueden fondear el pool y
 * comparten por igual el 4% de comisión generado por su pool.
 *
 * IMPORTANTE — decisiones tomadas sin confirmación explícita del usuario (el
 * flujo de preguntas falló durante la sesión), documentadas para revisión:
 *   1. Los $2 de creación van al dueño de ACUA (ingreso de plataforma), no al
 *      creador del pool.
 *   2. La cuota de creación se cobra en USDC de World Chain (stablecoin, $2 exactos).
 *   3. Cualquier usuario puede crear un pool para cualquier token sin whitelist.
 *   4. No se replicó el sistema de referidos de V5 — el claim aquí siempre
 *      cobra 5% (4%/1%) tal como se describió explícitamente para este contrato.
 */

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IERC20MetaOpt {
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
    function name() external view returns (string memory);
}

contract AcuaStakeFactory {

    // ─── Plataforma ──────────────────────────────────────────────────────────
    address public constant ACUA_OWNER = 0xC2Ef127734F296952DE75c1B58A6Cec605Cc2E59;
    address public constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1; // USDC World Chain

    address public factoryOwner;               // puede ajustar la cuota de creación
    address public creationFeeToken = USDC;
    uint256 public creationFeeAmount = 2_000000; // 2 USDC (6 decimales)

    // ─── Constantes de fee por pool ──────────────────────────────────────────
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant MAX_APR_BPS      = 100_000; // 1000% tope máximo
    uint256 public constant DEPOSIT_FEE_BPS  = 500;      // 5%
    uint256 public constant WITHDRAW_FEE_BPS = 500;      // 5%
    uint256 public constant CLAIM_FEE_BPS    = 500;      // 5%
    uint256 public constant CREATOR_SHARE_BPS = 400;     // 4% del gross → grupo de owners
    uint256 public constant ACUA_SHARE_BPS    = 100;     // 1% del gross → dueño de ACUA

    uint256 public poolCount;

    struct PoolMeta {
        address token;
        uint8   tokenDecimals;
        string  name;
        string  symbol;
        string  logoUrl;
        address creator;
        uint256 aprBps;
        uint256 totalStaked;
        uint256 fundPool;
        uint256 totalDeposited;
        uint256 totalWithdrawn;
        uint256 totalClaimed;
        uint256 totalFeesPaid;
        uint256 totalCreatorFeesPaid;
        uint256 totalAcuaFeesPaid;
        uint256 totalFunded;
        uint256 totalUsers;
        bool    paused;
        uint256 createdAt;
    }

    struct UserStake {
        uint256 amount;
        uint256 lastRewardAt;
        uint256 accRewards;
        uint256 totalDeposited;
        uint256 totalWithdrawn;
        uint256 totalClaimed;
    }

    mapping(uint256 => PoolMeta) public pools;
    mapping(uint256 => mapping(address => UserStake)) public userStakes;
    mapping(uint256 => mapping(address => bool)) public isPoolOwner;
    mapping(uint256 => address[]) private _poolOwnersList;
    mapping(uint256 => mapping(address => bool)) private _isStaker;
    mapping(uint256 => address[]) private _stakersList;

    // ─── Eventos ─────────────────────────────────────────────────────────────
    event PoolCreated(uint256 indexed poolId, address indexed token, address indexed creator, string name, string symbol, string logoUrl, uint256 aprBps);
    event OwnerAdded(uint256 indexed poolId, address indexed newOwner);
    event OwnerRemoved(uint256 indexed poolId, address indexed removedOwner);
    event Staked(uint256 indexed poolId, address indexed user, uint256 grossAmount, uint256 fee, uint256 netAmount);
    event Withdrawn(uint256 indexed poolId, address indexed user, uint256 grossAmount, uint256 fee, uint256 netAmount);
    event Claimed(uint256 indexed poolId, address indexed user, uint256 gross, uint256 fee, uint256 netToUser);
    event Funded(uint256 indexed poolId, address indexed funder, uint256 amount);
    event AprUpdated(uint256 indexed poolId, uint256 newAprBps);
    event PausedUpdated(uint256 indexed poolId, bool val);
    event CreationFeeUpdated(address token, uint256 amount);
    event FactoryOwnerUpdated(address newOwner);

    // ─── Modificadores ───────────────────────────────────────────────────────
    modifier onlyFactoryOwner() { require(msg.sender == factoryOwner, "not factory owner"); _; }
    modifier onlyPoolCreator(uint256 poolId) { require(msg.sender == pools[poolId].creator, "not pool creator"); _; }
    modifier onlyPoolOwner(uint256 poolId) { require(isPoolOwner[poolId][msg.sender], "not pool owner"); _; }
    modifier poolExists(uint256 poolId) { require(poolId < poolCount, "pool does not exist"); _; }
    modifier notPaused(uint256 poolId) { require(!pools[poolId].paused, "pool paused"); _; }

    constructor() {
        factoryOwner = msg.sender;
    }

    // ─── Helpers internos ────────────────────────────────────────────────────

    function _safeTransfer(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20Min.transfer.selector, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20Min.transferFrom.selector, from, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "transferFrom failed");
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

    function _detectDecimals(address token) internal view returns (uint8) {
        try IERC20MetaOpt(token).decimals() returns (uint8 d) {
            return d;
        } catch {
            return 18;
        }
    }

    function _snapshotRewards(uint256 poolId, address user) internal {
        UserStake storage s = userStakes[poolId][user];
        if (s.amount > 0 && s.lastRewardAt > 0) {
            uint256 elapsed = block.timestamp - s.lastRewardAt;
            s.accRewards += s.amount * elapsed * pools[poolId].aprBps / (10_000 * SECONDS_PER_YEAR);
        }
        s.lastRewardAt = block.timestamp;
    }

    /// @dev Reparte `feeAmount` en partes iguales entre todos los owners actuales del pool.
    function _distributeCreatorFee(uint256 poolId, uint256 feeAmount) internal {
        if (feeAmount == 0) return;
        address[] storage list = _poolOwnersList[poolId];
        uint256 n = list.length;
        if (n == 0) { _safeTransfer(pools[poolId].token, pools[poolId].creator, feeAmount); return; }
        uint256 share = feeAmount / n;
        uint256 distributed;
        for (uint256 i = 0; i < n; i++) {
            uint256 amt = (i == n - 1) ? (feeAmount - distributed) : share; // el último recibe el residuo
            _safeTransfer(pools[poolId].token, list[i], amt);
            distributed += amt;
        }
    }

    // ─── Creación de pools ────────────────────────────────────────────────────

    function createPool(
        address token,
        string calldata name_,
        string calldata symbol_,
        string calldata logoUrl,
        uint256 initialAprBps,
        IPermit2.PermitTransferFrom calldata feePermit,
        bytes calldata feeSig
    ) external returns (uint256 poolId) {
        require(token != address(0), "zero token");
        require(initialAprBps <= MAX_APR_BPS, "apr exceeds max");
        require(bytes(name_).length > 0 && bytes(symbol_).length > 0, "name/symbol required");
        require(feePermit.permitted.token == creationFeeToken, "wrong fee token");
        require(feePermit.permitted.amount >= creationFeeAmount, "fee permit too small");

        _permit2Transfer(feePermit, feeSig, creationFeeAmount, ACUA_OWNER);
        poolId = _createPool(token, name_, symbol_, logoUrl, initialAprBps);
    }

    /// @notice Igual que createPool pero pagando la cuota con approve ERC20 normal (wallet importada).
    function createPoolNormal(
        address token,
        string calldata name_,
        string calldata symbol_,
        string calldata logoUrl,
        uint256 initialAprBps
    ) external returns (uint256 poolId) {
        require(token != address(0), "zero token");
        require(initialAprBps <= MAX_APR_BPS, "apr exceeds max");
        require(bytes(name_).length > 0 && bytes(symbol_).length > 0, "name/symbol required");

        _safeTransferFrom(creationFeeToken, msg.sender, ACUA_OWNER, creationFeeAmount);
        poolId = _createPool(token, name_, symbol_, logoUrl, initialAprBps);
    }

    function _createPool(
        address token,
        string calldata name_,
        string calldata symbol_,
        string calldata logoUrl,
        uint256 initialAprBps
    ) internal returns (uint256 poolId) {
        poolId = poolCount++;
        PoolMeta storage p = pools[poolId];
        p.token         = token;
        p.tokenDecimals = _detectDecimals(token);
        p.name          = name_;
        p.symbol        = symbol_;
        p.logoUrl       = logoUrl;
        p.creator       = msg.sender;
        p.aprBps        = initialAprBps;
        p.createdAt     = block.timestamp;

        isPoolOwner[poolId][msg.sender] = true;
        _poolOwnersList[poolId].push(msg.sender);

        emit PoolCreated(poolId, token, msg.sender, name_, symbol_, logoUrl, initialAprBps);
    }

    // ─── Gestión de owners del pool ───────────────────────────────────────────

    function addOwner(uint256 poolId, address newOwner) external poolExists(poolId) onlyPoolCreator(poolId) {
        require(newOwner != address(0), "zero address");
        require(!isPoolOwner[poolId][newOwner], "already owner");
        isPoolOwner[poolId][newOwner] = true;
        _poolOwnersList[poolId].push(newOwner);
        emit OwnerAdded(poolId, newOwner);
    }

    function removeOwner(uint256 poolId, address ownerToRemove) external poolExists(poolId) onlyPoolCreator(poolId) {
        require(ownerToRemove != pools[poolId].creator, "cannot remove creator");
        require(isPoolOwner[poolId][ownerToRemove], "not an owner");
        isPoolOwner[poolId][ownerToRemove] = false;
        address[] storage list = _poolOwnersList[poolId];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == ownerToRemove) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
        emit OwnerRemoved(poolId, ownerToRemove);
    }

    function getPoolOwners(uint256 poolId) external view returns (address[] memory) {
        return _poolOwnersList[poolId];
    }

    // ─── Depósito ─────────────────────────────────────────────────────────────

    function deposit(
        uint256 poolId,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig,
        uint256 grossAmount
    ) external poolExists(poolId) notPaused(poolId) {
        require(grossAmount > 0, "zero amount");
        require(permit.permitted.token == pools[poolId].token, "wrong token");
        require(permit.permitted.amount >= grossAmount, "permit too small");
        _permit2Transfer(permit, sig, grossAmount, address(this));
        _doDeposit(poolId, msg.sender, grossAmount);
    }

    function depositNormal(uint256 poolId, uint256 grossAmount) external poolExists(poolId) notPaused(poolId) {
        require(grossAmount > 0, "zero amount");
        _safeTransferFrom(pools[poolId].token, msg.sender, address(this), grossAmount);
        _doDeposit(poolId, msg.sender, grossAmount);
    }

    /// @dev Calcula fee (creador+ACUA), actualiza contadores del pool y distribuye. Devuelve monto neto y fee total.
    function _applyFee(uint256 poolId, uint256 grossAmount) internal returns (uint256 netAmount, uint256 fee) {
        PoolMeta storage p = pools[poolId];
        uint256 creatorFee = grossAmount * CREATOR_SHARE_BPS / 10_000;
        uint256 acuaFee    = grossAmount * ACUA_SHARE_BPS / 10_000;
        fee       = creatorFee + acuaFee;
        netAmount = grossAmount - fee;

        if (fee > 0) {
            p.totalFeesPaid        += fee;
            p.totalCreatorFeesPaid += creatorFee;
            p.totalAcuaFeesPaid    += acuaFee;
            _distributeCreatorFee(poolId, creatorFee);
            _safeTransfer(p.token, ACUA_OWNER, acuaFee);
        }
    }

    function _doDeposit(uint256 poolId, address user, uint256 grossAmount) internal {
        _snapshotRewards(poolId, user);
        PoolMeta storage p = pools[poolId];
        UserStake storage s = userStakes[poolId][user];

        if (s.lastRewardAt == 0) s.lastRewardAt = block.timestamp;
        if (!_isStaker[poolId][user]) {
            _isStaker[poolId][user] = true;
            _stakersList[poolId].push(user);
            p.totalUsers++;
        }

        (uint256 netAmount, uint256 fee) = _applyFee(poolId, grossAmount);

        s.amount         += netAmount;
        s.totalDeposited += grossAmount;
        p.totalStaked    += netAmount;
        p.totalDeposited += grossAmount;
        p.fundPool       += netAmount;

        emit Staked(poolId, user, grossAmount, fee, netAmount);
    }

    // ─── Retiro instantáneo ───────────────────────────────────────────────────

    function withdraw(uint256 poolId, uint256 amount) external poolExists(poolId) notPaused(poolId) {
        UserStake storage s = userStakes[poolId][msg.sender];
        uint256 withdrawAmount = (amount == type(uint256).max) ? s.amount : amount;
        require(withdrawAmount > 0, "zero amount");
        require(s.amount >= withdrawAmount, "insufficient stake");

        PoolMeta storage p = pools[poolId];
        require(p.fundPool >= withdrawAmount, "insufficient pool");

        _snapshotRewards(poolId, msg.sender);

        (uint256 netAmount, uint256 fee) = _applyFee(poolId, withdrawAmount);

        s.amount        -= withdrawAmount;
        s.totalWithdrawn += withdrawAmount;
        p.totalStaked    -= withdrawAmount;
        p.totalWithdrawn += withdrawAmount;
        p.fundPool       -= withdrawAmount;

        _safeTransfer(p.token, msg.sender, netAmount);

        emit Withdrawn(poolId, msg.sender, withdrawAmount, fee, netAmount);
    }

    // ─── Reclamo instantáneo ──────────────────────────────────────────────────

    function claimRewards(uint256 poolId) external poolExists(poolId) notPaused(poolId) {
        _snapshotRewards(poolId, msg.sender);
        UserStake storage s = userStakes[poolId][msg.sender];
        uint256 gross = s.accRewards;
        require(gross > 0, "no rewards");

        PoolMeta storage p = pools[poolId];
        require(p.fundPool >= gross, "insufficient fund pool");

        s.accRewards = 0;
        p.fundPool  -= gross;

        (uint256 netToUser, uint256 fee) = _applyFee(poolId, gross);

        s.totalClaimed += gross;
        p.totalClaimed += gross;

        _safeTransfer(p.token, msg.sender, netToUser);

        emit Claimed(poolId, msg.sender, gross, fee, netToUser);
    }

    // ─── Fondeo del pool (creador + owners agregados) ────────────────────────

    function fund(
        uint256 poolId,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig,
        uint256 amount
    ) external poolExists(poolId) onlyPoolOwner(poolId) {
        require(amount > 0, "zero amount");
        require(permit.permitted.token == pools[poolId].token, "wrong token");
        require(permit.permitted.amount >= amount, "permit too small");
        _permit2Transfer(permit, sig, amount, address(this));
        pools[poolId].fundPool    += amount;
        pools[poolId].totalFunded += amount;
        emit Funded(poolId, msg.sender, amount);
    }

    function fundDirect(uint256 poolId, uint256 amount) external poolExists(poolId) onlyPoolOwner(poolId) {
        require(amount > 0, "zero amount");
        _safeTransferFrom(pools[poolId].token, msg.sender, address(this), amount);
        pools[poolId].fundPool    += amount;
        pools[poolId].totalFunded += amount;
        emit Funded(poolId, msg.sender, amount);
    }

    // ─── Administración del pool ──────────────────────────────────────────────

    function setApr(uint256 poolId, uint256 newAprBps) external poolExists(poolId) onlyPoolOwner(poolId) {
        require(newAprBps <= MAX_APR_BPS, "exceeds max APR");
        pools[poolId].aprBps = newAprBps;
        emit AprUpdated(poolId, newAprBps);
    }

    function setPaused(uint256 poolId, bool val) external poolExists(poolId) onlyPoolOwner(poolId) {
        pools[poolId].paused = val;
        emit PausedUpdated(poolId, val);
    }

    // ─── Administración de la fábrica ─────────────────────────────────────────

    function setCreationFee(address token, uint256 amount) external onlyFactoryOwner {
        require(token != address(0), "zero token");
        creationFeeToken  = token;
        creationFeeAmount = amount;
        emit CreationFeeUpdated(token, amount);
    }

    function transferFactoryOwnership(address newOwner) external onlyFactoryOwner {
        require(newOwner != address(0), "zero address");
        factoryOwner = newOwner;
        emit FactoryOwnerUpdated(newOwner);
    }

    // ─── Vistas ───────────────────────────────────────────────────────────────

    function pendingRewards(uint256 poolId, address user) public view returns (uint256) {
        UserStake memory s = userStakes[poolId][user];
        if (s.amount == 0 || s.lastRewardAt == 0) return s.accRewards;
        uint256 elapsed = block.timestamp - s.lastRewardAt;
        return s.accRewards + s.amount * elapsed * pools[poolId].aprBps / (10_000 * SECONDS_PER_YEAR);
    }

    function getUserStakeInfo(uint256 poolId, address user) external view returns (
        uint256 staked,
        uint256 rewards,
        uint256 totalDep,
        uint256 totalWith,
        uint256 totalClaim
    ) {
        UserStake memory s = userStakes[poolId][user];
        staked     = s.amount;
        rewards    = pendingRewards(poolId, user);
        totalDep   = s.totalDeposited;
        totalWith  = s.totalWithdrawn;
        totalClaim = s.totalClaimed;
    }

    function getPoolInfo(uint256 poolId) external view returns (
        address token,
        uint8   tokenDecimals,
        string memory name_,
        string memory symbol_,
        string memory logoUrl,
        address creator,
        uint256 aprBps,
        uint256 totalStaked,
        uint256 fundPool,
        uint256 totalDeposited,
        uint256 totalWithdrawn,
        uint256 totalClaimed,
        uint256 totalFeesPaid,
        uint256 totalUsers,
        bool    paused,
        uint256 createdAt
    ) {
        PoolMeta memory p = pools[poolId];
        return (
            p.token, p.tokenDecimals, p.name, p.symbol, p.logoUrl, p.creator,
            p.aprBps, p.totalStaked, p.fundPool, p.totalDeposited, p.totalWithdrawn,
            p.totalClaimed, p.totalFeesPaid, p.totalUsers, p.paused, p.createdAt
        );
    }

    function getAllPoolIds() external view returns (uint256[] memory ids) {
        ids = new uint256[](poolCount);
        for (uint256 i = 0; i < poolCount; i++) ids[i] = i;
    }

    function getStakers(uint256 poolId) external view returns (address[] memory) {
        return _stakersList[poolId];
    }
}
