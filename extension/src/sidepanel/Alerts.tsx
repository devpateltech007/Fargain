import { useEffect, useState } from 'react';
import type { AlertView, Api } from './api';

/** Unseen wishlist price-drop alerts, polled every 30s while the panel is open. */
export function Alerts({ api }: { api: Api }) {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void api
        .alerts(true)
        .then((r) => alive && setAlerts(r.alerts))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [api]);

  if (!alerts.length) return null;
  return (
    <section className="card alert-card">
      <h3>Price drops</h3>
      {alerts.map((a) => (
        <div key={a.id} className="row small">
          <span>
            <strong>{a.item_title}</strong> now ${a.price.toFixed(2)} at{' '}
            {a.url ? (
              <a href={a.url} target="_blank" rel="noreferrer">
                {a.retailer}
              </a>
            ) : (
              a.retailer
            )}
            {a.detail.source === 'simulated' && <span className="muted"> (simulated)</span>}
          </span>
          <button
            className="link"
            onClick={() =>
              void api
                .markAlertSeen(a.id)
                .then(() => setAlerts((xs) => xs.filter((x) => x.id !== a.id)))
            }
          >
            dismiss
          </button>
        </div>
      ))}
    </section>
  );
}
