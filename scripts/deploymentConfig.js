import fs from 'node:fs';

export function readDeployment(network = 'sepolia') {
  const source = fs.readFileSync(new URL('../frontend/src/constants.js', import.meta.url), 'utf8');
  if (network === 'sepolia') {
    return {
      address: source.match(/export const CONTRACT_ADDRESS = "([^"]+)"/)[1],
      startBlock: Number(source.match(/export const START_BLOCK = (\d+)/)[1]),
    };
  }
  if (network === 'localhost') {
    return { address: source.match(/return "(0x[\da-fA-F]{40})"; \/\/ Localhost/)[1], startBlock: 0 };
  }
  throw new Error('Select --network sepolia or --network localhost explicitly.');
}
