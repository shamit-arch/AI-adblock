# AI Content Blocker

A Chrome extension (Manifest V3) that detects text that is **likely AI-generated** and hides, blurs, collapses, or replaces it with a placeholder — on news sites, blogs, forums, Reddit, YouTube comments, search results, reviews and most other text-heavy pages.

Everything runs **locally in your browser**. No server, no API key, no tracking.

```
┌──────────────────────────────────────────────────────────┐
│ AI  Highly likely AI-generated content blocked           │
│     Confidence: 93% · Stock AI phrasing, Formulaic …     │
│                         [Show content] [Always allow site]│
└──────────────────────────────────────────────────────────┘
```

## ⚠️ Important limitations of AI detection

**No tool can reliably prove that text was written by AI.** This extension scores how closely text matches common patterns of AI writing. Treat the score as an estimate:

- **False positives happen** — formal, templated, or heavily edited human writing (press releases, SEO copy, corporate pages) can look “AI-like”.
- **False negatives happen** — AI text that was edited, or prompted to sound casual, often passes.
- **Short text can’t be judged** — tweets and one-line comments rarely have enough signal, so they’re usually left alone.
- **English only** — other languages are skipped rather than guessed at.
- Results are labelled *“Possibly / Likely / Highly likely AI-generated”*, never “definitely”, and are capped at 99%.

When in doubt the extension **leaves content visible**: the default blocking threshold (65) sits above the start of the “likely” band, and no content can be blocked on a single kind of evidence.

## Features

- **Multi-signal local detector** with a 0–100 confidence score and configurable bands (0–30 unlikely · 31–60 possibly · 61–80 likely · 81–100 highly likely).
- **Blocks before content is shown:** new text is checked while the page is still being parsed and inside the MutationObserver callback, before the browser paints it — AI text doesn’t flash on screen first (verified frame-by-frame in Chrome on normal, slow-streamed and dynamic pages).
- **Four blocking modes:** placeholder (default), collapse, blur, hide — with *Show content* / *Hide again* and *Always allow site*.
- **Smart content discovery:** finds article bodies, comments, posts, reviews and snippets; ignores navigation, headers, footers, cookie banners, forms, inputs, code, buttons, menus, link lists, URLs and e-mail addresses.
- **Dynamic sites:** MutationObserver with debouncing, infinite scroll, SPA navigation (URL changes without reload).
- **Site adapters:** Reddit, YouTube, Google Search (incl. site-labelled “AI Overview”), X/Twitter, news/publishing sites, plus a generic adapter with common forum/blog/review platforms (WordPress, Discourse, XenForo, phpBB, Stack Exchange, Hacker News, Amazon reviews).
- **Popup:** ON/OFF, live per-page counts (detected / blocked / visible), Scan Page, Show All, Block All, Disable on This Site, sensitivity slider, toolbar badge.
- **Options page:** every setting below, whitelist/blacklist, performance tuning, and a **detector playground** that explains why a text scored the way it did.
- **Pluggable architecture** for future detection providers (e.g. an external API).

## Installation

Requires Node.js 18+ and Chrome 111+.

```bash
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the **`dist`** folder inside this project (not the project root — the root `manifest.json` is the source template; `dist/` holds the bundled extension)

Tabs that were already open before installing need a reload (or use **Activate on this page** in the popup).

## Development

| Command | What it does |
| --- | --- |
| `npm run build` | Production build into `dist/` + build verification |
| `npm run build:dev` | Unminified build with inline source maps |
| `npm run watch` | Rebuild on change (then click ↻ on the extension card) |
| `npm test` | Run the automated test suite (Vitest + jsdom) |
| `npm run demo` | Serve the demo page at <http://localhost:5173/demo.html> (add `?slow` to simulate a slow network) |
| `npm run calibrate` | Print detector scores/signals for all sample texts (`-- --verbose`, `-- --sens=5`, `-- --only=name`) |
| `npm run icons` | Regenerate the PNG icons |

## Architecture

```
manifest.json                  MV3 manifest (source; copied to dist/ with the package.json version)
src/
├── background/service-worker.js   defaults on install, toolbar badge, on/off icon
├── content/
│   ├── content.js                 entry point (double-injection guard)
│   ├── controller.js              wires everything together; popup messaging; settings changes
│   ├── discovery.js               finds content units (adapter selectors + paragraph-group heuristic)
│   ├── extractor.js               structured text extraction (no layout reads), link density
│   ├── scanner.js                 idle-time batched analysis queue, dedupe, viewport priority
│   ├── blocker.js                 apply/revert hide · blur · collapse · placeholder
│   ├── placeholder.js             Shadow-DOM notice UI
│   ├── observer.js                debounced MutationObserver → scan roots
│   ├── navigation.js              SPA URL-change detection
│   ├── dom-filters.js             what is never analysed (nav, forms, code, banners, …)
│   └── adapters/                  generic, reddit, youtube, google, twitter, news + registry
├── detector/
│   ├── detector.js                DetectionEngine: eligibility, caching, provider combination
│   ├── types.js                   Detector / AIProvider interfaces, DetectionResult, labels
│   ├── text-features.js           tokenising, sentences, structure, statistics
│   ├── phrase-detector.js         chatbot boilerplate, stock phrases, AI vocabulary
│   ├── style-detector.js          formula, structure and rhythm signals
│   ├── human-detector.js          evidence of human writing (lowers scores)
│   ├── scoring.js                 family caps, corroboration rule, logistic score
│   ├── lexicon.js                 all word/phrase lists (data only)
│   └── providers/
│       ├── local-provider.js      built-in on-device provider
│       └── remote-provider.template.js   example for a future external API (not bundled)
├── popup/  options/  styles/blocker.css  shared/ (constants, storage, site rules, utils)
scripts/   build, verify-build, generate-icons, serve-demo, calibrate
tests/     Vitest suites + fixtures (sample texts)
test-pages/demo.html   manual testing page
docs/MANUAL_TESTING.md
```

### Detection approach

Each content unit is turned into **features** once (sentences, blocks, statistics), then analysed by independent detectors that emit **signals** (`value` 0–1 × `weight` points), grouped into five **families**:

| Family | Examples |
| --- | --- |
| chatbot | “As an AI language model”, “Certainly! Here are…”, “Let me know if you need…”, leftover `**Markdown**`, “[Your Name]” templates |
| phrasing | stock phrases (“delve into”, “plays a crucial role”, “in today’s fast-paced world”) and AI-favoured vocabulary density |
| formula | generic intros, “Moreover/Additionally” transitions, stock hedging, “In conclusion” wrap-ups, template headings, generic filler with no concrete details |
| structure | “Label: explanation” bullet lists, heading/bullet overuse |
| rhythm | uniform sentence lengths (low burstiness), uniform paragraphs, repetitive openers, triplets, em-dash density |

**Human evidence** — slang/informal words, casual typing (lowercase, missing apostrophes, “!!”), personal anecdotes, concrete names/numbers/dates, varied rhythm, fragments, profanity — is subtracted.

Scoring (`scoring.js`):

1. Family points are capped so one kind of evidence can’t dominate.
2. `evidence = AI points × sensitivity factor − human points` → logistic curve → 0–100.
3. **Corroboration caps:** evidence from only one family caps the score at 50; two families at 80; three or more are uncapped. Short texts, repetitive boilerplate, quoted chatbot phrases and articles *about* AI get extra dampening.
4. An explicit statement that the text is AI-generated (“This summary was generated by AI”) is treated as a label.

Text is skipped entirely if it is too short, code, navigation-like, mostly links, or not English.

### How blocking works

The original content is **never removed or moved**. The blocker sets a `data-aicb-state` attribute on the element (styled by `styles/blocker.css`) and, for placeholder/collapse, inserts a sibling `<aicb-notice>` element whose UI lives in a **closed Shadow DOM** so site CSS can’t affect it and it can’t affect the site. Clicks inside the notice don’t propagate to the page. Restoring removes the attribute and the notice, leaving the DOM exactly as it was (verified by tests). Table cells fall back to blur; list items get a valid `<li>` wrapper. If the page re-renders content you revealed, it stays revealed.

### Timing: blocking before paint

The content script is injected at `document_start` and observes the DOM while the HTML is still being parsed. New content is analysed **synchronously inside the MutationObserver callback** — a microtask that runs before the browser's next paint — so blocked text is never shown first. Analysis costs ~0.6 ms per typical block.

- **Time budget:** each batch is limited to ~16 ms (50 ms for the one-time initial scan, before anything is painted). New blocks that don't fit get `data-aicb-pending` (`opacity: 0`, layout preserved) and are finished in the immediately following tasks — never shown unchecked. A watchdog guarantees nothing stays hidden longer than 2 s.
- **Slow / streamed pages:** a block the parser is still inside is held invisible only if the fragment is too short to judge or already looks at least "possibly AI"; clearly human text is shown immediately.
- **Incomplete DOM:** a container chosen as one unit mid-parse is re-validated as the page grows (and at `DOMContentLoaded`); if it no longer looks like one text it is unblocked and its parts are re-checked in the same task.
- Previously judged content is never re-hidden; re-evaluations after settings changes run in idle time.

### Performance

- Discovery only runs on added subtrees from mutations; full-page discovery only on load, SPA navigation, settings changes, or a manual scan.
- Excluded subtrees are rejected by the TreeWalker itself; exclusion checks are memoised per pass.
- Each unit is analysed once per text version (WeakMap signatures + cheap length pre-check); results are LRU-cached by text hash. Content that is already blocked is not re-analysed for small growth.
- Background re-scans run in `requestIdleCallback` slices, at most *Maximum elements per scan* per batch, units near the viewport first.
- Text per unit is capped at 12k chars, and containers over 30k chars are never treated as a single unit.

## Settings

| Section | Setting | Default |
| --- | --- | --- |
| General | Enable extension · automatic scanning · scan dynamic content | on · on · on |
| | Detection sensitivity (1–5) | 3 (Medium) |
| Blocking | Placeholder / Collapse / Blur / Hide · show reasons | Placeholder · on |
| Detection | Confidence threshold · minimum text length | 65 · 120 chars |
| | Phrase detection · style detection · block site-labelled AI | on · on · on |
| | Score bands | 31 / 61 / 81 |
| Websites | Whitelist (never scanned) · Blacklist (strict: sensitivity 5, threshold −15) | empty |
| Performance | Max elements per scan · scan delay · MutationObserver debounce | 200 · 0 ms · 0 ms (0 = check before paint) |

Settings are stored in `chrome.storage.sync` (one key per setting, so long domain lists fit the per-item quota). Only values you change are stored, so improved defaults in new versions apply automatically; a versioned migration upgrades older installs.

## Privacy

- **All text analysis happens locally** in your browser. Page content is never sent anywhere.
- **No browsing history** is collected. Nothing about the pages you visit is stored.
- **No tracking, analytics, or ads.**
- Only your settings are saved, in Chrome’s own `chrome.storage.sync`.
- The build verifier fails the build if network APIs (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`) appear in the bundle.
- The **Support on PayPal** button only opens PayPal’s website in a new tab. The extension never sees, handles, or stores payment information.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Save your settings. |
| `activeTab` | When you open the popup, lets it read the current tab’s address (for “Disable on This Site”) and start the blocker in a tab that was open before installation. |
| `scripting` | Used together with `activeTab` for that “Activate on this page” fallback only. |
| Content script on `http://*/*`, `https://*/*` | Needed to read page text and hide content — locally. Chrome shows this as “Read and change your data on all websites”. |

No `tabs`, `history`, `webRequest`, `host_permissions`, or remote code.

## Adding a website adapter

1. Create `src/content/adapters/mysite.js`:

   ```js
   export default {
     id: 'mysite',
     name: 'My Site',
     matches: (host) => /(^|\.)mysite\.com$/.test(host),
     useGeneric: false,                                 // true = also run generic discovery
     unitSelectors: ['.post-body', '.comment__text'],   // each match is analysed as one unit
     excludeSelectors: ['.post-meta', '.signature'],    // never analysed
     // Optional: block a larger element than the analysed unit
     getBlockTarget: (unit) => unit.closest('.post') || unit,
     // Optional: content the site itself labels as AI-generated
     findLabeledAI: (root) => [...root.querySelectorAll('.ai-summary')].map((element) => ({ element, label: 'AI summary' })),
   };
   ```

2. Import it in `src/content/adapters/index.js` and add it to `SITE_ADAPTERS`.
3. Add a discovery test in `tests/scanner.test.js` with a small HTML fixture of the site’s markup.

Sites where DOM changes could break functionality (editors, mail, chat apps) belong in `UNSUPPORTED_HOSTS` in the same file.

## Adding an external AI-detection provider

The engine combines any number of providers implementing the `AIProvider` interface (`src/detector/types.js`):

```js
class MyProvider extends AIProvider {
  constructor() { super({ id: 'my-api', name: 'My API', weight: 2, local: false }); }
  async isAvailable() { return true; }
  async analyze(input, options, features) {
    return { providerId: this.id, score: 0-100, signals: [], humanSignals: [] };
  }
}
engine.registerProvider(new MyProvider());
```

- Scores are combined as a weighted average with the local provider; a failing provider is ignored, so local detection always works.
- Ineligible text (too short, code, navigation, non-English) is never sent to providers.
- The content script automatically switches from the synchronous fast path to `await engine.analyze()` when an async provider is registered.
- See `src/detector/providers/remote-provider.template.js` for a complete fetch-based example. A remote provider changes the privacy model, so it must be opt-in, declare `host_permissions` for its API origin only, and be explained in the options page. (The build verifier deliberately fails on network calls until you update it.)

To add a new **local** technique instead, subclass `Detector`, return signals tagged with one of the existing families, and pass it to `new LocalProvider({ detectors: [new MyDetector()] })`.

## Testing

```bash
npm test
```

Covers: human / AI / borderline / very short / code / navigation / repeated / non-English samples, score bands and thresholds, corroboration and false-positive guards, sensitivity monotonicity, provider plug-in and failure handling, DOM discovery and exclusions, text extraction, blocking and exact restoration for every mode, dynamic content via MutationObserver, SPA navigation, settings validation and persistence, whitelist/blacklist, and the popup message protocol.

See [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md) for the in-browser checklist.

## Support

If you find AI Content Blocker useful, you can support the developer:

**[☕ Buy Me a Coffee via PayPal](https://www.paypal.com/donate/?business=patelshamit1911%40gmail.com&item_name=Support+AI+Content+Blocker&currency_code=USD)**

The same link is in the popup and on the options page. It simply opens PayPal in a new tab; the extension does not process payments or handle any payment information.

## License

MIT
