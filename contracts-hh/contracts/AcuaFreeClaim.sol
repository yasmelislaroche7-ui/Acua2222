// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

/**
 * @title  AcuaFreeClaim
 * @notice Contrato de claim gratuito multi-token.
 *
 *   • Admin crea pools de claim (cualquier ERC-20 importado por dirección)
 *   • Cada pool configura: monto por claim, cooldown (segundos), estado activo
 *   • Usuarios llaman claim(poolId) una vez por cooldown
 *   • Admin fonde los pools via Permit2 (World App) o ERC-20 directo
 *   • Admin puede retirar fondos, ajustar montos y cooldowns sin redeploy
 *   • Dos dueños (owner + owner2): cualquiera puede administrar pools
 */

interface IERC20Claim {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
    function name() external view returns (string memory);
}

contract AcuaFreeClaim {

    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // ─── Pool ────────────────────────────────────────────────────────────────
    struct Pool {
        address token;
        uint256 balance;          // fondos disponibles
        uint256 amountPerClaim;   // tokens por claim (en wei)
        uint256 cooldown;         // segundos entre claims del mismo usuario
        uint256 totalClaimed;     // acumulado total
        uint256 claimCount;       // nro de claims realizados
        bool    active;
        string  name;             // nombre descriptivo del token
        string  symbol;           // símbolo del token
    }

    struct UserClaimInfo {
        uint256 lastClaim;     // timestamp del último claim
        uint256 totalClaimed;  // acumulado del usuario en este pool
        uint256 claimCount;    // nro de claims del usuario
    }

    // ─── State ────────────────────────────────────────────────────────────────
    address public owner;
    address public owner2;

    Pool[]  public pools;

    // poolId → user → info
    mapping(uint256 => mapping(address => UserClaimInfo)) public userInfo;

    // ─── Events ───────────────────────────────────────────────────────────────
    event PoolAdded(uint256 indexed id, address indexed token, uint256 amountPerClaim, uint256 cooldown, string name, string symbol);
    event PoolUpdated(uint256 indexed id, uint256 amountPerClaim, uint256 cooldown, bool active);
    event Funded(uint256 indexed id, address indexed from, uint256 amount);
    event Withdrawn(uint256 indexed id, address indexed to, uint256 amount);
    event Claimed(uint256 indexed id, address indexed user, uint256 amount);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event Owner2Changed(address indexed oldOwner2, address indexed newOwner2);

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner || msg.sender == owner2, "not owner");
        _;
    }
    modifier validPool(uint256 id) {
        require(id < pools.length, "invalid pool");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _owner, address _owner2) {
        require(_owner  != address(0), "zero owner");
        require(_owner2 != address(0), "zero owner2");
        owner  = _owner;
        owner2 = _owner2;
    }

    // ─── Admin: gestión de pools ─────────────────────────────────────────────

    /**
     * @notice Crear un nuevo pool de claim.
     * @param token          Dirección del token ERC-20 a distribuir.
     * @param amountPerClaim Tokens que recibe el usuario por claim (wei).
     * @param cooldown       Segundos mínimos entre claims (0 = sin límite de tiempo).
     * @param tokenName      Nombre descriptivo (puede ser "" para leer on-chain).
     * @param tokenSymbol    Símbolo del token (puede ser "" para leer on-chain).
     */
    function addPool(
        address token,
        uint256 amountPerClaim,
        uint256 cooldown,
        string calldata tokenName,
        string calldata tokenSymbol
    ) external onlyOwner returns (uint256 id) {
        require(token != address(0), "zero token");
        require(amountPerClaim > 0,  "zero amount");

        string memory nm = bytes(tokenName).length   > 0 ? tokenName   : _safeName(token);
        string memory sy = bytes(tokenSymbol).length > 0 ? tokenSymbol : _safeSymbol(token);

        id = pools.length;
        pools.push(Pool({
            token:          token,
            balance:        0,
            amountPerClaim: amountPerClaim,
            cooldown:       cooldown,
            totalClaimed:   0,
            claimCount:     0,
            active:         true,
            name:           nm,
            symbol:         sy
        }));
        emit PoolAdded(id, token, amountPerClaim, cooldown, nm, sy);
    }

    function setClaimAmount(uint256 id, uint256 amountPerClaim) external onlyOwner validPool(id) {
        require(amountPerClaim > 0, "zero amount");
        pools[id].amountPerClaim = amountPerClaim;
        emit PoolUpdated(id, amountPerClaim, pools[id].cooldown, pools[id].active);
    }

    function setCooldown(uint256 id, uint256 cooldown) external onlyOwner validPool(id) {
        pools[id].cooldown = cooldown;
        emit PoolUpdated(id, pools[id].amountPerClaim, cooldown, pools[id].active);
    }

    function setActive(uint256 id, bool active) external onlyOwner validPool(id) {
        pools[id].active = active;
        emit PoolUpdated(id, pools[id].amountPerClaim, pools[id].cooldown, active);
    }

    function setPoolInfo(
        uint256 id,
        uint256 amountPerClaim,
        uint256 cooldown,
        bool    active,
        string  calldata tokenName,
        string  calldata tokenSymbol
    ) external onlyOwner validPool(id) {
        require(amountPerClaim > 0, "zero amount");
        pools[id].amountPerClaim = amountPerClaim;
        pools[id].cooldown       = cooldown;
        pools[id].active         = active;
        if (bytes(tokenName).length   > 0) pools[id].name   = tokenName;
        if (bytes(tokenSymbol).length > 0) pools[id].symbol = tokenSymbol;
        emit PoolUpdated(id, amountPerClaim, cooldown, active);
    }

    // ─── Admin: fondeo con Permit2 ────────────────────────────────────────────

    /**
     * @notice Fondear un pool via Permit2 (World App).
     */
    function fund(
        uint256 id,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig
    ) external onlyOwner validPool(id) {
        uint256 amount = permit.permitted.amount;
        require(amount > 0, "zero amount");
        require(permit.permitted.token == pools[id].token, "wrong token");

        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            sig
        );

        pools[id].balance += amount;
        emit Funded(id, msg.sender, amount);
    }

    /**
     * @notice Fondear un pool via ERC-20 directo (requiere approve previo).
     */
    function fundDirect(uint256 id, uint256 amount) external validPool(id) {
        require(amount > 0, "zero amount");
        require(
            IERC20Claim(pools[id].token).transferFrom(msg.sender, address(this), amount),
            "transfer failed"
        );
        pools[id].balance += amount;
        emit Funded(id, msg.sender, amount);
    }

    // ─── Admin: retiro ────────────────────────────────────────────────────────

    function withdraw(uint256 id, uint256 amount) external onlyOwner validPool(id) {
        Pool storage p = pools[id];
        require(amount > 0,          "zero amount");
        require(p.balance >= amount, "insufficient balance");
        p.balance -= amount;
        require(IERC20Claim(p.token).transfer(msg.sender, amount), "transfer failed");
        emit Withdrawn(id, msg.sender, amount);
    }

    function withdrawAll(uint256 id) external onlyOwner validPool(id) {
        Pool storage p = pools[id];
        uint256 amount = p.balance;
        require(amount > 0, "empty pool");
        p.balance = 0;
        require(IERC20Claim(p.token).transfer(msg.sender, amount), "transfer failed");
        emit Withdrawn(id, msg.sender, amount);
    }

    // ─── Admin: gestión de dueños ─────────────────────────────────────────────

    function setOwner(address newOwner) external {
        require(msg.sender == owner, "only owner1");
        require(newOwner != address(0), "zero");
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }

    function setOwner2(address newOwner2) external onlyOwner {
        require(newOwner2 != address(0), "zero");
        emit Owner2Changed(owner2, newOwner2);
        owner2 = newOwner2;
    }

    // ─── User: claim ──────────────────────────────────────────────────────────

    /**
     * @notice Reclamar tokens del pool indicado.
     * @param id  Índice del pool.
     */
    function claim(uint256 id) external validPool(id) {
        Pool storage p = pools[id];
        require(p.active,  "pool inactive");
        require(p.balance >= p.amountPerClaim, "pool empty");

        UserClaimInfo storage u = userInfo[id][msg.sender];

        if (p.cooldown > 0) {
            require(
                u.lastClaim == 0 || block.timestamp >= u.lastClaim + p.cooldown,
                "cooldown not elapsed"
            );
        }

        uint256 amount = p.amountPerClaim;
        p.balance      -= amount;
        p.totalClaimed += amount;
        p.claimCount++;

        u.lastClaim    = block.timestamp;
        u.totalClaimed += amount;
        u.claimCount++;

        require(IERC20Claim(p.token).transfer(msg.sender, amount), "transfer failed");
        emit Claimed(id, msg.sender, amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function poolCount() external view returns (uint256) { return pools.length; }

    function getPool(uint256 id) external view validPool(id) returns (Pool memory) {
        return pools[id];
    }

    function getAllPools() external view returns (Pool[] memory) {
        return pools;
    }

    function getUserClaimInfo(uint256 id, address user)
        external view validPool(id) returns (UserClaimInfo memory)
    {
        return userInfo[id][user];
    }

    /**
     * @notice Segundos restantes hasta que el usuario pueda volver a reclamar.
     *         0 = puede reclamar ahora.
     */
    function cooldownRemaining(uint256 id, address user) external view validPool(id) returns (uint256) {
        Pool storage p = pools[id];
        if (p.cooldown == 0) return 0;
        UserClaimInfo storage u = userInfo[id][user];
        if (u.lastClaim == 0) return 0;
        uint256 nextClaim = u.lastClaim + p.cooldown;
        if (block.timestamp >= nextClaim) return 0;
        return nextClaim - block.timestamp;
    }

    /**
     * @notice Retorna todos los pools con el cooldown restante del usuario.
     */
    function getAllPoolsWithCooldown(address user)
        external view
        returns (Pool[] memory, uint256[] memory remainings)
    {
        uint256 n = pools.length;
        Pool[]     memory ps = new Pool[](n);
        remainings            = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            ps[i] = pools[i];
            if (pools[i].cooldown == 0) { remainings[i] = 0; continue; }
            UserClaimInfo storage u = userInfo[i][user];
            if (u.lastClaim == 0) { remainings[i] = 0; continue; }
            uint256 next = u.lastClaim + pools[i].cooldown;
            remainings[i] = block.timestamp >= next ? 0 : next - block.timestamp;
        }
        return (ps, remainings);
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _safeName(address token) internal view returns (string memory) {
        try IERC20Claim(token).name() returns (string memory n) { return n; } catch { return ""; }
    }

    function _safeSymbol(address token) internal view returns (string memory) {
        try IERC20Claim(token).symbol() returns (string memory s) { return s; } catch { return ""; }
    }
}
