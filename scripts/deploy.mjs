import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createClient, createAccount } from 'genlayer-js'
import { chain, checkNetwork, readWindow, waitFinalized } from '../chain.js'

const source = await readFile(new URL('../contracts/riverwindow.py', import.meta.url), 'utf8')
const resume = process.argv[2]
let hash = resume
if (resume) {
  assert.match(resume, /^0x[0-9a-f]{64}$/i)
} else {
  const key = process.env.RIVERWINDOW_STUDIO_KEY
  assert.match(key ?? '', /^0x[0-9a-f]{64}$/i, 'Supply an authorized Studionet signer through the environment.')
  const client = createClient({chain, account: createAccount(key)})
  await checkNetwork(client)
  hash = await client.deployContract({code: source, args: [], leaderOnly: false})
}
console.log('Deployment transaction', hash)
const receipt = await waitFinalized(hash)
const address = receipt.data.contract_address
assert.match(address, /^0x[0-9a-f]{40}$/i)
assert.equal(await createClient({chain}).getContractCode(address), source)
assert.equal(await readWindow(address, ''), null)
console.log('FINALIZED / SUCCESS', address)
