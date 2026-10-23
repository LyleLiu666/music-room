import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyQualityEvidence} from './quality/evidence.ts';
const bytes=new TextEncoder().encode('test evidence'),sha256=createHash('sha256').update(bytes).digest('hex');
const artifact=(kind:string)=>({kind,path:`test-${kind}`,sha256});
const report=()=>({realInference:true,sourceRevision:'test-only',modelRevision:'test-only',hardware:'test-only',results:[{caseId:'case',status:'passed',reviewedBy:'test reviewer',reviewedAt:'2026-10-23T00:00:00Z',scores:{clarity:4,continuity:4,completeness:5,noArtifacts:4},findings:[],artifacts:[artifact('audio'),artifact('inference-log')]}]});
test('quality gate refuses missing, pending, duplicated and fake evidence',async()=>{
 for(const r of [{}, {...report(),realInference:false},{...report(),results:[]},{...report(),results:[...report().results,...report().results]},{...report(),results:[{...report().results[0],status:'pending'}]}])assert.equal((await verifyQualityEvidence([{id:'case'}],r,async()=>bytes)).passed,false);
});
test('quality gate binds reviews to existing, unchanged audio and logs',async()=>{
 assert.equal((await verifyQualityEvidence([{id:'case'}],report(),async()=>bytes)).passed,true);
 assert.equal((await verifyQualityEvidence([{id:'case'}],report(),async()=>new Uint8Array([1]))).passed,false);
 assert.equal((await verifyQualityEvidence([{id:'case'}],report(),async()=>{throw Error('missing');})).passed,false);
 const low=report();low.results[0].scores.clarity=3;assert.equal((await verifyQualityEvidence([{id:'case'}],low,async()=>bytes)).passed,false);
});
test('lyrics require independent truth and valid accuracy and timing; speed requires every rate',async()=>{
 const c={id:'case',metrics:{characterAccuracyMin:.95,startErrorP95SecondsMax:.5}};
 assert.equal((await verifyQualityEvidence([c],report(),async()=>bytes)).passed,false);
 const valid:any=report();valid.results[0].metrics={characterAccuracy:.98,startErrorP95Seconds:.2};valid.results[0].artifacts.push(artifact('human-transcript'));
 assert.equal((await verifyQualityEvidence([c],valid,async()=>bytes)).passed,true);
 valid.results[0].metrics.startErrorP95Seconds=-1;assert.equal((await verifyQualityEvidence([c],valid,async()=>bytes)).passed,false);
 assert.equal((await verifyQualityEvidence([{id:'case',input:{rates:[.5,.8,2]}}],report(),async()=>bytes)).passed,false);
 assert.equal((await verifyQualityEvidence([{id:'case',runs:[1,2,3]}],report(),async()=>bytes)).passed,false);
 const repeated=report();repeated.results[0].artifacts=[1,2,3].flatMap(run=>['audio','inference-log'].map(kind=>({...artifact(kind),run})));
 assert.equal((await verifyQualityEvidence([{id:'case',runs:[1,2,3]}],repeated,async()=>bytes)).passed,true);
});
