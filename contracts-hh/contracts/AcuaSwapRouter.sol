// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev Permit2 AllowanceTransfer — only the functions we need
interface IPermit2 {
    function transferFrom(address from, address to, uint160 amount, address token) external;
}

/// @dev Uniswap V3 SwapRouter02 exactInput (multi-hop path)
interface ISwapRouterV3 {
    struct ExactInputParams {
        bytes   path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @dev SushiSwap / Uniswap V2 router
interface ISwapRouterV2 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

/// @dev Volume tracking contract
interface IVolumeRewards {
    function recordSwap(address user, uint256 usdcAmount) external;
}

// ─── AcuaSwapRouter ───────────────────────────────────────────────────────────

/**
 * @title AcuaSwapRouter
 * @notice Wraps Uniswap V3 + SushiSwap V2 swaps with on-chain fee collection.
 *         Uses Permit2 AllowanceTransfer — user approves Permit2 once per token,
 *         then batches Permit2.approve + router.swap in one MiniKit tx.
 *
 * Fee model:
 *   - swapFeeBps (default 200 = 2%) split evenly among up to 3 feeOwners.
 *     Accumulated per-owner per-token, claimable at any time.
 *   - h2oFeeBps  (default 10 = 0.1%) accumulated per-token in the contract.
 *     Owner calls swapFeesToH2O() periodically to buy H2O and receive it.
 */
contract AcuaSwapRouter {

    // ─── Constants ────────────────────────────────────────────────────────────
    IPermit2       public constant PERMIT2    = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    ISwapRouterV3  public constant ROUTER_V3  = ISwapRouterV3(0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45);
    ISwapRouterV2  public constant ROUTER_V2  = ISwapRouterV2(0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506);
    address        public constant H2O        = 0x17392e5483983945dEB92e0518a8F2C4eB6bA59d;
    address        public constant WLD        = 0x2cFc85d8E48F8EAB294be644d9E25C3030863003;
    address        public constant USDC       = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;
    uint256        public constant MAX_FEE_BPS = 1000; // 10%

    // ─── Config ───────────────────────────────────────────────────────────────
    address   public owner;
    address[3] public feeOwners;     // up to 3 fee recipients
    uint256   public swapFeeBps = 200; // 2%
    uint256   public h2oFeeBps  = 10;  // 0.1%
    address   public volumeRewards;    // optional volume tracking contract

    // ─── Fee accounting ───────────────────────────────────────────────────────
    /// @notice ownerFees[ownerAddr][tokenAddr] = amount claimable
    mapping(address => mapping(address => uint256)) public ownerFees;
    /// @notice h2oFeePool[tokenAddr] = accumulated for H2O buyback
    mapping(address => uint256) public h2oFeePool;

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

    // ─── Internal: deduct and distribute fees ─────────────────────────────────
    function _deductFees(address token, uint256 amount)
        internal returns (uint256 netAmount)
    {
        uint256 swapFee = amount * swapFeeBps / 10000;
        uint256 h2oFee  = amount * h2oFeeBps  / 10000;

        // Distribute swap fee evenly among active feeOwners
        if (swapFee > 0) {
            uint256 activeOwners;
            for (uint256 i; i < 3; ++i) if (feeOwners[i] != address(0)) ++activeOwners;
            if (activeOwners > 0) {
                uint256 perOwner = swapFee / activeOwners;
                uint256 dust = swapFee - perOwner * activeOwners;
                for (uint256 i; i < 3; ++i) {
                    if (feeOwners[i] != address(0)) {
                        ownerFees[feeOwners[i]][token] += perOwner;
                    }
                }
                // dust stays in contract (negligible)
                ownerFees[feeOwners[0]][token] += dust; // first owner gets dust
            } else {
                ownerFees[owner][token] += swapFee;
            }
        }

        // Accumulate H2O fee
        if (h2oFee > 0) h2oFeePool[token] += h2oFee;

        netAmount = amount - swapFee - h2oFee;
    }

    // ─── Swap via Uniswap V3 (multi-hop or single-hop encoded path) ───────────
    /**
     * @param tokenIn       Input token address
     * @param tokenOut      Output token address
     * @param amountIn      Total input (including fees); pulled via Permit2
     * @param amountOutMin  Minimum output after slippage (user sets, already fee-adjusted)
     * @param v3Path        ABI-packed Uniswap V3 path: token/fee/token/fee/token…
     * @param usdcEquivalent  Input value in USDC units (6 dec) — for volume tracking
     */
    function swapV3(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        bytes   calldata v3Path,
        uint256 usdcEquivalent
    ) external returns (uint256 amountOut) {
        require(amountIn > 0, "Zero amount");
        require(amountIn <= type(uint160).max, "Amount overflow");

        // 1. Pull from user via Permit2 AllowanceTransfer
        PERMIT2.transferFrom(msg.sender, address(this), uint160(amountIn), tokenIn);

        // 2. Deduct fees
        uint256 netAmt = _deductFees(tokenIn, amountIn);

        // 3. Approve V3 router and swap
        IERC20(tokenIn).approve(address(ROUTER_V3), netAmt);
        amountOut = ROUTER_V3.exactInput(ISwapRouterV3.ExactInputParams({
            path:             v3Path,
            recipient:        msg.sender,
            amountIn:         netAmt,
            amountOutMinimum: amountOutMin
        }));

        // 4. Record volume
        _recordVolume(msg.sender, usdcEquivalent);

        emit SwappedV3(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ─── Swap via SushiSwap V2 (address[] path) ───────────────────────────────
    /**
     * @param v2Path        Array of token addresses: [tokenIn, hop?, tokenOut]
     * @param usdcEquivalent  Input value in USDC units (6 dec)
     */
    function swapV2(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata v2Path,
        uint256 usdcEquivalent
    ) external returns (uint256 amountOut) {
        require(amountIn > 0, "Zero amount");
        require(amountIn <= type(uint160).max, "Amount overflow");
        require(v2Path.length >= 2, "Bad path");

        // 1. Pull from user via Permit2
        PERMIT2.transferFrom(msg.sender, address(this), uint160(amountIn), tokenIn);

        // 2. Deduct fees
        uint256 netAmt = _deductFees(tokenIn, amountIn);

        // 3. Approve V2 router and swap
        IERC20(tokenIn).approve(address(ROUTER_V2), netAmt);
        uint256 deadline = block.timestamp + 1800;
        uint256[] memory amounts = ROUTER_V2.swapExactTokensForTokens(
            netAmt, amountOutMin, v2Path, msg.sender, deadline
        );
        amountOut = amounts[amounts.length - 1];

        // 4. Record volume
        _recordVolume(msg.sender, usdcEquivalent);

        emit SwappedV2(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ─── Claim accumulated swap fees (any token) ──────────────────────────────
    function claimFees(address token) external {
        uint256 amount = ownerFees[msg.sender][token];
        require(amount > 0, "Nothing to claim");
        ownerFees[msg.sender][token] = 0;
        IERC20(token).transfer(msg.sender, amount);
        emit FeeClaimed(msg.sender, token, amount);
    }

    function claimFeesBatch(address[] calldata tokens) external {
        for (uint256 i; i < tokens.length; ++i) {
            uint256 amount = ownerFees[msg.sender][tokens[i]];
            if (amount == 0) continue;
            ownerFees[msg.sender][tokens[i]] = 0;
            IERC20(tokens[i]).transfer(msg.sender, amount);
            emit FeeClaimed(msg.sender, tokens[i], amount);
        }
    }

    // ─── Swap accumulated H2O fee pool to H2O ─────────────────────────────────
    /**
     * @notice Owner calls this periodically to convert accumulated token fees into H2O.
     *         h2oPath: token → WLD (fee 3000) → H2O (fee 3000) — encoded V3 path
     */
    function swapFeesToH2OV3(
        address token,
        bytes calldata h2oPath,
        uint256 minH2OOut
    ) external onlyOwner {
        uint256 amount = h2oFeePool[token];
        require(amount > 0, "No fees accumulated");
        h2oFeePool[token] = 0;

        if (token == H2O) {
            IERC20(H2O).transfer(owner, amount);
            emit H2OBought(token, amount, amount);
            return;
        }

        IERC20(token).approve(address(ROUTER_V3), amount);
        uint256 h2oOut = ROUTER_V3.exactInput(ISwapRouterV3.ExactInputParams({
            path:             h2oPath,
            recipient:        owner,
            amountIn:         amount,
            amountOutMinimum: minH2OOut
        }));
        emit H2OBought(token, amount, h2oOut);
    }

    // ─── Internal volume recording ────────────────────────────────────────────
    function _recordVolume(address user, uint256 usdcAmount) internal {
        if (volumeRewards != address(0) && usdcAmount > 0) {
            try IVolumeRewards(volumeRewards).recordSwap(user, usdcAmount) {} catch {}
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
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero addr");
        owner = newOwner;
    }

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }
}
