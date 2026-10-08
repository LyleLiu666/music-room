import { readFile } from 'node:fs/promises';
import { validateComposition } from './validate.mjs';
try {
  if (process.argv.length !== 3) throw new Error('用法：node check.mjs your-song.json');
  const doc = validateComposition(await readFile(process.argv[2], 'utf8'));
  console.log(`通过：${doc.work.title} / ${doc.revision.label} · ${doc.score.bars.length} 小节 · ${doc.score.notes.length} 个音符 · ${doc.score.duration.toFixed(2)} 秒`);
  console.log('格式通过不代表音乐好听。请导入 Music Room 试听，再按反馈修改。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
