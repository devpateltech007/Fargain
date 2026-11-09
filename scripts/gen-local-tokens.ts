/**
 * Fills empty FARGAIN_API_TOKEN and IG_VERIFY_TOKEN in the repo-root .env with random values.
 * Never prints the generated values. Safe to re-run: only empty entries are filled.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../backend/src/config.js';

const file = path.join(REPO_ROOT, '.env');
if (!existsSync(file)) {
  console.error('No .env at repo root. Copy .env.example first.');
  process.exit(1);
}

let text = readFileSync(file, 'utf8');
for (const key of ['FARGAIN_API_TOKEN', 'IG_VERIFY_TOKEN']) {
  const re = new RegExp(`^${key}=\\s*$`, 'm');
  if (re.test(text)) {
    text = text.replace(re, `${key}=${randomBytes(32).toString('base64url')}`);
    console.log(`${key}: generated`);
  } else {
    console.log(`${key}: already set, left unchanged`);
  }
}
writeFileSync(file, text);
