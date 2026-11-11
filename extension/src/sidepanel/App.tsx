import type { RiskFlag } from '@fargain/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageContext } from '../messaging';
import {
  ApiRequestError,
  createApi,
  loadSettings,
  saveSettings,
  type Api,
  type DraftResponse,
  type NegotiationView,
  type PaymentView,
  type SellerMessageResponse,
  type Settings,
  type WishlistItem,
} from './api';
import { Alerts } from './Alerts';
import { AmazonView } from './AmazonView';
import { ProfileForm } from './ProfileForm';
import { getPageContext, insertIntoPage } from './tab';

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : `$${n.toFixed(2)}`;
const errText = (e: unknown) =>
  e instanceof ApiRequestError
    ? `${e.message}${e.code ? ` (${e.code})` : ''}`
    : e instanceof Error
      ? e.message
      : String(e);

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);
  if (!settings) return <p className="muted">Loading…</p>;
  if (!settings.apiToken) return <SettingsForm initial={settings} onSave={setSettings} />;
  return (
    <Panel settings={settings} onEditSettings={() => setSettings({ ...settings, apiToken: '' })} />
  );
}

function SettingsForm({ initial, onSave }: { initial: Settings; onSave: (s: Settings) => void }) {
  const [url, setUrl] = useState(initial.backendUrl);
  const [token, setToken] = useState('');
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        const s = { backendUrl: url.trim(), apiToken: token.trim() };
        void saveSettings(s).then(() => onSave(s));
      }}
    >
      <h2>Connect to Fargain</h2>
      <label>
        Backend URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label>
        API token (FARGAIN_API_TOKEN from your .env)
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
        />
      </label>
      <button type="submit" disabled={!url || !token}>
        Save
      </button>
    </form>
  );
}

function Flags({ flags }: { flags: RiskFlag[] }) {
  if (!flags.length) return null;
  return (
    <div className="flags">
      {flags.map((f, i) => (
        <div key={`${f.code}-${i}`} className={`flag flag-${f.code}`}>
          <strong>⚠ {f.code.replace(/_/g, ' ')}</strong>
          <span>{f.detail}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({ settings, onEditSettings }: { settings: Settings; onEditSettings: () => void }) {
  const api: Api = useRef(createApi(settings)).current;
  const [ctx, setCtx] = useState<PageContext | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [neg, setNeg] = useState<NegotiationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [llmReady, setLlmReady] = useState(true);
  const syncing = useRef(false);

  const refreshPage = useCallback(async () => {
    const r = await getPageContext();
    if ('error' in r) {
      setPageError(r.error);
      setCtx(null);
    } else {
      setPageError(null);
      setCtx(r);
    }
  }, []);

  useEffect(() => {
    void api
      .health()
      .then((h) => setLlmReady(h.llm_configured))
      .catch((e) => setError(`Backend: ${errText(e)}`));
    void refreshPage();
    const onMsg = (m: { type?: string }) => {
      if (m?.type === 'fargain:pageChanged') void refreshPage();
    };
    const onTab = () => void refreshPage();
    chrome.runtime.onMessage.addListener(onMsg);
    chrome.tabs.onActivated.addListener(onTab);
    chrome.tabs.onUpdated.addListener(onTab);
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg);
      chrome.tabs.onActivated.removeListener(onTab);
      chrome.tabs.onUpdated.removeListener(onTab);
    };
  }, [api, refreshPage]);

  // Find the negotiation for the current listing URL.
  const listingUrl = ctx?.listing?.url;
  useEffect(() => {
    setNeg(null);
    if (!listingUrl) return;
    void api
      .findNegotiations(listingUrl)
      .then(async (r) =>
        r.negotiations[0] ? setNeg(await api.negotiation(r.negotiations[0].id)) : undefined,
      )
      .catch((e) => setError(errText(e)));
  }, [api, listingUrl]);

  // Forward new seller messages from the page to the backend (risk scan + agreement detection).
  const [lastSeller, setLastSeller] = useState<SellerMessageResponse | null>(null);
  useEffect(() => {
    if (!neg || !ctx || syncing.current) return;
    const pageSeller = ctx.conversation.filter((m) => m.role === 'seller');
    const known = neg.messages.filter((m) => m.role === 'seller').length;
    if (pageSeller.length <= known) return;
    syncing.current = true;
    void (async () => {
      try {
        let last: SellerMessageResponse | null = null;
        for (const m of pageSeller.slice(known)) last = await api.sellerMessage(neg.id, m.text);
        setLastSeller(last);
        setNeg(await api.negotiation(neg.id));
      } catch (e) {
        setError(errText(e));
      } finally {
        syncing.current = false;
      }
    })();
  }, [api, ctx, neg]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main>
      <header className="row">
        <h2>Fargain</h2>
        <button className="link" onClick={onEditSettings}>
          settings
        </button>
      </header>
      <p className="muted small">
        Your agent drafts. You approve and press send. PayPal sandbox only.
      </p>
      {error && <p className="error">{error}</p>}
      <Alerts api={api} />
      <ProfileForm api={api} />
      {!llmReady && (
        <p className="warn">
          LLM not configured on the backend: drafting and agreement detection are off.
        </p>
      )}
      {pageError && <p className="muted">{pageError}</p>}
      {ctx?.diagnostics && (
        <details className="card small" open={!ctx.listing}>
          <summary>Page check ({ctx.site})</summary>
          {!ctx.listing && (
            <p className="warn">
              Could not read the listing on this page. Send these results to the developer.
            </p>
          )}
          <table>
            <tbody>
              {Object.entries(ctx.diagnostics).map(([k, v]) => (
                <tr key={k}>
                  <td className="muted">{k}</td>
                  <td>{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {ctx?.listing && (
        <section className="card">
          <div className="small muted">{ctx.site}</div>
          <strong>{ctx.listing.title}</strong>
          <div>
            Asking {money(ctx.listing.price)} · Seller {ctx.listing.sellerLabel ?? '?'}
          </div>
        </section>
      )}
      {ctx?.site === 'amazon' && ctx.listing && <AmazonView api={api} ctx={ctx} />}
      {ctx?.listing && ctx.site !== 'amazon' && !neg && (
        <StartNegotiation api={api} ctx={ctx} onStarted={setNeg} run={run} busy={busy} />
      )}
      {neg && ctx && ctx.site !== 'amazon' && (
        <Negotiation
          api={api}
          neg={neg}
          setNeg={setNeg}
          lastSeller={lastSeller}
          run={run}
          busy={busy}
          llmReady={llmReady}
        />
      )}
    </main>
  );
}

type Run = (label: string, fn: () => Promise<void>) => Promise<void>;

function StartNegotiation({
  api,
  ctx,
  onStarted,
  run,
  busy,
}: {
  api: Api;
  ctx: PageContext;
  onStarted: (n: NegotiationView) => void;
  run: Run;
  busy: string | null;
}) {
  const listing = ctx.listing!;
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [itemId, setItemId] = useState<number | 'new'>('new');
  const [maxPrice, setMaxPrice] = useState('');
  const [target, setTarget] = useState('');
  useEffect(() => {
    void api.wishlist().then((r) => setItems(r.items.filter((i) => i.status !== 'purchased')));
  }, [api]);

  const start = () =>
    run('start', async () => {
      let id = itemId;
      if (id === 'new') {
        const item = await api.createItem({
          title: listing.title,
          source_url: listing.url,
          image_url: listing.imageUrl?.startsWith('http') ? listing.imageUrl : undefined,
          max_price: maxPrice ? Number(maxPrice) : undefined,
          target_price: target ? Number(target) : undefined,
        });
        id = item.id;
      }
      onStarted(
        await api.createNegotiation({
          item_id: id,
          platform: ctx.site === 'facebook_marketplace' ? 'facebook_marketplace' : 'mock_seller',
          listing_url: listing.url,
          seller_label: listing.sellerLabel,
          listing: {
            title: listing.title,
            price: listing.price,
            currency: listing.currency,
            description: listing.description,
            attributes: listing.attributes,
          },
        }),
      );
    });

  return (
    <section className="card">
      <h3>Start negotiating</h3>
      <label>
        Wishlist item
        <select
          value={itemId}
          onChange={(e) => setItemId(e.target.value === 'new' ? 'new' : Number(e.target.value))}
        >
          <option value="new">+ New item from this listing</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.title} (max {money(i.max_price)})
            </option>
          ))}
        </select>
      </label>
      {itemId === 'new' && (
        <>
          <label>
            Max price (private, never shared with the seller)
            <input
              inputMode="decimal"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="e.g. 160"
            />
          </label>
          <label>
            Target price
            <input
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="e.g. 130"
            />
          </label>
        </>
      )}
      <button onClick={start} disabled={busy !== null || (itemId === 'new' && !maxPrice)}>
        {busy === 'start' ? 'Starting…' : 'Start'}
      </button>
    </section>
  );
}

function Negotiation({
  api,
  neg,
  setNeg,
  lastSeller,
  run,
  busy,
  llmReady,
}: {
  api: Api;
  neg: NegotiationView;
  setNeg: (n: NegotiationView) => void;
  lastSeller: SellerMessageResponse | null;
  run: Run;
  busy: string | null;
  llmReady: boolean;
}) {
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [inserted, setInserted] = useState(false);
  const [confirmValue, setConfirmValue] = useState('');
  const [payment, setPayment] = useState<PaymentView | null>(null);

  const agreement = lastSeller?.agreement?.agreed ? lastSeller.agreement : null;
  useEffect(() => {
    if (agreement?.price !== undefined) setConfirmValue(String(agreement.price));
  }, [agreement?.price]);

  // Poll payment status until PayPal reports a final state.
  useEffect(() => {
    if (!payment || ['COMPLETED', 'VOIDED', 'CAPTURE_BLOCKED'].includes(payment.status)) return;
    const t = setInterval(() => {
      void api.payment(payment.id).then(async (p) => {
        setPayment(p);
        if (p.status === 'COMPLETED') setNeg(await api.negotiation(neg.id));
      });
    }, 4000);
    return () => clearInterval(t);
  }, [api, neg.id, payment, setNeg]);

  const allFlags: RiskFlag[] = [
    ...(neg.assessment?.risk_flags ?? []),
    ...neg.messages.flatMap((m) =>
      m.role === 'seller' ? ((m.ai?.risk_flags as RiskFlag[] | undefined) ?? []) : [],
    ),
  ];

  const makeDraft = () =>
    run('draft', async () => {
      const d = await api.draft(neg.id, instructions || undefined);
      setDraft(d);
      setText(d.draft.draft_message);
      setEditing(false);
      setInserted(false);
      setNeg(await api.negotiation(neg.id));
    });

  const approve = () =>
    run('approve', async () => {
      // Server re-checks the text (max price, budget disclosure, off-platform) before we insert it.
      await api.buyerMessage(neg.id, text, draft?.message.id);
      const ok = await insertIntoPage(text);
      if (!ok)
        throw new Error('Could not find the message box on the page. Copy the text manually.');
      setInserted(true);
      setDraft(null);
      setNeg(await api.negotiation(neg.id));
    });

  const confirm = () =>
    run('confirm', async () => {
      setNeg(await api.confirmPrice(neg.id, Number(confirmValue)));
    });

  const pay = () =>
    run('pay', async () => {
      const p = await api.createPayment(neg.id, neg.agreed_price!);
      setPayment(p);
      if (p.approve_url) await chrome.tabs.create({ url: p.approve_url });
    });

  return (
    <>
      <section className="card">
        <div className="row">
          <h3>Negotiation #{neg.id}</h3>
          <span className={`status status-${neg.status}`}>{neg.status}</span>
        </div>
        <div className="grid">
          <span>Fair price</span>
          <strong>{money(neg.assessment?.fair_price_estimate)}</strong>
          <span>Opening offer</span>
          <strong>{money(neg.assessment?.suggested_opening_offer)}</strong>
          <span>Your max (private)</span>
          <strong>{money(neg.item.max_price)}</strong>
          {neg.agreed_price !== null && (
            <>
              <span>Agreed</span>
              <strong>{money(neg.agreed_price)}</strong>
            </>
          )}
        </div>
        {neg.assessment && <p className="small muted">{neg.assessment.reasoning}</p>}
      </section>

      <Flags flags={allFlags} />

      {neg.status === 'open' && (
        <section className="card">
          <h3>Next message</h3>
          {!draft && (
            <>
              <input
                placeholder="Optional steer, e.g. 'ask about battery'"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
              <button onClick={makeDraft} disabled={busy !== null || !llmReady}>
                {busy === 'draft' ? 'Drafting…' : 'Draft reply'}
              </button>
            </>
          )}
          {draft && (
            <>
              {draft.blocked && (
                <p className="error">
                  Blocked by safety check: {draft.violations.map((v) => v.detail).join('; ')}. This
                  draft cannot be inserted.
                </p>
              )}
              {draft.draft.needs_user_input && (
                <p className="warn">{draft.draft.needs_user_input}</p>
              )}
              {editing ? (
                <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
              ) : (
                <blockquote>{text}</blockquote>
              )}
              <p className="small muted">
                Offer {money(draft.draft.proposed_offer)} · {draft.draft.tone} ·{' '}
                {draft.draft.reasoning}
              </p>
              <div className="row">
                <button onClick={approve} disabled={busy !== null || draft.blocked || !text.trim()}>
                  {busy === 'approve' ? 'Checking…' : 'Approve & insert'}
                </button>
                <button className="secondary" onClick={() => setEditing(!editing)}>
                  {editing ? 'Done' : 'Edit'}
                </button>
                <button className="secondary" onClick={makeDraft} disabled={busy !== null}>
                  Regenerate
                </button>
              </div>
            </>
          )}
          {inserted && (
            <p className="ok">Inserted into the chat box. Review it and press Send on the page.</p>
          )}
        </section>
      )}

      {neg.status === 'open' && (
        <section className="card">
          <h3>Agreed price</h3>
          {agreement && (
            <p className={agreement.exceeds_max_price ? 'error' : 'ok'}>
              Seller seems to agree at {money(agreement.price)}: “{agreement.evidence_quote}”
              {agreement.exceeds_max_price && ' (above your max price)'}
            </p>
          )}
          <div className="row">
            <input
              inputMode="decimal"
              value={confirmValue}
              onChange={(e) => setConfirmValue(e.target.value)}
              placeholder="Agreed price"
            />
            <button onClick={confirm} disabled={busy !== null || !confirmValue}>
              I confirm this price
            </button>
          </div>
        </section>
      )}

      {(neg.status === 'agreed' || neg.status === 'paid' || payment) && (
        <section className="card">
          <h3>Pay with PayPal (sandbox)</h3>
          <button
            onClick={pay}
            disabled={neg.status !== 'agreed' || busy !== null || payment !== null}
          >
            {busy === 'pay' ? 'Creating…' : `Create PayPal payment for ${money(neg.agreed_price)}`}
          </button>
          {payment && (
            <p className="small">
              Payment #{payment.id}: <strong>{payment.status}</strong>
              {payment.approve_url && payment.status !== 'COMPLETED' && (
                <>
                  {' '}
                  ·{' '}
                  <a href={payment.approve_url} target="_blank" rel="noreferrer">
                    approve in PayPal
                  </a>
                </>
              )}
            </p>
          )}
          {neg.status === 'paid' && <p className="ok">Paid. Your agent haggled, PayPal settled.</p>}
        </section>
      )}

      <section className="card">
        <h3>Conversation log</h3>
        <ol className="log">
          {neg.messages.map((m) => (
            <li key={m.id} className={`log-${m.role}`}>
              <span className="small muted">{m.role.replace('_', ' ')}</span> {m.text}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
