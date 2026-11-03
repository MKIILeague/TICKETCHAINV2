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
      await expect(contract.connect(buyer2).batchPurchaseResale([ticketId], { value: 0n }))
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

    it("rejects a buyer trying to consume another user's ticket", async function () {
      await expect(contract.connect(buyer2).useTicket(ticketId)).to.be.revertedWith("Not authorized to check in tickets");
    });

    it("supports admin-assigned gatekeepers and revocation", async function () {
      await contract.setGatekeeper(buyer2.address, true);
      await contract.connect(buyer2).useTicket(ticketId);
      expect((await contract.getTicketDetails(ticketId)).isUsed).to.be.true;
      await contract.connect(organizer).mintTicket(buyer1.address, tokenURI, ticketPrice, eventName);
      await contract.setGatekeeper(buyer2.address, false);
      await expect(contract.connect(buyer2).useTicket(2)).to.be.revertedWith("Not authorized to check in tickets");
    });

    it("rejects nonexistent tickets", async function () {
      await expect(contract.useTicket(999)).to.be.revertedWithCustomError(contract, "ERC721NonexistentToken");
    });

    it("delists a used ticket and prevents moving it", async function () {
      await contract.useTicket(ticketId);
      expect((await contract.getTicketDetails(ticketId)).isForResale).to.be.false;
      await expect(contract.connect(buyer1).transferFrom(buyer1.address, buyer2.address, ticketId)).to.be.revertedWith("Ticket already used");
    });
  });

  describe("Demo lifecycle regressions", function () {
    beforeEach(async function () {
      await contract.whitelistOrganizer(organizer.address);
      await contract.connect(organizer).batchMintTickets(organizer.address, tokenURI, ticketPrice, eventName, 3);
    });

    it("purchases several tickets atomically for zero payment", async function () {
      await contract.connect(buyer1).batchPurchaseResale([1, 2]);
      expect(await contract.ownerOf(1)).to.equal(buyer1.address);
      expect(await contract.ownerOf(2)).to.equal(buyer1.address);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
    });

    it("rejects accidental ETH rather than trapping it in the demo contract", async function () {
      await expect(contract.connect(buyer1).purchaseResaleTicket(1, { value: ticketPrice })).to.be.revertedWith("Simulated payments only; send zero ETH");
      await expect(contract.connect(buyer1).batchPurchaseResale([1], { value: ticketPrice })).to.be.revertedWith("Simulated payments only; send zero ETH");
    });

    it("rolls back an entire batch containing an unavailable ticket", async function () {
      await contract.connect(buyer2).purchaseResaleTicket(2);
      await expect(contract.connect(buyer1).batchPurchaseResale([1, 2])).to.be.revertedWith("Ticket not for resale");
      expect(await contract.ownerOf(1)).to.equal(organizer.address);
    });

    it("cannot purchase the same token twice or buy your own ticket", async function () {
      await expect(contract.connect(buyer1).batchPurchaseResale([1, 1])).to.be.revertedWith("Ticket not for resale");
      await expect(contract.connect(organizer).purchaseResaleTicket(1)).to.be.revertedWith("Cannot buy your own ticket");
    });

    it("clears stale seller listings when a ticket is gifted", async function () {
      await contract.connect(organizer).transferFrom(organizer.address, buyer1.address, 1);
      expect((await contract.getTicketDetails(1)).isForResale).to.be.false;
      await expect(contract.connect(buyer2).purchaseResaleTicket(1)).to.be.revertedWith("Ticket not for resale");
    });

    it("pause also blocks direct ERC721 transfers and check-in", async function () {
      await contract.pause();
      await expect(contract.connect(organizer).transferFrom(organizer.address, buyer1.address, 1)).to.be.revertedWithCustomError(contract, "EnforcedPause");
      await expect(contract.connect(buyer1).purchaseResaleTicket(1)).to.be.revertedWithCustomError(contract, "EnforcedPause");
      await expect(contract.useTicket(1)).to.be.revertedWithCustomError(contract, "EnforcedPause");
      await contract.unpause();
      await contract.connect(buyer1).purchaseResaleTicket(1);
      expect(await contract.ownerOf(1)).to.equal(buyer1.address);
    });

    it("only the issuing organizer or an authorized gatekeeper can check in", async function () {
      await contract.whitelistOrganizer(buyer2.address);
      await expect(contract.connect(buyer2).useTicket(1)).to.be.revertedWith("Not authorized to check in tickets");
      await contract.connect(organizer).useTicket(1);
      expect((await contract.getTicketDetails(1)).isUsed).to.be.true;
    });
  });
});
