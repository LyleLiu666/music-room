import { mkdir, writeFile } from 'node:fs/promises';
import { SONGS } from '../src/catalog.ts';
import { scoreToMidi } from '../src/midi.ts';
for (const song of SONGS) {
  const score = song.compose();
  const root = new URL(`../public/exports/${song.id}/`, import.meta.url);
  await mkdir(root, { recursive: true });
  await writeFile(new URL('song.mid', root), scoreToMidi(score, song.englishTitle ?? song.id));
  await writeFile(new URL('score.json', root), JSON.stringify(score, null, 2));
  process.stdout.write(`${song.id}: ${score.notes.length} events, ${score.bars.length} bars, ${score.duration} seconds\n`);
}
