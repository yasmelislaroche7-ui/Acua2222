// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPermit2.sol";

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface IERC20S {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/**
 * @title  H2OSwapV1
 * @notice Exchange con H2O viejo como base.
 *         El owner configura pares token/H2O, precio y comisión.
 *         Las comisiones quedan en el contrato como liquidez adicional.
 *         Soporta Permit2 en compra, venta y fondeado.
 *
 * Modelo de precio:
 *   price[token] = cantidad de token-wei necesarios para comprar 1 H2O (1e18 H2O-wei)
 *   Ejemplo: 1 H2O = 0.0000001 WLD  →  price[WLD] = 0.0000001e18 = 1e11 WLD-wei
 *
 * Comprar H2O (usuario paga token, recibe H2O):
 *   tokenCost  = h2oOut * price[token] / 1e18
 *   fee        = tokenCost * feeBps / 10000
 *   totalCost  = tokenCost + fee   (usuario paga, fee queda en contrato)
 *   Requiere: balanceH2O >= h2oOut
 *
 * Vender H2O (usuario paga H2O, recibe token):
 *   tokenOut   = h2oIn * price[token] / 1e18
 *   fee        = tokenOut * feeBps / 10000
 *   userGets   = tokenOut - fee     (fee queda en contrato)
 *   Requiere: balanceToken >= tokenOut
 */
contract H2OSwapV1 {

    // ─── Constantes ──────────────────────────────────────────────────────────
    IPermit2 public constant PERMIT2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    uint256  public constant PRICE_SCALE = 1e18;

    // ─── Estructuras ─────────────────────────────────────────────────────────
    struct PairConfig {
        bool    active;      // Par agregado
        bool    paused;      // Par pausado temporalmente
        uint256 price;       // token-wei por 1 H2O (escalado x1e18)
        uint256 feeBps;      // comisión en bps (100 = 1%)
        string  symbol;      // símbolo del token (informativo)
        uint8   decimals;    // decimales del token
    }

    // ─── Estado ──────────────────────────────────────────────────────────────
    address public owner;
    address public owner2;
    IERC20S public h2oToken;        // H2O viejo — base del exchange
    bool    public globalPause;     // pausa global de emergencia

    address[] public tokenList;                         // lista de tokens agregados
    mapping(address => PairConfig) public pairs;        // config por token

    // ─── Eventos ─────────────────────────────────────────────────────────────
    event PairAdded(address indexed token, uint256 price, uint256 feeBps, string symbol);
    event PairRemoved(address indexed token);
    event PriceUpdated(address indexed token, uint256 oldPrice, uint256 newPrice);
    event FeeUpdated(address indexed token, uint256 oldFee, uint256 newFee);
    event PairPaused(address indexed token, bool paused);
    event GlobalPaused(bool paused);
    event H2OBought(address indexed buyer, address indexed payToken, uint256 h2oOut, uint256 tokenIn, uint256 fee);
    event H2OSold(address indexed seller, address indexed getToken, uint256 h2oIn, uint256 tokenOut, uint256 fee);
    event Funded(address indexed by, address indexed token_, uint256 amount);
    event Withdrawn(address indexed by, address indexed token_, uint256 amount);
    event Owner2Changed(address indexed old_, address indexed new_);

    // ─── Modificadores ───────────────────────────────────────────────────────
    modifier onlyOwner()   { require(msg.sender == owner, "not owner"); _; }
    modifier onlyOwners()  { require(msg.sender == owner || msg.sender == owner2, "not authorized"); _; }
    modifier notPaused()   { require(!globalPause, "global pause"); _; }
    modifier pairOK(address tkn) {
        require(pairs[tkn].active,  "pair not active");
        require(!pairs[tkn].paused, "pair paused");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(address _h2oToken, address _owner2) {
        owner     = msg.sender;
        owner2    = _owner2;
        h2oToken  = IERC20S(_h2oToken);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SWAP — Comprar H2O (usuario paga payToken, recibe H2O)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Comprar H2O pagando con payToken via Permit2.
     * @param payToken  Token que paga el usuario
     * @param h2oOut    Cantidad de H2O a recibir (en wei, 1e18 = 1 H2O)
     * @param permit    Permit2 firmado (token=payToken, spender=este contrato)
     * @param sig       Firma EIP-712
     */
    function buyH2OWithPermit2(
        address payToken,
        uint256 h2oOut,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig
    ) external notPaused pairOK(payToken) {
        require(h2oOut > 0, "zero amount");
        require(permit.permitted.token == payToken, "wrong token in permit");

        PairConfig storage cfg = pairs[payToken];
        uint256 tokenCost = h2oOut * cfg.price / PRICE_SCALE;
        uint256 fee       = tokenCost * cfg.feeBps / 10000;
        uint256 totalCost = tokenCost + fee;

        require(h2oToken.balanceOf(address(this)) >= h2oOut, "insufficient H2O liquidity");
        require(permit.permitted.amount >= totalCost, "permit too small");

        // Pull payToken del usuario via Permit2
        PERMIT2.permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: totalCost }),
            msg.sender,
            sig
        );

        // Enviar H2O al usuario
        require(h2oToken.transfer(msg.sender, h2oOut), "H2O transfer failed");

        emit H2OBought(msg.sender, payToken, h2oOut, totalCost, fee);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SWAP — Vender H2O (usuario paga H2O, recibe getToken)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Vender H2O recibiendo getToken, usando Permit2 para H2O.
     * @param getToken  Token que recibirá el usuario
     * @param h2oIn     Cantidad de H2O que paga el usuario (en wei)
     * @param permit    Permit2 firmado (token=H2O, spender=este contrato)
     * @param sig       Firma EIP-712
     */
    function sellH2OWithPermit2(
        address getToken,
        uint256 h2oIn,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig
    ) external notPaused pairOK(getToken) {
        require(h2oIn > 0, "zero amount");
        require(permit.permitted.token == address(h2oToken), "wrong token in permit");

        PairConfig storage cfg = pairs[getToken];
        uint256 tokenOut = h2oIn * cfg.price / PRICE_SCALE;
        uint256 fee      = tokenOut * cfg.feeBps / 10000;
        uint256 userGets = tokenOut - fee;

        require(IERC20S(getToken).balanceOf(address(this)) >= tokenOut, "insufficient token liquidity");
        require(permit.permitted.amount >= h2oIn, "permit too small");

        // Pull H2O del usuario via Permit2
        PERMIT2.permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: h2oIn }),
            msg.sender,
            sig
        );

        // Enviar token al usuario (fee queda en contrato)
        require(IERC20S(getToken).transfer(msg.sender, userGets), "token transfer failed");

        emit H2OSold(msg.sender, getToken, h2oIn, userGets, fee);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN — Fondear pool via Permit2
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Fondear el pool con cualquier token usando Permit2.
     *         Sirve para agregar H2O, o tokens de reserva para venta.
     */
    function fundWithPermit2(
        address fundToken,
        uint256 amount,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata sig
    ) external onlyOwners {
        require(amount > 0, "zero amount");
        require(permit.permitted.token == fundToken, "wrong token in permit");
        require(permit.permitted.amount >= amount, "permit too small");

        PERMIT2.permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            sig
        );

        emit Funded(msg.sender, fundToken, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN — Retirar fondos
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Retirar tokens del contrato. Solo owner o owner2.
     */
    function withdraw(address tkn, uint256 amount, address to) external onlyOwners {
        require(amount > 0, "zero amount");
        require(to != address(0), "zero address");
        require(IERC20S(tkn).transfer(to, amount), "transfer failed");
        emit Withdrawn(msg.sender, tkn, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN — Gestión de pares
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Agregar un nuevo par de intercambio.
     * @param tkn     Dirección del token ERC20
     * @param price   token-wei necesarios para comprar 1 H2O (escalado x1e18)
     * @param feeBps  Comisión en bps (100 = 1%, 300 = 3%)
     * @param symbol  Símbolo del token (string, informativo)
     */
    function addPair(
        address tkn,
        uint256 price,
        uint256 feeBps,
        string calldata symbol
    ) external onlyOwners {
        require(tkn != address(0), "zero address");
        require(price > 0, "zero price");
        require(feeBps <= 2000, "fee too high (max 20%)");
        require(!pairs[tkn].active, "pair already exists");

        uint8 dec = 18;
        try IERC20S(tkn).decimals() returns (uint8 d) { dec = d; } catch {}

        pairs[tkn] = PairConfig({
            active:   true,
            paused:   false,
            price:    price,
            feeBps:   feeBps,
            symbol:   symbol,
            decimals: dec
        });
        tokenList.push(tkn);

        emit PairAdded(tkn, price, feeBps, symbol);
    }

    /**
     * @notice Desactivar un par permanentemente.
     */
    function removePair(address tkn) external onlyOwners {
        require(pairs[tkn].active, "pair not active");
        pairs[tkn].active = false;
        // Quitar de tokenList
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokenList[i] == tkn) {
                tokenList[i] = tokenList[tokenList.length - 1];
                tokenList.pop();
                break;
            }
        }
        emit PairRemoved(tkn);
    }

    /**
     * @notice Actualizar precio de un par.
     */
    function setPrice(address tkn, uint256 newPrice) external onlyOwners {
        require(pairs[tkn].active, "pair not active");
        require(newPrice > 0, "zero price");
        emit PriceUpdated(tkn, pairs[tkn].price, newPrice);
        pairs[tkn].price = newPrice;
    }

    /**
     * @notice Actualizar comisión de un par.
     */
    function setFee(address tkn, uint256 newFeeBps) external onlyOwners {
        require(pairs[tkn].active, "pair not active");
        require(newFeeBps <= 2000, "fee too high");
        emit FeeUpdated(tkn, pairs[tkn].feeBps, newFeeBps);
        pairs[tkn].feeBps = newFeeBps;
    }

    /**
     * @notice Pausar o reanudar un par específico.
     */
    function setPairPaused(address tkn, bool paused) external onlyOwners {
        require(pairs[tkn].active, "pair not active");
        pairs[tkn].paused = paused;
        emit PairPaused(tkn, paused);
    }

    /**
     * @notice Pausa global — suspende todos los swaps.
     */
    function setGlobalPause(bool paused) external onlyOwners {
        globalPause = paused;
        emit GlobalPaused(paused);
    }

    /**
     * @notice Cambiar owner2.
     */
    function setOwner2(address newOwner2) external onlyOwner {
        emit Owner2Changed(owner2, newOwner2);
        owner2 = newOwner2;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VISTAS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Lista de tokens activos
    function getTokenList() external view returns (address[] memory) {
        return tokenList;
    }

    /// @notice Balance de H2O disponible para venta
    function h2oLiquidity() external view returns (uint256) {
        return h2oToken.balanceOf(address(this));
    }

    /// @notice Balance de un token en el contrato
    function tokenLiquidity(address tkn) external view returns (uint256) {
        return IERC20S(tkn).balanceOf(address(this));
    }

    /**
     * @notice Calcular costo en payToken para comprar h2oOut H2O.
     * @return tokenCost costo sin fee, fee comisión, totalCost total a pagar
     */
    function quoteBuy(address payToken, uint256 h2oOut)
        external view
        returns (uint256 tokenCost, uint256 fee, uint256 totalCost)
    {
        PairConfig storage cfg = pairs[payToken];
        tokenCost = h2oOut * cfg.price / PRICE_SCALE;
        fee       = tokenCost * cfg.feeBps / 10000;
        totalCost = tokenCost + fee;
    }

    /**
     * @notice Calcular tokens a recibir al vender h2oIn H2O.
     * @return tokenOut sin fee, fee comisión, userGets tokens netos al usuario
     */
    function quoteSell(address getToken, uint256 h2oIn)
        external view
        returns (uint256 tokenOut, uint256 fee, uint256 userGets)
    {
        PairConfig storage cfg = pairs[getToken];
        tokenOut = h2oIn * cfg.price / PRICE_SCALE;
        fee      = tokenOut * cfg.feeBps / 10000;
        userGets = tokenOut - fee;
    }

    /**
     * @notice Snapshot completo del estado del contrato para el panel admin.
     */
    function getContractInfo() external view returns (
        uint256 h2oBalance,
        uint256 numPairs,
        bool    paused_
    ) {
        h2oBalance = h2oToken.balanceOf(address(this));
        numPairs   = tokenList.length;
        paused_    = globalPause;
    }
}
