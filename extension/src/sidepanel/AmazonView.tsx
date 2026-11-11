import { useEffect, useState } from 'react';
import type { PageContext } from '../messaging';
import { ApiRequestError, type Api, type PricingLookupView, type WishlistItem } from './api';

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : `$${n.toFixed(2)}`;
const errText = (e: unknown) =>
  e instanceof ApiRequestError
    ? `${e.message} (${e.code})`
    : e instanceof Error
      ? e.message
      : String(e);

/** Amazon product page: cross-retailer comparison (Channel3), profile discounts, watch for drops. */
export function AmazonView({ api, ctx }: { api: Api; ctx: PageContext }) {
  const listing = ctx.listing!;
  const [data, setData] = useState<PricingLookupView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [watched, setWatched] = useState<WishlistItem | null>(null);
  const [target, setTarget] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const key = `${listing.url}|${listing.price ?? ''}`;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .pricingLookup({
        product_title: listing.title,
        brand: listing.attributes?.brand,
        current_price: listing.price,
        current_retailer: 'amazon.com',
      })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errText(e)))
      .finally(() => !cancelled && setLoading(false));
    void api
      .wishlist()
      .then(
        (r) => !cancelled && setWatched(r.items.find((i) => i.source_url === listing.url) ?? null),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);

  const watch = async () => {
    setMsg(null);
    try {
      const item = await api.createItem({
        title: data?.query ?? listing.title,
        source_url: listing.url,
        image_url: listing.imageUrl?.startsWith('http') ? listing.imageUrl : undefined,
        target_price: target ? Number(target) : undefined,
        max_price: maxPrice ? Number(maxPrice) : undefined,
      });
      // Link Channel3 products to the item so the price watch can follow them.
      await api.pricingLookup({ item_id: item.id, query: data?.query });
      setWatched(item);
      setMsg('Watching. You will see an alert here when a retailer drops to your target.');
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const simulate = async () => {
    if (!watched) return;
    try {
      const r = await api.simulateDrop(watched.id);
      setMsg(`Simulated drop: ${money(r.alert.price)} at ${r.alert.retailer} (demo only).`);
    } catch (e) {
      setMsg(errText(e));
    }
  };

  if (loading) return <p className="muted">Comparing prices across retailers…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!data) return null;

  const used = data.offers.filter((o) => !o.excluded);
  const excluded = data.offers.filter((o) => o.excluded);
  const best = data.discounts.best_after_discounts;

  return (
    <>
      <section className="card">
        <h3>Price check</h3>
        <p className="small muted">
          Searched Channel3 for “{data.query}” ({data.matched_products.length} matching products,{' '}
          {data.offer_count_used} US offers)
        </p>
        <div className="grid">
          <span>Amazon</span>
          <strong>{money(listing.price)}</strong>
          <span>Best elsewhere</span>
          <strong>
            {money(data.best_offer?.price)}{' '}
            {data.best_offer && <span className="small muted">{data.best_offer.domain}</span>}
          </strong>
          <span>Typical price</span>
          <strong>{money(data.fair_price)}</strong>
          {data.savings_vs_current !== null && data.savings_vs_current > 0 && (
            <>
              <span>You could save</span>
              <strong className="ok-text">{money(data.savings_vs_current)}</strong>
            </>
          )}
        </div>
        {data.best_offer === null && (
          <p className="warn">No reliable exact matches found on other retailers.</p>
        )}
      </section>

      {data.discounts.profile_discounts > 0 && (
        <section className="card">
          <h3>Your discounts</h3>
          {data.current && (
            <p className="small">
              Amazon after your discounts: <strong>{money(data.current.final_price)}</strong>
              {data.current.applied.map((a) => ` · ${a.label}`).join('')}
            </p>
          )}
          {best && (
            <p className="small">
              Best after discounts: <strong>{money(best.final_price)}</strong> at {best.domain}
              {best.applied.map((a) => ` · ${a.label}`).join('')}
            </p>
          )}
          {data.current?.skipped.map((s) => (
            <p key={s.label} className="small muted">
              {s.label}: {s.reason}
            </p>
          ))}
          <p className="small muted">
            Discounts are the ones you entered. Retailers may not allow stacking, so treat totals as
            “up to”.
          </p>
        </section>
      )}

      <section className="card">
        <h3>Offers</h3>
        <table className="small">
          <tbody>
            {used.map((o) => (
              <tr key={o.domain}>
                <td>
                  {o.url ? (
                    <a href={o.url} target="_blank" rel="noreferrer">
                      {o.domain}
                    </a>
                  ) : (
                    o.domain
                  )}
                </td>
                <td>{money(o.price)}</td>
                <td className="muted">
                  {o.compare_at_price ? `was ${money(o.compare_at_price)}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {excluded.length > 0 && (
          <details className="small muted">
            <summary>{excluded.length} offers not counted</summary>
            {excluded.map((o) => (
              <div key={o.domain}>
                {o.domain} {money(o.price)} ({o.excluded?.replace(/_/g, ' ')})
              </div>
            ))}
          </details>
        )}
      </section>

      {data.alternatives.length > 0 && (
        <section className="card">
          <h3>Cheaper alternatives</h3>
          {data.alternatives.map((a) => (
            <div key={a.product_id} className="small">
              {a.url ? (
                <a href={a.url} target="_blank" rel="noreferrer">
                  {a.title}
                </a>
              ) : (
                a.title
              )}{' '}
              · {money(a.lowest_price)} <span className="muted">{a.domain}</span>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h3>Price watch</h3>
        {watched ? (
          <>
            <p className="small">On your wishlist (target {money(watched.target_price)}).</p>
            <button className="secondary" onClick={() => void simulate()}>
              Simulate price drop (demo)
            </button>
          </>
        ) : (
          <>
            <label>
              Target price (alert when any retailer reaches it)
              <input
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="e.g. 260"
              />
            </label>
            <label>
              Max price (private)
              <input
                inputMode="decimal"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="optional"
              />
            </label>
            <button onClick={() => void watch()} disabled={!target}>
              Add to wishlist & watch
            </button>
          </>
        )}
        {msg && <p className="small">{msg}</p>}
      </section>
    </>
  );
}
