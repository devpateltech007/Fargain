import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Tab =
  'Overview' | 'Wishlist' | 'Negotiations' | 'Payments' | 'Activity' | 'Instagram' | 'Profile';
type Item = {
  id: number;
  title: string;
  source: string;
  status: string;
  source_url: string | null;
  target_price: number | null;
  max_price: number | null;
  best_price: number | null;
  unseen_alerts: number;
};
type Negotiation = {
  id: number;
  item_id: number;
  platform: string;
  seller_label: string | null;
  status: string;
  agreed_price: number | null;
  listing_url: string | null;
};
type Message = { id: number; role: string; text: string; created_at: string; ai: unknown };
type Summary = {
  total: number;
  watching: number | null;
  negotiating: number | null;
  purchased: number | null;
  negotiations: number;
  payments: number;
  paid_total: number;
  saved_total: number;
};
type Payment = {
  id: number;
  negotiation_id: number;
  paypal_order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  approve_url: string | null;
  created_at: string;
  title: string;
};
type Alert = {
  id: number;
  item_id: number;
  item_title?: string;
  price: number;
  retailer: string | null;
  url: string | null;
  created_at: string;
};
type AuditEntry = {
  id: string;
  actor: string;
  action: string;
  detail: unknown;
  created_at: string;
};
type LinkStatus = { linked: boolean; pending_code: string | null; expires_at: string | null };
type DashboardData = {
  summary?: Summary;
  items?: Item[];
  negotiations?: Negotiation[];
  payments?: Payment[];
  audit?: AuditEntry[];
  alerts?: Alert[];
  link?: LinkStatus;
};
type NegotiationDetail = { messages: Message[] };
type ReelResult = {
  session_id: number;
  status: string;
  identification?: { candidates: { label: string; confidence: number; search_query: string }[] };
};
type Profile = {
  student: boolean;
  birthday?: string;
  memberships: string[];
  discounts: {
    label: string;
    percent: number;
    domains: string[];
    requires: 'none' | 'student' | 'birthday_month';
  }[];
};

const tabs: Tab[] = [
  'Overview',
  'Wishlist',
  'Negotiations',
  'Payments',
  'Activity',
  'Instagram',
  'Profile',
];
const money = (value: number | null | undefined) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const DEMO_MARKETPLACE_URL = 'https://www.facebook.com/marketplace/item/1469470546248672/';
const isSonyDemoItem = (title: string) =>
  /sony/i.test(title) && /wh[\s-]?1000\s*-?\s*xm5/i.test(title);
const initialProfile: Profile = { student: false, memberships: [], discounts: [] };

function App() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [token, setToken] = useState(() => localStorage.getItem('fargain.apiToken') ?? '');
  const [hasConnected, setHasConnected] = useState(
    () => localStorage.getItem('fargain.connected') === 'yes',
  );
  const [tokenInput, setTokenInput] = useState(token);
  const [data, setData] = useState<DashboardData>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [auditFilter, setAuditFilter] = useState('');
  const [newItem, setNewItem] = useState({
    title: '',
    source_url: '',
    target_price: '',
    max_price: '',
  });
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [igUrl, setIgUrl] = useState('');
  const [igBudget, setIgBudget] = useState('130');
  const [igResult, setIgResult] = useState<ReelResult | null>(null);

  const request = useCallback(
    async <T,>(path: string, method = 'GET', body?: unknown): Promise<T> => {
      const response = await fetch(path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result: unknown = response.status === 204 ? null : await response.json();
      if (!response.ok) {
        const payload = result as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
      }
      return result as T;
    },
    [token],
  );

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [summary, wishlist, negotiations, payments, audit, alerts, profileResult, link] =
        await Promise.all([
          request<Summary>('/api/dashboard/summary'),
          request<{ items: Item[] }>('/api/dashboard/wishlist'),
          request<{ negotiations: Negotiation[] }>('/api/negotiations'),
          request<{ payments: Payment[] }>('/api/dashboard/payments'),
          request<{ entries: AuditEntry[] }>('/api/dashboard/audit?limit=100'),
          request<{ alerts: Alert[] }>('/api/alerts'),
          request<{ profile: Profile }>('/api/profile'),
          request<LinkStatus>('/api/link/status'),
        ]);
      setData({
        summary,
        items: wishlist.items,
        negotiations: negotiations.negotiations,
        payments: payments.payments,
        audit: audit.entries,
        alerts: alerts.alerts,
        link,
      });
      setProfile(profileResult.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load dashboard');
    } finally {
      setBusy(false);
    }
  }, [request]);

  useEffect(() => {
    if (hasConnected) void load();
  }, [hasConnected, token, load]);
  const itemById = useMemo(
    () => new Map<number, Item>((data.items ?? []).map((item: Item) => [item.id, item])),
    [data.items],
  );

  async function act(fn: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function addItem(event: React.FormEvent) {
    event.preventDefault();
    await act(() =>
      request('/api/wishlist', 'POST', {
        title: newItem.title,
        source: 'manual',
        ...(newItem.source_url ? { source_url: newItem.source_url } : {}),
        ...(newItem.target_price ? { target_price: Number(newItem.target_price) } : {}),
        ...(newItem.max_price ? { max_price: Number(newItem.max_price) } : {}),
      }),
    );
    setNewItem({ title: '', source_url: '', target_price: '', max_price: '' });
  }

  async function savePrices(event: React.FormEvent) {
    event.preventDefault();
    if (!editItem) return;
    const target = (document.getElementById('edit-target') as HTMLInputElement).value;
    const max = (document.getElementById('edit-max') as HTMLInputElement).value;
    await act(() =>
      request(`/api/wishlist/${editItem.id}`, 'PATCH', {
        target_price: target ? Number(target) : null,
        max_price: max ? Number(max) : null,
      }),
    );
    setEditItem(null);
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    await act(() => request('/api/profile', 'PUT', profile));
  }

  async function startLink() {
    const result = await request<{ code: string; expires_at: string }>(
      '/api/link/start',
      'POST',
      {},
    );
    await load();
    setData((old) => ({
      ...old,
      link: {
        ...old.link,
        linked: false,
        pending_code: result.code,
        expires_at: result.expires_at,
      },
    }));
  }

  async function identifyReel(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setIgResult(null);
    try {
      setIgResult(
        await request<ReelResult>('/api/reels/identify', 'POST', {
          url: igUrl,
          ...(igBudget ? { buyer_max_price: Number(igBudget) } : {}),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not identify product');
    } finally {
      setBusy(false);
    }
  }

  async function confirmReel(choice: number) {
    if (!igResult) return;
    await act(() => request(`/api/reels/${igResult.session_id}/confirm`, 'POST', { choice }));
    setIgResult({ ...igResult, status: 'added' });
  }

  const header = (
    <header className="topbar">
      <div className="brandmark">f</div>
      <div>
        <strong>Fargain</strong>
        <span>Intuitive buying experience.</span>
      </div>
      <div className="top-actions">
        <span className="connection">
          <i /> {busy ? 'Syncing' : error ? 'Needs attention' : 'Connected'}
        </span>
        <button className="icon-btn" onClick={() => void load()} aria-label="Refresh">
          ↻
        </button>
      </div>
    </header>
  );
  if (!hasConnected)
    return (
      <>
        {header}
        <main className="setup">
          <div className="eyebrow">YOUR BUYING COMMAND CENTER</div>
          <h1>Buy with confidence.</h1>
          <p>
            Connect to your private backend with your API token. Your token stays in this browser.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              localStorage.setItem('fargain.apiToken', tokenInput);
              localStorage.setItem('fargain.connected', 'yes');
              setToken(tokenInput);
              setHasConnected(true);
            }}
          >
            <label>
              Backend API token
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Paste FARGAIN_API_TOKEN"
                autoComplete="off"
              />
            </label>
            <button className="primary">
              Connect dashboard <span>→</span>
            </button>
          </form>
          <small>
            For local development without a token, leave this field blank and press Connect.
          </small>
        </main>
      </>
    );

  return (
    <div className="app-shell">
      {header}
      <div className="layout">
        <aside className="sidebar">
          <div className="nav-label">WORKSPACE</div>
          {tabs.map((name, index) => (
            <button
              key={name}
              className={`nav-item ${tab === name ? 'active' : ''}`}
              onClick={() => setTab(name)}
            >
              <span className="nav-icon">{['◫', '♡', '↔', '$', '≡', '◎', '◉'][index]}</span>
              {name}
              {name === 'Wishlist' && (data.alerts?.length ?? 0) > 0 && (
                <b className="badge">{data.alerts?.length}</b>
              )}
            </button>
          ))}
          <div className="sidebar-bottom">
            <div className="avatar">F</div>
            <div>
              <b>Personal workspace</b>
              <small>Private account</small>
            </div>
            <button
              className="icon-btn"
              onClick={() => {
                localStorage.removeItem('fargain.apiToken');
                localStorage.removeItem('fargain.connected');
                setToken('');
                setHasConnected(false);
              }}
              aria-label="Disconnect"
            >
              ↗
            </button>
          </div>
        </aside>
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {tab === 'Overview' ? 'YOUR DEALS AT A GLANCE' : 'FARGAIN WORKSPACE'}
              </div>
              <h1>{tab}</h1>
            </div>
            <button className="secondary" onClick={() => void load()}>
              ↻ &nbsp;Refresh
            </button>
          </div>
          {error && (
            <div className="error-banner">
              {error}
              <button onClick={() => setError('')}>×</button>
            </div>
          )}
          {tab === 'Overview' && (
            <>
              <section className="welcome-card">
                <div>
                  <span className="pill">✦ &nbsp; YOUR PERSONAL DEAL AGENT</span>
                  <h2>Buy with confidence.</h2>
                  <p>
                    Keep your finds in one place. We’ll watch prices and help you negotiate
                    confidently.
                  </p>
                  <button className="light-btn" onClick={() => setTab('Wishlist')}>
                    Explore your wishlist <span>→</span>
                  </button>
                </div>
                <div className="hero-orbit">
                  <div className="orbit-ring ring-a" />
                  <div className="orbit-ring ring-b" />
                  <div className="hero-core">
                    f<span>✦</span>
                  </div>
                  <div className="float-tag tag-one">↓ Price drop</div>
                  <div className="float-tag tag-two">✓ Deal found</div>
                </div>
              </section>
              <section className="stat-grid">
                {[
                  ['Saved vs retail', money(data.summary?.saved_total), '↘', 'mint'],
                  ['Wishlist items', data.summary?.total ?? '—', '♡', 'lavender'],
                  ['Negotiations', data.summary?.negotiations ?? '—', '↔', 'peach'],
                  ['Payments', data.summary?.payments ?? '—', '$', 'blue'],
                ].map(([label, value, icon, color]) => (
                  <article className="stat-card" key={String(label)}>
                    <div className={`stat-icon ${color}`}>{icon}</div>
                    <small>{label}</small>
                    <strong>{value}</strong>
                    <span className="stat-foot">
                      {label === 'Saved vs retail' ? 'Across confirmed deals' : 'In your workspace'}
                    </span>
                  </article>
                ))}
              </section>
              <div className="two-col">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Recent finds</h3>
                      <p>Products you’re keeping an eye on</p>
                    </div>
                    <button className="text-btn" onClick={() => setTab('Wishlist')}>
                      View all →
                    </button>
                  </div>
                  {(data.items ?? []).slice(0, 4).map((item: Item) => (
                    <div className="mini-row" key={item.id}>
                      <div className="product-thumb">{item.source === 'instagram' ? '◎' : '◇'}</div>
                      <div className="grow">
                        <b>{item.title}</b>
                        <small>
                          {item.source} · {item.status}
                        </small>
                      </div>
                      <div className="price-stack">
                        <b>{money(item.best_price)}</b>
                        <small>best found</small>
                      </div>
                    </div>
                  ))}
                  {!data.items?.length && (
                    <Empty>Nothing on your list yet. Add a product to start watching.</Empty>
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Price alerts</h3>
                      <p>Recent drops worth a look</p>
                    </div>
                    <span className="badge">{data.alerts?.length ?? 0}</span>
                  </div>
                  {(data.alerts ?? []).slice(0, 4).map((alert) => (
                    <div className="alert-row" key={alert.id}>
                      <div className="alert-spark">↘</div>
                      <div className="grow">
                        <b>
                          {alert.item_title ??
                            itemById.get(alert.item_id)?.title ??
                            'Wishlist item'}
                        </b>
                        <small>
                          {alert.retailer ?? 'Price drop'} ·{' '}
                          {new Date(alert.created_at).toLocaleDateString()}
                        </small>
                      </div>
                      <strong>{money(alert.price)}</strong>
                    </div>
                  ))}
                  {!data.alerts?.length && (
                    <Empty>No new price drops. We’ll show alerts here.</Empty>
                  )}
                </section>
              </div>
              <section className="panel quick-panel">
                <div>
                  <h3>Quick actions</h3>
                  <p>Pick up where you left off</p>
                </div>
                <button onClick={() => setTab('Wishlist')}>＋ Add to wishlist</button>
                <button onClick={() => setTab('Instagram')}>◎ Identify a reel</button>
                <button onClick={() => setTab('Profile')}>✦ Set up discounts</button>
              </section>
            </>
          )}
          {tab === 'Wishlist' && (
            <>
              <section className="panel form-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Add something to watch</h3>
                    <p>Set a target and a hard max. Your max is enforced by the backend.</p>
                  </div>
                </div>
                <form className="add-form" onSubmit={addItem}>
                  <label>
                    Product name
                    <input
                      required
                      value={newItem.title}
                      onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                      placeholder="e.g. Sony WH-1000XM5"
                    />
                  </label>
                  <label>
                    Product link
                    <input
                      type="url"
                      value={newItem.source_url}
                      onChange={(e) => setNewItem({ ...newItem, source_url: e.target.value })}
                      placeholder="https://…"
                    />
                  </label>
                  <label>
                    Target price
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newItem.target_price}
                      onChange={(e) => setNewItem({ ...newItem, target_price: e.target.value })}
                      placeholder="$ 0.00"
                    />
                  </label>
                  <label>
                    Max price
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newItem.max_price}
                      onChange={(e) => setNewItem({ ...newItem, max_price: e.target.value })}
                      placeholder="$ 0.00"
                    />
                  </label>
                  <button className="primary">
                    Add to wishlist <span>→</span>
                  </button>
                </form>
              </section>
              <section className="panel table-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Your wishlist</h3>
                    <p>{data.items?.length ?? 0} products being tracked</p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>PRODUCT</th>
                        <th>SOURCE</th>
                        <th>TARGET</th>
                        <th>MAX</th>
                        <th>BEST PRICE</th>
                        <th>STATUS</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(data.items ?? []).map((item: Item) => (
                        <tr key={item.id}>
                          <td>
                            <b>{item.title}</b>
                            {item.source_url && (
                              <a href={item.source_url} target="_blank" rel="noreferrer">
                                Open listing ↗
                              </a>
                            )}
                          </td>
                          <td>
                            <span className="source-pill">{item.source}</span>
                            {isSonyDemoItem(item.title) && (
                              <a
                                className="demo-match-link"
                                href={DEMO_MARKETPLACE_URL}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open prepared Marketplace match ↗
                              </a>
                            )}
                          </td>
                          <td>{money(item.target_price)}</td>
                          <td>{money(item.max_price)}</td>
                          <td className="good-price">
                            {money(item.best_price)}
                            {item.best_price !== null &&
                              item.max_price !== null &&
                              item.best_price > item.max_price && (
                                <small className="over-budget">Above your budget</small>
                              )}
                          </td>
                          <td>
                            <span className={`status ${item.status}`}>{item.status}</span>
                            {item.unseen_alerts > 0 && (
                              <small className="alert-count">
                                {item.unseen_alerts} alert{item.unseen_alerts > 1 ? 's' : ''}
                              </small>
                            )}
                          </td>
                          <td>
                            <button className="small-btn" onClick={() => setEditItem(item)}>
                              Edit prices
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.items?.length && <Empty>Your list is ready for its first find.</Empty>}
                </div>
              </section>
            </>
          )}
          {tab === 'Negotiations' && (
            <section className="negotiation-list">
              {(data.negotiations ?? []).map((neg: Negotiation) => (
                <NegotiationCard
                  key={neg.id}
                  negotiation={neg}
                  item={itemById.get(neg.item_id)}
                  request={request}
                  act={act}
                />
              ))}
              {!data.negotiations?.length && (
                <Empty>No negotiations yet. Start one from your shopping side panel.</Empty>
              )}
            </section>
          )}
          {tab === 'Payments' && (
            <section className="panel table-panel">
              <div className="panel-heading">
                <div>
                  <h3>PayPal sandbox payments</h3>
                  <p>Every payment is capped by the wishlist max price.</p>
                </div>
                <span className="source-pill">SANDBOX</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>PRODUCT</th>
                      <th>AMOUNT</th>
                      <th>ORDER ID</th>
                      <th>STATUS</th>
                      <th>CREATED</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(data.payments ?? []).map((payment) => (
                      <tr key={payment.id}>
                        <td>
                          <b>{payment.title}</b>
                        </td>
                        <td>
                          {money(payment.amount)} {payment.currency}
                        </td>
                        <td className="mono">{payment.paypal_order_id ?? '—'}</td>
                        <td>
                          <span
                            className={`status ${payment.status === 'COMPLETED' ? 'purchased' : 'watching'}`}
                          >
                            {payment.status}
                          </span>
                        </td>
                        <td>{new Date(payment.created_at).toLocaleDateString()}</td>
                        <td>
                          {payment.approve_url && payment.status !== 'COMPLETED' && (
                            <a
                              className="small-btn link-btn"
                              href={payment.approve_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Continue in PayPal ↗
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.payments?.length && (
                  <Empty>No payments yet. Confirm a deal to create a sandbox payment.</Empty>
                )}
              </div>
            </section>
          )}
          {tab === 'Activity' && (
            <section className="panel activity-panel">
              <div className="panel-heading">
                <div>
                  <h3>Audit trail</h3>
                  <p>Actions and the reasoning behind agent suggestions</p>
                </div>
                <input
                  className="activity-filter"
                  value={auditFilter}
                  onChange={(e) => setAuditFilter(e.target.value)}
                  placeholder="Filter activity"
                  aria-label="Filter activity"
                />
              </div>
              {(data.audit ?? [])
                .filter((entry) =>
                  `${entry.action} ${entry.actor} ${JSON.stringify(entry.detail)}`
                    .toLowerCase()
                    .includes(auditFilter.toLowerCase()),
                )
                .map((entry) => (
                  <article className="activity-row" key={entry.id}>
                    <div className={`activity-dot ${entry.actor}`} />
                    <div className="grow">
                      <div className="activity-title">
                        <b>{entry.action.replaceAll('.', ' ')}</b>
                        <span>{new Date(entry.created_at).toLocaleString()}</span>
                      </div>
                      <small>{entry.actor}</small>
                      <pre>{JSON.stringify(entry.detail, null, 2)}</pre>
                    </div>
                  </article>
                ))}
              {!data.audit?.length && <Empty>Activity will appear as your agent works.</Empty>}
            </section>
          )}
          {tab === 'Instagram' && (
            <div className="two-col reel-layout">
              <section className="panel reel-card">
                <span className="round-icon">◎</span>
                <h2>Save a find from Instagram</h2>
                <p>
                  Paste a Reel or post link. Fargain uses the link as a reference and never
                  downloads the video.
                </p>
                <form onSubmit={identifyReel}>
                  <label>
                    Instagram link
                    <input
                      required
                      type="url"
                      value={igUrl}
                      onChange={(e) => setIgUrl(e.target.value)}
                      placeholder="https://www.instagram.com/reel/…"
                    />
                  </label>
                  <label>
                    Budget maximum
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={igBudget}
                      onChange={(e) => setIgBudget(e.target.value)}
                      placeholder="130"
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    Find this product <span>→</span>
                  </button>
                </form>
                {igResult && (
                  <div className="identify-result">
                    <b>
                      {igResult.status === 'added'
                        ? 'Added to your wishlist'
                        : igResult.status === 'awaiting_confirmation'
                          ? 'Choose the product'
                          : 'Could not identify the product yet'}
                    </b>
                    {igResult.status === 'awaiting_confirmation' &&
                      (igResult.identification?.candidates ?? []).map((candidate, index) => (
                        <div className="candidate" key={index}>
                          <span>{candidate.label}</span>
                          <button className="small-btn" onClick={() => void confirmReel(index + 1)}>
                            Add this
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </section>
              <section className="panel link-card">
                <div className="round-icon">⌁</div>
                <h3>Connect Instagram DMs</h3>
                <p>Link your Instagram account to save products by messaging a Reel to Fargain.</p>
                <div className="link-state">
                  <span className={`status ${data.link?.linked ? 'purchased' : 'watching'}`}>
                    {data.link?.linked ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <button className="secondary full" onClick={() => void act(startLink)}>
                  {data.link?.pending_code ? 'Generate a new code' : 'Create linking code'}
                </button>
                {data.link?.pending_code && (
                  <div className="code-box">
                    <small>ONE TIME LINK CODE</small>
                    <strong>{data.link.pending_code}</strong>
                    <span>
                      Code expires{' '}
                      {data.link.expires_at
                        ? new Date(data.link.expires_at).toLocaleString()
                        : 'soon'}
                    </span>
                    <button
                      className="text-btn"
                      onClick={() => {
                        if (data.link?.pending_code)
                          void navigator.clipboard.writeText(data.link.pending_code);
                      }}
                    >
                      Copy code
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
          {tab === 'Profile' && (
            <form className="profile-grid" onSubmit={saveProfile}>
              <section className="panel profile-card">
                <div className="panel-heading">
                  <div>
                    <h3>Your profile</h3>
                    <p>Manually entered details help find eligible discounts.</p>
                  </div>
                </div>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={profile.student}
                    onChange={(e) => setProfile({ ...profile, student: e.target.checked })}
                  />
                  <span>
                    <b>I'm a student</b>
                    <small>Apply student discounts where supported.</small>
                  </span>
                </label>
                <label>
                  Birthday
                  <input
                    type="date"
                    value={profile.birthday ?? ''}
                    onChange={(e) =>
                      setProfile({ ...profile, birthday: e.target.value || undefined })
                    }
                  />
                </label>
                <label>
                  Memberships <small>Comma separated retailer or club memberships.</small>
                  <input
                    value={profile.memberships.join(', ')}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        memberships: e.target.value
                          .split(',')
                          .map((x) => x.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="Costco, REI Co-op"
                  />
                </label>
                <button className="primary">
                  Save profile <span>→</span>
                </button>
              </section>
              <section className="panel discount-card">
                <div className="panel-heading">
                  <div>
                    <h3>Discounts</h3>
                    <p>Personal discounts applied during price comparisons.</p>
                  </div>
                </div>
                {profile.discounts.map((discount, index) => (
                  <div className="discount-row" key={`${discount.label}-${index}`}>
                    <div className="discount-icon">%</div>
                    <div className="grow">
                      <b>{discount.label}</b>
                      <small>
                        {discount.domains.length ? discount.domains.join(', ') : 'All retailers'} ·{' '}
                        {discount.requires.replace('_', ' ')}
                      </small>
                    </div>
                    <strong>{discount.percent}%</strong>
                    <button
                      type="button"
                      className="remove-btn"
                      onClick={() =>
                        setProfile({
                          ...profile,
                          discounts: profile.discounts.filter((_, i) => i !== index),
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                {!profile.discounts.length && <Empty>No custom discounts yet.</Empty>}
                <DiscountAdder
                  onAdd={(discount) =>
                    setProfile({ ...profile, discounts: [...profile.discounts, discount] })
                  }
                />
              </section>
            </form>
          )}
        </main>
      </div>
      {editItem && (
        <div className="modal-backdrop" onClick={() => setEditItem(null)}>
          <form className="modal" onSubmit={savePrices} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setEditItem(null)}>
              ×
            </button>
            <div className="eyebrow">WISHLIST ITEM</div>
            <h2>Edit price goals</h2>
            <p>{editItem.title}</p>
            <label>
              Target price
              <input
                id="edit-target"
                type="number"
                min="0"
                step="0.01"
                defaultValue={editItem.target_price ?? ''}
              />
            </label>
            <label>
              Maximum price
              <input
                id="edit-max"
                type="number"
                min="0"
                step="0.01"
                defaultValue={editItem.max_price ?? ''}
              />
            </label>
            <button className="primary">Save price goals</button>
          </form>
        </div>
      )}
    </div>
  );
}

function NegotiationCard({
  negotiation,
  item,
  request,
  act,
}: {
  negotiation: Negotiation;
  item?: Item;
  request: <T = unknown>(path: string, method?: string, body?: unknown) => Promise<T>;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [detail, setDetail] = useState<NegotiationDetail | null>(null);
  const [approvalUrl, setApprovalUrl] = useState('');
  useEffect(() => {
    void request<NegotiationDetail>(`/api/negotiations/${negotiation.id}`)
      .then(setDetail)
      .catch(() => undefined);
  }, [negotiation.id, request]);
  return (
    <article className="panel negotiation-card">
      <div className="neg-head">
        <div>
          <span className="source-pill">{negotiation.platform}</span>
          <h3>{item?.title ?? `Negotiation #${negotiation.id}`}</h3>
          <p>
            {negotiation.seller_label ?? 'Seller'} ·{' '}
            {negotiation.listing_url ? (
              <a href={negotiation.listing_url} target="_blank" rel="noreferrer">
                View listing ↗
              </a>
            ) : (
              'No listing link'
            )}
          </p>
        </div>
        <span className={`status ${negotiation.status}`}>{negotiation.status}</span>
      </div>
      <div className="neg-price">
        <span>Agreed price</span>
        <b>{money(negotiation.agreed_price)}</b>
        {item?.max_price != null && <small>Max {money(item.max_price)}</small>}
      </div>
      <div className="message-thread">
        {detail?.messages?.map((message: Message) => (
          <div className={`message ${message.role}`} key={message.id}>
            <small>{message.role.replace('buyer_', 'you · ')}</small>
            <p>{message.text}</p>
          </div>
        ))}
        {!detail?.messages?.length && <small className="muted">No messages recorded yet.</small>}
      </div>
      {approvalUrl && (
        <a className="small-btn link-btn" href={approvalUrl} target="_blank" rel="noreferrer">
          Continue to PayPal sandbox ↗
        </a>
      )}
      {negotiation.status === 'agreed' && (
        <button
          className="secondary"
          onClick={() =>
            void act(async () => {
              const result = await request<{ approve_url: string | null }>(
                '/api/payments/create',
                'POST',
                {
                  negotiation_id: negotiation.id,
                  amount: negotiation.agreed_price,
                },
              );
              setApprovalUrl(result.approve_url ?? '');
            })
          }
        >
          Create sandbox payment
        </button>
      )}
    </article>
  );
}

function DiscountAdder({ onAdd }: { onAdd: (discount: Profile['discounts'][number]) => void }) {
  const [label, setLabel] = useState('');
  const [percent, setPercent] = useState('');
  const [domains, setDomains] = useState('');
  const [requires, setRequires] = useState<'none' | 'student' | 'birthday_month'>('none');
  return (
    <div className="discount-adder">
      <b>Add a discount</b>
      <div className="discount-fields">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Discount name"
        />
        <input
          type="number"
          min="0.01"
          max="90"
          step="0.01"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          placeholder="%"
        />
        <input
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          placeholder="Domains, optional"
        />
        <select value={requires} onChange={(e) => setRequires(e.target.value as typeof requires)}>
          <option value="none">No requirement</option>
          <option value="student">Student</option>
          <option value="birthday_month">Birthday month</option>
        </select>
        <button
          type="button"
          className="small-btn"
          disabled={!label || !percent || Number(percent) > 90}
          onClick={() => {
            onAdd({
              label: label.trim(),
              percent: Number(percent),
              domains: domains
                .split(',')
                .map((x) => x.trim().toLowerCase())
                .filter(Boolean),
              requires,
            });
            setLabel('');
            setPercent('');
            setDomains('');
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span>✦</span>
      <p>{children}</p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
