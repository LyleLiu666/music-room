import { backend, ServicePanel, type ServerSnapshot } from './service.ts';
import {YuE2Panel} from './yue2.ts';
import { TRACKS, type TrackId } from '../music/score.ts';
import { SONGS as BUILTIN_SONGS, WORKS as BUILTIN_WORKS, versionsOf as workVersions, type Song } from '../catalog.ts';
import { ImportedLibrary } from '../music/import/library.ts';
import { validateComposition, MAX_FILE_BYTES, type Composition } from '../music/authoring/validate.mjs';
import { midiToComposition } from '../music/import/midi.ts';
import { buildAuthoringPrompt, type AuthoringStage } from '../music/authoring/prompt.ts';
import { MusicEngine, defaultMix, cloneMix, type Mix } from '../audio.ts';
import { scoreToMidi } from '../midi.ts';

import { windowAt, beatAtSeconds, secondsAtBeat, notesInRange, pitchExtent, selectionFromBars } from './view.ts';

import { comparisonMapping } from './comparison.ts';
import type { BeatRange } from '../audio/playback.ts';

const imported = new ImportedLibrary(backend ? {getItem:()=>null,setItem:()=>{}} : { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, backend?[]:BUILTIN_WORKS, backend?[]:BUILTIN_SONGS);
let serverSnapshot: ServerSnapshot | undefined;
let serviceWarning = '';
if (backend) {
  try {serverSnapshot=await backend.call('library',{});imported.documents=serverSnapshot.documents;}
  catch(error) {serviceWarning=`本地服务连接失败：${(error as Error).message}`;}
}
let servicePanel: ServicePanel | undefined;
let yue2Panel:YuE2Panel|undefined;
const librarySongs = () => serverSnapshot ? imported.songs.map(song=>({...song,color:BUILTIN_SONGS.find(b=>b.id===song.id)?.color??song.color})) : [...BUILTIN_SONGS,...imported.songs];
const libraryWorks = () => serverSnapshot ? serverSnapshot.projects.map(p=>({id:p.id,title:p.title,defaultVersionId:p.defaultRevisionId??''})) : [...BUILTIN_WORKS,...imported.works];
let SONGS = librarySongs(), WORKS = libraryWorks();
const songById = (id: string) => SONGS.find(song => song.id === id);
const versionsOf = (workId: string) => workVersions(workId, SONGS);
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
let selection: BeatRange | undefined, selecting = false;
let viewStart = 0, viewSize = 4, follow = true;
const defaultSong = () => WORKS.map(work=>songById(work.defaultVersionId)).find(song=>song!==undefined)??SONGS[0];
let selected = songById(location.hash.slice(1)) ?? defaultSong();
const scores = new Map(SONGS.map(song => [song.id, song.compose()]));
const scoreFor = (song: Song) => scores.get(song.id)!;
let score = scoreFor(selected);
type ListeningSnapshot = { song: Song; position: number; selection?: BeatRange; loop?: BeatRange; viewStart: number; viewSize: number; follow: boolean; mix: Mix };
let comparison: { a: Song; b: Song; before: ListeningSnapshot } | undefined;
const engine = new MusicEngine(score);
const format = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="topbar"><a class="brand" href="./"><span class="brand-icon">♫</span> MUSIC ROOM</a><button id="library-toggle" aria-expanded="false" aria-controls="library">作品库</button><span class="top-label" id="catalog-position"></span><a class="speech-entry" href="./">返回创作空间 ↗</a><span class="local-badge">本地演奏</span></header>
  <div class="workspace">
    <aside id="library" class="library" aria-label="作品库"><div class="library-heading"><h2>作品库</h2><span id="library-count"></span></div><div id="library-works"></div>
      <div class="authoring-tools"><div id="import-drop" class="import-drop"><button id="import-score">＋ 导入 MIDI / JSON</button><span>或把文件拖到这里</span></div><input id="import-file" type="file" accept=".json,.mid,.midi" hidden /><p>文件留在本机。导入后请下载备份。</p><button id="remove-import" hidden>移除本机版本</button><details><summary>让 agent 创作新曲子</summary><p>下载创作包，把它和下面的要求交给 agent。拿到乐谱后回到这里导入试听。</p><a href="./music-authoring-kit.zip" download>下载独立创作包 ZIP</a><a href="./authoring-kit/example.json" download>下载八小节示例 JSON</a><a href="./authoring-kit/README.md" download>下载创作说明</a><label for="authoring-stage">创作步骤</label><select id="authoring-stage"><option value="four">先写 4 小节</option><option value="eight" selected>先写 8 小节</option><option value="expand">扩写当前版本</option></select><button id="authoring-current">下载当前版本，交给 agent</button><label for="authoring-prompt">示例提示词（可修改后复制）</label><textarea id="authoring-prompt" rows="10"></textarea><button id="copy-prompt">复制提示词</button><p>代码由 agent 生成并运行，页面把生成的 MIDI / JSON 乐谱演奏成声音。</p></details></div></aside>
  <main>
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
    <details id="mixer" class="mixer-panel"><summary>混音器 <span>静音、独奏、音量与旋律音色</span></summary><div class="mixer-tools"><label class="tone-control">旋律音色 <select id="lead" aria-label="旋律音色"><option value="piano">三角钢琴</option><option value="rhodes">电钢琴</option><option value="flute">长笛</option></select></label><button id="reset-mix">恢复本版默认混音</button></div><div class="mixer-grid">${TRACKS.map(track => `<div class="mixer-channel" style="--track:${track.color}"><strong>${track.name}</strong><div class="track-buttons"><button class="mute" data-id="${track.id}" aria-label="静音${track.name}" aria-pressed="false">静音</button><button class="solo" data-id="${track.id}" aria-label="独奏${track.name}" aria-pressed="false">独奏</button></div><input class="track-level" data-id="${track.id}" type="range" min="0" max="1.6" step="0.01" value="1" aria-label="${track.name}音量" /></div>`).join('')}</div></details>
    <section class="listening-notes"><div><div class="eyebrow">NOW PLAYING</div><h3 id="section-name">${escapeHTML(score.sections[0].name)}</h3><p id="section-subtitle">${escapeHTML(score.sections[0].subtitle)}</p></div><div class="spectrum-wrap"><canvas id="spectrum" width="280" height="60" aria-label="实时声音频谱"></canvas><small>实时频谱</small></div><div class="note"><span>关于当前作品</span><p id="work-note">${escapeHTML(selected.description)}</p></div></section>
    <footer><span>演奏与导出均在本机完成 · 无后台 · 无付费服务</span><a href="./credits.html">音色来源与开源许可 ↗</a><a id="finished-audio" href="./${selected.files.wav}" download>下载原始成品</a><a id="score-download" href="./${selected.files.score}" download>下载乐谱 JSON</a></footer>
  </main></div>`;

const playButton = document.querySelector<HTMLButtonElement>('#play')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const seek = document.querySelector<HTMLInputElement>('#seek')!;
const exportButton = document.querySelector<HTMLButtonElement>('#export')!;
let busy = false, dragging = false, rendering = false, selectionEpoch = 0;
const report = (message: string) => { status.textContent = message; };
async function toggle() {
  if (busy) return;
  if (engine.playing) { engine.pause(); report('已暂停，可以调整配器或跳转段落。'); return; }
  servicePanel?.pauseAudio();yue2Panel?.pauseAudio();
  const epoch = selectionEpoch;
  busy = true; playButton.disabled = true;
  report('正在加载音色…');
  try {
    await engine.prepare(fraction => { if (epoch === selectionEpoch) report(`加载音色 ${Math.round(fraction * 100)}%`); });
    if (epoch !== selectionEpoch) return;
    engine.play(); report('正在演奏。M 静音、S 独奏；音量调整即时生效。');
  } catch (error) { if (epoch === selectionEpoch) report(`播放失败：${error instanceof Error ? error.message : error}。请重试。`); }
  finally { if (epoch === selectionEpoch) { busy = false; playButton.disabled = false; } }
}
playButton.addEventListener('click', toggle);
document.querySelector('#restart')!.addEventListener('click', () => navigate(engine.loop ? secondsAtBeat(engine.loop.startBeat, score.bpm) : 0));
seek.addEventListener('pointerdown', () => { dragging = true; });
seek.addEventListener('input', () => { navigate(Number(seek.value)); });
seek.addEventListener('change', () => { dragging = false; });
seek.addEventListener('pointerup', () => { dragging = false; });
document.querySelector<HTMLInputElement>('#volume')!.addEventListener('input', event => { engine.mix.volume = Number((event.target as HTMLInputElement).value); engine.updateMix(); });
document.querySelector<HTMLSelectElement>('#lead')!.addEventListener('change', event => {
  engine.mix.lead = (event.target as HTMLSelectElement).value as typeof engine.mix.lead;
  if (engine.playing) engine.play(engine.currentTime());
  report(`旋律音色已切换为${(event.target as HTMLSelectElement).selectedOptions[0].text}，导出会使用当前选择。`);
});
function updateMixerUI() {
  for (const track of TRACKS) {
    const mute = document.querySelector<HTMLButtonElement>(`.mute[data-id="${track.id}"]`)!;
    const solo = document.querySelector<HTMLButtonElement>(`.solo[data-id="${track.id}"]`)!;
    mute.setAttribute('aria-pressed', String(engine.mix.muted.has(track.id)));
    solo.setAttribute('aria-pressed', String(engine.mix.solo.has(track.id)));
    document.querySelector(`[data-track="${track.id}"]`)!.classList.toggle('inaudible', engine.mix.muted.has(track.id) || !!engine.mix.solo.size && !engine.mix.solo.has(track.id));
  }
  engine.updateMix();
}
for (const button of document.querySelectorAll<HTMLButtonElement>('.mute,.solo')) button.addEventListener('click', () => {
  const id = button.dataset.id as TrackId, set = button.classList.contains('mute') ? engine.mix.muted : engine.mix.solo;
  if (set.has(id)) set.delete(id); else set.add(id);
  updateMixerUI();
});
for (const input of document.querySelectorAll<HTMLInputElement>('.track-level')) input.addEventListener('input', () => { engine.mix.levels[input.dataset.id as TrackId] = Number(input.value); engine.updateMix(); });
document.querySelector('.sections')!.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-section]');
  if (button) { const section = score.sections[Number(button.dataset.section)]; navigate(secondsAtBeat(section.startBar * 4, score.bpm)); setView(section.startBar, false); }
});
document.addEventListener('keydown', event => {
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
document.querySelector('#midi')!.addEventListener('click', () => {
  download(scoreToMidi(score, selected.englishTitle ?? selected.id), `${selected.id}.mid`, 'audio/midi');
  report('已导出 MIDI。音源与混音保存在本项目中；MIDI 播放效果取决于接收软件的音源。');
});
exportButton.addEventListener('click', async () => {
  if (rendering) return;
  if (backend) {
    rendering=true;exportButton.disabled=true;
    try {const job=await backend.render(currentDocument(),cloneMix(engine.mix));report(`已提交后台渲染 ${job.id}。任务区可查看、试听和下载；关闭网页后仍会继续。`);await servicePanel?.refresh();}
    catch(error) {report(`提交失败：${(error as Error).message}`);}
    finally {rendering=false;exportButton.disabled=false;}return;
  }
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
  const loop = document.querySelector<HTMLButtonElement>('#loop')!;
  loop.disabled = !selection; loop.setAttribute('aria-pressed', String(!!engine.loop));
  loop.textContent = engine.loop ? '关闭循环' : '循环此片段';
  document.querySelector<HTMLButtonElement>('#clear-selection')!.disabled = !selection;
  document.querySelector('#selection-label')!.textContent = selection ? `第 ${selection.startBeat / 4 + 1}—${selection.endBeat / 4} 小节${engine.loop ? ' · 循环中' : ''}` : '未选择片段';
  for (const id of ['selection-start', 'selection-end']) document.querySelector<HTMLInputElement>(`#${id}`)!.max = String(score.bars.length);
  if (selection) {
    document.querySelector<HTMLInputElement>('#selection-start')!.value = String(selection.startBeat / 4 + 1);
    document.querySelector<HTMLInputElement>('#selection-end')!.value = String(selection.endBeat / 4);
  } else {
    const range = windowAt(score, viewStart, viewSize);
    document.querySelector<HTMLInputElement>('#selection-start')!.value = String(range.startBar + 1);
    document.querySelector<HTMLInputElement>('#selection-end')!.value = String(range.endBar);
  }
}
function selectRange(range?: BeatRange) {
  selection = range;
  if (engine.loop) engine.setLoop(range);
  updateSelectionUI(); updateComparisonUI(); drawLanes();
}
document.querySelector('#select-view')!.addEventListener('click', () => {
  const range = windowAt(score, viewStart, viewSize); selectRange({ startBeat: range.startBeat, endBeat: range.endBeat });
});
document.querySelector('#select-drag')!.addEventListener('click', event => {
  selecting = !selecting; (event.currentTarget as HTMLElement).setAttribute('aria-pressed', String(selecting));
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-lane]')) canvas.style.touchAction = selecting ? 'none' : 'pan-y';
  report(selecting ? '在音符区域拖动，选择完整小节。' : '音符区域已恢复点击跳转。');
});
for (const id of ['selection-start', 'selection-end']) document.querySelector(`#${id}`)!.addEventListener('change', () => {
  try { selectRange(selectionFromBars(Number(document.querySelector<HTMLInputElement>('#selection-start')!.value), Number(document.querySelector<HTMLInputElement>('#selection-end')!.value), score.bars.length)); }
  catch (error) { updateSelectionUI(); report((error as Error).message); }
});
document.querySelector('#clear-selection')!.addEventListener('click', () => { selectRange(); report('已清除片段选择和循环。'); });
document.querySelector('#loop')!.addEventListener('click', () => {
  if (!selection) return;
  engine.setLoop(engine.loop ? undefined : selection); updateSelectionUI(); updateComparisonUI();
  if (engine.loop) setView(selection.startBeat / 4, false);
  report(engine.loop ? '已启用片段循环。播放将从选区开始，导出仍为完整曲目。' : '已关闭循环。');
});
function setView(bar: number, manual = true) {
  viewStart = windowAt(score, bar, viewSize).startBar;
  if (manual) follow = false;
  document.querySelector('#follow')!.setAttribute('aria-pressed', String(follow));
  if (!selection) updateSelectionUI();
  drawLanes();
}
function drawLanes() {
  const range = windowAt(score, viewStart, viewSize), span = range.endBeat - range.startBeat;
  document.querySelector('#view-title')!.textContent = `第 ${range.startBar + 1}—${range.endBar} 小节`;
  document.querySelector<HTMLInputElement>('#view-start')!.value = String(range.startBar + 1);
  document.querySelector<HTMLInputElement>('#view-start')!.max = String(score.bars.length);
  document.querySelector<HTMLButtonElement>('#view-prev')!.disabled = viewStart === 0;
  document.querySelector<HTMLButtonElement>('#view-next')!.disabled = range.endBar === score.bars.length;
  document.querySelector('#chords')!.innerHTML = score.bars.slice(range.startBar, range.endBar).map((bar, i) => `<div><small>${range.startBar + i + 1}</small><strong>${escapeHTML(bar.chord)}</strong></div>`).join('');
  document.querySelector('.ruler')!.innerHTML = Array.from({ length: range.endBar - range.startBar + 1 }, (_, i) => `<span>${range.startBar + i + 1}</span>`).join('');
  for (const track of TRACKS) {
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-lane="${track.id}"]`)!;
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
  const canvas = document.querySelector<HTMLCanvasElement>('#overview')!, rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(rect.width * ratio); canvas.height = Math.ceil(rect.height * ratio);
  const ctx = canvas.getContext('2d')!; ctx.scale(ratio, ratio);
  const beats = score.bars.length * 4;
  for (const [index, track] of TRACKS.entries()) {
    ctx.fillStyle = track.color; ctx.globalAlpha = .6;
    for (const note of score.notes.filter(n => n.track === track.id)) ctx.fillRect(note.beat / beats * rect.width, index / TRACKS.length * rect.height, Math.max(1, note.duration / beats * rect.width), 3);
  }
  const range = windowAt(score, viewStart, viewSize), marker = document.querySelector<HTMLElement>('#overview-range')!;
  marker.style.left = `${range.startBar / score.bars.length * 100}%`;
  marker.style.width = `${(range.endBar - range.startBar) / score.bars.length * 100}%`;
}
for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-lane]')) canvas.addEventListener('click', event => {
  if (selecting) return;
  const rect = canvas.getBoundingClientRect(), range = windowAt(score, viewStart, viewSize);
  navigate(secondsAtBeat(range.startBeat + (event.clientX - rect.left) / rect.width * (range.endBeat - range.startBeat), score.bpm));
});
for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-lane]')) {
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
document.querySelector('#overview')!.addEventListener('click', event => {
  const canvas = event.currentTarget as HTMLCanvasElement, rect = canvas.getBoundingClientRect();
  const bar = Math.min(score.bars.length - 1, Math.floor(((event as MouseEvent).clientX - rect.left) / rect.width * score.bars.length));
  setView(bar); navigate(secondsAtBeat(bar * 4, score.bpm));
});
document.querySelector('#view-prev')!.addEventListener('click', () => setView(viewStart - viewSize));
document.querySelector('#view-next')!.addEventListener('click', () => setView(viewStart + viewSize));
document.querySelector<HTMLInputElement>('#view-start')!.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (!input.checkValidity() || !Number.isInteger(Number(input.value))) { input.value = String(viewStart + 1); report(`请输入 1—${score.bars.length} 之间的小节号。`); return; }
  setView(Number(input.value) - 1);
});
document.querySelector<HTMLSelectElement>('#view-size')!.addEventListener('change', event => { viewSize = Number((event.target as HTMLSelectElement).value); drawLanes(); });
document.querySelector('#follow')!.addEventListener('click', () => {
  follow = !follow; document.querySelector('#follow')!.setAttribute('aria-pressed', String(follow));
  if (follow) setView(Math.floor(beatAtSeconds(engine.currentTime(), score.bpm) / (4 * viewSize)) * viewSize, false);
});
document.querySelector('#library-toggle')!.addEventListener('click', event => {
  const button = event.currentTarget as HTMLButtonElement, open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open)); document.querySelector('#library')!.classList.toggle('mobile-open', open);
});
document.querySelector('#reset-mix')!.addEventListener('click', () => {
  const volume = engine.mix.volume; engine.mix = defaultMix(); engine.mix.volume = volume;
  document.querySelector<HTMLSelectElement>('#lead')!.value = 'piano';
  for (const input of document.querySelectorAll<HTMLInputElement>('.track-level')) input.value = '1';
  updateMixerUI(); if (engine.playing) engine.play(engine.currentTime()); report('已恢复本版默认混音，总音量保留。');
});
new ResizeObserver(drawLanes).observe(document.querySelector('.arrangement-inner')!);
const spectrum = document.querySelector<HTMLCanvasElement>('#spectrum')!, spectrumContext = spectrum.getContext('2d')!;
const bins = new Uint8Array(128);
function frame() {
  updateComparisonUI();
  const seconds = Math.max(0, engine.currentTime());
  const range = windowAt(score, viewStart, viewSize), beat = beatAtSeconds(seconds, score.bpm);
  if (follow && engine.playing && (beat < range.startBeat || beat >= range.endBeat) && seconds < score.duration) setView(Math.floor(beat / (4 * viewSize)) * viewSize, false);
  if (!dragging) seek.value = String(seconds);
  document.querySelector('#current-time')!.textContent = format(seconds);
  document.querySelector('#musical-position')!.textContent = musicalPosition(beat);
  playButton.innerHTML = engine.playing ? 'Ⅱ <span>暂停</span>' : '▶ <span>播放</span>';
  const sectionIndex = Math.max(0, score.sections.findLastIndex(s => seconds >= s.startBar * 4 * 60 / score.bpm));
  const section = score.sections[sectionIndex];
  document.querySelector('#section-name')!.textContent = section.name;
  document.querySelector('#section-subtitle')!.textContent = section.subtitle;
  document.querySelectorAll('.section').forEach((node, i) => node.classList.toggle('active', i === sectionIndex));
  const inner = document.querySelector<HTMLElement>('.arrangement-inner')!;
  const lane = document.querySelector<HTMLElement>('.lane-canvas')!;
  const current = windowAt(score, viewStart, viewSize), head = document.querySelector<HTMLElement>('#playhead')!;
  head.style.display = beat >= current.startBeat && beat <= current.endBeat ? 'block' : 'none';
  head.style.left = `${lane.offsetLeft + (beat - current.startBeat) / (current.endBeat - current.startBeat) * lane.offsetWidth}px`;
  document.querySelector<HTMLElement>('#overview-playhead')!.style.left = `${seconds / score.duration * 100}%`;
  document.querySelector<HTMLElement>('#playhead')!.style.height = `${inner.offsetHeight - 56}px`;
  spectrumContext.clearRect(0, 0, spectrum.width, spectrum.height);
  bins.fill(0); engine.graph?.analyser.getByteFrequencyData(bins);
  for (let i = 0; i < 46; i++) {
    const height = Math.max(2, bins[i * 2] / 255 * 52);
    spectrumContext.fillStyle = engine.playing ? '#cce7a4' : '#414a39';
    spectrumContext.fillRect(i * 6, 58 - height, 3, height);
  }
  requestAnimationFrame(frame);
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
  const select = document.querySelector<HTMLSelectElement>('#compare-target')!;
  const a = comparison?.a ?? selected, prior = comparison?.b.id ?? select.value;
  select.innerHTML = versionsOf(a.workId).filter(song => song.id !== a.id).map(song => `<option value="${song.id}">${escapeHTML(song.edition)}</option>`).join('');
  if ([...select.options].some(option => option.value === prior)) select.value = prior;
  updateComparisonUI();
}
function updateComparisonUI() {
  const targetSelect = document.querySelector<HTMLSelectElement>('#compare-target')!;
  targetSelect.disabled = !!comparison;
  document.querySelector<HTMLButtonElement>('#compare-start')!.hidden = !!comparison;
  document.querySelector<HTMLElement>('#compare-session')!.hidden = !comparison;
  document.querySelector<HTMLElement>('#comparison-note')!.hidden = !comparison;
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('.mute,.solo,.track-level,#lead,#reset-mix')) control.disabled = !!comparison;
  if (comparison) {
    const other = selected.id === comparison.a.id ? comparison.b : comparison.a;
    const map = comparisonMapping(selected, other, score, scoreFor(other), beatAtSeconds(engine.currentTime(), score.bpm), selection);
    for (const side of ['a','b'] as const) {
      const button = document.querySelector<HTMLButtonElement>(`#compare-${side}`)!;
      button.textContent = `${side.toUpperCase()} · ${comparison[side].edition}`;
      button.setAttribute('aria-pressed', String(selected.id === comparison[side].id));
      button.disabled = selected.id !== comparison[side].id && !map.ok;
    }
    document.querySelector('#comparison-reason')!.textContent = map.ok ? `当前：${selected.edition} · ${map.name} · ${musicalPosition(beatAtSeconds(engine.currentTime(), score.bpm))}` : map.reason;
    if (!map.ok && engine.playing) { engine.pause(); report(map.reason); }
  } else {
    const target = songById(targetSelect.value);
    const map = target && comparisonMapping(selected, target, score, scoreFor(target), comparisonBeat(), selection);
    document.querySelector<HTMLButtonElement>('#compare-start')!.disabled = !map?.ok;
    document.querySelector('#comparison-reason')!.textContent = !target ? '当前歌曲只有一个版本。' : map?.ok ? `可比较：${map.name}，按段内小节和拍对应。` : map!.reason;
  }
}
function snapshot(): ListeningSnapshot {
  return { song: selected, position: engine.currentTime(), selection: selection && { ...selection }, loop: engine.loop && { ...engine.loop }, viewStart, viewSize, follow, mix: cloneMix(engine.mix) };
}
function restorePlaybackView(snapshot: Omit<ListeningSnapshot, 'song' | 'mix'>) {
  if (snapshot.loop) engine.setLoop(snapshot.loop);
  engine.seek(snapshot.position); selection = snapshot.selection && { ...snapshot.selection };
  viewStart = snapshot.viewStart; viewSize = snapshot.viewSize; follow = snapshot.follow;
  document.querySelector<HTMLSelectElement>('#view-size')!.value = String(viewSize);
  document.querySelector('#follow')!.setAttribute('aria-pressed', String(follow));
  updateSelectionUI(); drawLanes();
}
document.querySelector('#compare-target')!.addEventListener('change', updateComparisonUI);
document.querySelector('#compare-start')!.addEventListener('click', () => {
  const target = songById(document.querySelector<HTMLSelectElement>('#compare-target')!.value);
  if (!target) return;
  const beat = comparisonBeat(), map = comparisonMapping(selected, target, score, scoreFor(target), beat, selection);
  if (!map.ok) { report(map.reason); return; }
  const before = snapshot(), wasPlaying = engine.playing;
  comparison = { a: selected, b: target, before };
  showSong(selected, 'none');
  restorePlaybackView({ ...before, position: secondsAtBeat(beat, score.bpm) });
  if (wasPlaying) engine.play();
  updateComparisonUI(); report('已进入版本比较，使用两版原始混音；退出后恢复试听设置。');
});
for (const side of ['a','b'] as const) document.querySelector(`#compare-${side}`)!.addEventListener('click', () => {
  if (!comparison || selected.id === comparison[side].id) return;
  const target = comparison[side], map = comparisonMapping(selected, target, score, scoreFor(target), beatAtSeconds(engine.currentTime(), score.bpm), selection);
  if (!map.ok) { report(map.reason); return; }
  const wasPlaying = engine.playing, looping = !!engine.loop, following = follow;
  showSong(target, 'none');
  restorePlaybackView({ position: secondsAtBeat(map.beat, score.bpm), selection: map.range, loop: looping ? map.range : undefined, viewStart: Math.floor(map.beat / (viewSize * 4)) * viewSize, viewSize, follow: following });
  if (wasPlaying) engine.play();
  updateComparisonUI(); report(`正在比较 ${side.toUpperCase()} · ${target.edition}，对应${map.name}。`);
});
document.querySelector('#compare-exit')!.addEventListener('click', () => {
  if (!comparison) return;
  const before = comparison.before, volume = engine.mix.volume; comparison = undefined;
  showSong(before.song, 'none'); engine.mix = cloneMix(before.mix); engine.mix.volume = volume;
  restorePlaybackView(before);
  document.querySelector<HTMLSelectElement>('#lead')!.value = engine.mix.lead;
  for (const input of document.querySelectorAll<HTMLInputElement>('.track-level')) input.value = String(engine.mix.levels[input.dataset.id as TrackId]);
  updateMixerUI(); updateComparisonUI(); report('已退出比较，恢复进入前的版本、位置与试听设置，保持暂停。');
});
function showSong(song: Song, navigation: 'push' | 'replace' | 'none' = 'push') {
  servicePanel?.pauseAudio();yue2Panel?.pauseAudio();
  selectionEpoch++;
  selected = song; score = scoreFor(song);
  const volume = engine.mix.volume;
  engine.setScore(score); engine.mix.volume = volume;
  viewStart = 0; follow = true; selection = undefined; selecting = false;
  document.querySelector('#select-drag')!.setAttribute('aria-pressed', 'false');
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-lane]')) canvas.style.touchAction = 'pan-y';
  document.querySelector<HTMLInputElement>('#selection-start')!.value = '1';
  document.querySelector<HTMLInputElement>('#selection-end')!.value = String(Math.min(4, score.bars.length));
  updateSelectionUI();
  document.querySelector('#follow')!.setAttribute('aria-pressed', 'true');
  busy = false; dragging = false; playButton.disabled = false;
  seek.max = String(score.duration); seek.value = '0';
  document.querySelector('#song-title')!.textContent = song.title;
  document.querySelector('#song-title-en')!.textContent = song.englishTitle ?? '';
  document.querySelector('#edition')!.textContent = song.edition;
  document.querySelector('#catalog-position')!.textContent = `原创器乐 / No. ${String(SONGS.indexOf(song) + 1).padStart(3, '0')}`;
  document.querySelector('#song-description')!.textContent = song.description;
  document.querySelector('#work-note')!.textContent = song.description;
  document.querySelector('#total-duration')!.textContent = format(score.duration);
  document.querySelector('#clock-duration')!.textContent = `/ ${format(score.duration)}`;
  document.querySelector('#tempo')!.textContent = String(score.bpm);
  document.querySelector('#track-count')!.textContent = String(new Set(score.notes.map(n => n.track)).size);
  document.querySelector('#score-info')!.textContent = `${score.bars.length} 小节 · ${song.key}`;
  document.querySelector<HTMLAnchorElement>('#score-download')!.href = `./${song.files.score}`;
  const finished = document.querySelector<HTMLAnchorElement>('#finished-audio')!;
  finished.href = `./${song.files.wav}`; finished.hidden = !!backend || !song.files.wav;
  document.querySelector<HTMLButtonElement>('#remove-import')!.hidden = !!backend || !imported.documents.some(d => d.revision.id === song.id);
  document.querySelector<HTMLSelectElement>('#lead')!.value = 'piano';
  document.querySelector<HTMLInputElement>('#volume')!.value = String(volume);
  for (const input of document.querySelectorAll<HTMLInputElement>('.track-level')) input.value = '1';
  document.querySelector('.sections')!.innerHTML = score.sections.map((s, i) => `<button class="section" data-section="${i}" style="flex:${s.bars};--section:${s.color}"><span>${escapeHTML(s.name)}</span><small>${format(s.startBar * 4 * 60 / score.bpm)}</small></button>`).join('');
  document.querySelector('.ruler')!.innerHTML = Array.from({length:10}, (_, i) => `<span>${format(i * score.duration / 9)}</span>`).join('');
  for (const card of document.querySelectorAll<HTMLButtonElement>('[data-song]')) {
    const active = card.dataset.song === song.id;
    card.setAttribute('aria-pressed', String(active));
    card.querySelector('.song-check')!.textContent = active ? '当前版本' : '切换试听';
    if (active) card.closest('details')!.open = true;
  }
  updateMixerUI(); drawLanes(); refreshComparisonChoices();
  void servicePanel?.selectionChanged();
  if (authoringStage.value === 'expand') refreshAuthoringPrompt();
  document.title = `${song.title} · ${song.edition} · Music Room`;
  if (navigation !== 'none') history[navigation === 'push' ? 'pushState' : 'replaceState'](null, '', `#${song.id}`);
  report(`已选择《${song.title}》${song.edition}。点击播放开始试听。`);
  Object.assign(window, { musicRoom: { engine, score, songId: song.id, view: () => ({ startBar: viewStart, size: viewSize, follow }), selection: () => selection, comparison: () => comparison && ({ a: comparison.a.id, b: comparison.b.id }) } });
}
function renderLibrary() {
  document.querySelector('#library-count')!.textContent = `${WORKS.length} 首歌曲 · ${SONGS.length} 个版本`;
  document.querySelector('#library-works')!.innerHTML = WORKS.map(work => `<details class="work-group" ${work.id === selected.workId ? 'open' : ''}><summary>${escapeHTML(work.title)}<small>${versionsOf(work.id).length} 个版本</small></summary><div class="song-list">${versionsOf(work.id).map(song => `<button class="song-card" data-song="${song.id}" aria-pressed="${song.id === selected.id}" aria-label="选择${escapeHTML(song.title)} ${escapeHTML(song.edition)}" style="--song:${song.color}"><strong>${escapeHTML(song.edition)}</strong><span>${escapeHTML(song.summary)}</span><span class="song-check">${song.id === selected.id ? '当前版本' : '切换试听'}</span></button>`).join('')}</div></details>`).join('');
}
function refreshImportedLibrary() {
  SONGS = librarySongs(); WORKS = libraryWorks();
  const ids = new Set(SONGS.map(s => s.id));
  for (const id of scores.keys()) if (!ids.has(id)) scores.delete(id);
  for (const song of SONGS) if (!scores.has(song.id)) scores.set(song.id, song.compose());
  renderLibrary();
}
document.querySelector('#library-works')!.addEventListener('click', event => {
  const card = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-song]');
  const song = card && songById(card.dataset.song!);
  if (song && (song.id !== selected.id || comparison)) { comparison = undefined; showSong(song); }
});
const importFile = document.querySelector<HTMLInputElement>('#import-file')!;
const importButton = document.querySelector<HTMLButtonElement>('#import-score')!;
document.querySelector('#import-score')!.addEventListener('click', () => importFile.click());
async function importCompositionFile(file: File) {
  if (importButton.disabled) { report('正在导入，请等当前文件完成后再导入。'); return; }
  importButton.disabled = true;
  try {
    if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 4 MiB，请减少音符后重试。');
    const isMidi = /\.(mid|midi)$/i.test(file.name);
    if (!isMidi && !/\.json$/i.test(file.name)) throw new Error('请选择 .mid、.midi 或 .json 文件。');
    const doc = isMidi ? midiToComposition(new Uint8Array(await file.arrayBuffer()), file.name, `midi-${crypto.randomUUID()}`) : validateComposition(await file.text());
    if (backend) {
      const parent=document.querySelector<HTMLInputElement>('#service-parent')?.checked;
      if(parent && selected.workId!==doc.work.id)throw new Error('所选父版本不属于导入文件的项目');
      await backend.call('import_revision',{compositionJson:JSON.stringify(doc),parentId:parent?selected.id:undefined});
      applyServerSnapshot(await backend.call('library',{}));
    } else {imported.add(doc); refreshImportedLibrary();}
    comparison = undefined; showSong(songById(doc.revision.id)!);
    report(backend ? '版本已保存在本地项目目录。可直接试听，或提交后台渲染；原件与后续版本会保留。' : isMidi ? 'MIDI 已保存在当前浏览器。按工作台音色演奏，踏板、弯音、表情及原混音暂不还原。请试听并下载备份。' : '乐谱已校验并保存在当前浏览器。点击播放试听；请下载 JSON / MIDI 备份。');
  } catch(error) { report(`导入失败：${error instanceof Error ? error.message : error}`); }
  finally { importButton.disabled = false; importFile.value = ''; }
}
importFile.addEventListener('change', () => { const file = importFile.files?.[0]; if (file) void importCompositionFile(file); });
const dropZone = document.querySelector<HTMLElement>('#import-drop')!;
let dragDepth = 0;
const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
dropZone.addEventListener('dragenter', event => {
  if (!hasFiles(event)) return; event.preventDefault(); dragDepth++; dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragover', event => {
  if (!hasFiles(event)) return; event.preventDefault(); event.dataTransfer!.dropEffect = 'copy';
});
dropZone.addEventListener('dragleave', event => {
  if (!hasFiles(event)) return; event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; dropZone.classList.remove('drag-over'); }
});
dropZone.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; dropZone.classList.remove('drag-over');
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  if (files.length !== 1) { report('请一次拖入一个 MIDI 或 JSON 文件。'); return; }
  void importCompositionFile(files[0]);
});
// A file dropped outside the target must not navigate away and lose listening state.
window.addEventListener('dragover', event => { if (hasFiles(event)) event.preventDefault(); });
window.addEventListener('drop', event => { if (hasFiles(event)) event.preventDefault(); });
document.querySelector('#remove-import')!.addEventListener('click', () => {
  try {
    const old = selected; imported.remove(old.id); comparison = undefined; refreshImportedLibrary();
    const next = versionsOf(old.workId)[0] ?? defaultSong(); showSong(next, 'replace');
    report('已移除本机版本。电脑上的源文件保留，可重新导入。');
  } catch(error) { report((error as Error).message); }
});
const promptInput = document.querySelector<HTMLTextAreaElement>('#authoring-prompt')!;
const authoringStage = document.querySelector<HTMLSelectElement>('#authoring-stage')!;
function refreshAuthoringPrompt() { promptInput.value = buildAuthoringPrompt(authoringStage.value as AuthoringStage, currentDocument()); }
authoringStage.addEventListener('change', refreshAuthoringPrompt);
refreshAuthoringPrompt();
document.querySelector('#authoring-current')!.addEventListener('click', () => {
  download(new TextEncoder().encode(JSON.stringify(currentDocument(), null, 2)), `${selected.id}.json`, 'application/json');
  report('已下载当前版本。把这个 JSON 和扩写提示词一起交给 agent，保留旧版再创作新版本。');
});
document.querySelector('#copy-prompt')!.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(promptInput.value); report('提示词已复制。把独立创作包一并交给 agent。'); }
  catch { promptInput.focus(); promptInput.select(); report('浏览器无法自动复制，已选中提示词，请手动复制。'); }
});
function currentDocument(): Composition {
  const saved = imported.documents.find(d => d.revision.id === selected.id);
  return saved ?? {format:'music-room-score',version:1,work:{id:selected.workId,title:selected.title},revision:{id:selected.id,label:selected.edition,englishTitle:selected.englishTitle,summary:selected.summary,description:selected.description,key:selected.key},comparisonSections:selected.comparisonSections,score};
}
document.querySelector('#score-download')!.addEventListener('click', event => {
  event.preventDefault();
  download(new TextEncoder().encode(JSON.stringify(currentDocument(), null, 2)), `${selected.id}.json`, 'application/json');
  report('已下载完整创作 JSON（含歌曲、版本、段落和音符）。可交给 agent 修改，新增版本请更换 revision.id。');
});
renderLibrary();
const handleNavigation = () => {
  const wasComparing = !!comparison; comparison = undefined;
  const song = songById(location.hash.slice(1));
  if (song && (song.id !== selected.id || wasComparing)) showSong(song, 'none');
  else if (!song) {
    if(backend&&!serverSnapshot){showSong(defaultSong(),'none');report('正在等待本地作品库，保留当前版本链接。');}
    else {showSong(defaultSong(),'replace');report('未找到该版本，已打开默认作品。');}
  }
};
window.addEventListener('hashchange', handleNavigation);
window.addEventListener('popstate', handleNavigation);
const invalidAddress = !!location.hash && !songById(location.hash.slice(1));
showSong(selected, backend&&!serverSnapshot?'none':'replace');
if (serviceWarning) report(serviceWarning);
else if (imported.warning) report(imported.warning);
else if (invalidAddress) report('未找到该版本，已打开默认作品。');
frame();

function applyServerSnapshot(snapshot:ServerSnapshot) {
  const previousScore=score,wasWaiting=backend&&!serverSnapshot;
  serverSnapshot=snapshot;imported.documents=snapshot.documents;refreshImportedLibrary();
  // A recovered connection may replace an offline catalog fallback with its stored original.
  for(const doc of snapshot.documents)scores.set(doc.revision.id,doc.score);
  if(wasWaiting) {
    // Read the current address: later user navigation supersedes the original request.
    const requested=songById(location.hash.slice(1)),missing=!!location.hash&&!requested;
    comparison=undefined;showSong(requested??defaultSong(),'replace');
    if(missing)report('未找到该版本，已打开默认作品。');
    return;
  }
  const current=songById(selected.id);
  if(current&&JSON.stringify(previousScore)!==JSON.stringify(scoreFor(current))){comparison=undefined;showSong(current,'none');}
}
if(backend) {
  const badge=document.querySelector('.local-badge')!;badge.textContent='本地服务';
  document.querySelector('footer > span')!.textContent='本机项目与后台渲染 · 内置 MCP · 无付费服务';
  document.querySelector('#import-drop')!.parentElement!.querySelector('p')!.textContent='版本由后台写入项目目录，清理浏览器不会丢失。';
  servicePanel=new ServicePanel(backend,currentDocument,()=>selection?{start:selection.startBeat*60/score.bpm,end:selection.endBeat*60/score.bpm}:undefined,applyServerSnapshot,report,()=>{selectionEpoch++;busy=false;playButton.disabled=false;engine.pause();yue2Panel?.pauseAudio();playButton.textContent='▶ 播放';});
  yue2Panel=new YuE2Panel(backend,()=>{selectionEpoch++;busy=false;playButton.disabled=false;engine.pause();servicePanel?.pauseAudio();playButton.textContent='▶ 播放';});
}
