// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockSellerAdapter } from './adapter';

/**
 * Runs the adapter against the REAL mock-seller/index.html markup, with the listing/chat filled
 * the way mock-seller/app.js fills it, so selector drift between the page and the adapter fails here.
 */
// Vitest runs from the repo root; under happy-dom import.meta.url is not a file: URL.
// External <link>/<script> tags are stripped so happy-dom does not try to fetch them.
const html = readFileSync(path.join(process.cwd(), 'mock-seller', 'index.html'), 'utf8')
  .replace(/<link[^>]*>/gi, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '');

function loadPage() {
  document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '');
  // happy-dom drops body attributes when setting innerHTML on <html>; restore the marker.
  document.body.dataset.fargainSite = 'mock_seller';
  const set = (id: string, v: string) =>
    (document.querySelector(`[data-testid="${id}"]`)!.textContent = v);
  set('listing-title', 'Sony WH-1000XM5 Wireless Headphones');
  set('listing-price', '$180');
  set('listing-condition', 'Used - Like New');
  set('listing-location', 'Brooklyn, NY');
  set('listing-description', 'Barely used.');
  set('seller-name', 'Jordan M.');
  const log = document.querySelector('[data-testid="chat-log"]')!;
  for (const [role, text] of [
    ['buyer', 'Hi, is this available?'],
    ['seller', 'Yes! Asking $180.'],
  ]) {
    const li = document.createElement('li');
    li.className = `msg msg-${role}`;
    li.dataset.role = role;
    const p = document.createElement('p');
    p.className = 'msg-text';
    p.textContent = text!;
    li.append(p);
    log.append(li);
  }
}

describe('MockSellerAdapter', () => {
  beforeEach(loadPage);

  it('detects the page and reads the listing', () => {
    const a = createMockSellerAdapter(document);
    expect(a.detect()).toBe(true);
    expect(a.getListing()).toMatchObject({
      title: 'Sony WH-1000XM5 Wireless Headphones',
      price: 180,
      currency: 'USD',
      sellerLabel: 'Jordan M.',
      attributes: { condition: 'Used - Like New', location: 'Brooklyn, NY' },
    });
  });

  it('reads the conversation in order', () => {
    expect(createMockSellerAdapter(document).getConversation()).toEqual([
      { role: 'buyer', text: 'Hi, is this available?', timestamp: undefined },
      { role: 'seller', text: 'Yes! Asking $180.', timestamp: undefined },
    ]);
  });

  it('insertMessage fills the compose box but never sends', () => {
    let submitted = false;
    let clicked = false;
    let enter = false;
    document.querySelector('form')!.addEventListener('submit', () => (submitted = true));
    document
      .querySelector('[data-testid="send"]')!
      .addEventListener('click', () => (clicked = true));
    const box = document.querySelector<HTMLTextAreaElement>('[data-testid="compose"]')!;
    box.addEventListener('keydown', (e) => (enter ||= e.key === 'Enter'));
    let inputEvents = 0;
    box.addEventListener('input', () => inputEvents++);

    expect(createMockSellerAdapter(document).insertMessage('Would you take $140?')).toBe(true);
    expect(box.value).toBe('Would you take $140?');
    expect(inputEvents).toBe(1);
    expect(submitted || clicked || enter).toBe(false);
    expect(document.querySelectorAll('[data-testid="chat-log"] .msg')).toHaveLength(2);
  });

  it('does not detect other pages', () => {
    document.documentElement.innerHTML = '<body><h1>Some other site</h1></body>';
    expect(createMockSellerAdapter(document).detect()).toBe(false);
  });
});
