import { ethers } from 'ethers';
import { CONTRACT_ABI, getContractAddress } from './constants';

export async function getAdminContract(wallet) {
  if (!wallet) throw new Error('Connect your admin wallet first.');
  let provider = new ethers.BrowserProvider(await wallet.getEthereumProvider());
  const current = Number((await provider.getNetwork()).chainId);
  const target = import.meta.env.DEV && current === 31337 ? 31337 : 11155111;
  if (current !== target) {
    await wallet.switchChain(target);
    provider = new ethers.BrowserProvider(await wallet.getEthereumProvider());
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
