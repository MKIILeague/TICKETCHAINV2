import fs from 'node:fs';
const artifact = JSON.parse(fs.readFileSync('artifacts/contracts/TicketContract.sol/TicketContract.json', 'utf8'));
fs.writeFileSync('frontend/src/TicketContract.json', JSON.stringify({ abi: artifact.abi }, null, 2) + '\n');
console.log('Updated frontend contract ABI from the compiled artifact.');
