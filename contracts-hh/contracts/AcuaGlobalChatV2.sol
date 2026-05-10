// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  AcuaGlobalChatV2
 * @notice On-chain global chat with:
 *   - gasless relay  (authorized relayer submits on behalf of signed users)
 *   - rate limiting  (30-second cooldown + 10 msg/hour per address)
 *   - anti-bot       (min 2 chars, max 500 chars, spam ban)
 *   - delete rights  (owner, owner2, OR message author can delete)
 *   - ban system     (owner / owner2 can ban/unban addresses)
 *   - emergency pause
 */
contract AcuaGlobalChatV2 {

    // ─── Structs ──────────────────────────────────────────────────────────────
    struct Message {
        uint256 id;
        address sender;
        string  text;
        uint256 timestamp;
        bool    deleted;
        bool    relayed;   // true if posted via gasless relay
    }

    // ─── State ────────────────────────────────────────────────────────────────
    address public owner;
    address public owner2;
    address public relayer;   // server wallet that submits relayed txs

    bool    public paused;

    uint256 public messageCount;
    mapping(uint256 => Message) public messages;

    mapping(address => bool)    public banned;
    mapping(address => uint256) public lastMessageAt;      // unix ts of last post
    mapping(address => uint256) public hourlyCount;        // messages posted this hour
    mapping(address => uint256) public hourWindowStart;    // start of current hour window
    mapping(address => uint256) public nonces;             // relay anti-replay

    // ─── Constants ────────────────────────────────────────────────────────────
    uint256 public constant COOLDOWN_SECS  = 30;   // min seconds between posts
    uint256 public constant HOURLY_LIMIT   = 10;   // max posts per address per hour
    uint256 public constant MIN_LENGTH     = 2;
    uint256 public constant MAX_LENGTH     = 500;
    uint256 public constant MAX_FETCH      = 50;

    // ─── Events ───────────────────────────────────────────────────────────────
    event MessagePosted(uint256 indexed id, address indexed sender, string text, uint256 ts, bool relayed);
    event MessageDeleted(uint256 indexed id, address indexed by);
    event AddressBanned(address indexed addr);
    event AddressUnbanned(address indexed addr);
    event Paused(bool paused);
    event RelayerUpdated(address relayer);

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyOwners() {
        require(msg.sender == owner || msg.sender == owner2, "Not owner");
        _;
    }
    modifier notPaused() {
        require(!paused, "Contract paused");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _owner2, address _relayer) {
        owner   = msg.sender;
        owner2  = _owner2;
        relayer = _relayer;
    }

    // ─── Internal: rate-limit check ──────────────────────────────────────────
    function _rateCheck(address sender) internal {
        require(!banned[sender], "Address is banned");
        require(
            block.timestamp >= lastMessageAt[sender] + COOLDOWN_SECS,
            "Cooldown: wait 30 seconds"
        );
        // Reset hourly window if needed
        if (block.timestamp >= hourWindowStart[sender] + 3600) {
            hourlyCount[sender]    = 0;
            hourWindowStart[sender] = block.timestamp;
        }
        require(hourlyCount[sender] < HOURLY_LIMIT, "Hourly limit reached");
        lastMessageAt[sender] = block.timestamp;
        hourlyCount[sender]++;
    }

    // ─── Post (direct — caller pays gas) ─────────────────────────────────────
    function postMessage(string calldata text) external notPaused returns (uint256 id) {
        uint256 len = bytes(text).length;
        require(len >= MIN_LENGTH && len <= MAX_LENGTH, "Invalid message length");
        _rateCheck(msg.sender);

        id = messageCount++;
        messages[id] = Message(id, msg.sender, text, block.timestamp, false, false);
        emit MessagePosted(id, msg.sender, text, block.timestamp, false);
    }

    // ─── Post via relay (gasless for user) ───────────────────────────────────
    // Relay signs on behalf of `sender` who signed the payload off-chain.
    // The contract verifies both: (1) msg.sender == relayer, (2) ecrecover == sender.
    function postRelayed(
        address sender,
        string calldata text,
        uint256 nonce,
        bytes calldata sig
    ) external notPaused returns (uint256 id) {
        require(msg.sender == relayer, "Only relayer");
        require(!banned[sender], "Address is banned");
        require(nonce == nonces[sender], "Invalid nonce (replay?)");

        uint256 len = bytes(text).length;
        require(len >= MIN_LENGTH && len <= MAX_LENGTH, "Invalid message length");

        // Verify the user signed: keccak256(text ‖ nonce ‖ chainId ‖ contract)
        bytes32 payloadHash = keccak256(
            abi.encodePacked(text, nonce, block.chainid, address(this))
        );
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash)
        );
        require(_recoverSigner(ethHash, sig) == sender, "Signature invalid");

        _rateCheck(sender);
        nonces[sender]++;

        id = messageCount++;
        messages[id] = Message(id, sender, text, block.timestamp, false, true);
        emit MessagePosted(id, sender, text, block.timestamp, true);
    }

    // ─── Delete message ───────────────────────────────────────────────────────
    function deleteMessage(uint256 id) external {
        require(id < messageCount, "Invalid message id");
        Message storage m = messages[id];
        require(!m.deleted, "Already deleted");
        require(
            msg.sender == owner   ||
            msg.sender == owner2  ||
            msg.sender == m.sender,
            "Not authorized to delete"
        );
        m.deleted = true;
        emit MessageDeleted(id, msg.sender);
    }

    // ─── Delete via relay (so message author can delete without gas) ──────────
    function deleteRelayed(
        address sender,
        uint256 msgId,
        uint256 nonce,
        bytes calldata sig
    ) external {
        require(msg.sender == relayer, "Only relayer");
        require(nonce == nonces[sender], "Invalid nonce");
        require(msgId < messageCount, "Invalid message id");

        Message storage m = messages[msgId];
        require(!m.deleted, "Already deleted");
        require(m.sender == sender, "Not message author");

        bytes32 payloadHash = keccak256(
            abi.encodePacked("delete", msgId, nonce, block.chainid, address(this))
        );
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash)
        );
        require(_recoverSigner(ethHash, sig) == sender, "Signature invalid");

        nonces[sender]++;
        m.deleted = true;
        emit MessageDeleted(msgId, sender);
    }

    // ─── Read: get paginated messages (newest first, skip deleted) ─────────────
    function getMessages(uint256 fromId, uint256 count)
        external view
        returns (Message[] memory result)
    {
        if (count > MAX_FETCH) count = MAX_FETCH;
        uint256 total = messageCount;
        if (total == 0) return new Message[](0);
        if (fromId >= total) fromId = total - 1;

        Message[] memory tmp = new Message[](count);
        uint256 found = 0;
        int256  i = int256(fromId);
        while (i >= 0 && found < count) {
            if (!messages[uint256(i)].deleted) {
                tmp[found++] = messages[uint256(i)];
            }
            i--;
        }
        result = new Message[](found);
        for (uint256 j = 0; j < found; j++) result[j] = tmp[j];
    }

    // ─── Read: nonce for relay anti-replay ────────────────────────────────────
    function getNonce(address addr) external view returns (uint256) {
        return nonces[addr];
    }

    // ─── Read: rate-limit status ──────────────────────────────────────────────
    function canPost(address addr) external view returns (bool ok, uint256 nextAllowedAt, uint256 hourlyLeft) {
        if (banned[addr] || paused) return (false, 0, 0);
        nextAllowedAt = lastMessageAt[addr] + COOLDOWN_SECS;
        uint256 usedThisHour = hourlyCount[addr];
        if (block.timestamp >= hourWindowStart[addr] + 3600) usedThisHour = 0;
        hourlyLeft = HOURLY_LIMIT > usedThisHour ? HOURLY_LIMIT - usedThisHour : 0;
        ok = block.timestamp >= nextAllowedAt && hourlyLeft > 0;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────
    function ban(address addr)               external onlyOwners { banned[addr] = true;  emit AddressBanned(addr); }
    function unban(address addr)             external onlyOwners { banned[addr] = false; emit AddressUnbanned(addr); }
    function setPaused(bool _p)              external onlyOwners { paused = _p;          emit Paused(_p); }
    function setRelayer(address _r)          external onlyOwners { relayer = _r;         emit RelayerUpdated(_r); }
    function setOwner2(address _o2)          external onlyOwners { owner2 = _o2; }
    function transferOwner(address _newOwner) external { require(msg.sender == owner, "Not owner"); owner = _newOwner; }

    // ─── Internal: ECDSA recover ──────────────────────────────────────────────
    function _recoverSigner(bytes32 hash, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "Bad signature length");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid v");
        return ecrecover(hash, v, r, s);
    }
}
