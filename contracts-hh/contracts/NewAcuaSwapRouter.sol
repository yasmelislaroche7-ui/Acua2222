// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NewAcuaSwapRouter
 * @notice Universal swap router for Acua 2.0 that aggregates Uniswap v2, v3, and v4.
 *
 * Features:
 *   - No swap amount limits
 *   - Configurable protocol fee (bps) per route, forwarded to FundManager
 *   - Supports Permit2 for input token approval (World App compatible)
 *   - Owner-configurable router addresses (upgradeable without redeployment)
 *   - Multi-hop via v3 encoded path or v2 path array
 *   - V4 swap via PoolManager (Uniswap v4) with custom hook support
 *   - Connect / disconnect contracts (fee collector, referral, etc.)
 *   - Add / remove owners
 *   - Emergency pause
 */

interface IERC20Swap {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IPermit2Swap {
    struct TokenPermissions { address token; uint256 amount; }
    struct PermitTransferFrom { TokenPermissions permitted; uint256 nonce; uint256 deadline; }
    struct SignatureTransferDetails { address to; uint256 requestedAmount; }
    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}

// ─── Uniswap V2 ───────────────────────────────────────────────────────────────
interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts);
}

// ─── Uniswap V3 ───────────────────────────────────────────────────────────────
interface ISwapRouter03 {
    struct ExactInputParams {
        bytes   path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

// ─── Uniswap V4 (PoolManager) ─────────────────────────────────────────────────
interface IPoolManager {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24  fee;
        int24   tickSpacing;
        address hooks;
    }
    struct SwapParams {
        bool    zeroForOne;
        int256  amountSpecified;
        uint160 sqrtPriceLimitX96;
    }
    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external returns (int256 delta0, int256 delta1);
}

contract NewAcuaSwapRouter {

    // ─── Constants ────────────────────────────────────────────────────────────
    uint256 public constant MAX_BPS       = 10_000;
    uint256 public constant MAX_FEE_BPS   = 500;     // 5% hard cap on protocol fee
    uint256 public constant MAX_OWNERS    = 5;
    uint256 public constant MAX_CONTRACTS = 10;

    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // ─── Routers (configurable) ───────────────────────────────────────────────
    address public routerV2;    // Uniswap V2 (or SushiSwap / compatible)
    address public routerV3;    // Uniswap V3 SwapRouter02
    address public poolManagerV4; // Uniswap V4 PoolManager

    // ─── Protocol fee ─────────────────────────────────────────────────────────
    /// Basis points charged on every swap, forwarded to feeReceiver.
    uint256 public protocolFeeBps = 30;  // 0.3% default

    /// Where protocol fees are sent (FundManager or direct wallet).
    address public feeReceiver;

    // ─── Owner & Contract management ─────────────────────────────────────────
    address[] public owners;
    address[] public connectedContracts;
    bool public paused;

    // ─── Events ───────────────────────────────────────────────────────────────
    event SwapV2Executed(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee);
    event SwapV3Executed(address indexed user, uint256 amountIn, uint256 amountOut, uint256 fee);
    event SwapV4Executed(address indexed user, address tokenIn, address tokenOut, int256 delta0, int256 delta1);
    event RoutersUpdated(address v2, address v3, address v4);
    event FeeUpdated(uint256 bps, address receiver);
    event ContractConnected(address indexed addr);
    event ContractDisconnected(address indexed addr);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event Paused(bool paused);

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(_isOwner(msg.sender), "AcuaSwap: not owner");
        _;
    }
    modifier whenNotPaused() {
        require(!paused, "AcuaSwap: paused");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(
        address _initialOwner,
        address _routerV2,
        address _routerV3,
        address _poolManagerV4,
        address _feeReceiver
    ) {
        require(_initialOwner != address(0), "zero owner");
        owners.push(_initialOwner);
        routerV2       = _routerV2;
        routerV3       = _routerV3;
        poolManagerV4  = _poolManagerV4;
        feeReceiver    = _feeReceiver != address(0) ? _feeReceiver : _initialOwner;
    }

    // ─── V2 Swap ──────────────────────────────────────────────────────────────

    /**
     * @notice Swap exact tokens via Uniswap V2 (any V2-compatible DEX).
     * @param amountIn     Gross input amount (before protocol fee).
     * @param amountOutMin Minimum output (slippage protection, caller sets).
     * @param path         Token path [tokenIn, ..., tokenOut].
     * @param deadline     Unix timestamp deadline.
     */
    function swapV2(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external whenNotPaused returns (uint256 amountOut) {
        require(routerV2 != address(0), "V2 router not set");
        require(path.length >= 2, "invalid path");
        require(amountIn > 0, "zero amount");

        address tokenIn  = path[0];
        address tokenOut = path[path.length - 1];

        IERC20Swap(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        uint256 fee = _collectFee(tokenIn, amountIn);
        uint256 netIn = amountIn - fee;

        IERC20Swap(tokenIn).approve(routerV2, netIn);

        uint256[] memory amounts = IUniswapV2Router(routerV2).swapExactTokensForTokens(
            netIn, amountOutMin, path, msg.sender, deadline
        );
        amountOut = amounts[amounts.length - 1];

        emit SwapV2Executed(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }

    /// @notice V2 swap with Permit2 input approval.
    function swapV2Permit2(
        IPermit2Swap.PermitTransferFrom calldata permit,
        bytes calldata signature,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external whenNotPaused returns (uint256 amountOut) {
        require(routerV2 != address(0), "V2 router not set");
        require(path.length >= 2, "invalid path");

        uint256 amountIn = permit.permitted.amount;
        address tokenIn  = permit.permitted.token;
        address tokenOut = path[path.length - 1];

        IPermit2Swap(PERMIT2).permitTransferFrom(
            permit,
            IPermit2Swap.SignatureTransferDetails({ to: address(this), requestedAmount: amountIn }),
            msg.sender,
            signature
        );

        uint256 fee = _collectFee(tokenIn, amountIn);
        uint256 netIn = amountIn - fee;

        IERC20Swap(tokenIn).approve(routerV2, netIn);
        uint256[] memory amounts = IUniswapV2Router(routerV2).swapExactTokensForTokens(
            netIn, amountOutMin, path, msg.sender, deadline
        );
        amountOut = amounts[amounts.length - 1];

        emit SwapV2Executed(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }

    // ─── V3 Swap ──────────────────────────────────────────────────────────────

    /**
     * @notice Swap via Uniswap V3 using an encoded multi-hop path.
     * @param tokenIn     Input token.
     * @param encodedPath ABI-encoded V3 path (tokenIn · fee · tokenMid · fee · tokenOut …).
     * @param amountIn    Gross input amount.
     * @param amountOutMin Slippage protection.
     */
    function swapV3(
        address tokenIn,
        bytes calldata encodedPath,
        uint256 amountIn,
        uint256 amountOutMin
    ) external whenNotPaused returns (uint256 amountOut) {
        require(routerV3 != address(0), "V3 router not set");
        require(amountIn > 0, "zero amount");

        IERC20Swap(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        uint256 fee = _collectFee(tokenIn, amountIn);
        uint256 netIn = amountIn - fee;

        IERC20Swap(tokenIn).approve(routerV3, netIn);
        amountOut = ISwapRouter03(routerV3).exactInput(
            ISwapRouter03.ExactInputParams({
                path:             encodedPath,
                recipient:        msg.sender,
                amountIn:         netIn,
                amountOutMinimum: amountOutMin
            })
        );

        emit SwapV3Executed(msg.sender, amountIn, amountOut, fee);
    }

    /// @notice Single-hop V3 swap (simpler interface).
    function swapV3Single(
        address tokenIn,
        address tokenOut,
        uint24  poolFee,
        uint256 amountIn,
        uint256 amountOutMin
    ) external whenNotPaused returns (uint256 amountOut) {
        require(routerV3 != address(0), "V3 router not set");
        require(amountIn > 0, "zero amount");

        IERC20Swap(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        uint256 fee = _collectFee(tokenIn, amountIn);
        uint256 netIn = amountIn - fee;

        IERC20Swap(tokenIn).approve(routerV3, netIn);
        amountOut = ISwapRouter03(routerV3).exactInputSingle(
            ISwapRouter03.ExactInputSingleParams({
                tokenIn:           tokenIn,
                tokenOut:          tokenOut,
                fee:               poolFee,
                recipient:         msg.sender,
                amountIn:          netIn,
                amountOutMinimum:  amountOutMin,
                sqrtPriceLimitX96: 0
            })
        );

        emit SwapV3Executed(msg.sender, amountIn, amountOut, fee);
    }

    // ─── V4 Swap ──────────────────────────────────────────────────────────────

    /**
     * @notice Swap via Uniswap V4 PoolManager.
     * @dev Caller provides a fully-formed PoolKey and SwapParams.
     *      The actual settlement / currency router wrapping is handled by the
     *      Universal Router or a custom unlock callback (not included here —
     *      integrate via a separate UnlockCallback contract if needed).
     *      This is the raw hook into the V4 pool.
     */
    function swapV4(
        IPoolManager.PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData,
        uint256 amountIn
    ) external whenNotPaused returns (int256 delta0, int256 delta1) {
        require(poolManagerV4 != address(0), "V4 pool manager not set");
        require(amountIn > 0, "zero amount");

        address tokenIn = params.zeroForOne ? key.currency0 : key.currency1;
        IERC20Swap(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        uint256 fee = _collectFee(tokenIn, amountIn);

        // Approve pool manager
        IERC20Swap(tokenIn).approve(poolManagerV4, amountIn - fee);

        (delta0, delta1) = IPoolManager(poolManagerV4).swap(key, params, hookData);

        emit SwapV4Executed(msg.sender, tokenIn, params.zeroForOne ? key.currency1 : key.currency0, delta0, delta1);
    }

    // ─── Fee ──────────────────────────────────────────────────────────────────

    function _collectFee(address tokenIn, uint256 amountIn) internal returns (uint256 fee) {
        if (protocolFeeBps == 0 || feeReceiver == address(0)) return 0;
        fee = (amountIn * protocolFeeBps) / MAX_BPS;
        if (fee > 0) {
            IERC20Swap(tokenIn).transfer(feeReceiver, fee);
        }
    }

    // ─── Config ───────────────────────────────────────────────────────────────

    function setRouters(address _v2, address _v3, address _v4) external onlyOwner {
        routerV2      = _v2;
        routerV3      = _v3;
        poolManagerV4 = _v4;
        emit RoutersUpdated(_v2, _v3, _v4);
    }

    function setProtocolFee(uint256 _bps, address _receiver) external onlyOwner {
        require(_bps <= MAX_FEE_BPS, "fee too high");
        protocolFeeBps = _bps;
        feeReceiver    = _receiver;
        emit FeeUpdated(_bps, _receiver);
    }

    // ─── Contract Connections ─────────────────────────────────────────────────

    function connectContract(address contractAddr) external onlyOwner {
        require(contractAddr != address(0), "zero address");
        require(connectedContracts.length < MAX_CONTRACTS, "max contracts");
        connectedContracts.push(contractAddr);
        emit ContractConnected(contractAddr);
    }

    function disconnectContract(uint256 index) external onlyOwner {
        require(index < connectedContracts.length, "out of bounds");
        emit ContractDisconnected(connectedContracts[index]);
        connectedContracts[index] = address(0);
    }

    function getConnectedContracts() external view returns (address[] memory) {
        return connectedContracts;
    }

    // ─── Owner Management ─────────────────────────────────────────────────────

    function addOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        require(!_isOwner(newOwner), "already owner");
        require(owners.length < MAX_OWNERS, "max owners");
        owners.push(newOwner);
        emit OwnerAdded(newOwner);
    }

    function removeOwner(address ownerAddr) external onlyOwner {
        require(owners.length > 1, "need at least 1 owner");
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == ownerAddr) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                emit OwnerRemoved(ownerAddr);
                return;
            }
        }
        revert("not found");
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    // ─── Pause / Emergency ────────────────────────────────────────────────────

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function rescueToken(address _token, address to, uint256 amount) external onlyOwner {
        IERC20Swap(_token).transfer(to, amount);
    }

    // ─── Quote helpers (view) ─────────────────────────────────────────────────

    function quoteV2(uint256 amountIn, address[] calldata path)
        external view returns (uint256 amountOut)
    {
        require(routerV2 != address(0), "V2 router not set");
        uint256 fee = (amountIn * protocolFeeBps) / MAX_BPS;
        uint256[] memory amounts = IUniswapV2Router(routerV2).getAmountsOut(amountIn - fee, path);
        return amounts[amounts.length - 1];
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _isOwner(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == addr) return true;
        }
        return false;
    }
}
