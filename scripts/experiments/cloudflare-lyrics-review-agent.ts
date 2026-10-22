// Two-turn review experiment. Gold labels are used only for scoring, never as feedback.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { credentials, evaluateFocused, evaluatePassage, loadFixtures, modelParameters, modelRates, experimentNeurons } from './cloudflare-lyrics-review.ts';

async function run() {
  const baselinePath = process.argv[2];
  if (!baselinePath) throw Error('Supply a single-turn report.json to review.');
  const envIndex = process.argv.indexOf('--env-file');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const fixtures = loadFixtures();
  const modelIndex = process.argv.indexOf('--model');
  const model = modelIndex < 0 ? '@cf/qwen/qwen3.8-27b' : process.argv[modelIndex + 1];
  modelParameters(model, 1); // Validate against the explicitly allowed experimental models.
  const caseIndex = process.argv.indexOf('--case');
  const selectedIds = caseIndex < 0 ? undefined : process.argv[caseIndex + 1]?.split(',');
  const drafts = baseline.trials.filter((trial: any) => trial.model === model && trial.body && trial.envelope?.result && (!selectedIds || selectedIds.includes(trial.id)));
  if (!drafts.length) throw Error('Report has no drafts for this model to review.');
  if (!process.argv.includes('--run')) {
    console.log(JSON.stringify({ mode: 'dry-run', model, rounds: 2, newCalls: drafts.length, inferencePerformed: false }));
    return;
  }
  const auth = credentials(envIndex < 0 ? undefined : process.argv[envIndex + 1]);
  const root = resolve('test-results/cloudflare-lyrics-review');
  let used = experimentNeurons();
  const directory = resolve(root, `${new Date().toISOString().replaceAll(':', '-')}-two-turn`);
  mkdirSync(directory, { recursive: true });
  const report = { startedAt: new Date().toISOString(), baselinePath: resolve(baselinePath), model,
    rounds: 2, newCallsPerCase: 1, goldLabelsSentToModel: false, initialReservedNeurons: used,
    localExperimentNeuronLimit: 9500, accountOtherUsageKnown: false, automaticLyricWrites: false, trials: [] as object[], failures: [] as object[] };
  const save = () => writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  save();
  for (const draft of drafts) {
    const focused = fixtures.focused.find(row => row.id === draft.id);
    const passage = [...fixtures.passages, ...fixtures.controls].find(row => row.id === draft.id);
    if (!focused && !passage) throw Error('Unknown fixture in the baseline report.');
    const previous = draft.envelope.result.response ?? draft.envelope.result.choices?.[0]?.message?.content ?? '';
    const structural = passage ? evaluatePassage(previous, { ...passage, checks: [] }, fixtures.reference).errors : [];
    const review = '现在独立复查上一轮答案并修订，不要默认自己的答案正确。先在内部重新比较待核对句与候选原词的发音和上下文。前后句相同只能帮助定位，不能证明中间任何一句都对应；中间若是发音完全不同的额外句子，要保留为无法对应。另一方面，同音识别错字不能仅因字面或意思不同而拒绝。合并句、半句和重复次数也要检查。不要只复述上一轮结论。最终仅按原请求的格式给出修订后的完整答案，不输出解释。'
      + (structural.length ? `\n程序只做了格式检查，发现以下问题（不含正确答案）：${JSON.stringify(structural)}` : '');
    const messages = [...draft.body.messages, { role: 'assistant', content: previous }, { role: 'user', content: review }];
    const maxTokens = passage ? (model === '@cf/qwen/qwen3.8-27b' ? 4096 : 2048) : 1536;
    // Conservative per-call bound: UTF-8 bytes bound input tokens, with room for the chat template.
    const rates = modelRates[model];
    const reserved = (Buffer.byteLength(JSON.stringify(messages), 'utf8') + 256) * rates.input / 1_000_000 + maxTokens * rates.output / 1_000_000;
    if (used + reserved > 9500) throw Error(`Local experiment budget reached. Report: ${directory}`);
    const body = { messages, stream: false, temperature: 0, ...modelParameters(model, maxTokens) };
    const started = Date.now();
    let response;
    try {
      response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${auth.account}/ai/run/${model}`, {
        method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      report.failures.push({ id: draft.id, model, round: 2, qualityResult: 'indeterminate', reservedNeurons: reserved, error: error instanceof Error ? error.message : String(error) });
      save();
      throw error;
    }
    if (!response.ok) throw Error(`Cloudflare HTTP ${response.status}; stopped without retries. Report: ${directory}`);
    const envelope = await response.json() as any;
    if (!envelope.success || !envelope.result) throw Error(`Unsuccessful inference. Report: ${directory}`);
    used += envelope.result.usage?.neurons ?? reserved;
    const content = envelope.result.response ?? envelope.result.choices?.[0]?.message?.content ?? '';
    const evaluation = focused ? evaluateFocused(content, focused.expected) : evaluatePassage(content, passage!, fixtures.reference);
    report.trials.push({ model, id: draft.id, seconds: (Date.now() - started) / 1000, baselinePassed: draft.evaluation.passed,
      body, envelope, evaluation, experimentReservedNeuronsSoFar: used });
    save();
    console.log(JSON.stringify({ id: draft.id, round: 2, baselinePassed: draft.evaluation.passed, ...evaluation }));
  }
  console.log(JSON.stringify({ directory, total: report.trials.length, experimentReservedNeurons: used }));
}

run().catch(error => { console.error(error.message, error.cause?.code ?? ''); process.exitCode = 1; });
