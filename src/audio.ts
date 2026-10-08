import { TRACKS, type Note, type Score, type TrackId } from './music/score.ts';
import { encodeWav } from './wav.ts';
import { playbackPosition, validateLoop, type BeatRange } from './audio/playback.ts';

export type LeadSound = 'piano' | 'rhodes' | 'flute';
export type Mix = { levels: Record<TrackId, number>; muted: Set<TrackId>; solo: Set<TrackId>; lead: LeadSound; volume: number };
export function defaultMix(): Mix {
  return { levels: Object.fromEntries(TRACKS.map(t => [t.id, 1])) as Record<TrackId, number>, muted: new Set(), solo: new Set(), lead: 'piano', volume: .85 };
}
export const cloneMix = (mix: Mix): Mix => ({ ...mix, levels: { ...mix.levels }, muted: new Set(mix.muted), solo: new Set(mix.solo) });
export const audible = (id: TrackId, mix: Mix) => !mix.muted.has(id) && (!mix.solo.size || mix.solo.has(id));
const hz = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);
type Sample = { buffer: AudioBuffer; root: number; kind: string };

class SoundBank {
  samples = new Map<string, Sample[]>();
  synthetic = new Map<string, AudioBuffer>();
  async load(context: BaseAudioContext, progress: (fraction: number) => void) {
    if (this.samples.size) return;
    const groups: Record<string, [string, number][]> = {
      piano: [['C2',36],['Ds2',39],['Fs2',42],['A2',45],['C3',48],['Ds3',51],['Fs3',54],['A3',57],['C4',60],['Ds4',63],['Fs4',66],['A4',69],['C5',72],['Ds5',75],['Fs5',78],['A5',81],['C6',84]],
      strings: [['C4',60],['E4',64],['G4',67],['D5',74]],
      flute: [['C4',60],['E4',64],['A4',69],['C5',72],['E5',76],['A5',81]],
    };
    const jobs = Object.entries(groups).flatMap(([kind, entries]) => entries.map(([name, root]) => ({ kind, name, root })));
    const loaded = new Map<string, Sample[]>();
    let done = 0;
    const controller = new AbortController();
    try {
      await Promise.all(jobs.map(async ({ kind, name, root }) => {
        const url = new URL(`./samples/${kind}-${name}.${kind === 'piano' ? 'mp3' : 'wav'}`, document.baseURI);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`音色加载失败：${kind}-${name} (${response.status})`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        loaded.set(kind, [...(loaded.get(kind) ?? []), { kind, root, buffer }]);
        progress(++done / jobs.length);
      }));
    } catch (error) { controller.abort(); throw error; }
    for (const samples of loaded.values()) samples.sort((a, b) => a.root - b.root);
    this.samples = loaded;
  }
  sound(context: BaseAudioContext, kind: string, pitch: number): Sample {
    const samples = this.samples.get(kind);
    if (samples) return samples.reduce((a, b) => Math.abs(a.root - pitch) <= Math.abs(b.root - pitch) ? a : b);
    const key = `${kind}-${pitch}-${context.sampleRate}`;
    if (!this.synthetic.has(key)) this.synthetic.set(key, this.synthesize(context, kind, pitch));
    return { buffer: this.synthetic.get(key)!, root: pitch, kind };
  }
  synthesize(context: BaseAudioContext, kind: string, pitch: number): AudioBuffer {
    const rate = context.sampleRate;
    const seconds = kind === 'rhodes' ? 4.5 : kind === 'bass' ? 2 : kind === 'pluck' ? 2.6 : kind === 'cymbal' ? 3 : kind === 'hat' ? .65 : .7;
    const buffer = context.createBuffer(1, Math.ceil(seconds * rate), rate);
    const out = buffer.getChannelData(0), frequency = hz(pitch);
    let seed = 3271 + pitch * 733, low = 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    if (kind === 'pluck') {
      const size = Math.round(rate / frequency), ring = new Float32Array(size);
      for (let i = 0; i < size; i++) ring[i] = random() * .8;
      for (let i = 0; i < out.length; i++) {
        const index = i % size;
        const value = ring[index];
        ring[index] = (value + ring[(index + 1) % size]) * .494;
        out[i] = value * Math.min(1, i / 70) * Math.exp(-i / rate * .4);
      }
      return buffer;
    }
    for (let i = 0; i < out.length; i++) {
      const t = i / rate, phase = 2 * Math.PI * frequency * t;
      if (kind === 'rhodes') {
        const carrier = Math.sin(phase + 1.5 * Math.exp(-t * 3.1) * Math.sin(phase * 2));
        out[i] = (carrier * .58 + Math.sin(phase * 3) * .1 * Math.exp(-t * 5)) * Math.exp(-t * 1.05) * Math.min(1, t / .004);
      } else if (kind === 'bass') {
        const body = Math.sin(phase) * .7 + Math.sin(phase * 2) * .2 * Math.exp(-t * 2) + Math.sin(phase * 3) * .08 * Math.exp(-t * 5);
        out[i] = Math.tanh(body * 1.15) * Math.exp(-t * 1.6) * Math.min(1, t / .005);
      } else if (kind === 'kick') {
        // Analytically integrated falling frequency avoids discontinuities in the pitch sweep.
        const sweep = 2 * Math.PI * (46 * t + (155 - 46) * (1 - Math.exp(-t * 36)) / 36);
        out[i] = Math.sin(sweep) * Math.exp(-t * 9) * .86 + random() * Math.exp(-t * 220) * .13;
      } else if (kind === 'snare') {
        const noise = random(); low += .13 * (noise - low);
        const high = noise - low;
        const snap = Math.exp(-t * (pitch === 37 ? 28 : 17));
        const clap = [0,.012,.025].reduce((sum, start) => sum + (t >= start ? Math.exp(-(t - start) * 80) : 0), 0);
        out[i] = high * (snap * .5 + clap * .15) + Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 26) * .23;
      } else {
        const noise = random(); low += .55 * (noise - low);
        const metal = Math.sin(t * 2 * Math.PI * 4361) * Math.sin(t * 2 * Math.PI * 6173);
        const decay = kind === 'cymbal' ? 1.8 : pitch === 46 ? 7 : 55;
        out[i] = ((noise - low) * .65 + metal * .11) * Math.exp(-t * decay) * Math.min(1, t / .001);
      }
    }
    return buffer;
  }
}

const impulses = new WeakMap<BaseAudioContext, AudioBuffer>();
class Orchestra {
  context: BaseAudioContext;
  buses = new Map<TrackId, GainNode>();
  master: GainNode;
  analyser: AnalyserNode;
  sources = new Set<AudioBufferSourceNode>();
  constructor(context: BaseAudioContext, mix: Mix, output: AudioNode = context.destination) {
    this.context = context;
    const dry = context.createGain();
    const reverb = context.createConvolver();
    let impulse = impulses.get(context);
    if (!impulse) {
      impulse = context.createBuffer(2, Math.ceil(context.sampleRate * 2.2), context.sampleRate);
      let seed = 9128;
      for (let c = 0; c < 2; c++) {
        const data = impulse.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          data[i] = (seed / 2147483648 - 1) * (1 - i / data.length) ** 3 * Math.min(1, i / (context.sampleRate * .024));
        }
      }
      impulses.set(context, impulse);
    }
    reverb.buffer = impulse;
    const wetLow = context.createBiquadFilter(); wetLow.type = 'lowpass'; wetLow.frequency.value = 6800;
    const wetHigh = context.createBiquadFilter(); wetHigh.type = 'highpass'; wetHigh.frequency.value = 190;
    reverb.connect(wetLow).connect(wetHigh).connect(dry);
    const highPass = context.createBiquadFilter(); highPass.type = 'highpass'; highPass.frequency.value = 28;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -13; compressor.knee.value = 18; compressor.ratio.value = 2.4; compressor.attack.value = .015; compressor.release.value = .2;
    this.master = context.createGain();
    this.analyser = context.createAnalyser(); this.analyser.fftSize = 256;
    dry.connect(highPass).connect(compressor).connect(this.master).connect(this.analyser).connect(output);
    for (const track of TRACKS) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = track.id === 'bass' ? 1600 : track.id === 'rhodes' ? 6000 : 15500;
      const panner = context.createStereoPanner(); panner.pan.value = track.pan;
      const fader = context.createGain();
      filter.connect(panner).connect(fader);
      fader.connect(dry);
      const send = context.createGain(); send.gain.value = track.send;
      fader.connect(send).connect(reverb);
      this.buses.set(track.id, fader);
      // Input and fader are distinct: mute must also affect the reverb send.
      this.inputs.set(track.id, filter);
    }
    this.setMix(mix, true);
  }
  inputs = new Map<TrackId, AudioNode>();
  setMix(mix: Mix, immediate = false) {
    const now = this.context.currentTime;
    for (const track of TRACKS) {
      const gain = this.buses.get(track.id)!.gain;
      const value = audible(track.id, mix) ? track.gain * mix.levels[track.id] : 0;
      if (immediate) gain.setValueAtTime(value, now); else gain.setTargetAtTime(value, now, .015);
    }
    if (immediate) this.master.gain.setValueAtTime(mix.volume, now); else this.master.gain.setTargetAtTime(mix.volume, now, .015);
  }
  note(bank: SoundBank, note: Note, bpm: number, start: number, lead: LeadSound, elapsed = 0, boundary = Infinity) {
    const context = this.context, duration = note.duration * 60 / bpm;
    const kind = note.track === 'melody' ? lead : note.track === 'piano' ? 'piano' : note.track;
    const sample = bank.sound(context, kind, note.pitch);
    const playbackRate = 2 ** ((note.pitch - sample.root) / 12);
    const release = kind === 'piano' ? .7 : kind === 'strings' ? .38 : kind === 'flute' ? .09 : kind === 'rhodes' ? .26 : kind === 'pluck' ? .6 : kind === 'cymbal' ? 1.25 : .055;
    const total = Math.min(duration + release, sample.buffer.duration / playbackRate);
    if (elapsed >= total || boundary <= start) return;
    const source = context.createBufferSource(); source.buffer = sample.buffer; source.playbackRate.value = playbackRate;
    const gain = context.createGain();
    const attack = kind === 'strings' ? .15 : kind === 'flute' ? .035 : .003;
    const amplitude = note.velocity ** 1.35;
    const envelope = (age: number) => age < attack ? Math.max(.00001, amplitude * age / attack) : age <= duration ? amplitude : Math.max(.00001, amplitude * Math.exp(-6 * (age - duration) / release));
    gain.gain.setValueAtTime(envelope(elapsed), start);
    if (elapsed < attack) gain.gain.linearRampToValueAtTime(amplitude, start + attack - elapsed);
    if (elapsed < duration) gain.gain.setValueAtTime(amplitude, start + duration - elapsed);
    gain.gain.exponentialRampToValueAtTime(.00001, start + total - elapsed);
    source.connect(gain).connect(this.inputs.get(note.track)!);
    this.sources.add(source);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.sources.delete(source); };
    source.start(start, elapsed * playbackRate); source.stop(Math.min(start + total - elapsed, boundary));
  }
  stop() {
    for (const source of this.sources) { try { source.stop(); } catch { /* already ended */ } }
    this.sources.clear();
  }
  dispose() { this.stop(); this.analyser.disconnect(); this.master.disconnect(); }
}

type Pass = { graph: Orchestra; from: number; end: number; audioStart: number; boundary: number; index: number; restored: boolean };

export class MusicEngine {
  score: Score;
  mix: Mix = defaultMix();
  context?: AudioContext;
  output?: GainNode;
  graph?: Orchestra;
  bank = new SoundBank();
  playing = false;
  position = 0;
  anchor = 0;
  ready = false;
  loading?: Promise<void>;
  loop?: BeatRange;
  timer?: ReturnType<typeof setInterval>;
  private passes: Pass[] = [];
  private from = 0;
  private audioStart = 0;
  private nextBoundary = 0;
  private retirement = new Set<ReturnType<typeof setTimeout>>();
  constructor(score: Score) { this.score = score; }
  setScore(score: Score) {
    this.pause(); this.score = score; this.position = 0; this.loop = undefined; this.mix = defaultMix();
  }
  async prepare(progress: (fraction: number) => void = () => {}) {
    this.context ??= new AudioContext({ sampleRate: 44100 });
    if (!this.output) { this.output = this.context.createGain(); this.output.connect(this.context.destination); }
    await this.context.resume();
    if (this.ready) return;
    this.loading ??= this.bank.load(this.context, progress).then(() => { this.ready = true; });
    try { await this.loading; } catch (error) { this.loading = undefined; throw error; }
  }
  private loopSeconds() {
    return this.loop && { start: this.loop.startBeat * 60 / this.score.bpm, end: this.loop.endBeat * 60 / this.score.bpm };
  }
  currentTime() {
    if (!this.playing) return this.position;
    const now = this.context!.currentTime;
    const active = this.passes.findLast(pass => pass.audioStart <= now);
    if (active) this.graph = active.graph;
    return playbackPosition(this.from, this.audioStart, now, this.score.duration, this.loopSeconds());
  }
  setLoop(range?: BeatRange) {
    const valid = range && validateLoop(range, this.score), wasPlaying = this.playing;
    const position = valid ? valid.startBeat * 60 / this.score.bpm : this.currentTime();
    this.pause(); this.loop = valid; this.position = position;
    if (wasPlaying) this.play(position);
  }
  play(from = this.position) {
    if (!this.ready || !this.context || !this.output) throw new Error('请先加载音色');
    this.pause();
    // Buffer synthesis can take longer than the startup lookahead. Warm it
    // before choosing an audio start time, so the first pass is never truncated.
    const warmed = new Set<string>();
    for (const note of this.score.notes) {
      const kind = note.track === 'melody' ? this.mix.lead : note.track === 'piano' ? 'piano' : note.track;
      const key = `${kind}:${note.pitch}`;
      if (!warmed.has(key)) { this.bank.sound(this.context, kind, note.pitch); warmed.add(key); }
    }
    const loop = this.loopSeconds();
    let position = Math.max(0, Math.min(this.score.duration, from));
    if (loop && (position < loop.start || position >= loop.end)) position = loop.start;
    else if (!loop && position >= this.score.duration) position = 0;
    // Initialize effects before starting the audio clock, just like synthesis.
    const graph = new Orchestra(this.context, this.mix, this.output);
    this.position = this.from = position;
    // Give the new effect graph a silent preroll to settle before its first note.
    // Loop successors already receive this preparation time from lookahead.
    this.audioStart = this.context.currentTime + .25;
    this.anchor = this.audioStart - position;
    this.playing = true;
    const pass = this.makePass(position, this.audioStart, loop?.end ?? this.score.duration, graph);
    this.graph = pass.graph; this.nextBoundary = pass.boundary;
    this.schedule(); this.timer = setInterval(() => this.schedule(), 40);
  }
  private makePass(from: number, audioStart: number, end: number, graph?: Orchestra) {
    const index = this.score.notes.findIndex(note => note.beat * 60 / this.score.bpm >= from);
    const pass: Pass = { graph: graph ?? new Orchestra(this.context!, this.mix, this.output), from, end, audioStart, boundary: audioStart + end - from, index: index < 0 ? this.score.notes.length : index, restored: false };
    this.passes.push(pass); this.applyPassMix(pass); return pass;
  }
  private applyPassMix(pass: Pass) {
    const now = this.context!.currentTime;
    if (now >= pass.boundary) return;
    pass.graph.setMix(this.mix);
    const gain = pass.graph.master.gain;
    gain.cancelAndHoldAtTime(now);
    const fadeIn = Math.min(.012, (pass.boundary - pass.audioStart) / 4);
    if (now <= pass.audioStart) {
      gain.setValueAtTime(0, pass.audioStart);
      gain.linearRampToValueAtTime(this.mix.volume, pass.audioStart + fadeIn);
    }
    const fadeLength = this.loop ? .008 : Math.min(1.5, this.score.duration / 4);
    const fadeStart = Math.max(pass.audioStart + fadeIn, pass.boundary - fadeLength);
    if (now < fadeStart) gain.setValueAtTime(this.mix.volume, fadeStart);
    else gain.setValueAtTime(this.mix.volume * Math.max(0, (pass.boundary - now) / (pass.boundary - fadeStart)), now);
    gain.linearRampToValueAtTime(0, pass.boundary);
  }
  private schedule() {
    if (!this.playing) return;
    const now = this.context!.currentTime, horizon = now + .22, loop = this.loopSeconds();
    if (!loop && now >= this.nextBoundary) { this.pause(); this.position = this.score.duration; return; }
    // Create the next pass before its boundary; its audio times derive from the
    // previous boundary, never from a late UI timer. No cumulative loop drift.
    if (loop) while (this.nextBoundary <= horizon) {
      const pass = this.makePass(loop.start, this.nextBoundary, loop.end); this.nextBoundary = pass.boundary;
    }
    for (const pass of this.passes) {
      if (pass.audioStart > horizon || pass.boundary <= now) continue;
      if (!pass.restored) {
        for (const note of this.score.notes.slice(0, pass.index)) {
          const elapsed = pass.from - note.beat * 60 / this.score.bpm;
          if (elapsed >= 0 && elapsed < note.duration * 60 / this.score.bpm) {
            const start = Math.max(pass.audioStart, now);
            pass.graph.note(this.bank, note, this.score.bpm, start, this.mix.lead, elapsed + start - pass.audioStart, pass.boundary);
          }
        }
        pass.restored = true;
      }
      while (pass.index < this.score.notes.length) {
        const note = this.score.notes[pass.index], noteTime = note.beat * 60 / this.score.bpm;
        const when = pass.audioStart + noteTime - pass.from;
        if (noteTime >= pass.end || when > horizon) break;
        pass.index++;
        if (when < pass.audioStart) continue;
        const start = Math.max(when, now);
        pass.graph.note(this.bank, note, this.score.bpm, start, this.mix.lead, start - when, pass.boundary);
      }
    }
    this.currentTime();
    const expired = this.passes.filter(pass => pass.boundary <= now);
    for (const pass of expired) pass.graph.dispose();
    this.passes = this.passes.filter(pass => pass.boundary > now);
  }
  pause() {
    if (this.playing) this.position = this.currentTime();
    this.playing = false; if (this.timer) clearInterval(this.timer); this.timer = undefined;
    for (const pass of this.passes) {
      // Fade the old graph before disposal; no old notes survive a transition.
      const now = this.context!.currentTime, gain = pass.graph.master.gain;
      gain.cancelAndHoldAtTime(now); gain.linearRampToValueAtTime(0, now + .008);
      const timer = setTimeout(() => { pass.graph.dispose(); this.retirement.delete(timer); }, 20);
      this.retirement.add(timer);
    }
    this.passes = []; this.graph = undefined;
  }
  seek(seconds: number) {
    const next = Math.max(0, Math.min(this.score.duration, seconds));
    const loop = this.loopSeconds();
    if (loop && (next < loop.start || next >= loop.end)) this.loop = undefined;
    if (this.playing) this.play(next); else this.position = next;
  }
  updateMix() { for (const pass of this.passes) this.applyPassMix(pass); }
  async render(progress: (fraction: number) => void = () => {}) {
    const score = this.score;
    const mix = cloneMix(this.mix);
    const context = new OfflineAudioContext(2, Math.round(score.duration * 44100), 44100);
    await this.bank.load(context, fraction => progress(fraction * .15));
    const graph = new Orchestra(context, mix);
    for (const note of score.notes) if (audible(note.track, mix)) graph.note(this.bank, note, score.bpm, note.beat * 60 / score.bpm, mix.lead);
    graph.master.gain.cancelScheduledValues(0);
    graph.master.gain.setValueAtTime(mix.volume, 0);
    graph.master.gain.setValueAtTime(mix.volume, score.duration - Math.min(1.5, score.duration / 4));
    graph.master.gain.linearRampToValueAtTime(0, score.duration);
    for (let t = 15; t < score.duration; t += 15) context.suspend(t).then(() => { progress(.15 + .8 * t / score.duration); return context.resume(); });
    const buffer = await context.startRendering();
    const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
    let peak = 0;
    for (const channel of channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
    // Only attenuate: a quiet user mix must remain quiet in the exported file.
    const attenuation = peak > .89 ? .89 / peak : 1;
    if (attenuation < 1) for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i] *= attenuation;
    progress(1);
    return { buffer, wav: encodeWav(channels, buffer.sampleRate), peak: peak * attenuation, attenuation };
  }
}
