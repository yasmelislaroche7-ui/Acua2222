// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface IERC20FP {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IH2OStake2 {
    function fundDirect(uint256 amount) external;
}

/**
 * @title  H2OFundingProxy
 * @notice Proxy que permite al owner2 fondear el rewardPool de H2OStake2
 *         usando Permit2 (sin approve separado) desde World App / MiniKit.
 *
 *         Flujo:
 *           1. owner2 firma Permit2 {token: H2O2, spender: este contrato, amount: X}
 *           2. Llama fund(permit, sig, amount)
 *           3. Este contrato extrae H2O2 de owner2 via Permit2
 *           4. Aprueba H2OStake2 y llama fundDirect(amount)
 *
 * @dev    owner puede cambiar owner2 o el contrato destino en cualquier momento.
 */
contract H2OFundingProxy {

    // ─── Constantes ──────────────────────────────────────────────────────────
    IPermit2 public constant PERMIT2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    // ─── Estado ──────────────────────────────────────────────────────────────
    address public owner;
    address public owner2;
    address public stakeContract;   // H2OStake2 destino
    IERC20FP public token;          // H2O 2.0

    // ─── Eventos ─────────────────────────────────────────────────────────────
    event Funded(address indexed by, uint256 amount);
    event Owner2Changed(address indexed oldOwner2, address indexed newOwner2);
    event StakeContractChanged(address indexed old_, address indexed new_);
    event TokenChanged(address indexed old_, address indexed new_);
    event Recovered(address indexed token_, uint256 amount);

    // ─── Modificadores ───────────────────────────────────────────────────────
    modifier onlyOwner()  { require(msg.sender == owner,  "not owner");  _; }
    modifier onlyOwners() { require(msg.sender == owner || msg.sender == owner2, "not authorized"); _; }

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(
        address _owner2,
        address _stakeContract,
        address _token
    ) {
        owner         = msg.sender;
        owner2        = _owner2;
        stakeContract = _stakeContract;
        token         = IERC20FP(_token);
    }

    // ─── Fondear via Permit2 ─────────────────────────────────────────────────
    /**
     * @notice Fondear H2OStake2 usando Permit2 SignatureTransfer.
     *         Puede llamar owner o owner2.
     * @param permit    Struct Permit2 firmado off-chain en World App
     * @param sig       Firma EIP-712
     * @param amount    Cantidad de H2O a transferir (debe ser <= permit.permitted.amount)
     */
    function fund(
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig,
        uint256 amount
    ) external onlyOwners {
        require(amount > 0, "zero amount");
        require(permit.permitted.token == address(token), "wrong token");
        require(permit.permitted.amount >= amount, "permit too small");
        require(permit.deadline >= block.timestamp, "permit expired");

        // 1. Pull tokens desde el caller (owner2) via Permit2
        PERMIT2.permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            sig
        );

        // 2. Aprobar H2OStake2 para el transferFrom interno de fundDirect
        token.approve(stakeContract, amount);

        // 3. Fondear el pool
        IH2OStake2(stakeContract).fundDirect(amount);

        emit Funded(msg.sender, amount);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────
    function setOwner2(address newOwner2) external onlyOwner {
        emit Owner2Changed(owner2, newOwner2);
        owner2 = newOwner2;
    }

    function setStakeContract(address newStake) external onlyOwner {
        emit StakeContractChanged(stakeContract, newStake);
        stakeContract = newStake;
    }

    function setToken(address newToken) external onlyOwner {
        emit TokenChanged(address(token), newToken);
        token = IERC20FP(newToken);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }

    /// @notice Recuperar tokens atascados (por seguridad)
    function recoverToken(address tkn, uint256 amount) external onlyOwner {
        IERC20FP(tkn).transfer(owner, amount);
        emit Recovered(tkn, amount);
    }
}
