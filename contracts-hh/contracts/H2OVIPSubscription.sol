// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IH2OStaking {
    function buyVIP(uint256 months_) external;
    function claimOwnerVip() external;
    function vipPrice() external view returns (uint256);
    function ownerShares(address) external view returns (uint256);
}

/**
 * @title H2OVIPSubscription
 * @notice Permit2 connector for the H2O staking VIP subscription.
 *
 * Problem it solves
 * -----------------
 * The staking contract's buyVIP() uses ERC20.transferFrom, which requires a
 * prior approve() call. In World App, approve() is unreliable and causes tx
 * failures. This contract bridges the gap:
 *   1. User signs ONE Permit2 message in World App (no approve needed).
 *   2. This contract receives the UTH2 from the user via Permit2.
 *   3. This contract calls staking.buyVIP() using its own pre-approved UTH2
 *      allowance → staking contract gets the UTH2 and gives this contract
 *      an ownerShare in its VIP fee pool.
 *   4. This contract records the subscription for the actual user.
 *
 * Rewards flow (no owner deposits required)
 * ------------------------------------------
 * Every time staking users claim rewards, 5% of the claim fee accumulates in
 * the staking contract's ownerVipPool. This contract has ownerShares there.
 * When a user calls claimOwnerVip() here, this contract:
 *   a) Calls staking.claimOwnerVip() to pull its earned H2O from the pool.
 *   b) Distributes the collected H2O proportionally to VIP holders.
 */
contract H2OVIPSubscription {

    uint256 constant SCALE   = 1e18;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address public immutable UTH2;
    address public immutable H2O;
    address public immutable STAKING;

    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _uth2, address _h2o, address _staking) {
        UTH2    = _uth2;
        H2O     = _h2o;
        STAKING = _staking;
        owner   = msg.sender;
        // Pre-approve: allow the staking contract to pull UTH2 from this contract.
        // This is what makes staking.buyVIP() work without a user approve().
        IERC20(_uth2).approve(_staking, type(uint256).max);
    }

    // ── VIP subscription tracking ─────────────────────────────────────────

    uint256 public constant vipDuration = 30 days;
    mapping(address => uint256) public vipExpire;

    // ── H2O reward pool for VIP holders ───────────────────────────────────

    mapping(address => uint256) public holderShares;
    uint256 public totalHolderShares;
    uint256 public rewardPerShare;
    mapping(address => uint256) public rewardDebt;

    // ── Read vipPrice from staking (single source of truth) ───────────────

    function vipPrice() public view returns (uint256) {
        return IH2OStaking(STAKING).vipPrice();
    }

    // ── Buy VIP with Permit2 ───────────────────────────────────────────────

    /**
     * @notice Buy or extend VIP subscription using UTH2 via Permit2.
     *         World App handles the signature — NO prior approve() needed.
     *
     * @param months_  Months to purchase (1-12)
     * @param permit   Permit2 struct: { permitted:{token,amount}, nonce, deadline }
     * @param sig      Permit2 signature from World App
     */
    function buyVIPWithPermit2(
        uint256 months_,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig
    ) external {
        require(months_ > 0 && months_ <= 12, "invalid months");
        uint256 cost = vipPrice() * months_;
        require(permit.permitted.token == UTH2, "wrong token");
        require(permit.permitted.amount >= cost, "amount too low");

        // 1. Pull UTH2 from user to this contract via Permit2 (no approve needed)
        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails(address(this), cost),
            msg.sender,
            sig
        );

        // 2. Forward UTH2 to the staking contract by calling buyVIP.
        //    The staking contract pulls UTH2 from this contract using the
        //    pre-approved allowance set in the constructor.
        //    As a result, this contract gains +1 ownerShare in staking's VIP pool.
        IH2OStaking(STAKING).buyVIP(months_);

        // 3. Record the actual user's subscription expiry in this contract.
        uint256 start = vipExpire[msg.sender] > block.timestamp
            ? vipExpire[msg.sender]
            : block.timestamp;
        vipExpire[msg.sender] = start + vipDuration * months_;

        // 4. Register user as a reward holder (first purchase only).
        //    Pull any pending H2O from staking first so current holders get it,
        //    then snapshot rewardPerShare for the new holder.
        if (holderShares[msg.sender] == 0) {
            _pullFromStaking();
            holderShares[msg.sender] = 1;
            totalHolderShares += 1;
            rewardDebt[msg.sender] = rewardPerShare;
        }
    }

    // ── Collect H2O from staking and distribute to VIP holders ───────────

    /**
     * @dev Calls claimOwnerVip on the staking contract to collect this
     *      contract's share of the H2O fee pool, then updates rewardPerShare.
     */
    function _pullFromStaking() internal {
        if (IH2OStaking(STAKING).ownerShares(address(this)) == 0) return;
        uint256 before = IERC20(H2O).balanceOf(address(this));
        // claimOwnerVip may revert if pending == 0, so we use try/catch
        try IH2OStaking(STAKING).claimOwnerVip() {} catch {}
        uint256 gained = IERC20(H2O).balanceOf(address(this));
        if (gained > before && totalHolderShares > 0) {
            rewardPerShare += (gained - before) * SCALE / totalHolderShares;
        }
    }

    /**
     * @notice Public trigger — anyone can call to push the latest staking
     *         rewards into the VIP pool (e.g. before checking pendingReward).
     */
    function pullFromStaking() external {
        _pullFromStaking();
    }

    // ── Claim H2O rewards ─────────────────────────────────────────────────

    /**
     * @notice Claim your accumulated H2O rewards from the VIP pool.
     *         Commissions accumulate automatically as staking users claim;
     *         you can claim here whenever you want.
     */
    function claimOwnerVip() external {
        _pullFromStaking();

        uint256 share = holderShares[msg.sender];
        require(share > 0, "not a VIP holder");

        uint256 pending = share * (rewardPerShare - rewardDebt[msg.sender]) / SCALE;
        require(pending > 0, "nothing to claim");

        rewardDebt[msg.sender] = rewardPerShare;
        IERC20(H2O).transfer(msg.sender, pending);
    }

    // ── View helpers ──────────────────────────────────────────────────────

    function pendingReward(address user) external view returns (uint256) {
        uint256 share = holderShares[user];
        if (share == 0) return 0;
        return share * (rewardPerShare - rewardDebt[user]) / SCALE;
    }

    function isVIP(address user) external view returns (bool) {
        return vipExpire[user] > block.timestamp;
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    function setOwner(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    /// @notice Safety: recover any tokens sent to this contract by mistake.
    function rescueToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }
}
