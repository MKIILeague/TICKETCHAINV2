// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract TicketContract is ERC721URIStorage, Ownable, ReentrancyGuard, Pausable {
    uint256 private _tokenIds;

    struct TicketDetails {
        uint256 originalPrice;
        bool isUsed;
        string eventName;
        bool isForResale;
        uint256 resalePrice;
    }

    mapping(uint256 => TicketDetails) public ticketRegistry;
    mapping(address => bool) public whitelistedOrganizers;
    mapping(address => uint256) public organizerBalances;
    mapping(address => bool) public gatekeepers;
    mapping(uint256 => address) public ticketOrganizers;

    event TicketMinted(uint256 indexed ticketId, address indexed organizer, uint256 price, string eventName);
    event TicketResaleListed(uint256 indexed ticketId, uint256 price);
    event TicketPurchased(uint256 indexed ticketId, address indexed buyer, uint256 price);
    event TicketUsed(uint256 indexed ticketId);
    event OrganizerWhitelisted(address indexed organizer);
    event OrganizerRevoked(address indexed organizer);
    event GatekeeperUpdated(address indexed gatekeeper, bool allowed);

    modifier onlyWhitelistedOrganizer() {
        require(whitelistedOrganizers[msg.sender], "Not a whitelisted organizer");
        _;
    }

    constructor() ERC721("TicketchainToken", "TKT") Ownable(msg.sender) {
        whitelistedOrganizers[msg.sender] = true;
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function whitelistOrganizer(address organizer) public onlyOwner {
        whitelistedOrganizers[organizer] = true;
        emit OrganizerWhitelisted(organizer);
    }

    function revokeOrganizer(address organizer) public onlyOwner {
        whitelistedOrganizers[organizer] = false;
        emit OrganizerRevoked(organizer);
    }

    function getNextTicketId() public view returns (uint256) {
        return _tokenIds;
    }

    function setGatekeeper(address gatekeeper, bool allowed) public onlyOwner {
        require(gatekeeper != address(0), "Invalid gatekeeper");
        gatekeepers[gatekeeper] = allowed;
        emit GatekeeperUpdated(gatekeeper, allowed);
    }

    function mintTicket(
        address buyer, 
        string memory tokenURI, 
        uint256 price, 
        string memory eventName
    ) public onlyWhitelistedOrganizer whenNotPaused returns (uint256) {
        _tokenIds++;
        uint256 newTicketId = _tokenIds;

        _mint(buyer, newTicketId);
        _setTokenURI(newTicketId, tokenURI);
        ticketOrganizers[newTicketId] = msg.sender;

        // Auto-list on mint so primary tickets appear in the marketplace
        ticketRegistry[newTicketId] = TicketDetails({
            originalPrice: price,
            isUsed: false,
            eventName: eventName,
            isForResale: true,
            resalePrice: price
        });

        emit TicketMinted(newTicketId, msg.sender, price, eventName);
        emit TicketResaleListed(newTicketId, price);
        return newTicketId;
    }

    function batchMintTickets(
        address buyer,
        string memory tokenURI,
        uint256 price,
        string memory eventName,
        uint256 quantity
    ) public onlyWhitelistedOrganizer whenNotPaused returns (uint256[] memory) {
        require(quantity > 0, "Quantity must be greater than zero");

        uint256[] memory ticketIds = new uint256[](quantity);
        for (uint256 i = 0; i < quantity; i++) {
            _tokenIds++;
            uint256 newTicketId = _tokenIds;

            _mint(buyer, newTicketId);
            _setTokenURI(newTicketId, tokenURI);
            ticketOrganizers[newTicketId] = msg.sender;

            // Auto-list on mint so primary tickets appear in the marketplace
            ticketRegistry[newTicketId] = TicketDetails({
                originalPrice: price,
                isUsed: false,
                eventName: eventName,
                isForResale: true,
                resalePrice: price
            });

            emit TicketMinted(newTicketId, msg.sender, price, eventName);
            emit TicketResaleListed(newTicketId, price);
            ticketIds[i] = newTicketId;
        }

        return ticketIds;
    }

    function withdrawOrganizerFunds() public nonReentrant whenNotPaused {
        uint256 amount = organizerBalances[msg.sender];
        require(amount > 0, "No funds to withdraw");
        
        organizerBalances[msg.sender] = 0;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");
    }

    function cancelEventAndRefund(string memory /* eventName */) public view onlyWhitelistedOrganizer whenNotPaused {
        revert("Refunds unavailable in simulated payment mode");
    }

    function listTicketForResale(uint256 ticketId, uint256 price) public whenNotPaused {
        require(ownerOf(ticketId) == msg.sender, "Not the ticket owner");
        require(!ticketRegistry[ticketId].isUsed, "Ticket already used");
        
        uint256 maxPrice = (ticketRegistry[ticketId].originalPrice * 110) / 100;
        require(price <= maxPrice, "Resale price exceeds 110% cap");

        ticketRegistry[ticketId].isForResale = true;
        ticketRegistry[ticketId].resalePrice = price;
        
        emit TicketResaleListed(ticketId, price);
    }

    function cancelResaleListing(uint256 ticketId) public whenNotPaused {
        require(ownerOf(ticketId) == msg.sender, "Not the ticket owner");
        require(ticketRegistry[ticketId].isForResale, "Ticket not listed for resale");
        
        ticketRegistry[ticketId].isForResale = false;
        ticketRegistry[ticketId].resalePrice = 0;
    }

    function purchaseResaleTicket(uint256 ticketId) public payable nonReentrant whenNotPaused {
        require(msg.value == 0, "Simulated payments only; send zero ETH");
        TicketDetails storage ticket = ticketRegistry[ticketId];
        require(ticket.isForResale, "Ticket not for resale");
        require(!ticket.isUsed, "Ticket already used");

        address seller = ownerOf(ticketId);
        require(seller != msg.sender, "Cannot buy your own ticket");
        uint256 price = ticket.resalePrice;
        ticket.isForResale = false;
        
        _transfer(seller, msg.sender, ticketId);
        
        // Zero-value ledger record: Use the original listed price for the ledger event
        emit TicketPurchased(ticketId, msg.sender, price);
    }

    // Buy several listed tickets in a SINGLE transaction. The buyer sends the
    // simulated prices are recorded in events; no ticket payment ETH is accepted.
    function batchPurchaseResale(uint256[] calldata ticketIds) public payable nonReentrant whenNotPaused {
        require(ticketIds.length > 0, "No tickets specified");
        require(msg.value == 0, "Simulated payments only; send zero ETH");

        for (uint256 i = 0; i < ticketIds.length; i++) {
            uint256 ticketId = ticketIds[i];
            TicketDetails storage ticket = ticketRegistry[ticketId];
            require(ticket.isForResale, "Ticket not for resale");
            require(!ticket.isUsed, "Ticket already used");
            
            uint256 price = ticket.resalePrice;
            address seller = ownerOf(ticketId);
            require(seller != msg.sender, "Cannot buy your own ticket");

            ticket.isForResale = false;
            _transfer(seller, msg.sender, ticketId);

            // Zero-value ledger record: emit the ticket's price instead of actual transferred funds
            emit TicketPurchased(ticketId, msg.sender, price);
        }
    }

    function useTicket(uint256 ticketId) public whenNotPaused {
        ownerOf(ticketId); // Reject nonexistent IDs before touching the registry.
        require(
            msg.sender == owner() || gatekeepers[msg.sender] ||
            (msg.sender == ticketOrganizers[ticketId] && whitelistedOrganizers[msg.sender]),
            "Not authorized to check in tickets"
        );
        require(!ticketRegistry[ticketId].isUsed, "Ticket already used");
        ticketRegistry[ticketId].isUsed = true;
        ticketRegistry[ticketId].isForResale = false;
        ticketRegistry[ticketId].resalePrice = 0;
        emit TicketUsed(ticketId);
    }

    function getTicketDetails(uint256 ticketId) public view returns (TicketDetails memory) {
        ownerOf(ticketId);
        return ticketRegistry[ticketId];
    }

    // Standard ERC-721 transfers must respect pause/entry state too. A listing
    // belongs to its seller and must never survive a gift to a different wallet.
    function _update(address to, uint256 tokenId, address auth) internal override whenNotPaused returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) require(!ticketRegistry[tokenId].isUsed, "Ticket already used");
        address previous = super._update(to, tokenId, auth);
        if (previous != address(0)) {
            ticketRegistry[tokenId].isForResale = false;
            ticketRegistry[tokenId].resalePrice = 0;
        }
        return previous;
    }
}
