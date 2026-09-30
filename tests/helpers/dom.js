import { HUMAN, AI } from '../fixtures/samples.js';

/** Poll until `fn()` is truthy or time out. */
export async function waitFor(fn, { timeout = 3000, interval = 10 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const p = (text) =>
  text
    .split('\n')
    .map((line) => `<p>${line}</p>`)
    .join('');

/** A realistic page mixing site chrome, human content and AI content. */
export function buildTestPage() {
  return `
    <header class="site-header"><nav><a href="/">Home</a> <a href="/news">News</a> <a href="/about">About us and our story, contact information, careers and more links</a></nav></header>
    <div id="cookie-banner" class="cookie-consent">We use cookies to improve your experience. In today's fast-paced digital world, cookies play a crucial role. By continuing, you agree to our use of cookies. Moreover, it's important to note that you can change settings anytime.</div>
    <main>
      <article id="ai-article">
        <h1>Content Marketing Guide</h1>
        <div class="article-content" id="ai-body">${p(AI.seoIntro)}</div>
      </article>
      <section class="comments">
        <div class="comment" id="c1"><div class="meta">user123 · 3h</div><div class="comment-body" id="human-comment">${p(HUMAN.casualComment)}</div></div>
        <div class="comment" id="c2"><div class="meta">helpful_bot · 2h</div><div class="comment-body" id="ai-comment">${p(AI.chatbotComment)}</div></div>
        <div class="comment" id="c3"><div class="meta">dave · 1h</div><div class="comment-body" id="human-comment-2">${p(HUMAN.forumAnswer)}</div></div>
      </section>
      <pre><code id="code-block">${AI.listicle}</code></pre>
      <form><textarea id="ta">${AI.seoIntro}</textarea><input type="text" value="Certainly! Here are some ways"></form>
      <ul id="features"><li>Short item</li><li>Another item</li></ul>
    </main>
    <footer><p id="footer-text">${AI.subtleCorporate}</p></footer>
  `;
}
