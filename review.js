import { abi } from 'genlayer-js'
import { reader } from './chain.js'

export function runs(record) {
  const matches = (record.readings ?? []).map(value => value >= record.threshold * 1000)
  return record.days.flatMap((day, index) => matches[index] && matches[index + 1]
    ? [day + ' → ' + record.days[index + 1]] : [])
}

export async function registrationTiming(address, record, hash) {
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error('Enter a valid registration transaction hash.')
  const tx = await reader.getTransaction({hash})
  const receipt = [tx.consensus_data?.leader_receipt].flat()
  const leader = receipt.find(item => item?.mode === 'leader') ?? receipt[0]
  if (![7,'FINALIZED'].includes(tx.status) || ![6,'MAJORITY_AGREE'].includes(tx.result)
      || leader?.execution_result !== 'SUCCESS') throw Error('The transaction has no successful finalized execution.')
  const encoded = tx.data?.calldata?.base64 ?? tx.data?.calldata
  if (typeof encoded !== 'string') throw Error('Registration calldata is unavailable.')
  const call = abi.calldata.decode(Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0)))
  const [slug, station, start, threshold, reviewer] = call.get('args') ?? []
  if (call.get('method') !== 'register' || tx.to_address?.toLowerCase() !== address.toLowerCase()
      || tx.from_address?.toLowerCase() !== record.owner || record.key !== record.owner + '/' + slug
      || station !== record.station || start !== record.days[0] || Number(threshold) !== record.threshold
      || String(reviewer).toLowerCase() !== record.reviewer) throw Error('This transaction does not match the window registration.')
  const submitted = new Date(tx.created_at)
  if (!Number.isFinite(submitted.getTime())) throw Error('Studionet did not return a registration submission time.')
  const cutoff = new Date(record.days[0]+'T00:00:00Z')
  return {submitted:submitted.toISOString(), early:submitted < cutoff, cutoff:cutoff.toISOString()}
}
