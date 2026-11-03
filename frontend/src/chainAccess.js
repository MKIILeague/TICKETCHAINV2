import { ethers } from 'ethers';
import { CONTRACT_ABI, PUBLIC_RPC_URL, getContractAddress } from './constants';
import { routeWalletRpc } from './walletRpc';

const readProviders = new Map();
export function getReadProvider(chainId = 11155111) {
  const id = Number(chainId);
  if (id !== 11155111 && !(import.meta.env.DEV && id === 31337)) throw new Error('Switch to Sepolia.');
  if (!readProviders.has(id)) {
    const request = new ethers.FetchRequest(id === 31337 ? 'http://127.0.0.1:8545' : PUBLIC_RPC_URL);
    request.timeout = 15_000;
    readProviders.set(id, new ethers.JsonRpcProvider(request, id, { staticNetwork: true, batchMaxCount: 1 }));
  }
  return readProviders.get(id);
}

export function createWalletProvider(eip1193Provider) {
  return new ethers.BrowserProvider(routeWalletRpc(eip1193Provider, {
    readProviderFor: getReadProvider, allowLocal: import.meta.env.DEV,
  }));
}

export async function getAdminContract(wallet) {
  if (!wallet) throw new Error('Connect your admin wallet first.');
  let provider = createWalletProvider(await wallet.getEthereumProvider());
  const current = Number((await provider.getNetwork()).chainId);
  const target = import.meta.env.DEV && current === 31337 ? 31337 : 11155111;
  if (current !== target) {
    await wallet.switchChain(target);
    provider = createWalletProvider(await wallet.getEthereumProvider());
  }
  const address = getContractAddress(target);
  if (await provider.getCode(address) === '0x') throw new Error('No TicketChain contract at the configured address on this network.');
  const signer = await provider.getSigner();
  const contract = new ethers.Contract(address, CONTRACT_ABI, signer);
  const owner = await contract.owner();
  if (owner.toLowerCase() !== (await signer.getAddress()).toLowerCase()) {
    throw new Error(`This action requires the contract owner wallet: ${owner}. Your sign-in email alone does not grant on-chain authority.`);
  }
  return contract;
}
