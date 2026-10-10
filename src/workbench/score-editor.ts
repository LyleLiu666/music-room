import { TRACKS, type TrackId } from '../music/score.ts';
import type {Song} from '../catalog.ts';
import type {Composition} from '../music/authoring/validate.mjs';
import {MusicEngine,defaultMix,cloneMix,type Mix} from '../audio.ts';
import {scoreToMidi} from '../midi.ts';
import {windowAt,beatAtSeconds,secondsAtBeat,notesInRange,pitchExtent,selectionFromBars} from './view.ts';
import {comparisonMapping} from './comparison.ts';
import type {Feedback} from '../service/projects/store.ts';
import type {RenderMix} from '../service/render/renderer.ts';
import type {BeatRange} from '../audio/playback.ts';
import styles from '../style.css?inline';
import panelStyles from './score-editor.css?inline';

/** A version tool, with only the sibling scores supplied by its owning sound. */
export function mountScoreEditor(host:HTMLElement, options:{
 documents:Composition[]; revisionId:string; soundTitle:string; labels:Record<string,string>; mixes:Record<string,RenderMix|undefined>;
 onPlay:()=>void; onVersion?:(id:string)=>void;
 feedback:Feedback[];
 onSaveMix:(revisionId:string,mix:Mix,requestId:string)=>Promise<void>;
 onFeedback:(revisionId:string,text:string,range?:{start:number;end:number})=>Promise<Feedback>;
}) {
 host.dataset.theme=document.documentElement.dataset.theme??'light';
 const root=host.attachShadow({mode:'open'});
 const SONGS:Song[]=options.documents.map(doc=>({
  id:doc.revision.id,workId:doc.work.id,title:options.soundTitle,edition:options.labels[doc.revision.id]??doc.revision.label,
  englishTitle:doc.revision.englishTitle,summary:doc.revision.summary??'',description:doc.revision.description??'',
  key:doc.revision.key??'未标注调性',color:'#a8cbc4',comparisonSections:doc.comparisonSections??{},
  compose:()=>doc.score,files:{wav:'',midi:'',score:''}
 }));
 const songById=(id:string)=>SONGS.find(s=>s.id===id);
 const versionsOf=(workId:string)=>SONGS.filter(s=>s.workId===workId);
 let selected=songById(options.revisionId)!;
 if(!selected)throw Error('当前版本没有可读取的乐谱');
 const scores=new Map(SONGS.map(s=>[s.id,s.compose()]));
 const scoreFor=(song:Song)=>scores.get(song.id)!;
 let score=scoreFor(selected),selection:BeatRange|undefined,selecting=false;
 let viewStart=0,viewSize=4,follow=true,disposed=false,frameId=0;
 type ListeningSnapshot={song:Song;position:number;selection?:BeatRange;loop?:BeatRange;viewStart:number;viewSize:number;follow:boolean;mix:Mix};
 let comparison:{a:Song;b:Song;before:ListeningSnapshot}|undefined;
 const mixFor=(id:string):Mix=>{const value=options.mixes[id];return value?{...defaultMix(),...value,levels:{...defaultMix().levels,...value.levels},muted:new Set(value.muted),solo:new Set(value.solo)}:defaultMix();};
 const engine=new MusicEngine(score);engine.mix=mixFor(selected.id);
 const feedbackDrafts=new Map<string,string>();
 let mixRequest:{fingerprint:string;id:string}|undefined;

 const escapeHTML=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const format=(seconds:number)=>`${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;
 root.innerHTML=`<style>${styles.replace(':root',':host')}\n${panelStyles}</style><div class="score-editor">
    <section class="work-header">
      <div><div class="eyebrow" id="edition">${escapeHTML(selected.edition)}</div><h1><span id="song-title" class="chinese-title">${escapeHTML(selected.title)}</span><span id="song-title-en">${escapeHTML(selected.englishTitle ?? '')}</span></h1><p class="description" id="song-description">${escapeHTML(selected.description)}</p></div>
      <div class="work-meta"><div><strong id="total-duration">${format(score.duration)}</strong><span>完整时长</span></div><div><strong id="tempo">${score.bpm}</strong><span>BPM · 4/4</span></div><div><strong id="track-count">${new Set(score.notes.map(n => n.track)).size}</strong><span>独立轨道</span></div></div>
    </section>
    <section class="transport" aria-label="播放控制">
      <button id="play" class="play-button">▶ <span>播放</span></button>
      <button id="restart" class="restart-button" aria-label="回到开头" title="回到开头">↺</button>
      <div class="clock"><strong id="current-time">00:00</strong><span id="clock-duration">/ ${format(score.duration)}</span></div>
      <span id="musical-position" class="musical-position">第 1 小节 · 第 1 拍</span>
      <input id="seek" class="seek-slider" type="range" min="0" max="${score.duration}" step="0.1" value="0" aria-label="播放位置" />
      <label class="master-control">音量 <input id="volume" type="range" min="0" max="1" step="0.01" value="0.85" aria-label="总音量" /></label>
      <div class="transport-right"><button id="export" class="export-button">↓ 导出试听 WAV</button><button id="midi" class="text-button">MIDI</button></div>
    </section>
    <div class="status-row"><span id="status" role="status" aria-live="polite"></span></div>
    <section class="overview-panel" aria-label="整曲概览"><div class="panel-title"><h2>整曲概览</h2><span id="score-info"></span></div><div class="sections"></div><div class="overview-wrap"><canvas id="overview" aria-label="整曲音符概览"></canvas><div id="overview-range"></div><div id="overview-playhead"></div></div></section>
    <div class="view-toolbar"><h2 id="view-title">当前片段</h2><button id="view-prev" aria-label="查看前一片段">←</button><button id="view-next" aria-label="查看后一片段">→</button><label>起始小节 <input id="view-start" type="number" min="1" value="1" aria-label="查看起始小节" /></label><label>查看范围 <select id="view-size" aria-label="查看范围"><option value="4">4 小节</option><option value="8">8 小节</option></select></label><button id="follow" aria-pressed="true">跟随播放</button></div>
    <div class="selection-toolbar" aria-label="片段选择"><button id="select-view">选择当前片段</button><button id="select-drag" aria-pressed="false">框选小节</button><label>从 <input id="selection-start" type="number" min="1" value="1" aria-label="选区起始小节" /></label><label>至 <input id="selection-end" type="number" min="1" value="4" aria-label="选区结束小节" /></label><span id="selection-label">未选择片段</span><button id="loop" aria-pressed="false" disabled>循环此片段</button><button id="clear-selection" disabled>清除选择</button></div>
    <section class="arrangement" aria-label="编曲时间线">
      <div class="panel-title"><h2>片段音符</h2><span class="hint">点击音符区域跳转</span></div>
      <div class="arrangement-scroll"><div class="arrangement-inner">
        <div class="chord-row"><div class="track-heading">和弦 / 小节</div><div id="chords"></div></div>
        <div class="ruler-row"><div class="track-heading muted">轨道</div><div class="ruler"></div></div>
        <div class="lanes">${TRACKS.map((track, i) => `
          <div class="lane" data-track="${track.id}" style="--track:${track.color}">
            <div class="track-info"><span class="track-index">${String(i + 1).padStart(2,'0')}</span><div class="track-name"><strong>${track.name}</strong><small>${track.description}</small></div></div>
            <div class="lane-canvas"><canvas data-lane="${track.id}" aria-label="${track.name}音符时间线"></canvas></div>
          </div>`).join('')}</div>
        <div id="playhead" class="playhead"><span></span></div>
      </div></div>
    </section>
    <section class="comparison-panel" aria-label="版本比较"><div class="comparison-heading"><h2>版本比较</h2><label>比较版本 <select id="compare-target" aria-label="比较版本"></select></label><button id="compare-start">开始 A/B 比较</button><div id="compare-session" hidden><button id="compare-a" aria-pressed="false">A</button><button id="compare-b" aria-pressed="false">B</button><button id="compare-exit">退出比较</button></div></div><p id="comparison-reason" role="status"></p><p id="comparison-note" hidden>比较使用两版原始混音，响度可能不同；退出后恢复试听设置。</p></section>
    <details id="mixer" class="mixer-panel"><summary>混音器 <span>静音、独奏、音量与旋律音色</span></summary><div class="mixer-tools"><label class="tone-control">旋律音色 <select id="lead" aria-label="旋律音色"><option value="piano">三角钢琴</option><option value="rhodes">电钢琴</option><option value="flute">长笛</option></select></label><button id="reset-mix">恢复本版混音</button><button id="save-mix">保存为新版本</button></div><div class="mixer-grid">${TRACKS.map(track => `<div class="mixer-channel" style="--track:${track.color}"><strong>${track.name}</strong><div class="track-buttons"><button class="mute" data-id="${track.id}" aria-label="静音${track.name}" aria-pressed="false">静音</button><button class="solo" data-id="${track.id}" aria-label="独奏${track.name}" aria-pressed="false">独奏</button></div><input class="track-level" data-id="${track.id}" type="range" min="0" max="1.6" step="0.01" value="1" aria-label="${track.name}音量" /></div>`).join('')}</div></details>
    <section class="listening-notes"><div><div class="eyebrow">NOW PLAYING</div><h3 id="section-name">${escapeHTML(score.sections[0].name)}</h3><p id="section-subtitle">${escapeHTML(score.sections[0].subtitle)}</p></div><div class="spectrum-wrap"><canvas id="spectrum" width="280" height="60" aria-label="实时声音频谱"></canvas><small>实时频谱</small></div><div class="note"><span>关于当前作品</span><p id="work-note">${escapeHTML(selected.description)}</p></div></section>
    <section class="score-feedback"><label for="score-feedback">对这个版本 / 所选小节的修改意见</label><textarea id="score-feedback" rows="3" maxlength="8000"></textarea><button id="save-score-feedback">保存听评，供 Agent 修改</button><div id="score-feedback-list"></div></section>
    <footer><span>音符与混音按当前版本试听，导出包含完整曲目。</span><a id="score-download" href="#" download>下载乐谱 JSON</a></footer>
</div>`;
const playButton = root.querySelector<HTMLButtonElement>('#play')!;
const status = root.querySelector<HTMLSpanElement>('#status')!;
const seek = root.querySelector<HTMLInputElement>('#seek')!;
const exportButton = root.querySelector<HTMLButtonElement>('#export')!;
let busy = false, dragging = false, rendering = false, selectionEpoch = 0;
const report = (message: string) => { if (!disposed) status.textContent = message; };
async function toggle() {
  if (busy) return;
  if (engine.playing) { engine.pause(); report('已暂停，可以调整配器或跳转段落。'); return; }
  const epoch = selectionEpoch;
  busy = true; playButton.disabled = true;
  report('正在加载音色…');
  try {
    await engine.prepare(fraction => { if (epoch === selectionEpoch) report(`加载音色 ${Math.round(fraction * 100)}%`); });
    if (epoch !== selectionEpoch) return;
    options.onPlay(); engine.play(); report('正在演奏。音轨调整即时生效，满意后可保存为新版本。');
  } catch (error) { if (epoch === selectionEpoch) report(`播放失败：${error instanceof Error ? error.message : error}。请重试。`); }
  finally { if (epoch === selectionEpoch) { busy = false; playButton.disabled = false; } }
}
playButton.addEventListener('click', toggle);
root.querySelector('#restart')!.addEventListener('click', () => navigate(engine.loop ? secondsAtBeat(engine.loop.startBeat, score.bpm) : 0));
seek.addEventListener('pointerdown', () => { dragging = true; });
seek.addEventListener('input', () => { navigate(Number(seek.value)); });
seek.addEventListener('change', () => { dragging = false; });
seek.addEventListener('pointerup', () => { dragging = false; });
root.querySelector<HTMLInputElement>('#volume')!.addEventListener('input', event => { engine.mix.volume = Number((event.target as HTMLInputElement).value); engine.updateMix(); });
root.querySelector<HTMLSelectElement>('#lead')!.addEventListener('change', event => {
  engine.mix.lead = (event.target as HTMLSelectElement).value as typeof engine.mix.lead;
  if (engine.playing) engine.play(engine.currentTime());
  report(`旋律音色已切换为${(event.target as HTMLSelectElement).selectedOptions[0].text}，导出会使用当前选择。`);
});
function updateMixerUI() {
  for (const track of TRACKS) {
    const mute = root.querySelector<HTMLButtonElement>(`.mute[data-id="${track.id}"]`)!;
    const solo = root.querySelector<HTMLButtonElement>(`.solo[data-id="${track.id}"]`)!;
    mute.setAttribute('aria-pressed', String(engine.mix.muted.has(track.id)));
    solo.setAttribute('aria-pressed', String(engine.mix.solo.has(track.id)));
    root.querySelector(`[data-track="${track.id}"]`)!.classList.toggle('inaudible', engine.mix.muted.has(track.id) || !!engine.mix.solo.size && !engine.mix.solo.has(track.id));
  }
  engine.updateMix();
}
for (const button of root.querySelectorAll<HTMLButtonElement>('.mute,.solo')) button.addEventListener('click', () => {
  const id = button.dataset.id as TrackId, set = button.classList.contains('mute') ? engine.mix.muted : engine.mix.solo;
  if (set.has(id)) set.delete(id); else set.add(id);
  updateMixerUI();
});
for (const input of root.querySelectorAll<HTMLInputElement>('.track-level')) input.addEventListener('input', () => { engine.mix.levels[input.dataset.id as TrackId] = Number(input.value); engine.updateMix(); });
root.querySelector('.sections')!.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-section]');
  if (button) { const section = score.sections[Number(button.dataset.section)]; navigate(secondsAtBeat(section.startBar * 4, score.bpm)); setView(section.startBar, false); }
});
root.addEventListener('keydown', e => {
  const event = e as KeyboardEvent;
  const target = event.target as HTMLElement;
  if (event.code === 'Space' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey
    && !target.closest('input,select,button,a,summary,textarea,[contenteditable]')) { event.preventDefault(); void toggle(); }
});
function download(bytes: ArrayBuffer | Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
root.querySelector('#midi')!.addEventListener('click', () => {
  download(scoreToMidi(score, selected.englishTitle ?? selected.id), `${selected.id}.mid`, 'audio/midi');
  report('已导出 MIDI。音源与混音保存在本项目中；MIDI 播放效果取决于接收软件的音源。');
});
exportButton.addEventListener('click', async () => {
  if (rendering) return;
  const exportedSong = selected, duration = score.duration;
  rendering = true; exportButton.disabled = true;
  try {
    report(`正在导出《${exportedSong.title}》${exportedSong.edition}，使用点击时的混音…`);
    const result = await engine.render(fraction => { exportButton.textContent = `导出 ${Math.round(fraction * 100)}%`; });
    download(result.wav, `${exportedSong.id}.wav`, 'audio/wav');
    report(`已导出《${exportedSong.title}》${exportedSong.edition}：${format(duration)} · 双声道 WAV。`);
  } catch (error) { report(`导出失败：${error instanceof Error ? error.message : error}`); }
  finally { rendering = false; exportButton.disabled = false; exportButton.textContent = '↓ 导出试听 WAV'; }
});

function navigate(seconds: number) {
  const loop = engine.loop; engine.seek(seconds);
  if (loop && !engine.loop) report('已退出片段循环。');
  updateSelectionUI(); updateComparisonUI();
}
function updateSelectionUI() {
  const loop = root.querySelector<HTMLButtonElement>('#loop')!;
  loop.disabled = !selection; loop.setAttribute('aria-pressed', String(!!engine.loop));
  loop.textContent = engine.loop ? '关闭循环' : '循环此片段';
  root.querySelector<HTMLButtonElement>('#clear-selection')!.disabled = !selection;
  root.querySelector('#selection-label')!.textContent = selection ? `第 ${selection.startBeat / 4 + 1}—${selection.endBeat / 4} 小节${engine.loop ? ' · 循环中' : ''}` : '未选择片段';
  for (const id of ['selection-start', 'selection-end']) root.querySelector<HTMLInputElement>(`#${id}`)!.max = String(score.bars.length);
  if (selection) {
    root.querySelector<HTMLInputElement>('#selection-start')!.value = String(selection.startBeat / 4 + 1);
    root.querySelector<HTMLInputElement>('#selection-end')!.value = String(selection.endBeat / 4);
  } else {
    const range = windowAt(score, viewStart, viewSize);
    root.querySelector<HTMLInputElement>('#selection-start')!.value = String(range.startBar + 1);
    root.querySelector<HTMLInputElement>('#selection-end')!.value = String(range.endBar);
  }
}
function selectRange(range?: BeatRange) {
  selection = range;
  if (engine.loop) engine.setLoop(range);
  updateSelectionUI(); updateComparisonUI(); drawLanes();
}
root.querySelector('#select-view')!.addEventListener('click', () => {
  const range = windowAt(score, viewStart, viewSize); selectRange({ startBeat: range.startBeat, endBeat: range.endBeat });
});
root.querySelector('#select-drag')!.addEventListener('click', event => {
  selecting = !selecting; (event.currentTarget as HTMLElement).setAttribute('aria-pressed', String(selecting));
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('[data-lane]')) canvas.style.touchAction = selecting ? 'none' : 'pan-y';
  report(selecting ? '在音符区域拖动，选择完整小节。' : '音符区域已恢复点击跳转。');
});
for (const id of ['selection-start', 'selection-end']) root.querySelector(`#${id}`)!.addEventListener('change', () => {
  try { selectRange(selectionFromBars(Number(root.querySelector<HTMLInputElement>('#selection-start')!.value), Number(root.querySelector<HTMLInputElement>('#selection-end')!.value), score.bars.length)); }
  catch (error) { updateSelectionUI(); report((error as Error).message); }
});
root.querySelector('#clear-selection')!.addEventListener('click', () => { selectRange(); report('已清除片段选择和循环。'); });
root.querySelector('#loop')!.addEventListener('click', () => {
  if (!selection) return;
  engine.setLoop(engine.loop ? undefined : selection); updateSelectionUI(); updateComparisonUI();
  if (engine.loop) setView(selection.startBeat / 4, false);
  report(engine.loop ? '已启用片段循环。播放将从选区开始，导出仍为完整曲目。' : '已关闭循环。');
});
function setView(bar: number, manual = true) {
  viewStart = windowAt(score, bar, viewSize).startBar;
  if (manual) follow = false;
  root.querySelector('#follow')!.setAttribute('aria-pressed', String(follow));
  if (!selection) updateSelectionUI();
  drawLanes();
}
function drawLanes() {
  const range = windowAt(score, viewStart, viewSize), span = range.endBeat - range.startBeat;
  root.querySelector('#view-title')!.textContent = `第 ${range.startBar + 1}—${range.endBar} 小节`;
  root.querySelector<HTMLInputElement>('#view-start')!.value = String(range.startBar + 1);
  root.querySelector<HTMLInputElement>('#view-start')!.max = String(score.bars.length);
  root.querySelector<HTMLButtonElement>('#view-prev')!.disabled = viewStart === 0;
  root.querySelector<HTMLButtonElement>('#view-next')!.disabled = range.endBar === score.bars.length;
  root.querySelector('#chords')!.innerHTML = score.bars.slice(range.startBar, range.endBar).map((bar, i) => `<div><small>${range.startBar + i + 1}</small><strong>${escapeHTML(bar.chord)}</strong></div>`).join('');
  root.querySelector('.ruler')!.innerHTML = Array.from({ length: range.endBar - range.startBar + 1 }, (_, i) => `<span>${range.startBar + i + 1}</span>`).join('');
  for (const track of TRACKS) {
    const canvas = root.querySelector<HTMLCanvasElement>(`[data-lane="${track.id}"]`)!;
    const rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(rect.width * ratio); canvas.height = Math.ceil(rect.height * ratio);
    const context = canvas.getContext('2d')!; context.scale(ratio, ratio);
    const all = score.notes.filter(n => n.track === track.id), { low, high } = pitchExtent(all);
    if (selection) {
      const start = Math.max(range.startBeat, selection.startBeat), end = Math.min(range.endBeat, selection.endBeat);
      if (end > start) { context.fillStyle = '#cce7a418'; context.fillRect((start - range.startBeat) / span * rect.width, 0, (end - start) / span * rect.width, rect.height); }
    }
    context.strokeStyle = '#ffffff0b';
    for (let beat = 0; beat <= span; beat++) {
      context.lineWidth = beat % 4 === 0 ? 1.3 : .5;
      context.beginPath(); context.moveTo(beat / span * rect.width, 0); context.lineTo(beat / span * rect.width, rect.height); context.stroke();
    }
    for (const note of notesInRange(all, range.startBeat, range.endBeat)) {
      const start = Math.max(range.startBeat, note.beat), end = Math.min(range.endBeat, note.beat + note.duration);
      const x = (start - range.startBeat) / span * rect.width;
      const y = rect.height - 12 - (note.pitch - low) / Math.max(1, high - low) * (rect.height - 25);
      context.globalAlpha = .3 + note.velocity * .65; context.fillStyle = track.color;
      context.fillRect(x, y, Math.max(1, (end - start) / span * rect.width - 1), 5);
    }
    context.globalAlpha = 1;
  }
  drawOverview();
}
function drawOverview() {
  const canvas = root.querySelector<HTMLCanvasElement>('#overview')!, rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(rect.width * ratio); canvas.height = Math.ceil(rect.height * ratio);
  const ctx = canvas.getContext('2d')!; ctx.scale(ratio, ratio);
  const beats = score.bars.length * 4;
  for (const [index, track] of TRACKS.entries()) {
    ctx.fillStyle = track.color; ctx.globalAlpha = .6;
    for (const note of score.notes.filter(n => n.track === track.id)) ctx.fillRect(note.beat / beats * rect.width, index / TRACKS.length * rect.height, Math.max(1, note.duration / beats * rect.width), 3);
  }
  const range = windowAt(score, viewStart, viewSize), marker = root.querySelector<HTMLElement>('#overview-range')!;
  marker.style.left = `${range.startBar / score.bars.length * 100}%`;
  marker.style.width = `${(range.endBar - range.startBar) / score.bars.length * 100}%`;
}
for (const canvas of root.querySelectorAll<HTMLCanvasElement>('[data-lane]')) canvas.addEventListener('click', event => {
  if (selecting) return;
  const rect = canvas.getBoundingClientRect(), range = windowAt(score, viewStart, viewSize);
  navigate(secondsAtBeat(range.startBeat + (event.clientX - rect.left) / rect.width * (range.endBeat - range.startBeat), score.bpm));
});
for (const canvas of root.querySelectorAll<HTMLCanvasElement>('[data-lane]')) {
  let firstBar: number | undefined;
  const barAt = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect(), range = windowAt(score, viewStart, viewSize);
    return Math.max(range.startBar, Math.min(range.endBar - 1, range.startBar + Math.floor((event.clientX - rect.left) / rect.width * (range.endBar - range.startBar)))) + 1;
  };
  canvas.addEventListener('pointerdown', event => {
    if (!selecting) return;
    firstBar = barAt(event); canvas.setPointerCapture(event.pointerId); event.preventDefault();
  });
  canvas.addEventListener('pointerup', event => {
    if (firstBar === undefined) return;
    selectRange(selectionFromBars(firstBar, barAt(event), score.bars.length)); firstBar = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { firstBar = undefined; });
}
root.querySelector('#overview')!.addEventListener('click', event => {
  const canvas = event.currentTarget as HTMLCanvasElement, rect = canvas.getBoundingClientRect();
  const bar = Math.min(score.bars.length - 1, Math.floor(((event as MouseEvent).clientX - rect.left) / rect.width * score.bars.length));
  setView(bar); navigate(secondsAtBeat(bar * 4, score.bpm));
});
root.querySelector('#view-prev')!.addEventListener('click', () => setView(viewStart - viewSize));
root.querySelector('#view-next')!.addEventListener('click', () => setView(viewStart + viewSize));
root.querySelector<HTMLInputElement>('#view-start')!.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (!input.checkValidity() || !Number.isInteger(Number(input.value))) { input.value = String(viewStart + 1); report(`请输入 1—${score.bars.length} 之间的小节号。`); return; }
  setView(Number(input.value) - 1);
});
root.querySelector<HTMLSelectElement>('#view-size')!.addEventListener('change', event => { viewSize = Number((event.target as HTMLSelectElement).value); drawLanes(); });
root.querySelector('#follow')!.addEventListener('click', () => {
  follow = !follow; root.querySelector('#follow')!.setAttribute('aria-pressed', String(follow));
  if (follow) setView(Math.floor(beatAtSeconds(engine.currentTime(), score.bpm) / (4 * viewSize)) * viewSize, false);
});
root.querySelector('#reset-mix')!.addEventListener('click', () => {
  const volume = engine.mix.volume; engine.mix = mixFor(selected.id); engine.mix.volume = volume;
  root.querySelector<HTMLSelectElement>('#lead')!.value = engine.mix.lead;
  for (const input of root.querySelectorAll<HTMLInputElement>('.track-level')) input.value = String(engine.mix.levels[input.dataset.id as TrackId]);
  updateMixerUI(); if (engine.playing) engine.play(engine.currentTime()); report('已恢复本版默认混音，总音量保留。');
});
const observer = new ResizeObserver(drawLanes); observer.observe(root.querySelector('.arrangement-inner')!);
const spectrum = root.querySelector<HTMLCanvasElement>('#spectrum')!, spectrumContext = spectrum.getContext('2d')!;
const bins = new Uint8Array(128);
function frame() {
  if (disposed) return;
  updateComparisonUI();
  const seconds = Math.max(0, engine.currentTime());
  const range = windowAt(score, viewStart, viewSize), beat = beatAtSeconds(seconds, score.bpm);
  if (follow && engine.playing && (beat < range.startBeat || beat >= range.endBeat) && seconds < score.duration) setView(Math.floor(beat / (4 * viewSize)) * viewSize, false);
  if (!dragging) seek.value = String(seconds);
  root.querySelector('#current-time')!.textContent = format(seconds);
  root.querySelector('#musical-position')!.textContent = musicalPosition(beat);
  playButton.innerHTML = engine.playing ? 'Ⅱ <span>暂停</span>' : '▶ <span>播放</span>';
  const sectionIndex = Math.max(0, score.sections.findLastIndex(s => seconds >= s.startBar * 4 * 60 / score.bpm));
  const section = score.sections[sectionIndex];
  root.querySelector('#section-name')!.textContent = section.name;
  root.querySelector('#section-subtitle')!.textContent = section.subtitle;
  root.querySelectorAll('.section').forEach((node, i) => node.classList.toggle('active', i === sectionIndex));
  const inner = root.querySelector<HTMLElement>('.arrangement-inner')!;
  const lane = root.querySelector<HTMLElement>('.lane-canvas')!;
  const current = windowAt(score, viewStart, viewSize), head = root.querySelector<HTMLElement>('#playhead')!;
  head.style.display = beat >= current.startBeat && beat <= current.endBeat ? 'block' : 'none';
  head.style.left = `${lane.offsetLeft + (beat - current.startBeat) / (current.endBeat - current.startBeat) * lane.offsetWidth}px`;
  root.querySelector<HTMLElement>('#overview-playhead')!.style.left = `${seconds / score.duration * 100}%`;
  root.querySelector<HTMLElement>('#playhead')!.style.height = `${inner.offsetHeight - 56}px`;
  spectrumContext.clearRect(0, 0, spectrum.width, spectrum.height);
  bins.fill(0); engine.graph?.analyser.getByteFrequencyData(bins);
  for (let i = 0; i < 46; i++) {
    const height = Math.max(2, bins[i * 2] / 255 * 52);
    spectrumContext.fillStyle = engine.playing ? '#cce7a4' : '#414a39';
    spectrumContext.fillRect(i * 6, 58 - height, 3, height);
  }
  frameId = requestAnimationFrame(frame);
}
function comparisonBeat() {
  const beat = beatAtSeconds(engine.currentTime(), score.bpm);
  return selection && (beat < selection.startBeat || beat >= selection.endBeat) ? selection.startBeat : beat;
}
function musicalPosition(beat: number) {
  const position = Math.max(0, Math.min(score.bars.length * 4 - .00001, beat));
  return `第 ${Math.floor(position / 4) + 1} 小节 · 第 ${Math.floor(position % 4) + 1} 拍`;
}
function refreshComparisonChoices() {
  const select = root.querySelector<HTMLSelectElement>('#compare-target')!;
  const a = comparison?.a ?? selected, prior = comparison?.b.id ?? select.value;
  select.innerHTML = versionsOf(a.workId).filter(song => song.id !== a.id).map(song => `<option value="${song.id}">${escapeHTML(song.edition)}</option>`).join('');
  if ([...select.options].some(option => option.value === prior)) select.value = prior;
  updateComparisonUI();
}
function updateComparisonUI() {
  const targetSelect = root.querySelector<HTMLSelectElement>('#compare-target')!;
  targetSelect.disabled = !!comparison;
  root.querySelector<HTMLButtonElement>('#compare-start')!.hidden = !!comparison;
  root.querySelector<HTMLElement>('#compare-session')!.hidden = !comparison;
  root.querySelector<HTMLElement>('#comparison-note')!.hidden = !comparison;
  for (const control of root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('.mute,.solo,.track-level,#lead,#reset-mix')) control.disabled = !!comparison;
  if (comparison) {
    const other = selected.id === comparison.a.id ? comparison.b : comparison.a;
    const map = comparisonMapping(selected, other, score, scoreFor(other), beatAtSeconds(engine.currentTime(), score.bpm), selection);
    for (const side of ['a','b'] as const) {
      const button = root.querySelector<HTMLButtonElement>(`#compare-${side}`)!;
      button.textContent = `${side.toUpperCase()} · ${comparison[side].edition}`;
      button.setAttribute('aria-pressed', String(selected.id === comparison[side].id));
      button.disabled = selected.id !== comparison[side].id && !map.ok;
    }
    root.querySelector('#comparison-reason')!.textContent = map.ok ? `当前：${selected.edition} · ${map.name} · ${musicalPosition(beatAtSeconds(engine.currentTime(), score.bpm))}` : map.reason;
    if (!map.ok && engine.playing) { engine.pause(); report(map.reason); }
  } else {
    const target = songById(targetSelect.value);
    const map = target && comparisonMapping(selected, target, score, scoreFor(target), comparisonBeat(), selection);
    root.querySelector<HTMLButtonElement>('#compare-start')!.disabled = !map?.ok;
    root.querySelector('#comparison-reason')!.textContent = !target ? '当前歌曲只有一个版本。' : map?.ok ? `可比较：${map.name}，按段内小节和拍对应。` : map!.reason;
  }
}
function snapshot(): ListeningSnapshot {
  return { song: selected, position: engine.currentTime(), selection: selection && { ...selection }, loop: engine.loop && { ...engine.loop }, viewStart, viewSize, follow, mix: cloneMix(engine.mix) };
}
function restorePlaybackView(snapshot: Omit<ListeningSnapshot, 'song' | 'mix'>) {
  if (snapshot.loop) engine.setLoop(snapshot.loop);
  engine.seek(snapshot.position); selection = snapshot.selection && { ...snapshot.selection };
  viewStart = snapshot.viewStart; viewSize = snapshot.viewSize; follow = snapshot.follow;
  root.querySelector<HTMLSelectElement>('#view-size')!.value = String(viewSize);
  root.querySelector('#follow')!.setAttribute('aria-pressed', String(follow));
  updateSelectionUI(); drawLanes();
}
root.querySelector('#compare-target')!.addEventListener('change', updateComparisonUI);
root.querySelector('#compare-start')!.addEventListener('click', () => {
  const target = songById(root.querySelector<HTMLSelectElement>('#compare-target')!.value);
  if (!target) return;
  const beat = comparisonBeat(), map = comparisonMapping(selected, target, score, scoreFor(target), beat, selection);
  if (!map.ok) { report(map.reason); return; }
  const before = snapshot(), wasPlaying = engine.playing;
  comparison = { a: selected, b: target, before };
  showSong(selected, 'none');
  restorePlaybackView({ ...before, position: secondsAtBeat(beat, score.bpm) });
  if (wasPlaying) { options.onPlay(); engine.play(); }
  updateComparisonUI(); report('已进入版本比较，使用两版原始混音；退出后恢复试听设置。');
});
for (const side of ['a','b'] as const) root.querySelector(`#compare-${side}`)!.addEventListener('click', () => {
  if (!comparison || selected.id === comparison[side].id) return;
  const target = comparison[side], map = comparisonMapping(selected, target, score, scoreFor(target), beatAtSeconds(engine.currentTime(), score.bpm), selection);
  if (!map.ok) { report(map.reason); return; }
  const wasPlaying = engine.playing, looping = !!engine.loop, following = follow;
  showSong(target, 'none');
  restorePlaybackView({ position: secondsAtBeat(map.beat, score.bpm), selection: map.range, loop: looping ? map.range : undefined, viewStart: Math.floor(map.beat / (viewSize * 4)) * viewSize, viewSize, follow: following });
  if (wasPlaying) { options.onPlay(); engine.play(); }
  updateComparisonUI(); report(`正在比较 ${side.toUpperCase()} · ${target.edition}，对应${map.name}。`);
});
root.querySelector('#compare-exit')!.addEventListener('click', () => {
  if (!comparison) return;
  const before = comparison.before, volume = engine.mix.volume; comparison = undefined;
  showSong(before.song, 'none'); engine.mix = cloneMix(before.mix); engine.mix.volume = volume;
  restorePlaybackView(before);
  root.querySelector<HTMLSelectElement>('#lead')!.value = engine.mix.lead;
  for (const input of root.querySelectorAll<HTMLInputElement>('.track-level')) input.value = String(engine.mix.levels[input.dataset.id as TrackId]);
  updateMixerUI(); updateComparisonUI(); report('已退出比较，恢复进入前的版本、位置与试听设置，保持暂停。');
});
function showSong(song: Song, _navigation: 'none' = 'none') {
  selectionEpoch++;
  const feedback=root.querySelector<HTMLTextAreaElement>('#score-feedback')!;feedbackDrafts.set(selected.id,feedback.value);feedback.value=feedbackDrafts.get(song.id)??'';
  selected = song; score = scoreFor(song);
  options.onVersion?.(song.id);renderFeedback();
  const volume = engine.mix.volume;
  engine.setScore(score); engine.mix=mixFor(song.id); engine.mix.volume = volume;
  viewStart = 0; follow = true; selection = undefined; selecting = false;
  root.querySelector('#select-drag')!.setAttribute('aria-pressed', 'false');
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('[data-lane]')) canvas.style.touchAction = 'pan-y';
  root.querySelector<HTMLInputElement>('#selection-start')!.value = '1';
  root.querySelector<HTMLInputElement>('#selection-end')!.value = String(Math.min(4, score.bars.length));
  updateSelectionUI();
  root.querySelector('#follow')!.setAttribute('aria-pressed', 'true');
  busy = false; dragging = false; playButton.disabled = false;
  seek.max = String(score.duration); seek.value = '0';
  root.querySelector('#song-title')!.textContent = song.title;
  root.querySelector('#song-title-en')!.textContent = song.englishTitle ?? '';
  root.querySelector('#edition')!.textContent = song.edition;
  root.querySelector('#song-description')!.textContent = song.description;
  root.querySelector('#work-note')!.textContent = song.description;
  root.querySelector('#total-duration')!.textContent = format(score.duration);
  root.querySelector('#clock-duration')!.textContent = `/ ${format(score.duration)}`;
  root.querySelector('#tempo')!.textContent = String(score.bpm);
  root.querySelector('#track-count')!.textContent = String(new Set(score.notes.map(n => n.track)).size);
  root.querySelector('#score-info')!.textContent = `${score.bars.length} 小节 · ${song.key}`;
  root.querySelector<HTMLAnchorElement>('#score-download')!.href = `./${song.files.score}`;
  root.querySelector<HTMLSelectElement>('#lead')!.value = engine.mix.lead;
  root.querySelector<HTMLInputElement>('#volume')!.value = String(volume);
  for (const input of root.querySelectorAll<HTMLInputElement>('.track-level')) input.value = String(engine.mix.levels[input.dataset.id as TrackId]);
  root.querySelector('.sections')!.innerHTML = score.sections.map((s, i) => `<button class="section" data-section="${i}" style="flex:${s.bars};--section:${s.color}"><span>${escapeHTML(s.name)}</span><small>${format(s.startBar * 4 * 60 / score.bpm)}</small></button>`).join('');
  root.querySelector('.ruler')!.innerHTML = Array.from({length:10}, (_, i) => `<span>${format(i * score.duration / 9)}</span>`).join('');
  updateMixerUI(); drawLanes(); refreshComparisonChoices();
  report(`已选择《${song.title}》${song.edition}。点击播放开始试听。`);
}

 function renderFeedback(){root.querySelector('#score-feedback-list')!.innerHTML=options.feedback.filter(f=>f.revisionId===selected.id).slice(-8).map(f=>`<p>${f.range?`${format(f.range.start)}–${format(f.range.end)}：`:''}${escapeHTML(f.text)}</p>`).join('');}
 function currentDocument(){return options.documents.find(d=>d.revision.id===selected.id)!;}
 root.querySelector('#score-download')!.addEventListener('click',event=>{
  event.preventDefault();download(new TextEncoder().encode(JSON.stringify(currentDocument(),null,2)),`${selected.id}.json`,'application/json');
 });
 root.querySelector<HTMLButtonElement>('#save-score-feedback')!.onclick=async()=>{
  const button=root.querySelector<HTMLButtonElement>('#save-score-feedback')!,input=root.querySelector<HTMLTextAreaElement>('#score-feedback')!;
  const text=input.value,revisionId=selected.id;if(!text.trim()){report('请先填写修改意见。');return;}
  const range=selection?{start:secondsAtBeat(selection.startBeat,score.bpm),end:secondsAtBeat(selection.endBeat,score.bpm)}:undefined;
  button.disabled=true;
  try{const saved=await options.onFeedback(revisionId,text,range);options.feedback.push(saved);if(!disposed)renderFeedback();if(selected.id===revisionId&&input.value===text){input.value='';feedbackDrafts.delete(revisionId);}else if(feedbackDrafts.get(revisionId)===text)feedbackDrafts.delete(revisionId);report('听评已保存，Agent 可从这个版本继续修改。');}
  catch(e){report(`保存失败：${(e as Error).message}`);}finally{button.disabled=false;}
 };
 root.querySelector<HTMLButtonElement>('#save-mix')!.onclick=async()=>{
  const button=root.querySelector<HTMLButtonElement>('#save-mix')!,mix=cloneMix(engine.mix),id=selected.id;
  const fingerprint=JSON.stringify({id,...mix,muted:[...mix.muted],solo:[...mix.solo]});
  if(mixRequest?.fingerprint!==fingerprint)mixRequest={fingerprint,id:`mix-${crypto.randomUUID()}`};
  button.disabled=true;
  try{await options.onSaveMix(id,mix,mixRequest.id);report('已保存为新版本，后台正在合成。');}
  catch(e){report(`保存失败：${(e as Error).message}`);}finally{button.disabled=false;}
 };
 showSong(selected);frame();
 return {dispose(){disposed=true;selectionEpoch++;engine.pause();observer.disconnect();cancelAnimationFrame(frameId);void engine.context?.close();root.replaceChildren();}};
}
