import test from 'node:test';
import assert from 'node:assert/strict';
import {generationSummary,qualityExecutionPassed} from './quality/execution.ts';
test('generation execution preserves old failures while reporting the latest successful retry',()=>{
 const summary=generationSummary([{key:'a',status:'blocked'},{key:'b',status:'failed'},{key:'a',status:'succeeded'},{key:'b',status:'succeeded'}],['a','b']);
 assert.equal(summary.status,'succeeded');assert.equal(summary.succeeded,2);assert.equal(summary.failed,0);assert.equal(summary.blocked,0);
});
test('missing, interrupted and blocked runs cannot become a completed generation batch',()=>{
 assert.equal(generationSummary([],[]).status,'not-run');
 assert.equal(generationSummary([{key:'a',status:'succeeded'}],['a','b']).status,'incomplete');
 assert.equal(generationSummary([{key:'a',status:'interrupted'}],['a']).status,'incomplete');
 assert.equal(generationSummary([{key:'a',status:'succeeded'},{key:'a',status:'blocked'}],['a']).status,'blocked');
 assert.equal(generationSummary([{key:'a',status:'failed'},{key:'b',status:'blocked'}],['a','b']).status,'failed');
});
test('a lyrics-only selection succeeds without inventing generation runs; empty and incomplete selections fail',()=>{
 const empty=generationSummary([],[]),complete=generationSummary([{key:'a',status:'succeeded'}],['a']);
 assert.equal(qualityExecutionPassed(empty,true,true),true);
 assert.equal(qualityExecutionPassed(empty,true,false),false);
 assert.equal(qualityExecutionPassed(empty,false,true),false);
 assert.equal(qualityExecutionPassed(complete,false,false),true);
 assert.equal(qualityExecutionPassed(complete,true,false),false);
 assert.equal(qualityExecutionPassed(generationSummary([],['a']),true,true),false);
});
