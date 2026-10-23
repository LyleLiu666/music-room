import {createHash} from 'node:crypto';
type Case={id:string;runs?:number[];input?:{rates?:number[]};metrics?:{characterAccuracyMin:number;startErrorP95SecondsMax:number}};
/** Evidence gate checks completeness and provenance, not aesthetic judgement. */
export async function verifyQualityEvidence(cases:Case[],report:any,read:(path:string)=>Promise<Uint8Array>){
 const errors:string[]=[];
 if(report?.realInference!==true)errors.push('需要真实推理记录');
 if(!report?.sourceRevision||!report?.modelRevision||!report?.hardware)errors.push('缺少代码、模型或机器版本');
 const results=Array.isArray(report?.results)?report.results:[];
 for(const item of cases){
  const matches=results.filter((r:any)=>r.caseId===item.id);
  if(matches.length!==1){errors.push(`${item.id}: 需要唯一结果，当前 ${matches.length} 条`);continue;}
  const result=matches[0];
  if(result.status!=='passed'||!result.reviewedBy?.trim()||!Number.isFinite(Date.parse(result.reviewedAt)))errors.push(`${item.id}: 缺少完成的人工听评`);
  for(const metric of ['clarity','continuity','completeness','noArtifacts'])if(!Number.isInteger(result.scores?.[metric])||result.scores[metric]<4||result.scores[metric]>5)errors.push(`${item.id}: ${metric} 未达到 4/5`);
  if(!Array.isArray(result.findings)||result.findings.some((f:any)=>f.severity==='blocker'||f.severity==='major'))errors.push(`${item.id}: 存在阻断缺陷或未记录缺陷列表`);
  const artifacts=Array.isArray(result.artifacts)?result.artifacts:[];
  if(!artifacts.some((a:any)=>a.kind==='audio')||!artifacts.some((a:any)=>a.kind==='inference-log'))errors.push(`${item.id}: 缺少音频或推理日志`);
  for(const run of item.runs??[])for(const kind of ['audio','inference-log'])if(!artifacts.some((a:any)=>a.kind===kind&&a.run===run))errors.push(`${item.id}: 缺少第 ${run} 次 ${kind}，不得只挑最好的一次`);
  if(item.input?.rates)for(const rate of item.input.rates)if(!artifacts.some((a:any)=>a.kind==='audio'&&a.rate===rate))errors.push(`${item.id}: 缺少 ${rate} 倍音频`);
  for(const artifact of artifacts){
   try{const bytes=await read(artifact.path);if(!bytes.length||!/^[a-f0-9]{64}$/.test(artifact.sha256)||createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)errors.push(`${item.id}: 产物哈希不匹配 ${artifact.path}`);}
   catch{errors.push(`${item.id}: 产物不可读取 ${artifact.path}`);}
  }
  if(item.metrics){const m=result.metrics;if(!Number.isFinite(m?.characterAccuracy)||m.characterAccuracy<item.metrics.characterAccuracyMin||m.characterAccuracy>1||!Number.isFinite(m?.startErrorP95Seconds)||m.startErrorP95Seconds<0||m.startErrorP95Seconds>item.metrics.startErrorP95SecondsMax)errors.push(`${item.id}: 歌词人工真值指标未通过`);if(!artifacts.some((a:any)=>a.kind==='human-transcript'))errors.push(`${item.id}: 缺少独立人工转写`);}
 }
 for(const result of results)if(!cases.some(c=>c.id===result.caseId))errors.push(`未知用例 ${result.caseId}`);
 return {passed:errors.length===0,errors};
}
