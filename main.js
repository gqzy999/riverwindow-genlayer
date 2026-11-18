import './style.css'
import { createClient } from 'genlayer-js'
import { chain, rpc, explorer, checkNetwork, readWindow, waitFinalized } from './chain.js'
import source from './contracts/riverwindow.py?raw'
import deployment from './deployment.json'
import example from './evidence/studionet.json'
import higher from './evidence/comparison.json'
import upgrade from './evidence/v2.json'
import { runs, registrationTiming } from './review.js'

const get = id => document.getElementById(id)
const wallets = new Map()
let provider
let account
let busy = false
let currentRecord
const published = [example,higher,...(upgrade.windows ?? [])]
const stations = {'01646500':'Potomac River · Little Falls','01491000':'Choptank River · Greensboro','01638500':'Potomac River · Point of Rocks'}
const storageKey = 'riverwindow.archive'
let saved = []
try { saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]') } catch {}
if (!Array.isArray(saved)) saved = []
const stored = (address, key) => saved.find(item => item.address===address && item.key===key)
function remember(address,key,method,hash) {
  const previous=stored(address,key)
  const entry={address,key,steps:{...previous?.steps}}
  if(method && hash) entry.steps[method]={hash}
  saved=[entry,...saved.filter(item=>item!==previous)].slice(0,20)
  try { localStorage.setItem(storageKey,JSON.stringify(saved)) } catch {}
  renderArchive()
}
function renderArchive() {
  const archive=get('window-archive')
  archive.replaceChildren(...[...published,...saved.filter(item=>!published.some(row=>row.address===item.address&&row.key===item.key))].map(item=>{
    const link=document.createElement('a')
    const url=new URL(location.href)
    url.search=new URLSearchParams({contract:item.address,key:item.key})
    link.href=url.href
    link.textContent=item.key.split('/')[1]+' · '+(item.address===deployment.address?'Current contract':'Historical contract')
    return link
  }))
}
function updatePermissions() {
  const record=currentRecord
  get('register').hidden=!account
  get('deploy-panel').hidden=!account
  const canEvaluate=!!account && record?.status==='AWAITING_DATA'
  const canAck=!!account && record?.status==='REVIEW_REQUIRED' && account===record.reviewer
  get('actions').hidden=!canEvaluate&&!canAck
  get('evaluate').hidden=!canEvaluate
  get('ack').hidden=!canAck
  get('action-context').textContent=canEvaluate
    ? 'Any connected wallet can request independent USGS validation. The evidence determines the next state.'
    : 'The assigned reviewer can record a permanent acknowledgement and note.'
}
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
  get('account').textContent = account ? account + ' · Stable Studionet (61999)' : 'Public chain reads work without a wallet.'
  updatePermissions()
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
    document.querySelectorAll('button, input, select, textarea').forEach(button => button.disabled = true)
    try { await handler() }
    catch (error) { status(error.shortMessage ?? error.message ?? String(error)) }
    finally {
      busy = false
      document.querySelectorAll('button, input, select, textarea').forEach(button => button.disabled = false)
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

function show(record, address=get('contract').value.trim()) {
  if(addressPattern.test(address)) get('contract-explorer').href=explorer+'/address/'+address
  else get('contract-explorer').removeAttribute('href')
  get('contract-explorer').textContent=address+' ↗'
  currentRecord = record
  get('timing-result').textContent = ''
  const known = published.find(item => item.key===record?.key && item.address.toLowerCase()===address.toLowerCase())
  const steps={...stored(address,record?.key)?.steps,...known?.steps}
  get('registration-hash').value = steps.register?.hash ?? ''
  get('record').hidden = !record
  updatePermissions()
  if (!record) return
  get('state').textContent = record.status.replaceAll('_', ' ')
  get('site').textContent=stations[record.station] ?? record.station
  get('rule').textContent = 'USGS ' + record.station + ' · Two consecutive days ≥ ' + record.threshold.toLocaleString() + ' ft³/s'
  const scale = Math.max(record.threshold*1000,...(record.readings ?? []))
  get('values').replaceChildren(...record.days.map((day, index) => {
    const cell = document.createElement('div')
    const label = document.createElement('small')
    label.textContent = day
    const value = document.createElement('strong')
    value.textContent = record.readings ? (record.readings[index] / 1000).toLocaleString() : '—'
    const approval=document.createElement('small')
    const qualifies=record.readings?.[index] >= record.threshold*1000
    approval.textContent=record.readings ? 'ft³/s · Approved · '+(qualifies?'Meets threshold':'Below threshold') : 'Awaiting approved USGS data'
    cell.classList.toggle('qualifies',qualifies)
    cell.append(label,value,approval)
    if(record.readings){
      const bar=document.createElement('div')
      bar.className='flow-meter'
      bar.setAttribute('aria-hidden','true')
      bar.style.setProperty('--flow',100*record.readings[index]/scale+'%')
      bar.style.setProperty('--threshold',100*record.threshold*1000/scale+'%')
      cell.append(bar)
    }
    return cell
  }))
  get('source').href = 'https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/items?' + new URLSearchParams({
    f:'json', monitoring_location_id:'USGS-' + record.station, parameter_code:'00060',
    statistic_id:'00003', datetime:record.days[0] + '/' + record.days[2], limit:'20',
  })
  get('review').textContent = record.note ? record.note + ' · ' + record.reviewer : 'Assigned reviewer · ' + record.reviewer
  const milestones = [
    'Rule registered',
    record.readings ? 'USGS observations evaluated' : 'Awaiting approved USGS observations',
    {ACKNOWLEDGED:'Reviewer acknowledged', REVIEW_REQUIRED:'Awaiting reviewer', RULE_NOT_MET:'Rule not met'}[record.status] ?? 'Review decision pending',
  ]
  get('progress').replaceChildren(...milestones.map(text => {
    const item=document.createElement('li')
    item.textContent=text
    return item
  }))
  const qualifying=runs(record)
  get('decision').textContent=record.readings
    ? (qualifying.length ? 'Review triggered by '+qualifying.join(', ') : 'No two consecutive days met the threshold.')
    : 'A decision requires three approved daily means.'
  const roles=[
    ['Registered by',record.owner,'register'],['Evaluated by',record.evaluated_by,'evaluate'],
    ['Assigned reviewer',record.reviewer],['Acknowledged by',record.acknowledged_by,'acknowledge'],
  ]
  get('responsibility').replaceChildren(...roles.map(([label,actor,method])=>{
    const row=document.createElement('div')
    const term=document.createElement('dt')
    term.textContent=label
    const detail=document.createElement('dd')
    detail.textContent=actor ?? (method && steps[method] ? 'Actor field unavailable on this deployment' : '—')
    if(steps[method]?.hash){
      const link=document.createElement('a')
      link.href=explorer+'/transactions/'+steps[method].hash
      link.target='_blank'
      link.rel='noopener'
      link.textContent='Transaction ↗'
      detail.append(' ',link)
    }
    row.append(term,detail)
    return row
  }))
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
  if(record) remember(address,reference,functionName,hash)
  show(record,address)
  if (record && functionName === 'register') get('registration-hash').value = hash
  if (!record || !expected.includes(record.status)) throw Error('Transaction succeeded, but finalized readback did not match the expected state.')
  status('FINALIZED / SUCCESS · Read back ' + record.status)
}

bind('lookup', async () => {
  const record = await readWindow(contract(), key())
  if(record) remember(contract(),record.key)
  show(record)
  status(record ? 'Finalized record loaded' : 'No finalized record for this reference')
})
bind('example',async () => {
  const sample=upgrade.windows?.[0] ?? example
  get('contract').value=sample.address
  get('key').value=sample.key
  const record=await readWindow(sample.address,sample.key)
  show(record)
  status(record ? 'Finalized example loaded' : 'Example unavailable')
})
bind('timing',async () => {
  if (!currentRecord) throw Error('Load a finalized window.')
  const result=await registrationTiming(contract(),currentRecord,get('registration-hash').value.trim())
  get('timing-result').textContent='Studionet recorded submission at '+result.submitted+
    (result.early ? ' · Before the conservative UTC start cutoff.' : ' · On or after the UTC start cutoff. This record does not establish pre-registration.')
  status('Registration transaction verified')
})
async function compareWindows() {
  const refs=['compare-first','compare-second'].map(id=>get(id).value.trim().toLowerCase())
  if (refs.some(ref=>!keyPattern.test(ref)) || refs[0]===refs[1]) throw Error('Enter two distinct window references.')
  const address=contract()
  get('comparison-table').hidden=true
  const records=await Promise.all(refs.map(ref=>readWindow(address,ref)))
  if (records.some(record=>!record)) throw Error('Both windows must exist on the selected contract.')
  get('compare-a').textContent=refs[0].split('/')[1]
  get('compare-b').textContent=refs[1].split('/')[1]
  const rows=[
    ['USGS gauge',record=>record.station],
    ['Observation dates',record=>record.days[0]+' → '+record.days.at(-1)],
    ['Threshold',record=>record.threshold.toLocaleString()+' ft³/s'],
    ['Approved daily means',record=>record.readings?.map(value=>(value/1000).toLocaleString()).join(' · ') ?? 'Awaiting data'],
    ['Consecutive qualifying dates',record=>runs(record).join(' · ') || (record.readings ? 'None' : 'Awaiting data')],
    ['Finalized state',record=>record.status.replaceAll('_',' ')],
    ['Reviewer note',record=>record.note || '—'],
  ]
  get('compare-rows').replaceChildren(...rows.map(([label,describe])=>{
    const row=document.createElement('tr')
    const heading=document.createElement('th')
    heading.scope='row'
    heading.textContent=label
    row.append(heading)
    for(const record of records){
      const cell=document.createElement('td')
      cell.textContent=describe(record)
      row.append(cell)
    }
    return row
  }))
  get('comparison-table').hidden=false
  status('Two finalized windows loaded')
}
bind('compare',compareWindows)
bind('compare-example',async () => {
  const [first,second]=upgrade.windows?.length>=2 ? upgrade.windows : [example,higher]
  get('contract').value=first.address
  show(null)
  get('compare-first').value=first.key
  get('compare-second').value=second.key
  await compareWindows()
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
  show(null)
  status('FINALIZED / SUCCESS · Deployed contract read verified')
})

for (const name of ['contract','key']) get(name).addEventListener('input',()=>show(null))
const params = new URLSearchParams(location.search)
get("contract").value = deployment.address
if (addressPattern.test(params.get('contract') ?? '')) get('contract').value = params.get('contract')
else {
  const legacy = [example,higher].find(item => item.key === params.get('key'))
  if (legacy) get('contract').value = legacy.address
}
if (keyPattern.test(params.get('key') ?? '')) get('key').value = params.get('key')

show(null)
renderArchive()
if(keyPattern.test(get('key').value)) get('lookup').requestSubmit()
