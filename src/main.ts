import './style.css';
import { TRACKS, type TrackId } from './music/score.ts';
import { SONGS, songById, type Song } from './catalog.ts';
import { MusicEngine } from './audio.ts';
import { scoreToMidi } from './midi.ts';

let selected = songById(location.hash.slice(1)) ?? SONGS[0];
let score = selected.compose();
const engine = new MusicEngine(score);
const format = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="topbar"><a class="brand" href="./"><span class="brand-icon">♫</span> MUSIC ROOM</a><span class="top-label" id="catalog-position"></span><span class="local-badge"><i></i> 浏览器本地演奏</span></header>
  <main>
    <section class="library" aria-label="作品库"><div class="library-heading"><h2>作品库</h2><span>${SONGS.length} 个作品版本 · 每个版本独立保留</span></div><div class="song-list">${SONGS.map((song, i) => `<button class="song-card" data-song="${song.id}" aria-pressed="${song.id === selected.id}" aria-label="选择${song.title} ${song.edition}" style="--song:${song.color}"><span class="song-number">${String(i + 1).padStart(2,'0')}</span><span class="song-card-title"><strong>${song.title}<small>${song.edition}</small></strong><span>${song.summary}</span></span><span class="song-check">${song.id === selected.id ? '当前作品' : '切换试听'}</span></button>`).join('')}</div></section>
    <section class="work-header">
      <div><div class="eyebrow" id="edition">${selected.edition}</div><h1><span id="song-title" class="chinese-title">${selected.title}</span><span id="song-title-en">${selected.englishTitle ?? ''}</span></h1><p class="description" id="song-description">${selected.description}</p></div>
      <div class="work-meta"><div><strong id="total-duration">${format(score.duration)}</strong><span>完整时长</span></div><div><strong id="tempo">${score.bpm}</strong><span>BPM · 4/4</span></div><div><strong id="track-count">${new Set(score.notes.map(n => n.track)).size}</strong><span>独立轨道</span></div></div>
    </section>
    <section class="transport" aria-label="播放控制">
      <button id="play" class="play-button">▶ <span>播放</span></button>
      <button id="restart" class="restart-button" aria-label="回到开头" title="回到开头">↺</button>
      <div class="clock"><strong id="current-time">00:00</strong><span id="clock-duration">/ ${format(score.duration)}</span></div>
      <input id="seek" class="seek-slider" type="range" min="0" max="${score.duration}" step="0.1" value="0" aria-label="播放位置" />
      <label class="master-control">音量 <input id="volume" type="range" min="0" max="1" step="0.01" value="0.85" aria-label="总音量" /></label>
      <div class="transport-right"><button id="export" class="export-button">↓ 导出 WAV</button><button id="midi" class="text-button">MIDI</button></div>
    </section>
    <div class="status-row"><span id="status" role="status" aria-live="polite">点击播放，加载本地音色。也可以从任意段落开始。</span><label class="tone-control">旋律音色 <select id="lead" aria-label="旋律音色"><option value="piano">三角钢琴</option><option value="rhodes">电钢琴</option><option value="flute">长笛</option></select></label></div>
    <section class="arrangement" aria-label="编曲时间线">
      <div class="panel-title"><h2>编曲时间线</h2><span id="score-info">${score.bars.length} 小节 · ${selected.key}</span><span class="hint">点击段落或轨道跳转</span></div>
      <div class="arrangement-scroll"><div class="arrangement-inner">
        <div class="section-row"><div class="track-heading">轨道 / MIXER</div><div class="sections"></div></div>
        <div class="ruler-row"><div class="track-heading muted">M 静音 &nbsp; S 独奏</div><div class="ruler"></div></div>
        <div class="lanes">${TRACKS.map((track, i) => `
          <div class="lane" data-track="${track.id}" style="--track:${track.color}">
            <div class="track-info"><span class="track-index">${String(i + 1).padStart(2,'0')}</span><div class="track-name"><strong>${track.name}</strong><small>${track.description}</small></div><div class="track-buttons"><button class="mute" data-id="${track.id}" aria-label="静音${track.name}" aria-pressed="false">M</button><button class="solo" data-id="${track.id}" aria-label="独奏${track.name}" aria-pressed="false">S</button></div><input class="track-level" data-id="${track.id}" type="range" min="0" max="1.6" step="0.01" value="1" aria-label="${track.name}音量" /></div>
            <div class="lane-canvas"><canvas data-lane="${track.id}" aria-label="${track.name}音符时间线"></canvas></div>
          </div>`).join('')}</div>
        <div id="playhead" class="playhead"><span></span></div>
      </div></div>
    </section>
    <section class="listening-notes"><div><div class="eyebrow">NOW PLAYING</div><h3 id="section-name">${score.sections[0].name}</h3><p id="section-subtitle">${score.sections[0].subtitle}</p></div><div class="spectrum-wrap"><canvas id="spectrum" width="280" height="60" aria-label="实时声音频谱"></canvas><small>实时频谱</small></div><div class="note"><span>关于当前作品</span><p id="work-note">${selected.description}</p></div></section>
    <footer><span>演奏与导出均在本机完成 · 无后台 · 无付费服务</span><a href="./credits.html">音色来源与开源许可 ↗</a><a id="finished-audio" href="./${selected.files.wav}" download>下载当前版本成品</a><a id="score-download" href="./${selected.files.score}" download>下载乐谱 JSON</a></footer>
  </main>`;

const playButton = document.querySelector<HTMLButtonElement>('#play')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const seek = document.querySelector<HTMLInputElement>('#seek')!;
const exportButton = document.querySelector<HTMLButtonElement>('#export')!;
let busy = false, dragging = false, rendering = false, selectionEpoch = 0;
const report = (message: string) => { status.textContent = message; };
async function toggle() {
  if (busy) return;
  if (engine.playing) { engine.pause(); report('已暂停，可以调整配器或跳转段落。'); return; }
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
document.querySelector('#restart')!.addEventListener('click', () => engine.seek(0));
seek.addEventListener('pointerdown', () => { dragging = true; });
seek.addEventListener('input', () => { engine.seek(Number(seek.value)); });
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
  if (button) engine.seek(score.sections[Number(button.dataset.section)].startBar * 4 * 60 / score.bpm);
});
document.addEventListener('keydown', event => {
  if (event.code === 'Space' && !['INPUT','SELECT','BUTTON'].includes((event.target as HTMLElement).tagName)) { event.preventDefault(); void toggle(); }
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
  const exportedSong = selected, duration = score.duration;
  rendering = true; exportButton.disabled = true;
  try {
    report(`正在导出《${exportedSong.title}》${exportedSong.edition}，使用点击时的混音…`);
    const result = await engine.render(fraction => { exportButton.textContent = `导出 ${Math.round(fraction * 100)}%`; });
    download(result.wav, `${exportedSong.id}.wav`, 'audio/wav');
    report(`已导出《${exportedSong.title}》${exportedSong.edition}：${format(duration)} · 双声道 WAV。`);
  } catch (error) { report(`导出失败：${error instanceof Error ? error.message : error}`); }
  finally { rendering = false; exportButton.disabled = false; exportButton.textContent = '↓ 导出 WAV'; }
});

function drawLanes() {
  const totalBeats = score.duration * score.bpm / 60;
  for (const track of TRACKS) {
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-lane="${track.id}"]`)!;
    const rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(rect.width * ratio); canvas.height = Math.ceil(rect.height * ratio);
    const context = canvas.getContext('2d')!; context.scale(ratio, ratio);
    const notes = score.notes.filter(n => n.track === track.id);
    const low = notes.length ? Math.min(...notes.map(n => n.pitch)) : 0, high = notes.length ? Math.max(...notes.map(n => n.pitch)) : 0;
    context.strokeStyle = '#ffffff09';
    for (let bar = 0; bar <= score.bars.length; bar++) {
      context.beginPath(); context.moveTo(bar * 4 / totalBeats * rect.width, 0); context.lineTo(bar * 4 / totalBeats * rect.width, rect.height); context.stroke();
    }
    for (const section of score.sections) {
      const active = notes.some(n => n.beat >= section.startBar * 4 && n.beat < (section.startBar + section.bars) * 4);
      if (!active) continue;
      context.globalAlpha = .06; context.fillStyle = track.color;
      context.fillRect(section.startBar * 4 / totalBeats * rect.width + 1, 4, section.bars * 4 / totalBeats * rect.width - 2, rect.height - 8);
    }
    for (const note of notes) {
      const x = note.beat / totalBeats * rect.width, width = Math.max(1.2, note.duration / totalBeats * rect.width - .5);
      const y = rect.height - 11 - (note.pitch - low) / Math.max(1, high - low) * (rect.height - 24);
      context.globalAlpha = .25 + note.velocity * .62; context.fillStyle = track.color;
      context.fillRect(x, y, width, 3);
    }
    context.globalAlpha = 1;
  }
}
for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-lane]')) canvas.addEventListener('click', event => {
  const rect = canvas.getBoundingClientRect(); engine.seek((event.clientX - rect.left) / rect.width * score.duration);
});
new ResizeObserver(drawLanes).observe(document.querySelector('.arrangement-inner')!);
const spectrum = document.querySelector<HTMLCanvasElement>('#spectrum')!, spectrumContext = spectrum.getContext('2d')!;
const bins = new Uint8Array(128);
function frame() {
  const seconds = Math.max(0, engine.currentTime());
  if (!dragging) seek.value = String(seconds);
  document.querySelector('#current-time')!.textContent = format(seconds);
  playButton.innerHTML = engine.playing ? 'Ⅱ <span>暂停</span>' : '▶ <span>播放</span>';
  const sectionIndex = Math.max(0, score.sections.findLastIndex(s => seconds >= s.startBar * 4 * 60 / score.bpm));
  const section = score.sections[sectionIndex];
  document.querySelector('#section-name')!.textContent = section.name;
  document.querySelector('#section-subtitle')!.textContent = section.subtitle;
  document.querySelectorAll('.section').forEach((node, i) => node.classList.toggle('active', i === sectionIndex));
  const inner = document.querySelector<HTMLElement>('.arrangement-inner')!;
  const lane = document.querySelector<HTMLElement>('.lane-canvas')!;
  document.querySelector<HTMLElement>('#playhead')!.style.left = `${lane.offsetLeft + seconds / score.duration * lane.offsetWidth}px`;
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
function showSong(song: Song) {
  selectionEpoch++;
  selected = song; score = song.compose();
  engine.setScore(score);
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
  document.querySelector<HTMLAnchorElement>('#finished-audio')!.href = `./${song.files.wav}`;
  document.querySelector<HTMLSelectElement>('#lead')!.value = 'piano';
  document.querySelector<HTMLInputElement>('#volume')!.value = '.85';
  for (const input of document.querySelectorAll<HTMLInputElement>('.track-level')) input.value = '1';
  document.querySelector('.sections')!.innerHTML = score.sections.map((s, i) => `<button class="section" data-section="${i}" style="flex:${s.bars};--section:${s.color}"><span>${s.name}</span><small>${format(s.startBar * 4 * 60 / score.bpm)}</small></button>`).join('');
  document.querySelector('.ruler')!.innerHTML = Array.from({length:10}, (_, i) => `<span>${format(i * score.duration / 9)}</span>`).join('');
  for (const card of document.querySelectorAll<HTMLButtonElement>('[data-song]')) {
    const active = card.dataset.song === song.id;
    card.setAttribute('aria-pressed', String(active));
    card.querySelector('.song-check')!.textContent = active ? '当前作品' : '切换试听';
  }
  updateMixerUI(); drawLanes();
  document.title = `${song.title} · ${song.edition} · Music Room`;
  history.replaceState(null, '', `#${song.id}`);
  report(`已选择《${song.title}》${song.edition}。点击播放开始试听。`);
  Object.assign(window, { musicRoom: { engine, score, songId: song.id } });
}
for (const card of document.querySelectorAll<HTMLButtonElement>('[data-song]')) card.addEventListener('click', () => {
  const song = songById(card.dataset.song!);
  if (song && song.id !== selected.id) showSong(song);
});
window.addEventListener('hashchange', () => {
  const song = songById(location.hash.slice(1));
  if (song && song.id !== selected.id) showSong(song);
});
showSong(selected);
frame();
