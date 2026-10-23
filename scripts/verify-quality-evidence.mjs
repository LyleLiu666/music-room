import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {verifyQualityEvidence} from '../tests/quality/evidence.ts';
const catalogue=JSON.parse(await readFile(new URL('../tests/quality/cases.json',import.meta.url),'utf8'));
const cases=catalogue.cases.map(c=>({...c,runs:['tts','music'].includes(c.kind)?catalogue.seeds.map((_,i)=>i+1):undefined}));
const path=resolve(process.argv[2]??'test-results/quality/review.json');
let report;try{report=JSON.parse(await readFile(path,'utf8'));}catch{console.error(`缺少真实音频听评记录：${path}。按 docs/testing/quality.md 执行；未执行不能算通过。`);process.exit(1);}
const result=await verifyQualityEvidence(cases,report,p=>readFile(resolve(dirname(path),p)));
console.log(JSON.stringify({path,cases:cases.length,...result},null,2));if(!result.passed)process.exitCode=1;
