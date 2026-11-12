import type { ContentRequest, ContentResponse, PageContext } from '../messaging';

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function send(req: ContentRequest): Promise<ContentResponse> {
  const id = await activeTabId();
  if (id === undefined) return { ok: false, error: 'no active tab' };
  try {
    return (await chrome.tabs.sendMessage(id, req)) as ContentResponse;
  } catch {
    // No content script on this page (unsupported site, or the page was open before install).
    return {
      ok: false,
      error: 'Fargain is not active on this page. Open a supported page (or reload it).',
    };
  }
}

export async function getPageContext(): Promise<PageContext | { error: string }> {
  const r = await send({ type: 'fargain:getContext' });
  if (r.ok && 'context' in r) return r.context;
  return { error: r.ok ? 'unexpected response' : r.error };
}

/** Fill the page's compose box for ordinary, buyer-reviewed drafts. */
export async function insertIntoPage(text: string): Promise<boolean> {
  const r = await send({ type: 'fargain:insert', text });
  return r.ok && 'inserted' in r ? r.inserted : false;
}

/** Send through the active adapter's positively identified control for opted-in autopilot. */
export async function sendFromPage(text: string): Promise<boolean> {
  const r = await send({ type: 'fargain:send', text });
  return r.ok && 'sent' in r ? r.sent : false;
}
