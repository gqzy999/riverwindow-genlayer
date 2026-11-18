import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'

export const chain = studionet
export const rpc = 'https://studio.genlayer.com/api'
export const explorer = 'https://explorer-studio.genlayer.com'
export const reader = createClient({chain})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function readWindow(address, key) {
  const result = await reader.readContract({
    address, functionName: 'get_window', args: [key], transactionHashVariant: 'latest-final',
  })
  return result ? JSON.parse(result) : null
}

export async function checkNetwork(client = reader) {
  if (Number(await client.getChainId()) !== 61999) throw Error('Expected Stable Studionet (61999).')
  if (BigInt(await client.request({method: 'eth_gasPrice', params: []})) !== 0n) {
    throw Error('Studionet reported a nonzero gas price. Submission stopped.')
  }
}

export async function waitFinalized(hash, update = () => {}) {
  for (let attempt = 0; attempt < 120; attempt++) {
    let tx
    try {
      tx = await reader.getTransaction({hash})
    } catch (error) {
      update('Receipt unavailable · retrying')
    }
    if (tx) {
      update(String(tx.status))
      if ([7, 'FINALIZED'].includes(tx.status)) {
        const receipts = [tx.consensus_data?.leader_receipt].flat()
        const leader = receipts.find(item => item?.mode === 'leader') ?? receipts[0]
        if (![6, 'MAJORITY_AGREE'].includes(tx.result) || leader?.execution_result !== 'SUCCESS') {
          throw Error('Finalized without successful consensus execution.')
        }
        return tx
      }
      if ([8, 'CANCELED', 'UNDETERMINED', 'LEADER_TIMEOUT', 'VALIDATORS_TIMEOUT'].includes(tx.status)) {
        throw Error('Consensus stopped: ' + tx.status)
      }
    }
    await delay(3500)
  }
  throw Error('Finality polling timed out. Use the transaction link to check before retrying.')
}
