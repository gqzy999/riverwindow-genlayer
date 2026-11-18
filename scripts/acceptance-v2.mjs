import assert from 'node:assert/strict'
import {chain,reader,checkNetwork,waitFinalized,readWindow} from '../chain.js'
import {acceptance} from './acceptance-v2-support.mjs'

const {actors:[owner,reviewer],history,save,transaction,deploy}=acceptance({
  chain,reader,checkNetwork,waitFinalized,sourcePath:'contracts/riverwindow.py',
})
await deploy()
const fixtures=[['water-review',10000,'REVIEW_REQUIRED'],['higher-threshold',12000,'RULE_NOT_MET']]
const windows=[]
for(const [slug,threshold,expected] of fixtures){
  const key=owner.address+'/'+slug
  async function record(status){
    const item=await readWindow(history.address,key)
    assert.equal(item.status,status)
    assert.equal(item.owner,owner.address)
    assert.equal(item.reviewer,reviewer.address)
    return item
  }
  await transaction(slug+'_register',0,'register',[slug,'01646500','2025-07-01',threshold,reviewer.address],()=>record('AWAITING_DATA'))
  const evaluated=await transaction(slug+'_evaluate',1,'evaluate',[key],()=>record(expected))
  assert.equal(evaluated.evaluated_by,reviewer.address)
  assert.deepEqual(evaluated.readings,[9360000,11200000,12400000])
  if(expected==='REVIEW_REQUIRED'){
    await transaction('unauthorized_acknowledge',0,'acknowledge',[key,'Unauthorized review attempt'],async()=>{
      const after=await record('REVIEW_REQUIRED')
      assert.deepEqual(after,evaluated)
      return after
    },'INDEPENDENT_REVIEW_NOTE_REQUIRED')
    const ack=await transaction(slug+'_acknowledge',1,'acknowledge',[key,'Reviewed the two consecutive approved discharge observations.'],()=>record('ACKNOWLEDGED'))
    assert.equal(ack.acknowledged_by,reviewer.address)
  }
  windows.push({address:history.address,key,steps:Object.fromEntries(['register','evaluate','acknowledge']
    .flatMap(method=>history.steps[slug+'_'+method] ? [[method,{hash:history.steps[slug+'_'+method].hash}]] : []))})
}
history.windows=windows
save()
