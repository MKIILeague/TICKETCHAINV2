const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Resumable event minting', function () {
  let contract, organizer, buyer, record, mintEventBatches, createMintApprovalSender;
  const budget = 2_000_000n;
  before(async function () {
    ({ mintEventBatches } = await import('../frontend/src/mintBatches.js'));
    ({ createMintApprovalSender } = await import('../frontend/src/mintApproval.js'));
  });
  beforeEach(async function () {
    const [owner, org, other] = await ethers.getSigners();
    organizer = org; buyer = other;
    const deployed = await ethers.deployContract('TicketContract', [], owner);
    await deployed.waitForDeployment();
    await deployed.whitelistOrganizer(organizer.address);
    contract = deployed.connect(organizer);
    record = {
      version: 2, walletAddress: organizer.address, id: 'test-event', stage: 'minting',
      request: { contractAddress: await contract.getAddress(), chainId: 31337,
        tokenURI: 'ipfs://bafkreicg3u735sfztguzcolspr3mzpn3s4kd2xarrhanpavbtl6n43qhpa',
        eventName: 'Batch Test Festival', priceWei: ethers.parseEther('0.0005').toString(), quantity: 150 },
      payload: { status: 'published', aggregateSupply: 150 },
      ticketIds: [], mintTransactions: [], pendingHash: null, submitting: false, firstMintBlock: null,
    };
  });
  function wrappedContract(send) {
    const method = (...args) => send(...args);
    method.estimateGas = (...args) => contract.batchMintTickets.estimateGas(...args);
    return { runner: contract.runner, interface: contract.interface,
      getAddress: () => contract.getAddress(), batchMintTickets: method };
  }
  it('mints all 150 tickets in capped transactions and records every ID for checkout', async function () {
    let saved;
    const result = await mintEventBatches({ contract, record, gasCap: budget, save: (s) => { saved = s; } });
    expect(await contract.balanceOf(organizer.address)).to.equal(150n);
    expect(result.ticketIds).to.have.length(150);
    expect(new Set(result.ticketIds).size).to.equal(150);
    expect(result.mintTransactions.length).to.be.greaterThan(1);
    expect(result.payload.ticketIds).to.deep.equal(result.ticketIds);
    expect(saved.stage).to.equal('sync');
    for (const entry of result.mintTransactions) {
      const tx = await ethers.provider.getTransaction(entry.hash);
      expect(tx.gasLimit).to.be.at.most(budget);
    }
  });
  it('resumes after a cancelled wallet prompt without minting the first batch twice', async function () {
    let saved, sends = 0;
    const wrapped = wrappedContract(async (...args) => {
      if (++sends === 2) throw Object.assign(new Error('User cancelled'), { code: 'ACTION_REJECTED' });
      return contract.batchMintTickets(...args);
    });
    await expect(mintEventBatches({ contract: wrapped, record, gasCap: budget, save: (s) => { saved = s; } })).to.be.rejectedWith('User cancelled');
    const mintedBeforeResume = Number(await contract.getNextTicketId());
    expect(mintedBeforeResume).to.be.greaterThan(0);
    expect(saved.ticketIds).to.have.length(mintedBeforeResume);
    const result = await mintEventBatches({ contract, record: saved, gasCap: budget, save: (s) => { saved = s; } });
    expect(await contract.getNextTicketId()).to.equal(150n);
    expect(result.ticketIds).to.have.length(150);
  });
  it('reconciles a mined transaction after a lost receipt response before sending more', async function () {
    let saved;
    const wrapped = wrappedContract(async (...args) => {
      const tx = await contract.batchMintTickets(...args);
      return { hash: tx.hash, wait: async () => { throw new Error('Receipt connection lost'); } };
    });
    await expect(mintEventBatches({ contract: wrapped, record, gasCap: budget, save: (s) => { saved = s; } })).to.be.rejectedWith('Receipt connection lost');
    expect(saved.pendingHash).to.be.a('string');
    expect(saved.ticketIds).to.have.length(0);
    await mintEventBatches({ contract, record: saved, gasCap: budget, save: (s) => { saved = s; } });
    expect(await contract.getNextTicketId()).to.equal(150n);
    expect(saved.stage).to.equal('sync');
  });
  it('does not send a transaction when recovery storage cannot be written', async function () {
    await expect(mintEventBatches({ contract, record, gasCap: budget, save: () => { throw new Error('Storage unavailable'); } })).to.be.rejectedWith('Storage unavailable');
    expect(await contract.getNextTicketId()).to.equal(0n);
  });
  it('requires the original wallet when resuming', async function () {
    await expect(mintEventBatches({ contract: contract.connect(buyer), record, save: () => {} })).to.be.rejectedWith('original organizer wallet');
    expect(await contract.getNextTicketId()).to.equal(0n);
  });
  it('will not broadcast again when a wallet submission has an unknown hash', async function () {
    record.submitting = true; record.batchQuantity = 5;
    await expect(mintEventBatches({ contract, record, save: () => {} })).to.be.rejectedWith('submission was interrupted');
    expect(await contract.getNextTicketId()).to.equal(0n);
  });
  it('pauses between batches when the organizer leaves and resumes the saved remainder', async function () {
    const controller = new AbortController();
    let saved;
    await expect(mintEventBatches({ contract, record, gasCap: budget, signal: controller.signal,
      save: (s) => { saved = s; if (s.ticketIds.length) controller.abort(); },
    })).to.be.rejectedWith('Publication paused');
    const partial = Number(await contract.getNextTicketId());
    expect(partial).to.be.greaterThan(0).and.lessThan(150);
    expect(saved.ticketIds).to.have.length(partial);
    await mintEventBatches({ contract, record: saved, gasCap: budget, save: (s) => { saved = s; } });
    expect(await contract.getNextTicketId()).to.equal(150n);
  });
  it('executes 150 real local-chain mints with one publishing confirmation', async function () {
    const prompts = [];
    const sendBatch = createMintApprovalSender({ contract, record,
      sendTransaction: async (input, options) => {
        prompts.push(options.uiOptions.showWalletUIs);
        const tx = await organizer.sendTransaction(input);
        return { hash: tx.hash };
      },
      waitForReceipt: (hash) => ethers.provider.getTransactionReceipt(hash),
    });
    await mintEventBatches({ contract, record, sendBatch, gasCap: budget, save: () => {} });
    expect(await contract.getNextTicketId()).to.equal(150n);
    expect(prompts.filter(Boolean)).to.have.length(1);
    expect(prompts.length).to.be.greaterThan(1);
  });
  it('a stopped one-confirmation run requests fresh approval when resumed', async function () {
    const prompts = [], controller = new AbortController(); let saved;
    const sender = (state, signal) => createMintApprovalSender({ contract, record: state, signal,
      sendTransaction: async (input, options) => {
        prompts.push(options.uiOptions.showWalletUIs);
        return { hash: (await organizer.sendTransaction(input)).hash };
      }, waitForReceipt: (hash) => ethers.provider.getTransactionReceipt(hash),
    });
    await expect(mintEventBatches({ contract, record, sendBatch: sender(record, controller.signal), gasCap: budget,
      signal: controller.signal, save: (s) => { saved = s; if (s.ticketIds.length) controller.abort(); },
    })).to.be.rejectedWith('Publication paused');
    await mintEventBatches({ contract, record: saved, sendBatch: sender(saved), gasCap: budget, save: () => {} });
    expect(await contract.getNextTicketId()).to.equal(150n);
    expect(prompts.filter(Boolean)).to.have.length(2);
  });
});
