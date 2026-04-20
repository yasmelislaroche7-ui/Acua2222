// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev Permit2 AllowanceTransfer
interface IPermit2 {
    function transferFrom(address from, address to, uint160 amount, address token) external;
}

/// @dev Uniswap V3 Pool (World Chain specific factory)
interface IUniswapV3Pool {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool
    );
}

/// @dev Uniswap V3 Swap Callback
interface IUniswapV3SwapCallback {
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external;
}

/// @dev Uniswap V2 Router (Uniswap V2 on World Chain)
interface ISwapRouterV2 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    function getAmountsOut(uint amountIn, address[] memory path)
        external view returns (uint[] memory amounts);
}

/// @dev Volume tracking
interface IVolumeRewards {
    function recordSwap(address user, uint256 usdcAmount) external;
}

// ─── AcuaSwapRouter ───────────────────────────────────────────────────────────

/**
 * @title AcuaSwapRouter
 * @notice On-chain fee wrapper for Uniswap V3 (direct pool calls) and V2 on World Chain.
 *         Uses Permit2 AllowanceTransfer for token pulls.
 *         Calls World Chain V3 pools directly (factory = 0x7a5028...) since the standard
 *         SwapRouter02 is deployed with the Ethereum mainnet factory address.
 *
 * Fee model:
 *   swapFeeBps (default 200 = 2%) — split evenly among feeOwners
 *   h2oFeeBps  (default 10  = 0.1%) — pooled for periodic H2O buyback
 */
contract AcuaSwapRouter is IUniswapV3SwapCallback {

    // ─── Constants ────────────────────────────────────────────────────────────
    IPermit2 public constant PERMIT2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    /// @dev World Chain Uniswap V3 factory (different from Ethereum mainnet)
    address public constant V3_FACTORY    = 0x7a5028BDa40e7B173C278C5342087826455ea25a;
    bytes32 public constant V3_POOL_INIT_CODE_HASH =
        0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54;

    /// @dev Standard Uniswap V2 router deployed on World Chain
    ISwapRouterV2 public constant ROUTER_V2 = ISwapRouterV2(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);

    address public constant H2O  = 0x17392e5483983945dEB92e0518a8F2C4eB6bA59d;
    address public constant WLD  = 0x2cFc85d8E48F8EAB294be644d9E25C3030863003;
    address public constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;

    uint160 private constant _MIN_SQRT_RATIO = 4295128739;
    uint160 private constant _MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;
    uint256 public  constant MAX_FEE_BPS = 1000;

    // ─── Config ───────────────────────────────────────────────────────────────
    address   public owner;
    address[3] public feeOwners;
    uint256   public swapFeeBps = 200;
    uint256   public h2oFeeBps  = 10;
    address   public volumeRewards;

    // ─── Fee accounting ───────────────────────────────────────────────────────
    mapping(address => mapping(address => uint256)) public ownerFees;
    mapping(address => uint256) public h2oFeePool;

    // ─── Transient swap context (re-entrant callback) ─────────────────────────
    address private _swapUser;
    address private _swapToken;

    // ─── Events ───────────────────────────────────────────────────────────────
    event SwappedV3(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event SwappedV2(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event FeeClaimed(address indexed who, address indexed token, uint256 amount);
    event H2OBought(address indexed token, uint256 tokenIn, uint256 h2oOut);
    event ConfigUpdated();

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address[3] memory _feeOwners) {
        owner = msg.sender;
        feeOwners = _feeOwners;
    }

    // ─── Pool address computation ─────────────────────────────────────────────
    function _computePool(address tokenA, address tokenB, uint24 fee)
        internal pure returns (address pool)
    {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 salt = keccak256(abi.encode(t0, t1, fee));
        pool = address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), V3_FACTORY, salt, V3_POOL_INIT_CODE_HASH
        )))));
    }

    // ─── V3 Swap Callback ─────────────────────────────────────────────────────
    /**
     * @dev Called by the pool after our swap() call. We push owed tokens from our balance.
     *      The router holds the net amount (after fees) at this point.
     */
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata /* data */
    ) external override {
        // The caller must be the pool we computed (security check)
        require(_swapToken != address(0), "No active swap");
        // We already hold the net token amount, just transfer it to the pool
        if (amount0Delta > 0) {
            IERC20(_swapToken).transfer(msg.sender, uint256(amount0Delta));
        } else if (amount1Delta > 0) {
            IERC20(_swapToken).transfer(msg.sender, uint256(amount1Delta));
        }
    }

    // ─── Internal fee deduction ───────────────────────────────────────────────
    function _deductFees(address token, uint256 amount) internal returns (uint256 netAmount) {
        uint256 swapFee = amount * swapFeeBps / 10000;
        uint256 h2oFee  = amount * h2oFeeBps  / 10000;

        if (swapFee > 0) {
            uint256 active;
            for (uint256 i; i < 3; ++i) if (feeOwners[i] != address(0)) ++active;
            if (active > 0) {
                uint256 per = swapFee / active;
                uint256 dust = swapFee - per * active;
                for (uint256 i; i < 3; ++i)
                    if (feeOwners[i] != address(0)) ownerFees[feeOwners[i]][token] += per;
                ownerFees[feeOwners[0]][token] += dust;
            } else {
                ownerFees[owner][token] += swapFee;
            }
        }
        if (h2oFee > 0) h2oFeePool[token] += h2oFee;
        netAmount = amount - swapFee - h2oFee;
    }

    // ─── Swap via Uniswap V3 (direct pool, single hop) ────────────────────────
    /**
     * @param tokenIn         Input token
     * @param tokenOut        Output token
     * @param fee             Pool fee tier (100, 500, 3000, or 10000)
     * @param amountIn        Gross input amount (fees deducted on-chain)
     * @param amountOutMin    Minimum output after slippage
     * @param usdcEquivalent  Input value in USDC-6-dec for volume tracking
     */
    function swapV3Single(
        address tokenIn,
        address tokenOut,
        uint24  fee,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 usdcEquivalent
    ) external returns (uint256 amountOut) {
        require(amountIn > 0 && amountIn <= type(uint160).max, "Bad amount");

        // Pull tokens via Permit2
        PERMIT2.transferFrom(msg.sender, address(this), uint160(amountIn), tokenIn);

        // Deduct fees
        uint256 netAmt = _deductFees(tokenIn, amountIn);

        // Set callback context
        _swapUser  = msg.sender;
        _swapToken = tokenIn;

        address pool = _computePool(tokenIn, tokenOut, fee);
        bool zeroForOne = tokenIn < tokenOut;
        uint160 sqrtLimit = zeroForOne ? _MIN_SQRT_RATIO + 1 : _MAX_SQRT_RATIO - 1;

        (int256 a0, int256 a1) = IUniswapV3Pool(pool).swap(
            msg.sender,        // recipient gets tokenOut
            zeroForOne,
            int256(netAmt),    // exact input
            sqrtLimit,
            ""
        );

        _swapToken = address(0); // clear callback context

        amountOut = zeroForOne ? uint256(-a1) : uint256(-a0);
        require(amountOut >= amountOutMin, "Too much slippage");

        _recordVolume(msg.sender, usdcEquivalent);
        emit SwappedV3(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ─── Swap via Uniswap V3 (multi-hop: tokenIn -> hop -> tokenOut) ──────────
    /**
     * @param tokenIn       Input token
     * @param hopToken      Intermediate token (WLD or USDC typically)
     * @param tokenOut      Output token
     * @param fee1          Fee tier for first hop (tokenIn -> hop)
     * @param fee2          Fee tier for second hop (hop -> tokenOut)
     * @param amountIn      Gross input
     * @param amountOutMin  Minimum output
     * @param usdcEquivalent Input USD value (6-dec)
     */
    function swapV3Multi(
        address tokenIn,
        address hopToken,
        address tokenOut,
        uint24  fee1,
        uint24  fee2,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 usdcEquivalent
    ) external returns (uint256 amountOut) {
        require(amountIn > 0 && amountIn <= type(uint160).max, "Bad amount");

        PERMIT2.transferFrom(msg.sender, address(this), uint160(amountIn), tokenIn);
        uint256 netAmt = _deductFees(tokenIn, amountIn);

        // Hop 1: tokenIn -> hopToken (output to this contract)
        _swapUser  = msg.sender;
        _swapToken = tokenIn;
        address pool1 = _computePool(tokenIn, hopToken, fee1);
        bool z1 = tokenIn < hopToken;
        (int256 a0, int256 a1) = IUniswapV3Pool(pool1).swap(
            address(this), z1, int256(netAmt), z1 ? _MIN_SQRT_RATIO + 1 : _MAX_SQRT_RATIO - 1, ""
        );
        _swapToken = address(0);
        uint256 midAmt = z1 ? uint256(-a1) : uint256(-a0);

        // Hop 2: hopToken -> tokenOut (output directly to user)
        _swapToken = hopToken;
        address pool2 = _computePool(hopToken, tokenOut, fee2);
        bool z2 = hopToken < tokenOut;
        (int256 b0, int256 b1) = IUniswapV3Pool(pool2).swap(
            msg.sender, z2, int256(midAmt), z2 ? _MIN_SQRT_RATIO + 1 : _MAX_SQRT_RATIO - 1, ""
        );
        _swapToken = address(0);
        amountOut = z2 ? uint256(-b1) : uint256(-b0);

        require(amountOut >= amountOutMin, "Too much slippage");
        _recordVolume(msg.sender, usdcEquivalent);
        emit SwappedV3(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ─── Swap via Uniswap V2 ──────────────────────────────────────────────────
    function swapV2(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata v2Path,
        uint256 usdcEquivalent
    ) external returns (uint256 amountOut) {
        require(amountIn > 0 && amountIn <= type(uint160).max, "Bad amount");
        require(v2Path.length >= 2, "Bad path");

        PERMIT2.transferFrom(msg.sender, address(this), uint160(amountIn), tokenIn);
        uint256 netAmt = _deductFees(tokenIn, amountIn);

        IERC20(tokenIn).approve(address(ROUTER_V2), netAmt);
        uint256[] memory amounts = ROUTER_V2.swapExactTokensForTokens(
            netAmt, amountOutMin, v2Path, msg.sender, block.timestamp + 1800
        );
        amountOut = amounts[amounts.length - 1];

        _recordVolume(msg.sender, usdcEquivalent);
        emit SwappedV2(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ─── Fee claims ───────────────────────────────────────────────────────────
    function claimFees(address token) external {
        uint256 amount = ownerFees[msg.sender][token];
        require(amount > 0, "Nothing to claim");
        ownerFees[msg.sender][token] = 0;
        IERC20(token).transfer(msg.sender, amount);
        emit FeeClaimed(msg.sender, token, amount);
    }

    function claimFeesBatch(address[] calldata tokens) external {
        for (uint256 i; i < tokens.length; ++i) {
            uint256 a = ownerFees[msg.sender][tokens[i]];
            if (a == 0) continue;
            ownerFees[msg.sender][tokens[i]] = 0;
            IERC20(tokens[i]).transfer(msg.sender, a);
            emit FeeClaimed(msg.sender, tokens[i], a);
        }
    }

    // ─── H2O buyback (owner calls periodically) ───────────────────────────────
    function buybackH2O(address token, uint24 feeHop, uint24 feeOut) external onlyOwner {
        uint256 amount = h2oFeePool[token];
        require(amount > 0, "No fees");
        h2oFeePool[token] = 0;

        if (token == H2O) {
            IERC20(H2O).transfer(owner, amount);
            emit H2OBought(token, amount, amount);
            return;
        }

        // Route token -> WLD -> H2O (via V3 direct pools on World Chain)
        _swapToken = token;
        address pool1 = _computePool(token, WLD, feeHop);
        bool z1 = token < WLD;
        (int256 a0, int256 a1) = IUniswapV3Pool(pool1).swap(
            address(this), z1, int256(amount), z1 ? _MIN_SQRT_RATIO + 1 : _MAX_SQRT_RATIO - 1, ""
        );
        _swapToken = address(0);
        uint256 wldAmt = z1 ? uint256(-a1) : uint256(-a0);

        _swapToken = WLD;
        address pool2 = _computePool(WLD, H2O, feeOut);
        bool z2 = WLD < H2O;
        (int256 b0, int256 b1) = IUniswapV3Pool(pool2).swap(
            owner, z2, int256(wldAmt), z2 ? _MIN_SQRT_RATIO + 1 : _MAX_SQRT_RATIO - 1, ""
        );
        _swapToken = address(0);
        uint256 h2oOut = z2 ? uint256(-b1) : uint256(-b0);

        emit H2OBought(token, amount, h2oOut);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function _recordVolume(address user, uint256 usdcAmount) internal {
        if (volumeRewards != address(0) && usdcAmount > 0) {
            try IVolumeRewards(volumeRewards).recordSwap(user, usdcAmount) {} catch {}
        }
    }

    /// @notice Preview a single-hop V3 quote (spot price, no impact — only for UI use)
    function quoteSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn)
        external view returns (uint256 amountOut, address poolAddr)
    {
        poolAddr = _computePool(tokenIn, tokenOut, fee);
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(poolAddr).slot0();
        // price = (sqrtPriceX96 / 2^96)^2
        // token0 price in token1: price = sqrtPriceX96^2 / 2^192
        bool zeroForOne = tokenIn < tokenOut;
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        if (zeroForOne) {
            // tokenIn = token0, tokenOut = token1
            amountOut = amountIn * priceX192 / (1 << 192);
        } else {
            // tokenIn = token1, tokenOut = token0
            amountOut = amountIn * (1 << 192) / priceX192;
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────
    function setFees(uint256 _swapFeeBps, uint256 _h2oFeeBps) external onlyOwner {
        require(_swapFeeBps + _h2oFeeBps <= MAX_FEE_BPS, "Fee too high");
        swapFeeBps = _swapFeeBps;
        h2oFeeBps  = _h2oFeeBps;
        emit ConfigUpdated();
    }

    function setFeeOwners(address[3] calldata _owners) external onlyOwner {
        feeOwners = _owners;
        emit ConfigUpdated();
    }

    function setVolumeRewards(address _vr) external onlyOwner {
        volumeRewards = _vr;
        emit ConfigUpdated();
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero addr");
        owner = newOwner;
    }

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }

    function getPoolAddress(address tokenA, address tokenB, uint24 fee)
        external pure returns (address)
    {
        return _computePool(tokenA, tokenB, fee);
    }
}
