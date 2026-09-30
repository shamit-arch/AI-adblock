/**
 * Options page: every control with `data-setting` is bound to a setting and
 * saved on change. Domain lists are validated and normalised. Includes a
 * local detector playground.
 */

import { SUPPORT_URL } from '../shared/constants.js';
import { loadSettings, normalizeDomainList, onSettingsChanged, resetSettings, saveSettings } from '../shared/storage.js';
import { getDetectionOptions } from '../shared/site-rules.js';
import { normalizeDomain, debounce } from '../shared/utils.js';
import { DetectionEngine } from '../detector/detector.js';

const SAMPLE_TEXT =
  "In today's fast-paced digital world, content marketing has become an essential tool for businesses of all sizes. Whether you're a small startup or a well-established enterprise, understanding the fundamentals can help you unlock new opportunities for growth. Moreover, a well-crafted strategy allows you to build trust with your audience. Furthermore, high-quality content plays a pivotal role in improving your search rankings. In this article, we will delve into the key strategies that can help you navigate the ever-evolving landscape of content marketing. Ultimately, the goal is to create valuable content that resonates with your target audience.";

const SENSITIVITY_LABELS = { 1: 'Very low', 2: 'Low', 3: 'Medium', 4: 'High', 5: 'Very high' };

let settings = null;
const engine = new DetectionEngine();

const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
}

function updateOutputs() {
  const sens = document.querySelector('[data-output="sensitivity"]');
  if (sens) sens.textContent = SENSITIVITY_LABELS[settings.sensitivity];
  const thr = document.querySelector('[data-output="confidenceThreshold"]');
  if (thr) thr.textContent = `${settings.confidenceThreshold}%`;
}

function render() {
  for (const input of document.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    const value = settings[key];
    if (input.type === 'checkbox') input.checked = !!value;
    else if (input.type === 'radio') input.checked = input.value === value;
    else if (document.activeElement !== input) input.value = String(value);
  }
  for (const area of document.querySelectorAll('[data-list]')) {
    if (document.activeElement !== area) area.value = settings[area.dataset.list].join('\n');
  }
  updateOutputs();
}

async function save(partial) {
  try {
    settings = await saveSettings(partial);
    render();
    toast('Saved');
  } catch (e) {
    toast(`Could not save: ${e.message || e}`);
  }
}

function readInput(input) {
  if (input.type === 'checkbox') return input.checked;
  if (input.type === 'range' || input.type === 'number') return Number(input.value);
  return input.value;
}

function bindSettings() {
  const debouncedSave = debounce((partial) => save(partial), 300);
  for (const input of document.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    if (input.type === 'range') {
      input.addEventListener('input', () => {
        settings = { ...settings, [key]: Number(input.value) };
        updateOutputs();
        debouncedSave({ [key]: Number(input.value) });
      });
    } else if (input.type === 'number') {
      input.addEventListener('change', () => {
        if (!input.checkValidity()) {
          toast('Value out of range — clamped');
        }
        save({ [key]: readInput(input) });
      });
    } else if (input.type === 'radio') {
      input.addEventListener('change', () => input.checked && save({ [key]: input.value }));
    } else {
      input.addEventListener('change', () => save({ [key]: readInput(input) }));
    }
  }

  const errors = document.getElementById('list-errors');
  for (const area of document.querySelectorAll('[data-list]')) {
    const key = area.dataset.list;
    area.addEventListener('change', () => {
      const lines = area.value.split(/[\n,]+/).map((l) => l.trim()).filter(Boolean);
      const invalid = lines.filter((l) => !normalizeDomain(l));
      errors.textContent = invalid.length ? `Ignored invalid ${key} entr${invalid.length > 1 ? 'ies' : 'y'}: ${invalid.join(', ')}` : '';
      save({ [key]: normalizeDomainList(lines) });
    });
  }
}

/* ---------------- playground ---------------- */

function escapeText(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function renderResult(result, threshold) {
  const box = document.getElementById('playground-result');
  box.hidden = false;
  box.textContent = '';
  if (result.skipped) {
    const reasons = {
      'too-short': 'Too short to judge (fewer than ~12 words).',
      code: 'Looks like code — code is never analysed.',
      navigation: 'Looks like navigation or a list of labels — not analysed.',
      'unsupported-language': 'This doesn’t look like English. The current detector only supports English.',
      'link-list': 'Mostly links — not analysed.',
      empty: 'No text.',
    };
    box.append(escapeText(`Not analysed: ${reasons[result.skipped] || result.skipped}`));
    return;
  }

  const line = document.createElement('div');
  line.className = 'score-line';
  const score = document.createElement('span');
  score.className = 'score';
  score.textContent = `${result.score}%`;
  const pill = document.createElement('span');
  pill.className = 'label-pill';
  pill.dataset.label = result.label;
  pill.textContent = result.labelText;
  const verdict = document.createElement('span');
  verdict.className = 'hint';
  verdict.textContent = result.score >= threshold ? `Would be blocked (threshold ${threshold}%)` : `Would stay visible (threshold ${threshold}%)`;
  line.append(score, pill, verdict);

  const meter = document.createElement('div');
  meter.className = 'meter';
  const fill = document.createElement('span');
  fill.style.width = `${result.score}%`;
  meter.append(fill);

  box.append(line, meter);

  const addList = (title, signals, sign) => {
    if (!signals.length) return;
    const h = document.createElement('h3');
    h.textContent = title;
    const ul = document.createElement('ul');
    ul.className = 'signal-list';
    for (const s of signals) {
      const li = document.createElement('li');
      const left = document.createElement('span');
      left.textContent = s.label;
      if (s.evidence && s.evidence.length) {
        const ev = document.createElement('div');
        ev.className = 'ev';
        ev.textContent = s.evidence.slice(0, 4).join(' · ');
        left.append(ev);
      }
      const right = document.createElement('span');
      right.textContent = `${sign}${(s.value * s.weight).toFixed(1)}`;
      li.append(left, right);
      ul.append(li);
    }
    box.append(h, ul);
  };
  addList('Signals suggesting AI', result.signals, '+');
  addList('Signals suggesting a human', result.humanSignals, '−');

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = `Independent evidence families: ${result.firedFamilies.length ? result.firedFamilies.join(', ') : 'none'}. This is a heuristic estimate, not proof of authorship.`;
  box.append(note);
}

function bindPlayground() {
  const input = document.getElementById('playground-input');
  document.getElementById('playground-run').addEventListener('click', () => {
    const options = getDetectionOptions(settings, 'normal');
    const result = engine.analyzeSync(input.value, options);
    renderResult(result, options.threshold);
  });
  document.getElementById('playground-sample').addEventListener('click', () => {
    input.value = SAMPLE_TEXT;
    document.getElementById('playground-run').click();
  });
}

/* ---------------- init ---------------- */

async function init() {
  document.getElementById('support-link').href = SUPPORT_URL;
  document.getElementById('version').textContent = `Version ${chrome.runtime.getManifest().version}`;

  settings = await loadSettings();
  render();
  bindSettings();
  bindPlayground();

  document.getElementById('reset').addEventListener('click', async () => {
    if (!confirm('Reset all settings, including your whitelist and blacklist?')) return;
    settings = await resetSettings();
    render();
    toast('Settings reset');
  });

  // Reflect changes made from the popup or another options tab.
  onSettingsChanged((next) => {
    settings = next;
    render();
  });
}

init();
