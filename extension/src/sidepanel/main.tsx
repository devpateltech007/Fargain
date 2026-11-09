import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BACKEND_URL } from '../config';

function SidePanel() {
  const [status, setStatus] = useState('checking backend…');
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(() => setStatus('backend connected'))
      .catch((e: Error) => setStatus(`backend unreachable: ${e.message}`));
  }, []);
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 12 }}>
      <h2>Fargain</h2>
      <p>{status}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
