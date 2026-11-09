import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [health, setHealth] = useState<string>('checking…');
  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { paypal_env: string }) => setHealth(`backend ok (PayPal ${j.paypal_env})`))
      .catch((e: Error) => setHealth(`backend unreachable: ${e.message}`));
  }, []);
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Fargain</h1>
      <p>Your agent haggles, PayPal settles.</p>
      <p>{health}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
