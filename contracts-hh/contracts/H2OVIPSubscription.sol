// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title H2OVIPSubscription
 * @notice Standalone VIP subscription contract for Acua.
 *
 *  - Users buy monthly VIP passes paying UTH2 via Permit2 (no approve needed).
 *  - H2O rewards are pushed automatically by the connected staking contract
 *    every time any user claims staking rewards (the staking contract calls
 *    notifyReward with the VIP fee portion). No manual funding by the owner.
 *  - VIP holders accumulate H2O rewards and claim whenever they want.
 */
contract H2OVIPSubscription {

    uint256 constant SCALE   = 1e18;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address public immutable UTH2;
    address public immutable H2O;

    // ── Admin ──────────────────────────────────────────────────────────────

    address[] public owners;
    address public stakingContract;   // only this address can call notifyReward

    modifier onlyOwner() {
        bool ok = false;
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == msg.sender) { ok = true; break; }
        }
        require(ok, "not owner");
        _;
    }

    constructor(address _uth2, address _h2o) {
        UTH2 = _uth2;
        H2O  = _h2o;
        owners.push(msg.sender);
    }

    // ── VIP subscriptions ──────────────────────────────────────────────────

    uint256 public vipPrice    = 1e18;   // UTH2 per month (18 decimals)
    uint256 public vipDuration = 30 days;

    mapping(address => uint256) public vipExpire;

    // ── VIP reward pool — H2O pushed by staking contract ──────────────────

    mapping(address => uint256) public holderShares;
    uint256 public totalHolderShares;

    uint256 public rewardPerShare;
    mapping(address => uint256) public rewardDebt;

    // ── Buy VIP with Permit2 ───────────────────────────────────────────────

    /**
     * @notice Buy or extend VIP subscription using UTH2 via Permit2.
     *         World App handles the Permit2 signature — no prior approve() needed.
     * @param months_  Number of months to purchase (1-12)
     * @param permit   Permit2 struct: { permitted: { token, amount }, nonce, deadline }
     * @param sig      Permit2 signature from World App
     */
    function buyVIPWithPermit2(
        uint256 months_,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig
    ) external {
        require(months_ > 0 && months_ <= 12, "invalid months");
        uint256 cost = vipPrice * months_;
        require(permit.permitted.token == UTH2,  "wrong token");
        require(permit.permitted.amount >= cost,  "amount too low");

        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails(address(this), cost),
            msg.sender,
            sig
        );

        // Extend or start subscription
        uint256 start = vipExpire[msg.sender] > block.timestamp
            ? vipExpire[msg.sender]
            : block.timestamp;
        vipExpire[msg.sender] = start + vipDuration * months_;

        // Give holder one share in the H2O reward pool (first purchase only)
        if (holderShares[msg.sender] == 0) {
            holderShares[msg.sender] = 1;
            totalHolderShares += 1;
            // Snapshot so new holder only earns future rewards
            rewardDebt[msg.sender] = rewardPerShare;
        }
    }

    // ── Reward notification — called by staking contract ──────────────────

    /**
     * @notice Called by the connected staking contract each time it distributes
     *         fees. The staking contract transfers H2O to this contract before
     *         calling this function.
     * @param amount  H2O amount (wei) already transferred to this contract.
     */
    function notifyReward(uint256 amount) external {
        require(msg.sender == stakingContract, "only staking");
        if (totalHolderShares == 0 || amount == 0) return;
        rewardPerShare += amount * SCALE / totalHolderShares;
    }

    // ── Claim H2O rewards ─────────────────────────────────────────────────

    /**
     * @notice Claim accumulated H2O rewards from the VIP reward pool.
     *         Rewards accumulate automatically as staking users claim;
     *         no action needed until you want to withdraw.
     */
    function claimOwnerVip() external {
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

    // ── Admin functions ───────────────────────────────────────────────────

    /**
     * @notice Set the staking contract address that is allowed to call notifyReward.
     *         Call this once after deploying the new staking contract.
     */
    function setStakingContract(address addr) external onlyOwner {
        stakingContract = addr;
    }

    /**
     * @notice Update VIP price (in UTH2 wei per month).
     */
    function setVipPrice(uint256 price_) external onlyOwner {
        vipPrice = price_;
    }

    /**
     * @notice Add a co-owner.
     */
    function addOwner(address addr) external onlyOwner {
        owners.push(addr);
    }

    /**
     * @notice Manually grant VIP to a user (promotions), bypassing payment.
     */
    function grantVIP(address user, uint256 months_) external onlyOwner {
        require(months_ > 0, "invalid months");
        uint256 start = vipExpire[user] > block.timestamp
            ? vipExpire[user]
            : block.timestamp;
        vipExpire[user] = start + vipDuration * months_;

        if (holderShares[user] == 0) {
            holderShares[user] = 1;
            totalHolderShares += 1;
            rewardDebt[user] = rewardPerShare;
        }
    }

    /**
     * @notice Withdraw accumulated UTH2 subscription payments.
     */
    function withdrawUTH2(uint256 amount) external onlyOwner {
        IERC20(UTH2).transfer(msg.sender, amount);
    }

    /**
     * @notice Safety: withdraw any H2O in the contract (e.g. if no holders yet).
     */
    function withdrawH2O(uint256 amount) external onlyOwner {
        IERC20(H2O).transfer(msg.sender, amount);
    }
}
