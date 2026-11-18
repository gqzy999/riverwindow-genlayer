import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createAccount, createClient } from 'genlayer-js'
import { chain, checkNetwork, readWindow, reader, waitFinalized } from '../chain.js'

const [address, deployment] = process.argv.slice(2)
assert.match(address ?? '', /^0x[0-9a-f]{40}$/i)
assert.match(deployment ?? '', /^0x[0-9a-f]{64}$/i)
const deploy = await waitFinalized(deployment)
assert.equal(deploy.data.contract_address.toLowerCase(), address.toLowerCase())
const source = readFileSync(new URL('../contracts/riverwindow.py', import.meta.url), 'utf8')
assert.equal(await reader.getContractCode(deploy.data.contract_address), source)
const accounts = ['RIVERWINDOW_STUDIO_KEY', 'RIVERWINDOW_REVIEWER_KEY'].map(name => {
  assert.match(process.env[name] ?? '', /^0x[0-9a-f]{64}$/i, name + ' is required')
  return createAccount(process.env[name])
})
const [owner, reviewer] = accounts.map(account => account.address.toLowerCase())
assert.notEqual(owner, reviewer)
const slug = 'usgs-july-2025'
const key = owner + '/' + slug
const output = 'evidence/studionet.json'
const evidence = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : {
  chainId: 61999, address, deployment, owner, reviewer, key,
  sourceSha256: createHash('sha256').update(source).digest('hex'), steps: {},
}
assert.equal(evidence.address, address)
assert.equal(evidence.key, key)
assert.equal(evidence.reviewer, reviewer)
const save = () => writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n')
async function run(method, index, args, expected) {
  let step = evidence.steps[method]
  if (step?.readback) return step.readback
  if (!step) {
    await checkNetwork()
    const client = createClient({chain, account:accounts[index]})
    step = evidence.steps[method] = {hash:null}
    save()
    step.hash = await client.writeContract({address,functionName:method,args,value:0n,leaderOnly:false})
    save()
  }
  assert(step.hash, 'Submission state uncertain, reconcile before retrying.')
  console.log(method, step.hash)
  const tx = await waitFinalized(step.hash)
  assert.equal(tx.from_address.toLowerCase(), accounts[index].address.toLowerCase())
  const record = await readWindow(address, key)
  assert.equal(record?.status, expected)
  Object.assign(step, {status:'FINALIZED', execution:'SUCCESS', readback:record})
  save()
  return record
}
await run('register', 0, [slug,'01646500','2025-07-01',10000,reviewer], 'AWAITING_DATA')
const evaluated = await run('evaluate', 0, [key], 'REVIEW_REQUIRED')
assert.deepEqual(evaluated.readings, [9360000,11200000,12400000])
await run('acknowledge', 1, [key,'Reviewed the two consecutive approved discharge readings.'], 'ACKNOWLEDGED')
console.log('FINALIZED / SUCCESS · all three steps and readbacks verified')
