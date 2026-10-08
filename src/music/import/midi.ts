import MidiPackage from '@tonejs/midi';
import { validateComposition, MAX_FILE_BYTES, type Composition } from '../authoring/validate.mjs';
import type { TrackId, Note } from '../score.ts';
const { Midi } = MidiPackage;
const drums: Record<number, TrackId> = {35:'kick',36:'kick',37:'snare',38:'snare',39:'snare',40:'snare',42:'hat',44:'hat',46:'hat',49:'cymbal',51:'cymbal',52:'cymbal',55:'cymbal',57:'cymbal',59:'cymbal'};

// This is an explicit General MIDI protocol mapping, not inference from labels.
export function midiToComposition(bytes: Uint8Array, filename: string, id: string): Composition {
  if(bytes.byteLength > MAX_FILE_BYTES) throw new Error('MIDI 文件超过 4 MiB。');
  if(bytes.length < 14 || String.fromCharCode(...bytes.slice(0,4)) !== 'MThd') throw new Error('MIDI 文件头无效。');
  // SMPTE timing is outside the quarter-note-based score contract.
  if (bytes[8] !== 0 || bytes[9] > 1) throw new Error('暂只支持 MIDI 格式 0/1，不支持独立序列格式 2。');
  if(bytes[12] & 0x80) throw new Error('MIDI 的 SMPTE 时间格式暂不支持，请使用按拍计时的文件。');
  let midi: InstanceType<typeof Midi>;
  try { midi = new Midi(bytes); } catch { throw new Error('MIDI 文件无法解析，请检查文件是否完整。'); }
  const tempos = midi.header.tempos;
  const bpm = tempos[0]?.bpm ?? 120;
  if(tempos.some(t => t.bpm !== bpm) || (tempos[0]?.ticks ?? 0) > 0) throw new Error('暂不支持曲内变速的 MIDI，请导出固定速度版本。');
  if(midi.header.timeSignatures.some(t => t.timeSignature[0] !== 4 || t.timeSignature[1] !== 4)) throw new Error('暂只支持 4/4 MIDI。');
  const notes: Note[] = []; let pianoCount = 0;
  for(const track of midi.tracks) {
    if(!track.notes.length) continue;
    let kind: TrackId | undefined;
    const program = track.instrument.number;
    if(track.channel !== 9) {
      if(program === 0) kind = pianoCount++ === 0 ? 'melody' : 'piano';
      else if(program === 4) kind = 'rhodes';
      else if(program >= 48 && program <= 51) kind = 'strings';
      else if(program === 73) kind = 'flute';
      else if(program >= 32 && program <= 39) kind = 'bass';
      else if(program === 107) kind = 'pluck';
      else throw new Error(`MIDI 音色 GM ${program + 1} 暂不支持；请改用创作说明里的乐器或 JSON 音轨。`);
    }
    for(const note of track.notes) {
      const drum = track.channel === 9 ? drums[note.midi] : undefined;
      if(track.channel === 9 && !drum) throw new Error(`MIDI 鼓音 ${note.midi} 暂不支持，请查看创作说明里的鼓音范围。`);
      notes.push({track:drum ?? kind!,pitch:note.midi,beat:note.ticks / midi.header.ppq,duration:note.durationTicks / midi.header.ppq,velocity:note.velocity});
    }
  }
  const length = notes.reduce((max,n)=>Math.max(max,n.beat+n.duration),0);
  const bars = Math.ceil(length / 4 - 1e-8);
  const title = filename.replace(/\.(mid|midi)$/i,'').trim().slice(0,120) || 'MIDI 作品';
  return validateComposition(JSON.stringify({format:'music-room-score',version:1,work:{id,title},revision:{id:`${id}-v1`,label:'MIDI 导入版',summary:'本机 MIDI',description:'使用工作台音色重新演奏。MIDI 中的音色细节、效果器和混音不随文件还原。'},score:{title,bpm,duration:bars*4*60/bpm,sections:[{name:'全曲',subtitle:'MIDI 导入，可用 JSON 补充段落和版本信息。',startBar:0,bars,color:'#a8cbc4'}],bars:Array.from({length:Math.min(bars,513)},()=>({chord:'',section:0})),notes}}));
}
