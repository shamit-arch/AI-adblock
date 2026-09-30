// Demo-page behaviour: inserts comments dynamically and simulates SPA navigation.
const AI_COMMENT =
  'Great question! Choosing the right laptop for college ultimately depends on your specific needs and budget. First and foremost, consider the portability of the device, as you will likely be carrying it between classes. Additionally, battery life is a crucial factor, since access to power outlets may be limited. Furthermore, investing in a reliable warranty can provide valuable peace of mind. By carefully weighing these factors, you can make an informed decision that will serve you well throughout your academic journey.';
const HUMAN_COMMENT =
  "Had the same issue on my 2014 Civic. It wasn't the sensor, it was a cracked vacuum line behind the intake manifold, you can hear it hiss if you idle with the hood up. Part was like $6 at the dealer. Took me about 40 min with a 10mm socket and a lot of swearing because the clamp is in a stupid spot.";

let n = 0;
function addComment(text, author) {
  const wrap = document.createElement('div');
  wrap.className = 'comment';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${author} · just now`;
  const body = document.createElement('div');
  body.className = 'comment-body';
  body.id = `dynamic-${++n}`;
  const p = document.createElement('p');
  p.textContent = text;
  body.append(p);
  wrap.append(meta, body);
  document.getElementById('comments').append(wrap);
}

document.getElementById('add-ai').addEventListener('click', () => addComment(AI_COMMENT, 'totally_human'));
document.getElementById('add-human').addEventListener('click', () => addComment(HUMAN_COMMENT, 'civic_owner'));
document.getElementById('spa-nav').addEventListener('click', () => {
  history.pushState({}, '', `?page=${Date.now() % 1000}`);
  addComment(AI_COMMENT, 'spa_page_user');
});
