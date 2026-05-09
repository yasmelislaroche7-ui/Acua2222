// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AcuaGlobalChat — on-chain global chat with owner moderation
contract AcuaGlobalChat {
    address public owner;
    address public owner2;

    struct Message {
        uint256 id;
        address sender;
        string  text;
        uint256 timestamp;
        bool    deleted;
    }

    uint256 public messageCount;
    mapping(uint256 => Message) public messages;

    uint256 public constant MAX_LENGTH = 500;
    uint256 public constant MAX_FETCH  = 50;

    event MessagePosted(uint256 indexed id, address indexed sender, string text, uint256 timestamp);
    event MessageDeleted(uint256 indexed id, address indexed by);

    modifier onlyOwners() {
        require(msg.sender == owner || msg.sender == owner2, "Not owner");
        _;
    }

    constructor(address _owner2) {
        owner  = msg.sender;
        owner2 = _owner2;
    }

    function postMessage(string calldata text) external returns (uint256 id) {
        require(bytes(text).length > 0, "Empty message");
        require(bytes(text).length <= MAX_LENGTH, "Too long");
        id = messageCount++;
        messages[id] = Message(id, msg.sender, text, block.timestamp, false);
        emit MessagePosted(id, msg.sender, text, block.timestamp);
    }

    function deleteMessage(uint256 id) external onlyOwners {
        require(id < messageCount, "Invalid id");
        messages[id].deleted = true;
        emit MessageDeleted(id, msg.sender);
    }

    /// @notice Returns the last `count` messages (newest first), skipping deleted.
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
        int256 i = int256(fromId);
        while (i >= 0 && found < count) {
            if (!messages[uint256(i)].deleted) {
                tmp[found++] = messages[uint256(i)];
            }
            i--;
        }
        result = new Message[](found);
        for (uint256 j = 0; j < found; j++) result[j] = tmp[j];
    }

    function setOwner2(address _owner2) external onlyOwners {
        owner2 = _owner2;
    }
}
