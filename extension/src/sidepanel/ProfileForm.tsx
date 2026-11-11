import { useEffect, useState } from 'react';
import { ApiRequestError, type Api, type ProfileView } from './api';

type Discount = ProfileView['discounts'][number];
const empty: Discount = { label: '', percent: 10, domains: [], requires: 'none' };

/**
 * Manually entered profile (no retailer logins, no email scanning). Discounts listed here are the
 * only ones Fargain ever applies.
 */
export function ProfileForm({ api }: { api: Api }) {
  const [p, setP] = useState<ProfileView | null>(null);
  const [memberships, setMemberships] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void api.profile().then((r) => {
      setP(r.profile);
      setMemberships(r.profile.memberships.join(', '));
    });
  }, [api]);

  if (!p) return null;
  const setDiscount = (i: number, d: Partial<Discount>) =>
    setP({ ...p, discounts: p.discounts.map((x, j) => (j === i ? { ...x, ...d } : x)) });

  const save = async () => {
    setMsg(null);
    try {
      const body: ProfileView = {
        ...p,
        birthday: p.birthday || undefined,
        memberships: memberships
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        discounts: p.discounts.filter((d) => d.label.trim()),
      };
      const r = await api.saveProfile(body);
      setP(r.profile);
      setMsg('Saved.');
    } catch (e) {
      setMsg(
        e instanceof ApiRequestError
          ? `${e.message}: ${JSON.stringify(e.details ?? '')}`
          : String(e),
      );
    }
  };

  return (
    <details className="card small">
      <summary>Your profile & discounts</summary>
      <label className="row">
        <span>Student</span>
        <input
          type="checkbox"
          style={{ width: 'auto' }}
          checked={p.student}
          onChange={(e) => setP({ ...p, student: e.target.checked })}
        />
      </label>
      <label>
        Birthday
        <input
          type="date"
          value={p.birthday ?? ''}
          onChange={(e) => setP({ ...p, birthday: e.target.value || undefined })}
        />
      </label>
      <label>
        Memberships (comma separated)
        <input
          value={memberships}
          onChange={(e) => setMemberships(e.target.value)}
          placeholder="e.g. Amazon Prime, Best Buy Plus"
        />
      </label>
      <strong>Discounts you have</strong>
      {p.discounts.map((d, i) => (
        <div key={i} className="discount-row">
          <input
            placeholder="Label"
            value={d.label}
            onChange={(e) => setDiscount(i, { label: e.target.value })}
          />
          <input
            inputMode="decimal"
            placeholder="%"
            value={String(d.percent)}
            onChange={(e) => setDiscount(i, { percent: Number(e.target.value) || 0 })}
          />
          <input
            placeholder="only at (e.g. bestbuy.com)"
            value={d.domains.join(', ')}
            onChange={(e) =>
              setDiscount(i, {
                domains: e.target.value
                  .split(',')
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean),
              })
            }
          />
          <select
            value={d.requires}
            onChange={(e) => setDiscount(i, { requires: e.target.value as Discount['requires'] })}
          >
            <option value="none">always</option>
            <option value="student">if student</option>
            <option value="birthday_month">birthday month</option>
          </select>
          <button
            className="link"
            onClick={() => setP({ ...p, discounts: p.discounts.filter((_, j) => j !== i) })}
          >
            remove
          </button>
        </div>
      ))}
      <div className="row">
        <button
          className="secondary"
          onClick={() => setP({ ...p, discounts: [...p.discounts, { ...empty }] })}
        >
          + Add discount
        </button>
        <button onClick={() => void save()}>Save profile</button>
      </div>
      {msg && <p className="small">{msg}</p>}
    </details>
  );
}
