import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs'
import {dirname} from 'node:path'
import {createAccount,createClient,generatePrivateKey} from 'genlayer-js'

export function acceptance({chain,reader,checkNetwork,waitFinalized,sourcePath}) {
  const source=readFileSync(sourcePath,'utf8')
  const file=process.env.STUDIO_EVIDENCE_PATH ?? '.private/v2-run.json'
  const ephemeral=process.env.STUDIO_SIGNERS==='ephemeral'
  const names=['STUDIO_OWNER_KEY','STUDIO_REVIEWER_KEY']
  const actors=names.map(name=>{
    const key=ephemeral ? generatePrivateKey() : process.env[name]
    assert.match(key ?? '',/^0x[0-9a-f]{64}$/i,'An authorized test signer is required for '+name)
    const account=createAccount(key)
    return {address:account.address.toLowerCase(),client:createClient({chain,account})}
  })
  assert.notEqual(actors[0].address,actors[1].address)
  const sourceSha256=createHash('sha256').update(source).digest('hex')
  if(ephemeral && existsSync(file)) throw Error('Use a fresh evidence path for ephemeral signers.')
  const history=existsSync(file) ? JSON.parse(readFileSync(file,'utf8'))
    : {chainId:61999,rpc:'https://studio.genlayer.com/api',sourceSha256,signers:actors.map(actor=>actor.address),steps:{}}
  assert.deepEqual(history.signers,actors.map(actor=>actor.address))
  assert.equal(history.sourceSha256,sourceSha256)
  mkdirSync(dirname(file),{recursive:true})
  const save=()=>writeFileSync(file,JSON.stringify(history,null,2)+'\n')
  async function transaction(label,index,method,args,verify,expectedError) {
    const actor=actors[index]
    let step=history.steps[label]
    if(step?.verified) return step.readback
    if(!step) {
      await checkNetwork(actor.client)
      step=history.steps[label]={method,actor:actor.address,args,hash:null}
      save()
      step.hash=method==='deploy'
        ? await actor.client.deployContract({code:source,args,leaderOnly:false})
        : await actor.client.writeContract({address:history.address,functionName:method,args,value:0n,leaderOnly:false})
      save()
    }
    assert(step.hash,'Reconcile this uncertain submission before retrying.')
    console.log(label,step.hash)
    const tx=await waitFinalized(step.hash,undefined,{allowExecutionError:true})
    assert.equal(tx.from_address.toLowerCase(),actor.address)
    assert.equal(BigInt(tx.value ?? 0),0n)
    const receipts=[tx.consensus_data?.leader_receipt].flat()
    const leader=receipts.find(item=>item?.mode==='leader') ?? receipts[0]
    Object.assign(step,{status:'FINALIZED',consensus:'MAJORITY_AGREE',execution:leader.execution_result})
    if(typeof leader.result?.payload==='string') step.reason=leader.result.payload
    save()
    assert.equal(step.execution,expectedError?'ERROR':'SUCCESS',step.reason)
    if(expectedError) assert.equal(step.reason,expectedError)
    step.readback=await verify(tx)
    step.verified=true
    save()
    console.log(label,step.status,step.execution)
    return step.readback
  }
  function deploy() {
    return transaction('deployment',0,'deploy',[],async tx=>{
      history.address=tx.data.contract_address
      assert.equal(await reader.getContractCode(history.address),source)
      return {address:history.address,sourceVerified:true}
    })
  }
  return {actors,history,save,transaction,deploy}
}
