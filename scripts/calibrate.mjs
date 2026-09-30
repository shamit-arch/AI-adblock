/**
 * Prints detector scores and signal breakdowns for the fixture samples.
 * Useful when tuning weights in src/detector:  npm run calibrate [-- --verbose]
 */
import { DetectionEngine } from '../src/detector/detector.js';
import { HUMAN, AI, BORDERLINE, EDGE } from '../tests/fixtures/samples.js';

const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const sensitivity = Number(process.argv.find((a) => a.startsWith('--sens='))?.slice(7) || 3);
const engine = new DetectionEngine();

const groups = { HUMAN, BORDERLINE, AI, EDGE };
for (const [group, samples] of Object.entries(groups)) {
  console.log(`\n=== ${group} ===`);
  for (const [name, text] of Object.entries(samples)) {
    if (only && !name.includes(only)) continue;
    const r = engine.analyzeSync(text, { sensitivity });
    const provider = engine.providers[0];
    const debug = r.skipped ? null : provider.analyzeSync(text, { sensitivity }).debug;
    const line = r.skipped
      ? `skipped: ${r.skipped}`
      : `${String(r.score).padStart(3)}  ${r.label.padEnd(9)} fam=[${r.firedFamilies.join(',')}] ai=${debug.aiPoints} human=${debug.humanPoints} E=${debug.evidence} ${debug.caps.join(' ')}`;
    console.log(`${name.padEnd(22)} ${line}`);
    if (verbose && !r.skipped) {
      for (const s of r.signals) console.log(`     + ${s.id.padEnd(22)} ${s.family.padEnd(9)} ${(s.value * s.weight).toFixed(2)}  ${s.evidence ? s.evidence.join(' | ') : ''}`);
      for (const s of r.humanSignals) console.log(`     - ${s.id.padEnd(22)} ${(s.value * s.weight).toFixed(2)}`);
    }
  }
}
