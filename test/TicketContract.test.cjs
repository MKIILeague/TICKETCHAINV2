const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TicketContract", function () {
  let TicketContract;
  let contract;
  let owner;
  let organizer;
  let buyer1;
  let buyer2;

  const eventName = "Test Concert 2026";
  const tokenURI = "ipfs://QmTestURI";
  const ticketPrice = ethers.parseEther("0.1");

  beforeEach(async function () {
    // Get the ContractFactory and Signers
    TicketContract = await ethers.getContractFactory("TicketContract");
    [owner, organizer, buyer1, buyer2] = await ethers.getSigners();

    // Deploy the contract
    contract = await TicketContract.deploy();
  });

  describe("Deployment & Governance", function () {
    it("Should set the right owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("Should whitelist an organizer by admin", async function () {
      await contract.whitelistOrganizer(organizer.address);
      expect(await contract.whitelistedOrganizers(organizer.address)).to.be.true;
    });

    it("Should emit OrganizerWhitelisted event", async function () {
      await expect(contract.whitelistOrganizer(organizer.address))
        .to.emit(contract, "OrganizerWhitelisted")
        .withArgs(organizer.address);
    });
  });

  describe("Ticket Minting", function () {
    beforeEach(async function () {
      // Whitelist the organizer before minting tests
      await contract.whitelistOrganizer(organizer.address);
    });

    it("Should allow a whitelisted organizer to batch mint tickets", async function () {
      const quantity = 5;
      await expect(
        contract.connect(organizer).batchMintTickets(buyer1.address, tokenURI, ticketPrice, eventName, quantity)
      ).to.emit(contract, "TicketMinted");

      expect(await contract.balanceOf(buyer1.address)).to.equal(quantity);
    });

    it("Should prevent non-whitelisted users from minting", async function () {
      const quantity = 2;
      await expect(
        contract.connect(buyer2).batchMintTickets(buyer2.address, tokenURI, ticketPrice, eventName, quantity)
      ).to.be.revertedWith("Not a whitelisted organizer");
    });
  });

  describe("Secondary Market & Anti-Scalping Engine", function () {
    let ticketId;

    beforeEach(async function () {
      // Setup: Organizer mints 1 ticket to buyer1
      await contract.whitelistOrganizer(organizer.address);
      await contract.connect(organizer).batchMintTickets(buyer1.address, tokenURI, ticketPrice, eventName, 1);
      ticketId = 1; // Since it's the first ticket
    });

    it("Should allow the owner to list a ticket for resale", async function () {
      const resalePrice = ethers.parseEther("0.11"); // 110% of original price
      await expect(contract.connect(buyer1).listTicketForResale(ticketId, resalePrice))
        .to.emit(contract, "TicketResaleListed")
        .withArgs(ticketId, resalePrice);

      const ticketDetails = await contract.getTicketDetails(ticketId);
      expect(ticketDetails.isForResale).to.be.true;
      expect(ticketDetails.resalePrice).to.equal(resalePrice);
    });

    it("Should ENFORCE the 110% price cap (Anti-Scalping)", async function () {
      // 120% of original price (0.12 ETH) - Should Fail!
      const scalperPrice = ethers.parseEther("0.12"); 
      await expect(
        contract.connect(buyer1).listTicketForResale(ticketId, scalperPrice)
      ).to.be.revertedWith("Resale price exceeds 110% cap");
    });

    it("Should allow another user to purchase a resale ticket", async function () {
      const resalePrice = ethers.parseEther("0.11");
      await contract.connect(buyer1).listTicketForResale(ticketId, resalePrice);

      // Approve contract for transfer if needed, but ERC721 _transfer handles it for resale
      // Note: In a real environment with value transfer, msg.value must be >= resalePrice
      // Our smart contract implementation currently emits the purchase event
      await expect(contract.connect(buyer2).batchPurchaseResale([ticketId], { value: resalePrice }))
        .to.emit(contract, "TicketPurchased")
        .withArgs(ticketId, buyer2.address, resalePrice);

      // Buyer2 should now own the ticket
      expect(await contract.ownerOf(ticketId)).to.equal(buyer2.address);
    });
  });

  describe("Gatekeeper Terminal", function () {
    let ticketId;

    beforeEach(async function () {
      await contract.whitelistOrganizer(organizer.address);
      await contract.connect(organizer).batchMintTickets(buyer1.address, tokenURI, ticketPrice, eventName, 1);
      ticketId = 1; 
    });

    it("Should successfully mark a ticket as used (Check-In)", async function () {
      await expect(contract.useTicket(ticketId))
        .to.emit(contract, "TicketUsed")
        .withArgs(ticketId);

      const ticketDetails = await contract.getTicketDetails(ticketId);
      expect(ticketDetails.isUsed).to.be.true;
    });

    it("Should prevent double-entry for an already used ticket", async function () {
      await contract.useTicket(ticketId); // First scan
      
      // Second scan should fail
      await expect(contract.useTicket(ticketId)).to.be.revertedWith("Ticket already used");
    });
  });
});
