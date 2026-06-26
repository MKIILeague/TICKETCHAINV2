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

    event TicketMinted(uint256 indexed ticketId, address indexed organizer, uint256 price, string eventName);
    event TicketResaleListed(uint256 indexed ticketId, uint256 price);
    event TicketPurchased(uint256 indexed ticketId, address indexed buyer, uint256 price);
    event TicketUsed(uint256 indexed ticketId);
    event OrganizerWhitelisted(address indexed organizer);
    event OrganizerRevoked(address indexed organizer);

    modifier onlyWhitelistedOrganizer() {
        require(whitelistedOrganizers[msg.sender], "Not a whitelisted organizer");
        _;
    }

    constructor() ERC721("TicketchainToken", "TKT") Ownable(msg.sender) {
        whitelistedOrganizers[msg.sender] = true;
        // Whitelist Hardhat Account 2 by default for easier local testing
        whitelistedOrganizers[0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC] = true;
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

    function cancelEventAndRefund(string memory eventName) public onlyWhitelistedOrganizer whenNotPaused {
        // Placeholder for role matrix
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
        TicketDetails storage ticket = ticketRegistry[ticketId];
        require(ticket.isForResale, "Ticket not for resale");
        require(msg.value >= ticket.resalePrice, "Insufficient payment");

        address seller = ownerOf(ticketId);
        ticket.isForResale = false;
        
        _transfer(seller, msg.sender, ticketId);
        
        // Escrow funds in organizerBalances if the seller is a whitelisted organizer
        // Otherwise, transfer directly to the seller
        if (whitelistedOrganizers[seller]) {
            organizerBalances[seller] += msg.value;
        } else {
            (bool success, ) = payable(seller).call{value: msg.value}("");
            require(success, "Transfer to seller failed");
        }

        emit TicketPurchased(ticketId, msg.sender, msg.value);
    }

    // Buy several listed tickets in a SINGLE transaction. The buyer sends the
    // aggregate price for all requested tickets; the loop transfers each one and
    // routes funds atomically (all-or-nothing). Any overpayment is refunded.
    function batchPurchaseResale(uint256[] calldata ticketIds) public payable nonReentrant whenNotPaused {
        require(ticketIds.length > 0, "No tickets specified");

        // First pass: validate every ticket and tally the exact aggregate price.
        uint256 totalPrice = 0;
        for (uint256 i = 0; i < ticketIds.length; i++) {
            require(ticketRegistry[ticketIds[i]].isForResale, "Ticket not for resale");
            totalPrice += ticketRegistry[ticketIds[i]].resalePrice;
        }
        require(msg.value >= totalPrice, "Insufficient payment");

        // Second pass: transfer each ticket to the buyer and route funds.
        for (uint256 i = 0; i < ticketIds.length; i++) {
            uint256 ticketId = ticketIds[i];
            TicketDetails storage ticket = ticketRegistry[ticketId];
            uint256 price = ticket.resalePrice;
            address seller = ownerOf(ticketId);

            ticket.isForResale = false;
            _transfer(seller, msg.sender, ticketId);

            if (whitelistedOrganizers[seller]) {
                organizerBalances[seller] += price;
            } else {
                (bool success, ) = payable(seller).call{value: price}("");
                require(success, "Transfer to seller failed");
            }

            emit TicketPurchased(ticketId, msg.sender, price);
        }

        // Refund any overpayment so the buyer is only charged the exact total.
        uint256 refund = msg.value - totalPrice;
        if (refund > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: refund}("");
            require(refunded, "Refund failed");
        }
    }

    function useTicket(uint256 ticketId) public whenNotPaused {
        require(!ticketRegistry[ticketId].isUsed, "Ticket already used");
        ticketRegistry[ticketId].isUsed = true;
        emit TicketUsed(ticketId);
    }

    function getTicketDetails(uint256 ticketId) public view returns (TicketDetails memory) {
        return ticketRegistry[ticketId];
    }
}