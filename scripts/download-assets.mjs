import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../public/samples/', import.meta.url);
await mkdir(root, { recursive: true });
let existing;
try { existing = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8')); } catch { /* first download */ }
const revision = existing?.vscoRevision ?? '440300901dfe9275fd84e0b7763af1f8443ae62e';
const jobs = [];
for (const name of ['C2','Ds2','Fs2','A2','C3','Ds3','Fs3','A3','C4','Ds4','Fs4','A4','C5','Ds5','Fs5','A5','C6']) {
  jobs.push({ file: `piano-${name}.mp3`, source: `https://tonejs.github.io/audio/salamander/${name}.mp3`, license: 'CC-BY-3.0', author: 'Alexander Holm' });
}
for (const name of ['C4','E4','G4','D5']) {
  const path = `Strings/Violin Section/susVib/VlnEns_susVib_${name}_v1.wav`;
  jobs.push({ file: `strings-${name}.wav`, source: `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`, license: 'CC0-1.0', author: 'Sam Gossner & Simon Dalzell; Elan Hickler' });
}
for (const name of ['C4','E4','A4','C5','E5','A5']) {
  const path = `Woodwinds/Flute/susvib/LDFlute_susvib_${name}_v1_1.wav`;
  jobs.push({ file: `flute-${name}.wav`, source: `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/${revision}/${path}`, license: 'CC0-1.0', author: 'Sam Gossner & Simon Dalzell; Elan Hickler' });
}
// A small bounded pool avoids flooding the sample hosts.
const manifest = [];
for (let offset = 0; offset < jobs.length; offset += 4) {
  await Promise.all(jobs.slice(offset, offset + 4).map(async job => {
    let bytes;
    try {
      const saved = await readFile(new URL(job.file, root));
      const expected = existing?.assets.find(asset => asset.file === job.file);
      if (expected && createHash('sha256').update(saved).digest('hex') === expected.sha256) bytes = saved;
    } catch { /* download missing files */ }
    if (!bytes) {
    const response = await fetch(job.source);
    if (!response.ok) throw new Error(`${response.status}: ${job.source}`);
    bytes = Buffer.from(await response.arrayBuffer());
    }
    await writeFile(new URL(job.file, root), bytes);
    manifest.push({ ...job, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    process.stdout.write(`${job.file}: ${bytes.length}\n`);
  }));
}
manifest.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(new URL('manifest.json', root), JSON.stringify({ vscoRevision: revision, assets: manifest }, null, 2));
