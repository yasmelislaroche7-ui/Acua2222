// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title H2OFeeCollector
 * @notice Cobra una comisión fija en H2O por transacción (stake/unstake/claim/sub/mining buy).
 *         La comisión se paga vía Permit2 SignatureTransfer (sin approve previo).
 *         El monto por defecto es 1 H2O y es ajustable por el owner.
 *         Conectado a:
 *           - H2O staking (stake / unstake / claimRewards / claimRef / claimOwnerVip)
 *           - H2O staking V2 (stake / unstake / claim)
 *           - Multi-staking (todos los tokens)
 *           - VIP subscription (buyVIP)
 *           - Mining UTH2 (buyPackage / claimRewards)
 *           - Mining WLD (buyPackage / claimPackageRewards / claimAllRewards)
 *           - Mining TIME (stake / unstake / claimWldReward)
 *         NOT conectado al swap.
 */
contract H2OFeeCollector {

    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public immutable H2O;

    address public owner;
    uint256 public fee;        // monto en wei (default 1e18 = 1 H2O)
    uint256 public collected;  // total H2O cobrado histórico (informativo)

    event FeePaid(address indexed user, uint256 amount);
    event FeeChanged(uint256 oldFee, uint256 newFee);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _h2o, address _owner) {
        require(_h2o != address(0) && _owner != address(0), "zero address");
        H2O = _h2o;
        owner = _owner;
        fee = 1e18; // 1 H2O por defecto (18 decimales)
    }

    // ─── User entry: paga la comisión vía Permit2 ───────────────────────────
    /// @notice Llamado por el frontend como primera tx del batch antes de la acción real.
    /// @dev Usa SignatureTransfer de Permit2; permit.permitted.token debe ser H2O y
    ///      permit.permitted.amount >= fee actual.
    function payFee(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external {
        require(permit.permitted.token == H2O, "fee must be H2O");
        uint256 currentFee = fee;
        require(permit.permitted.amount >= currentFee, "permit amount < fee");

        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({
                to: address(this),
                requestedAmount: currentFee
            }),
            msg.sender,
            signature
        );

        unchecked { collected += currentFee; }
        emit FeePaid(msg.sender, currentFee);
    }

    // ─── Owner admin ────────────────────────────────────────────────────────
    function setFee(uint256 _fee) external onlyOwner {
        emit FeeChanged(fee, _fee);
        fee = _fee;
    }

    function setOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "zero address");
        emit OwnerChanged(owner, _owner);
        owner = _owner;
    }

    function withdraw(uint256 amount, address to) external onlyOwner {
        require(to != address(0), "zero address");
        IERC20(H2O).transfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function withdrawAll(address to) external onlyOwner {
        require(to != address(0), "zero address");
        uint256 bal = IERC20(H2O).balanceOf(address(this));
        IERC20(H2O).transfer(to, bal);
        emit Withdrawn(to, bal);
    }

    // ─── Views ──────────────────────────────────────────────────────────────
    function balance() external view returns (uint256) {
        return IERC20(H2O).balanceOf(address(this));
    }
}
