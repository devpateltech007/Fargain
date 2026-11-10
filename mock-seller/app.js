// @ts-check
import { LISTING, createSellerBot } from './seller-bot.js';

/**
 * Page controller. The conversation is kept in sessionStorage so a reload does not lose it.
 * "Reset demo" starts a fresh run with a new ?run= id, which gives the extension a new listing
 * URL and therefore a fresh negotiation.
 */

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') === 'scam' ? 'scam' : 'standard';
let run = params.get('run');
if (!run) {
  run = Date.now().toString(36);
  params.set('run', run);
  params.set('scenario', scenario);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
const storageKey = `mock-seller:${scenario}:${run}`;

const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

// Listing
/** @type {HTMLImageElement} */ ($('[data-testid="listing-image"]')).src = LISTING.image;
$('[data-testid="listing-title"]').textContent = LISTING.title;
$('[data-testid="listing-price"]').textContent = `$${LISTING.price}`;
$('[data-testid="listing-condition"]').textContent = LISTING.condition;
$('[data-testid="listing-location"]').textContent = LISTING.location;
$('[data-testid="listing-description"]').textContent = LISTING.description;
$('[data-testid="seller-name"]').textContent = LISTING.seller;
$('[data-testid="seller-name-chat"]').textContent = LISTING.seller;

const scenarioSelect = /** @type {HTMLSelectElement} */ ($('#scenario'));
scenarioSelect.value = scenario;
const restart = (/** @type {string} */ sc) => {
  location.search = `?scenario=${sc}&run=${Date.now().toString(36)}`;
};
scenarioSelect.addEventListener('change', () => restart(scenarioSelect.value));
$('#reset').addEventListener('click', () => {
  sessionStorage.removeItem(storageKey);
  restart(scenario);
});

// Chat
/** @type {{role: 'buyer'|'seller', text: string, at: string}[]} */
const log = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
const bot = createSellerBot({ scenario });
// Replay buyer turns so the bot's state matches the stored conversation.
for (const m of log) if (m.role === 'buyer') bot.reply(m.text);

const chat = $('#chat-log');
const compose = /** @type {HTMLTextAreaElement} */ ($('#compose'));
const typing = $('#typing');

function render() {
  chat.replaceChildren(
    ...log.map((m) => {
      const li = document.createElement('li');
      li.className = `msg msg-${m.role}`;
      li.dataset.role = m.role;
      li.dataset.at = m.at;
      const p = document.createElement('p');
      p.className = 'msg-text';
      p.textContent = m.text;
      li.append(p);
      return li;
    }),
  );
  chat.scrollTop = chat.scrollHeight;
}

function push(/** @type {'buyer'|'seller'} */ role, /** @type {string} */ text) {
  log.push({ role, text, at: new Date().toISOString() });
  sessionStorage.setItem(storageKey, JSON.stringify(log));
  render();
}

function send() {
  const text = compose.value.trim();
  if (!text) return;
  compose.value = '';
  push('buyer', text);
  typing.hidden = false;
  setTimeout(() => {
    typing.hidden = true;
    push('seller', bot.reply(text));
  }, 1200);
}

$('#compose-form').addEventListener('submit', (e) => {
  e.preventDefault();
  send();
});
compose.addEventListener('keydown', (e) => {
  // The PERSON presses Enter; the extension never synthesizes key events.
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

render();
