import './style.css'
import { createClient } from 'genlayer-js'
import { chain, rpc, explorer, checkNetwork, readWindow, waitFinalized } from './chain.js'
import source from './contracts/riverwindow.py?raw'
import deployment from './deployment.json'

const get = id => document.getElementById(id)
const wallets = new Map()
let provider
let account
let busy = false
const status = text => { get('status').textContent = text }
const addressPattern = /^0x[0-9a-f]{40}$/i
const keyPattern = /^0x[0-9a-f]{40}\/[a-z0-9-]{3,40}$/

function offerWallet(name, candidate) {
  if (!candidate?.request || [...wallets.values()].includes(candidate)) return
  if (!wallets.size) get('wallet').replaceChildren()
  const id = String(wallets.size)
  wallets.set(id, candidate)
  get('wallet').add(new Option(name, id))
}
window.addEventListener('eip6963:announceProvider', ({detail}) => offerWallet(detail.info.name, detail.provider))
window.dispatchEvent(new Event('eip6963:requestProvider'))
for (const candidate of window.ethereum?.providers ?? [window.ethereum, window.okxwallet, window.coinbaseWalletExtension]) {
  offerWallet(candidate?.isRabby ? 'Rabby' : candidate?.isMetaMask ? 'MetaMask' : candidate?.isOKExWallet ? 'OKX' : candidate?.isCoinbaseWallet ? 'Coinbase Wallet' : 'Injected wallet', candidate)
}
if (!wallets.size) get('wallet').add(new Option('No injected wallet detected', ''))

function updateAccount(value) {
  account = addressPattern.test(value ?? '') ? value.toLowerCase() : undefined
  get('account').textContent = account ?? 'Public chain reads work without a wallet.'
}
const accountsChanged = list => updateAccount(list[0])
get('wallet').addEventListener('change', () => {
  provider?.removeListener?.('accountsChanged', accountsChanged)
  provider = undefined
  updateAccount(undefined)
})

async function switchNetwork() {
  const chainId = '0xf22f'
  if (Number(await provider.request({method: 'eth_chainId'})) === 61999) return
  try {
    await provider.request({method: 'wallet_switchEthereumChain', params: [{chainId}]})
  } catch (error) {
    if ((error?.data?.originalError?.code ?? error.code) !== 4902) throw error
    await provider.request({method: 'wallet_addEthereumChain', params: [{
      chainId, chainName: 'GenLayer Stable Studionet',
      nativeCurrency: {name: 'GEN', symbol: 'GEN', decimals: 18},
      rpcUrls: [rpc], blockExplorerUrls: [explorer],
    }]})
    if (Number(await provider.request({method: 'eth_chainId'})) !== 61999) {
      await provider.request({method: 'wallet_switchEthereumChain', params: [{chainId}]})
    }
  }
  if (Number(await provider.request({method: 'eth_chainId'})) !== 61999) throw Error('Switch to Stable Studionet before signing.')
}

function bind(id, handler) {
  get(id).addEventListener(get(id).tagName === 'FORM' ? 'submit' : 'click', async event => {
    event.preventDefault()
    if (busy) return
    busy = true
    document.querySelectorAll('button').forEach(button => button.disabled = true)
    try { await handler() }
    catch (error) { status(error.shortMessage ?? error.message ?? String(error)) }
    finally {
      busy = false
      document.querySelectorAll('button').forEach(button => button.disabled = false)
    }
  })
}

bind('connect', async () => {
  const selected = wallets.get(get('wallet').value)
  if (!selected) throw Error('Install or enable an EIP-1193 wallet, then reload.')
  provider?.removeListener?.('accountsChanged', accountsChanged)
  provider = selected
  updateAccount(undefined)
  const list = await provider.request({method: 'eth_requestAccounts'})
  await switchNetwork()
  updateAccount(list[0])
  provider.on?.('accountsChanged', accountsChanged)
  status(account ? 'Wallet connected to Stable Studionet' : 'Wallet did not provide an account')
})

async function signer() {
  if (!provider || !account) throw Error('Connect a wallet first.')
  await switchNetwork()
  const active = (await provider.request({method: 'eth_accounts'}))[0]?.toLowerCase()
  if (!active || active !== account) throw Error('Wallet account changed. Reconnect before signing.')
  await checkNetwork()
  const selectedProvider = provider
  const guardedProvider = {
    async request(request) {
      if (request.method === 'eth_sendTransaction') {
        if (Number(await selectedProvider.request({method: 'eth_chainId'})) !== 61999) {
          throw Error('Wallet network changed before signing.')
        }
        if (BigInt(request.params[0].value ?? 0) !== 0n || BigInt(request.params[0].gasPrice ?? 1) !== 0n) {
          throw Error('Wallet request must have zero value and zero gas price.')
        }
      }
      return selectedProvider.request(request)
    },
  }
  return createClient({chain, account: active, provider: guardedProvider})
}

function contract() {
  const value = get('contract').value.trim()
  if (!addressPattern.test(value)) throw Error('Enter a valid contract address.')
  return value
}

function key() {
  const value = get('key').value.trim().toLowerCase()
  if (!keyPattern.test(value)) throw Error('Enter the wallet address and window name as address/name.')
  return value
}

function show(record) {
  get('record').hidden = !record
  get('actions').hidden = !record || !['AWAITING_DATA','REVIEW_REQUIRED'].includes(record.status)
  if (!record) return
  get('state').textContent = record.status.replaceAll('_', ' ')
  get('rule').textContent = 'USGS ' + record.station + ' · Two consecutive days ≥ ' + record.threshold.toLocaleString() + ' ft³/s'
  get('values').replaceChildren(...record.days.map((day, index) => {
    const cell = document.createElement('div')
    const label = document.createElement('small')
    label.textContent = day
    const value = document.createElement('strong')
    value.textContent = record.readings ? (record.readings[index] / 1000).toLocaleString() : '—'
    cell.append(label, value)
    return cell
  }))
  get('source').href = 'https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/items?' + new URLSearchParams({
    f:'json', monitoring_location_id:'USGS-' + record.station, parameter_code:'00060',
    statistic_id:'00003', datetime:record.days[0] + '/' + record.days[2], limit:'20',
  })
  get('review').textContent = record.note ? record.note + ' · ' + record.reviewer : 'Assigned reviewer · ' + record.reviewer
  get('ack').hidden = record.status !== 'REVIEW_REQUIRED'
  get('evaluate').hidden = record.status !== 'AWAITING_DATA'
}

async function track(hash) {
  const link = get('transaction')
  link.href = explorer + '/transactions/' + hash
  link.hidden = false
  status('Submitted · awaiting consensus')
  return waitFinalized(hash, stage => status('Consensus · ' + stage))
}

async function write(functionName, args, reference, expected) {
  const address = contract()
  const client = await signer()
  status('Approve the transaction in your wallet')
  const hash = await client.writeContract({address, functionName, args, value:0n, leaderOnly:false})
  await track(hash)
  const record = await readWindow(address, reference)
  show(record)
  if (!record || !expected.includes(record.status)) throw Error('Transaction succeeded, but finalized readback did not match the expected state.')
  status('FINALIZED / SUCCESS · Read back ' + record.status)
}

bind('lookup', async () => {
  const record = await readWindow(contract(), key())
  show(record)
  status(record ? 'Finalized record loaded' : 'No finalized record for this reference')
})
bind('register', async () => {
  if (!account) throw Error('Connect a wallet first.')
  const slug = get('slug').value
  const reference = account + '/' + slug
  get('key').value = reference
  await write('register', [slug, get('station').value, get('date').value, Number(get('threshold').value), get('reviewer').value], reference, ['AWAITING_DATA'])
})
bind('evaluate', async () => {
  const reference = key()
  await write('evaluate', [reference], reference, ['RULE_NOT_MET','REVIEW_REQUIRED','ACKNOWLEDGED'])
})
bind('ack', async () => {
  const reference = key()
  await write('acknowledge', [reference, get('note').value], reference, ['ACKNOWLEDGED'])
})
bind('deploy', async () => {
  const client = await signer()
  status('Approve contract deployment in your wallet')
  const tx = await track(await client.deployContract({code:source,args:[],leaderOnly:false}))
  const address = tx.data?.contract_address ?? tx.to_address
  if (!addressPattern.test(address ?? '')) throw Error('Deployment finalized. Locate the address in the transaction explorer.')
  await readWindow(address, '')
  get('contract').value = address
  status('FINALIZED / SUCCESS · Deployed contract read verified')
})

const params = new URLSearchParams(location.search)
get("contract").value = deployment.address
if (addressPattern.test(params.get('contract') ?? '')) get('contract').value = params.get('contract')
if (keyPattern.test(params.get('key') ?? '')) get('key').value = params.get('key')
