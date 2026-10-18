import { execFile, spawn } from 'node:child_process';

const FFMPEG = process.env.ACERVO_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.ACERVO_FFPROBE || 'ffprobe';
const SR = 22050;
const FRAME = 1024;
const HOP = 512;

function run(bin, args) {
  return new Promise(function (resolve, reject) {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, timeout: 180000, windowsHide: true }, function (err, stdout, stderr) {
      if (err) reject(new Error(String(stderr || err.message).slice(-400)));
      else resolve({ stdout: stdout, stderr: stderr });
    });
  });
}

export async function probe(file) {
  const res = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration,bit_rate', '-of', 'json', file]);
  const fmt = JSON.parse(res.stdout).format || {};
  return { duration: Number(fmt.duration) || 0, bitrate: Number(fmt.bit_rate) || 0 };
}

export async function measureLoudness(file) {
  const filter = 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json';
  const res = await run(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', filter, '-f', 'null', '-']);
  const text = res.stderr;
  const start = text.lastIndexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Nao foi possivel medir o loudness.');
  let data;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch (e) { throw new Error('Medicao de loudness invalida.'); }
  return {
    input_i: Number(data.input_i),
    input_tp: Number(data.input_tp),
    input_lra: Number(data.input_lra),
    input_thresh: Number(data.input_thresh),
    target_offset: Number(data.target_offset)
  };
}

export async function normalizeTo(file, outFile, measured, targetLufs) {
  const lufs = targetLufs || -14;
  const m = measured || {};
  const parts = [
    'loudnorm=I=' + lufs + ':TP=-1:LRA=11',
    'measured_I=' + (isFinite(m.input_i) ? m.input_i : -18),
    'measured_TP=' + (isFinite(m.input_tp) ? m.input_tp : -1),
    'measured_LRA=' + (isFinite(m.input_lra) ? m.input_lra : 7),
    'measured_thresh=' + (isFinite(m.input_thresh) ? m.input_thresh : -28),
    'offset=' + (isFinite(m.target_offset) ? m.target_offset : 0),
    'linear=true',
    'print_format=json'
  ].join(':');
  try {
    await run(FFMPEG, ['-y', '-hide_banner', '-nostats', '-i', file, '-af', parts, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-q:a', '2', outFile]);
  } catch (e) {
    const dynamic = 'loudnorm=I=' + lufs + ':TP=-1:LRA=11';
    await run(FFMPEG, ['-y', '-hide_banner', '-nostats', '-i', file, '-af', dynamic, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-q:a', '2', outFile]);
  }
  const out = await run(FFMPEG, ['-hide_banner', '-nostats', '-i', outFile, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  const text = out.stderr;
  const start = text.lastIndexOf('{');
  const end = text.lastIndexOf('}');
  let info = {};
  if (start >= 0 && end > start) {
    try { info = JSON.parse(text.slice(start, end + 1)); } catch (e) { info = {}; }
  }
  return { i: Number(info.input_i), tp: Number(info.input_tp), lra: Number(info.input_lra) };
}

export async function loudnessOf(file) {
  const res = await run(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  const text = res.stderr;
  const start = text.lastIndexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { i: null, tp: null, lra: null };
  try {
    const d = JSON.parse(text.slice(start, end + 1));
    return { i: Number(d.input_i), tp: Number(d.input_tp), lra: Number(d.input_lra) };
  } catch (e) { return { i: null, tp: null, lra: null }; }
}

function decodePcm(file, startSec, seconds) {
  return new Promise(function (resolve, reject) {
    const args = ['-v', 'error'];
    if (startSec > 0) args.push('-ss', String(startSec));
    args.push('-t', String(seconds), '-i', file, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-');
    const child = spawn(FFMPEG, args, { windowsHide: true });
    const chunks = [];
    child.stdout.on('data', function (c) { chunks.push(c); });
    child.on('error', reject);
    child.on('close', function (code) {
      if (chunks.length === 0) reject(new Error('Nao foi possivel decodificar o audio para analise.'));
      else resolve(Buffer.concat(chunks));
    });
  });
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k], ui = im[i + k];
        const xr = re[i + k + half], xi = im[i + k + half];
        const vr = xr * cr - xi * ci;
        const vi = xr * ci + xi * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + half] = ur - vr; im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function analyzePcm(buffer) {
  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2));
  const total = samples.length;
  if (total < SR) return { bpm: 0, energy: 0, centroid: 0, zcr: 0, beat: 0 };
  let sumSq = 0;
  let crossings = 0;
  for (let i = 0; i < total; i++) {
    const s = samples[i] / 32768;
    sumSq += s * s;
    if (i > 0 && ((samples[i - 1] >= 0 && samples[i] < 0) || (samples[i - 1] < 0 && samples[i] >= 0))) crossings++;
  }
  const rms = Math.sqrt(sumSq / total);
  const db = 20 * Math.log10(rms + 1e-9);
  const energy = Math.max(0, Math.min(1, (db + 50) / 50));
  const zcr = crossings / total;
  const frames = Math.floor((total - FRAME) / HOP);
  const env = new Float64Array(Math.max(1, frames));
  const centroids = [];
  const win = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1));
  let centroidSum = 0, centroidN = 0;
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = samples[off + i] / 32768;
      e += s * s;
    }
    env[f] = Math.sqrt(e / FRAME);
    if (f % 3 === 0) {
      const re = new Float64Array(FRAME);
      const im = new Float64Array(FRAME);
      for (let i = 0; i < FRAME; i++) re[i] = (samples[off + i] / 32768) * win[i];
      fft(re, im);
      let num = 0, den = 0;
      for (let b = 1; b < FRAME / 2; b++) {
        const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
        num += mag * (b * SR / FRAME);
        den += mag;
      }
      if (den > 1e-6) { centroidSum += (num / den) / (SR / 2); centroidN++; }
    }
  }
  const centroid = centroidN ? centroidSum / centroidN : 0;
  let bpm = 0, beat = 0;
  if (frames > 30) {
    const flux = new Float64Array(frames);
    for (let i = 1; i < frames; i++) flux[i] = Math.max(0, env[i] - env[i - 1]);
    let mean = 0;
    for (let i = 0; i < frames; i++) mean += flux[i];
    mean /= frames;
    for (let i = 0; i < frames; i++) flux[i] -= mean;
    const fps = SR / HOP;
    const minLag = Math.max(3, Math.floor(fps * 60 / 200));
    const maxLag = Math.min(frames - 1, Math.ceil(fps * 60 / 55));
    let bestLag = 0, bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let score = 0;
      for (let i = 0; i + lag < frames; i++) score += flux[i] * flux[i + lag];
      score /= (frames - lag);
      if (score > bestScore) { bestScore = score; bestLag = lag; }
    }
    if (bestLag > 0) {
      let period = bestLag;
      const prev = [];
      for (let lag = Math.max(minLag, bestLag - 2); lag <= Math.min(maxLag, bestLag + 2); lag++) {
        let s = 0;
        for (let i = 0; i + lag < frames; i++) s += flux[i] * flux[i + lag];
        prev.push({ lag: lag, s: s / (frames - lag) });
      }
      prev.sort(function (a, b) { return b.s - a.s; });
      period = prev[0].lag;
      let candidate = 60 * fps / period;
      while (candidate < 70) candidate *= 2;
      while (candidate > 180) candidate /= 2;
      bpm = Math.round(candidate * 10) / 10;
      let zero = 0;
      for (let i = 0; i < frames; i++) zero += flux[i] * flux[i];
      beat = zero > 0 ? Math.max(0, Math.min(1, bestScore / (zero / frames))) : 0;
    }
  }
  return {
    bpm: bpm,
    energy: Math.round(energy * 1000) / 1000,
    centroid: Math.round(centroid * 1000) / 1000,
    zcr: Math.round(zcr * 1000) / 1000,
    beat: Math.round(beat * 1000) / 1000,
    rmsDb: Math.round(db * 10) / 10
  };
}

export async function extractFeatures(file) {
  let buffer;
  try {
    buffer = await decodePcm(file, 8, 60);
  } catch (e) {
    buffer = await decodePcm(file, 0, 60);
  }
  if (buffer.length < SR * 2 * 5) {
    try { buffer = await decodePcm(file, 0, 60); } catch (e) { return { bpm: 0, energy: 0, centroid: 0, zcr: 0, beat: 0 }; }
  }
  return analyzePcm(buffer);
}
