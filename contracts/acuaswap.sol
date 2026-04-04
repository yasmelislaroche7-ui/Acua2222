//SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { SafeTransferLib } from "solmate/src/utils/SafeTransferLib.sol";
import { ERC20 } from "solmate/src/tokens/ERC20.sol";
import { BaseAggregator } from "./BaseAggregator.sol"; // Asumimos que BaseAggregator maneja la lógica de swap
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ISignatureTransfer } from "./interfaces/ISignatureTransfer.sol";

contract SimplifiedDNARouter is BaseAggregator, Ownable {
    /// @dev Event emitted when a swap target gets added
    event SwapTargetAdded(address indexed target);

    /// @dev Event emitted when a swap target gets removed
    event SwapTargetRemoved(address indexed target);

    /// @dev Event emitted when token fees are withdrawn
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);

    /// @dev Event emitted when ETH fees are withdrawn
    event EthWithdrawn(address indexed to, uint256 amount);

    constructor(
        address[] memory _swapTargets,
        ISignatureTransfer _permit2,
        address _uniswapV3routerAddr,
        address _uniswapV2RouterAddr
    )
        Ownable(_msgSender())
        BaseAggregator(_permit2)
    {
        for (uint256 i = 0; i < _swapTargets.length; i++) {
            swapTargets[_swapTargets[i]] = true;
        }
        uniswapV2RouterAddr = _uniswapV2RouterAddr;
        uniswapV3RouterAddr = _uniswapV3routerAddr;
        // companyWalletAddr y companyFeePercentage eliminados
        // dnaController, dnaStakingAddr, stakingRewardThreshold, fixedTokenAmount eliminados
    }

    /// @dev We don't want to accept any ETH, except refunds from aggregators
    /// or the owner (for testing purposes), which can also withdraw
    /// This is done by evaluating the value of status, which is set to 2
    /// only during swaps due to the "nonReentrant" modifier
    receive() external payable {
        // Se mantiene la lógica para permitir ETH de refunds de agregadores o del owner
        require(_reentrancyGuardEntered() || msg.sender == owner(), "NO_RECEIVE");
    }

    // --- Funciones de administración de swapTargets se mantienen ---
    /// @dev method to add or remove swap targets from swapTargets
    /// This is required so we only approve "trusted" swap targets
    /// to transfer tokens out of this contract
    /// @param target address of the swap target to add
    /// @param add flag to add or remove the swap target
    function updateSwapTargets(address target, bool add) external onlyOwner {
        swapTargets[target] = add;
        if (add) {
            emit SwapTargetAdded(target);
        } else {
            emit SwapTargetRemoved(target);
        }
    }

    // --- Funciones para retirar comisiones (ahora 100% para el owner) ---
    // Las comisiones de tokens y ETH simplemente se acumulan en el contrato.
    // El owner puede retirarlas a su antojo.

    /// @dev method to withdraw ERC20 tokens (fees)
    /// @param token address of the token to withdraw
    /// @param amount amount of tokens to withdraw
    // Eliminamos 'to' como parámetro ya que siempre irá al owner
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        require(token != address(0), "ZERO_ADDRESS");
        require(amount > 0, "ZERO_AMOUNT");
        // No necesitamos feeTokenData.balance, el owner simplemente retira lo que hay en el contrato
        SafeTransferLib.safeTransfer(ERC20(token), owner(), amount);
        emit TokenWithdrawn(token, owner(), amount);
    }

    /// @dev method to withdraw ETH (fees)
    /// @param amount amount of ETH to withdraw
    // Eliminamos 'to' como parámetro ya que siempre irá al owner
    function withdrawEth(uint256 amount) external onlyOwner {
        require(amount > 0, "ZERO_AMOUNT");
        SafeTransferLib.safeTransferETH(owner(), amount);
        emit EthWithdrawn(owner(), amount);
    }

    // --- Variables de BaseAggregator que se mantienen (asumiendo que están allí) ---
    // address internal uniswapV2RouterAddr;
    // address internal uniswapV3RouterAddr;
    // mapping(address => bool) public swapTargets; // Public para que pueda ser leída
    // ... otras variables y lógica de swap en BaseAggregator
}
