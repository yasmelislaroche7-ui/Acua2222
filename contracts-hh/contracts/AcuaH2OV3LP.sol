// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20H {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface IUniV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function liquidity() external view returns (uint128);
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool
    );
}

interface INPM {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1);

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external payable returns (uint256 amount0, uint256 amount1);

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function collect(CollectParams calldata params)
        external payable returns (uint256 amount0, uint256 amount1);
}

/**
 * @title  AcuaH2OV3LP
 * @notice Wrapper alrededor de Uniswap V3 NonfungiblePositionManager.
 *         Cada par de pool usa UNA NFT compartida por todos los usuarios (full-range
 *         o rango fijo definido por owner). Las recompensas (fees del pool) se quedan
 *         en el contrato como tokenA/tokenB para que el owner las retire cuando quiera,
 *         y al usuario se le paga su parte en H2O equivalente usando precios spot de
 *         Uniswap V3, con una comision oculta de 20% en el claim, 2% en deposit y 2%
 *         en withdraw. Pares se agregan via owner; H2O pares se pueden marcar
 *         "comingSoon" para mostrarlos sin permitir interaccion.
 *         Pull de tokens via Permit2 SignatureTransfer (mismo flujo que stake/swap).
 */
contract AcuaH2OV3LP {
    // ─── Constantes ───────────────────────────────────────────────────────────
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant H2O  = 0x17392e5483983945dEB92e0518a8F2C4eB6bA59d;
    address public constant WLD  = 0x2cFc85d8E48F8EAB294be644d9E25C3030863003;
    address public constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;

    uint256 public constant BPS = 10000;
    uint256 public constant MAX_FEE_BPS = 3000; // tope de seguridad 30%
    uint256 private constant Q128 = 1 << 128;
    uint256 private constant Q96  = 1 << 96;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    INPM public immutable NPM;

    // ─── Owner / config ───────────────────────────────────────────────────────
    address public owner;
    bool public paused;

    uint256 public depositFeeBps  = 200;  // 2%
    uint256 public withdrawFeeBps = 200;  // 2%
    uint256 public claimFeeBps    = 2000; // 20% (oculto al usuario)

    // ─── Pools ────────────────────────────────────────────────────────────────
    struct Pool {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        address poolAddr;            // direccion del pool V3 (oracle de slot0)
        uint256 nftTokenId;          // 0 si no se ha hecho mint todavia
        uint128 totalLiquidity;
        uint256 accFee0PerLiqX128;
        uint256 accFee1PerLiqX128;
        uint256 totalFees0Collected; // historico (raw token0)
        uint256 totalFees1Collected; // historico (raw token1)
        uint256 firstDepositAt;      // timestamp del primer deposito
        bool active;
        bool comingSoon;             // mostrar pero deshabilitado (ej. pares H2O)
    }

    Pool[] private _pools;

    // Posicion del usuario por pool
    struct UserPosition {
        uint128 liquidity;
        uint256 fee0Debt;
        uint256 fee1Debt;
        uint256 pendingFee0;
        uint256 pendingFee1;
    }

    mapping(uint256 => mapping(address => UserPosition)) private _userPositions;

    // ─── Pricing routes ───────────────────────────────────────────────────────
    // Para cada token, configurar la pool spot que se usa para llevarlo a WLD o USDC.
    // Ruta final: token -> WLD -> H2O    (preferida)
    //          o  token -> USDC -> WLD -> H2O
    struct Route {
        address pool;     // pool donde el token tiene par contra WLD o USDC
        bool isToUsdc;    // false = pool token/WLD ; true = pool token/USDC
    }

    mapping(address => Route) public priceRoutes;
    address public wldH2OPool;  // WLD/H2O pool obligatorio para conversion final
    address public usdcWldPool; // USDC/WLD para rutas que pasan por USDC

    // ─── Owner-collected raw fees (2% deposit + 2% withdraw + fees del claim) ─
    mapping(address => uint256) public ownerCollectedFees;

    // ─── Eventos ──────────────────────────────────────────────────────────────
    event PoolAdded(uint256 indexed poolId, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, bool comingSoon);
    event PoolStatusUpdated(uint256 indexed poolId, bool active, bool comingSoon);
    event Deposited(address indexed user, uint256 indexed poolId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event Withdrawn(address indexed user, uint256 indexed poolId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event Claimed(address indexed user, uint256 indexed poolId, uint256 fee0, uint256 fee1, uint256 grossH2O, uint256 netH2O);
    event FeesUpdated(uint256 dep, uint256 wd, uint256 claim);
    event PriceRouteSet(address indexed token, address pool, bool isToUsdc);
    event WldH2OPoolSet(address pool);
    event UsdcWldPoolSet(address pool);
    event Paused();
    event Unpaused();
    event OwnerWithdraw(address indexed token, address indexed to, uint256 amount);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier whenNotPaused() { require(!paused, "Paused"); _; }

    constructor(address _npm) {
        require(_npm != address(0), "zero npm");
        owner = msg.sender;
        NPM = INPM(_npm);
    }

    // ─── ERC721 receiver ──────────────────────────────────────────────────────
    function onERC721Received(address, address, uint256, bytes calldata)
        external pure returns (bytes4) { return 0x150b7a02; }

    // ─── Owner: configuracion ─────────────────────────────────────────────────
    function addPool(
        address tokenA,
        address tokenB,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        address poolAddr,
        bool comingSoon
    ) external onlyOwner returns (uint256 poolId) {
        require(tokenA != address(0) && tokenB != address(0) && tokenA != tokenB, "bad tokens");
        require(tickLower < tickUpper, "bad ticks");
        require(poolAddr != address(0), "bad pool");
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        poolId = _pools.length;
        _pools.push(Pool({
            token0: t0,
            token1: t1,
            fee: fee,
            tickLower: tickLower,
            tickUpper: tickUpper,
            poolAddr: poolAddr,
            nftTokenId: 0,
            totalLiquidity: 0,
            accFee0PerLiqX128: 0,
            accFee1PerLiqX128: 0,
            totalFees0Collected: 0,
            totalFees1Collected: 0,
            firstDepositAt: 0,
            active: !comingSoon,
            comingSoon: comingSoon
        }));
        emit PoolAdded(poolId, t0, t1, fee, tickLower, tickUpper, comingSoon);
    }

    /// @notice Permite al owner actualizar la direccion del pool V3 por si fue mal configurada.
    function setPoolAddr(uint256 poolId, address poolAddr) external onlyOwner {
        require(poolId < _pools.length, "bad id");
        require(poolAddr != address(0), "zero");
        _pools[poolId].poolAddr = poolAddr;
    }

    function setPoolStatus(uint256 poolId, bool active, bool comingSoon) external onlyOwner {
        require(poolId < _pools.length, "bad id");
        _pools[poolId].active = active;
        _pools[poolId].comingSoon = comingSoon;
        emit PoolStatusUpdated(poolId, active, comingSoon);
    }

    function setPriceRoute(address token, address pool, bool isToUsdc) external onlyOwner {
        priceRoutes[token] = Route({pool: pool, isToUsdc: isToUsdc});
        emit PriceRouteSet(token, pool, isToUsdc);
    }

    function setPriceRoutesBatch(
        address[] calldata tokens,
        address[] calldata pools,
        bool[] calldata isToUsdcArr
    ) external onlyOwner {
        require(tokens.length == pools.length && tokens.length == isToUsdcArr.length, "len");
        for (uint256 i; i < tokens.length; ++i) {
            priceRoutes[tokens[i]] = Route({pool: pools[i], isToUsdc: isToUsdcArr[i]});
            emit PriceRouteSet(tokens[i], pools[i], isToUsdcArr[i]);
        }
    }

    function setWldH2OPool(address pool) external onlyOwner { wldH2OPool = pool; emit WldH2OPoolSet(pool); }
    function setUsdcWldPool(address pool) external onlyOwner { usdcWldPool = pool; emit UsdcWldPoolSet(pool); }

    function setFees(uint256 dep, uint256 wd, uint256 claimBps_) external onlyOwner {
        require(dep <= MAX_FEE_BPS && wd <= MAX_FEE_BPS && claimBps_ <= MAX_FEE_BPS, "fee>max");
        depositFeeBps = dep; withdrawFeeBps = wd; claimFeeBps = claimBps_;
        emit FeesUpdated(dep, wd, claimBps_);
    }

    function pause() external onlyOwner { paused = true; emit Paused(); }
    function unpause() external onlyOwner { paused = false; emit Unpaused(); }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        owner = newOwner;
    }

    // Owner puede retirar cualquier token del contrato (incluido H2O reserve)
    function withdrawToken(address token, uint256 amount, address to) external onlyOwner {
        require(to != address(0), "zero to");
        require(IERC20H(token).transfer(to, amount), "tx fail");
        emit OwnerWithdraw(token, to, amount);
    }

    function withdrawAll(address token, address to) external onlyOwner {
        require(to != address(0), "zero to");
        uint256 bal = IERC20H(token).balanceOf(address(this));
        if (bal > 0) {
            require(IERC20H(token).transfer(to, bal), "tx fail");
            emit OwnerWithdraw(token, to, bal);
        }
    }

    // ─── Internal: actualizar acumulado de fees ──────────────────────────────
    function _harvest(uint256 poolId) internal {
        Pool storage p = _pools[poolId];
        if (p.nftTokenId == 0 || p.totalLiquidity == 0) return;
        (uint256 c0, uint256 c1) = NPM.collect(INPM.CollectParams({
            tokenId: p.nftTokenId,
            recipient: address(this),
            amount0Max: type(uint128).max,
            amount1Max: type(uint128).max
        }));
        if (c0 > 0) {
            p.accFee0PerLiqX128 += (c0 * Q128) / p.totalLiquidity;
            p.totalFees0Collected += c0;
        }
        if (c1 > 0) {
            p.accFee1PerLiqX128 += (c1 * Q128) / p.totalLiquidity;
            p.totalFees1Collected += c1;
        }
    }

    function _settleUser(uint256 poolId, address user) internal {
        Pool storage p = _pools[poolId];
        UserPosition storage u = _userPositions[poolId][user];
        if (u.liquidity > 0) {
            uint256 d0 = (uint256(u.liquidity) * p.accFee0PerLiqX128) / Q128;
            uint256 d1 = (uint256(u.liquidity) * p.accFee1PerLiqX128) / Q128;
            if (d0 > u.fee0Debt) u.pendingFee0 += d0 - u.fee0Debt;
            if (d1 > u.fee1Debt) u.pendingFee1 += d1 - u.fee1Debt;
            u.fee0Debt = d0;
            u.fee1Debt = d1;
        } else {
            u.fee0Debt = 0;
            u.fee1Debt = 0;
        }
    }

    // Cualquiera puede sincronizar fees on-chain (refresh para UI)
    function harvest(uint256 poolId) external {
        require(poolId < _pools.length, "bad id");
        _harvest(poolId);
    }

    // ─── Deposit (Permit2 doble: token0 + token1) ─────────────────────────────
    /**
     * @notice Aporta liquidez al pool indicado.
     * @dev    Ambos permits deben ser para los mismos token0/token1 del pool en orden:
     *         primero token0, luego token1. Se aplica 2% sobre cada monto bruto y se
     *         queda como fee del owner antes de mintear / aumentar liquidez.
     */
    function deposit(
        uint256 poolId,
        IPermit2.PermitTransferFrom calldata permit0,
        bytes calldata signature0,
        IPermit2.PermitTransferFrom calldata permit1,
        bytes calldata signature1,
        uint256 amount0Min,
        uint256 amount1Min
    ) external whenNotPaused {
        require(poolId < _pools.length, "bad id");
        Pool storage p = _pools[poolId];
        require(p.active && !p.comingSoon, "Pool inactive");
        require(permit0.permitted.token == p.token0, "token0 mismatch");
        require(permit1.permitted.token == p.token1, "token1 mismatch");

        uint256 amt0 = permit0.permitted.amount;
        uint256 amt1 = permit1.permitted.amount;
        require(amt0 > 0 && amt1 > 0, "zero amount");

        // Pull via Permit2 SignatureTransfer
        IPermit2(PERMIT2).permitTransferFrom(
            permit0,
            IPermit2.SignatureTransferDetails({to: address(this), requestedAmount: amt0}),
            msg.sender,
            signature0
        );
        IPermit2(PERMIT2).permitTransferFrom(
            permit1,
            IPermit2.SignatureTransferDetails({to: address(this), requestedAmount: amt1}),
            msg.sender,
            signature1
        );

        // Cobrar 2% deposit fee (queda como fee del owner)
        uint256 fee0 = (amt0 * depositFeeBps) / BPS;
        uint256 fee1 = (amt1 * depositFeeBps) / BPS;
        if (fee0 > 0) ownerCollectedFees[p.token0] += fee0;
        if (fee1 > 0) ownerCollectedFees[p.token1] += fee1;
        uint256 net0 = amt0 - fee0;
        uint256 net1 = amt1 - fee1;

        // Settle fees actuales antes de cambiar liquidez del usuario
        _harvest(poolId);
        _settleUser(poolId, msg.sender);

        // Aprobar al NPM y mintear / incrementar
        IERC20H(p.token0).approve(address(NPM), net0);
        IERC20H(p.token1).approve(address(NPM), net1);

        uint128 liq;
        uint256 used0;
        uint256 used1;
        if (p.nftTokenId == 0) {
            (uint256 tokenId, uint128 _l, uint256 _a0, uint256 _a1) = NPM.mint(INPM.MintParams({
                token0: p.token0,
                token1: p.token1,
                fee: p.fee,
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                amount0Desired: net0,
                amount1Desired: net1,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                recipient: address(this),
                deadline: block.timestamp + 600
            }));
            p.nftTokenId = tokenId;
            p.firstDepositAt = block.timestamp;
            liq = _l; used0 = _a0; used1 = _a1;
        } else {
            (uint128 _l, uint256 _a0, uint256 _a1) = NPM.increaseLiquidity(INPM.IncreaseLiquidityParams({
                tokenId: p.nftTokenId,
                amount0Desired: net0,
                amount1Desired: net1,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline: block.timestamp + 600
            }));
            liq = _l; used0 = _a0; used1 = _a1;
        }

        // Reset approvals + reembolso de remanente (si NPM no tomo el total)
        IERC20H(p.token0).approve(address(NPM), 0);
        IERC20H(p.token1).approve(address(NPM), 0);
        if (used0 < net0) IERC20H(p.token0).transfer(msg.sender, net0 - used0);
        if (used1 < net1) IERC20H(p.token1).transfer(msg.sender, net1 - used1);

        // Tracking de liquidez
        p.totalLiquidity += liq;
        UserPosition storage u = _userPositions[poolId][msg.sender];
        u.liquidity += liq;
        u.fee0Debt = (uint256(u.liquidity) * p.accFee0PerLiqX128) / Q128;
        u.fee1Debt = (uint256(u.liquidity) * p.accFee1PerLiqX128) / Q128;

        emit Deposited(msg.sender, poolId, liq, used0, used1);
    }

    // ─── Withdraw (decrease liquidity proporcional) ───────────────────────────
    function withdraw(
        uint256 poolId,
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min
    ) external whenNotPaused {
        require(poolId < _pools.length, "bad id");
        Pool storage p = _pools[poolId];
        require(p.nftTokenId != 0, "No position");
        UserPosition storage u = _userPositions[poolId][msg.sender];
        require(u.liquidity >= liquidity && liquidity > 0, "insufficient");

        _harvest(poolId);
        _settleUser(poolId, msg.sender);

        (uint256 a0, uint256 a1) = NPM.decreaseLiquidity(INPM.DecreaseLiquidityParams({
            tokenId: p.nftTokenId,
            liquidity: liquidity,
            amount0Min: amount0Min,
            amount1Min: amount1Min,
            deadline: block.timestamp + 600
        }));

        // collect saca principal + cualquier fee residual
        (uint256 c0, uint256 c1) = NPM.collect(INPM.CollectParams({
            tokenId: p.nftTokenId,
            recipient: address(this),
            amount0Max: type(uint128).max,
            amount1Max: type(uint128).max
        }));

        // c0/c1 - a0/a1 = fees adicionales generados durante decrease
        uint256 extra0 = c0 > a0 ? c0 - a0 : 0;
        uint256 extra1 = c1 > a1 ? c1 - a1 : 0;
        if (extra0 > 0 && p.totalLiquidity > 0) {
            p.accFee0PerLiqX128 += (extra0 * Q128) / p.totalLiquidity;
            p.totalFees0Collected += extra0;
        }
        if (extra1 > 0 && p.totalLiquidity > 0) {
            p.accFee1PerLiqX128 += (extra1 * Q128) / p.totalLiquidity;
            p.totalFees1Collected += extra1;
        }

        // 2% sobre principal
        uint256 fee0 = (a0 * withdrawFeeBps) / BPS;
        uint256 fee1 = (a1 * withdrawFeeBps) / BPS;
        if (fee0 > 0) ownerCollectedFees[p.token0] += fee0;
        if (fee1 > 0) ownerCollectedFees[p.token1] += fee1;
        uint256 out0 = a0 - fee0;
        uint256 out1 = a1 - fee1;

        // Tracking
        p.totalLiquidity -= liquidity;
        u.liquidity -= liquidity;
        u.fee0Debt = (uint256(u.liquidity) * p.accFee0PerLiqX128) / Q128;
        u.fee1Debt = (uint256(u.liquidity) * p.accFee1PerLiqX128) / Q128;

        if (out0 > 0) IERC20H(p.token0).transfer(msg.sender, out0);
        if (out1 > 0) IERC20H(p.token1).transfer(msg.sender, out1);

        emit Withdrawn(msg.sender, poolId, liquidity, out0, out1);
    }

    // ─── Claim (paga H2O equivalente, comision 20% oculta) ───────────────────
    function claim(uint256 poolId) external whenNotPaused {
        require(poolId < _pools.length, "bad id");
        Pool storage p = _pools[poolId];

        _harvest(poolId);
        _settleUser(poolId, msg.sender);

        UserPosition storage u = _userPositions[poolId][msg.sender];
        uint256 fee0 = u.pendingFee0;
        uint256 fee1 = u.pendingFee1;
        require(fee0 > 0 || fee1 > 0, "Nothing");
        u.pendingFee0 = 0;
        u.pendingFee1 = 0;

        // Los tokens (raw fees) ya estan en el contrato (vinieron del _harvest);
        // los registramos como recompensa del owner.
        if (fee0 > 0) ownerCollectedFees[p.token0] += fee0;
        if (fee1 > 0) ownerCollectedFees[p.token1] += fee1;

        // Calcular H2O equivalente
        uint256 grossH2O = _priceInH2O(p.token0, fee0) + _priceInH2O(p.token1, fee1);
        uint256 commission = (grossH2O * claimFeeBps) / BPS;
        uint256 netH2O = grossH2O - commission;

        require(IERC20H(H2O).balanceOf(address(this)) >= netH2O, "Low H2O reserve");
        if (netH2O > 0) require(IERC20H(H2O).transfer(msg.sender, netH2O), "tx fail");

        emit Claimed(msg.sender, poolId, fee0, fee1, grossH2O, netH2O);
    }

    // ─── Pricing helpers ──────────────────────────────────────────────────────
    function _priceInH2O(address token, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        if (token == H2O) return amount;
        if (token == WLD) return wldH2OPool == address(0) ? 0 : _spotPrice(wldH2OPool, WLD, H2O, amount);
        if (token == USDC) {
            if (usdcWldPool == address(0) || wldH2OPool == address(0)) return 0;
            uint256 wldAmt = _spotPrice(usdcWldPool, USDC, WLD, amount);
            return _spotPrice(wldH2OPool, WLD, H2O, wldAmt);
        }
        Route memory r = priceRoutes[token];
        if (r.pool == address(0)) return 0;
        if (r.isToUsdc) {
            if (usdcWldPool == address(0) || wldH2OPool == address(0)) return 0;
            uint256 usdcAmt = _spotPrice(r.pool, token, USDC, amount);
            uint256 wldAmt = _spotPrice(usdcWldPool, USDC, WLD, usdcAmt);
            return _spotPrice(wldH2OPool, WLD, H2O, wldAmt);
        } else {
            if (wldH2OPool == address(0)) return 0;
            uint256 wldAmt = _spotPrice(r.pool, token, WLD, amount);
            return _spotPrice(wldH2OPool, WLD, H2O, wldAmt);
        }
    }

    /**
     * @dev Spot price simple desde slot0() de un pool V3. Usa la misma formula
     *      que AcuaSwapRouterV2.quoteSingle.
     */
    function _spotPrice(address pool, address tokenIn, address tokenOut, uint256 amountIn)
        internal view returns (uint256)
    {
        if (amountIn == 0 || pool == address(0)) return 0;
        (uint160 sqrtPriceX96,,,,,,) = IUniV3Pool(pool).slot0();
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        if (tokenIn < tokenOut) {
            return (amountIn * priceX192) >> 192;
        } else {
            return (amountIn << 192) / priceX192;
        }
    }

    // ─── Vistas ───────────────────────────────────────────────────────────────
    function poolsCount() external view returns (uint256) { return _pools.length; }

    function getPool(uint256 poolId) external view returns (Pool memory) {
        return _pools[poolId];
    }

    function getAllPools() external view returns (Pool[] memory) {
        return _pools;
    }

    function getUserPosition(uint256 poolId, address user) external view returns (
        uint128 liquidity,
        uint256 pendingFee0,
        uint256 pendingFee1,
        uint256 grossH2O,
        uint256 netH2O
    ) {
        Pool storage p = _pools[poolId];
        UserPosition storage u = _userPositions[poolId][user];
        liquidity = u.liquidity;
        // Solo refleja lo registrado en storage (refresh con harvest() para totales frescos)
        if (u.liquidity > 0) {
            uint256 d0 = (uint256(u.liquidity) * p.accFee0PerLiqX128) / Q128;
            uint256 d1 = (uint256(u.liquidity) * p.accFee1PerLiqX128) / Q128;
            pendingFee0 = u.pendingFee0 + (d0 > u.fee0Debt ? d0 - u.fee0Debt : 0);
            pendingFee1 = u.pendingFee1 + (d1 > u.fee1Debt ? d1 - u.fee1Debt : 0);
        } else {
            pendingFee0 = u.pendingFee0;
            pendingFee1 = u.pendingFee1;
        }
        grossH2O = _priceInH2O(p.token0, pendingFee0) + _priceInH2O(p.token1, pendingFee1);
        uint256 commission = (grossH2O * claimFeeBps) / BPS;
        netH2O = grossH2O - commission;
    }

    /// @notice Para UI: valor en H2O de un monto raw de cualquier token.
    function tokenValueInH2O(address token, uint256 amount) external view returns (uint256) {
        return _priceInH2O(token, amount);
    }

    /// @notice APR estimado anual (BPS). Calculado como
    ///         (totalFeesValueH2O / poolNftLiquidityValueH2O) * SECONDS_PER_YEAR / elapsed.
    ///         Devuelve 0 si aun no hay datos.
    function estimateAprBps(uint256 poolId) external view returns (uint256) {
        Pool storage p = _pools[poolId];
        if (p.firstDepositAt == 0 || p.totalLiquidity == 0) return 0;
        uint256 elapsed = block.timestamp - p.firstDepositAt;
        if (elapsed == 0) return 0;

        uint256 feesH2O = _priceInH2O(p.token0, p.totalFees0Collected) + _priceInH2O(p.token1, p.totalFees1Collected);
        if (feesH2O == 0) return 0;

        // valor del NFT actual en H2O usando precio spot
        uint256 nftValueH2O = _liquidityValueInH2O(p);
        if (nftValueH2O == 0) return 0;

        return (feesH2O * BPS * SECONDS_PER_YEAR) / (nftValueH2O * elapsed);
    }

    function _liquidityValueInH2O(Pool storage p) internal view returns (uint256) {
        if (p.nftTokenId == 0 || p.totalLiquidity == 0 || p.poolAddr == address(0)) return 0;
        // Aproximacion para una posicion full-range: amount0 ≈ L * 2^96 / sqrtP,
        // amount1 ≈ L * sqrtP / 2^96. No es 100% exacto para rangos finitos pero
        // suficiente para estimar APR en la UI.
        (uint160 sqrtPriceX96,,,,,,) = IUniV3Pool(p.poolAddr).slot0();
        if (sqrtPriceX96 == 0) return 0;
        uint256 amt0 = (uint256(p.totalLiquidity) * Q96) / uint256(sqrtPriceX96);
        uint256 amt1 = (uint256(p.totalLiquidity) * uint256(sqrtPriceX96)) / Q96;
        return _priceInH2O(p.token0, amt0) + _priceInH2O(p.token1, amt1);
    }

    function getOwnerFees(address[] calldata tokens) external view returns (uint256[] memory amounts) {
        amounts = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) amounts[i] = ownerCollectedFees[tokens[i]];
    }

    function contractTokenBalance(address token) external view returns (uint256) {
        return IERC20H(token).balanceOf(address(this));
    }
}
