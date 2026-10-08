export const SAMPLE_GROUPS: Record<string, [string, number][]> = {
      piano: [['C2',36],['Ds2',39],['Fs2',42],['A2',45],['C3',48],['Ds3',51],['Fs3',54],['A3',57],['C4',60],['Ds4',63],['Fs4',66],['A4',69],['C5',72],['Ds5',75],['Fs5',78],['A5',81],['C6',84]],
      strings: [['C4',60],['E4',64],['G4',67],['D5',74]],
      flute: [['C4',60],['E4',64],['A4',69],['C5',72],['E5',76],['A5',81]],
    };

export function synthesizeVoice(kind: string, pitch: number, rate: number): Float32Array {
    const seconds = kind === 'rhodes' ? 4.5 : kind === 'bass' ? 2 : kind === 'pluck' ? 2.6 : kind === 'cymbal' ? 3 : kind === 'hat' ? .65 : .7;
    const out = new Float32Array(Math.ceil(seconds * rate)), frequency = 440 * 2 ** ((pitch - 69) / 12);
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
      return out;
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
    return out;
  }
