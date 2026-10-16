// Level 2 — the authorization matrix the instruction specifies, exercised
// against the HTTP API rather than the browser: "Do not rely only on browser
// testing. Test APIs directly."
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trimStart().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^"|"$/g,'')]}));
const pw = Object.fromEntries(readFileSync('.env.level2-test-accounts','utf8').split('\n')
  .filter(l=>l.includes('@')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));

const SUPA = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const KEY  = env.SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const REF  = new URL(SUPA).hostname.split('.')[0];
const BASE = 'http://localhost:3000';

let gateCookie = '';
export async function openGate() {
  // Level 2 authorizes by account; there is no shared access code to open.
  gateCookie = '';
}

export async function signIn(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method:'POST', headers:{apikey:KEY,'Content-Type':'application/json'},
    body: JSON.stringify({ email, password: pw[email] }),
  });
  const s = await r.json();
  if (!r.ok) throw new Error(`${email}: ${JSON.stringify(s)}`);
  const token = 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64url');
  return { email, userId: s.user.id, cookie: `${gateCookie}; sb-${REF}-auth-token=${token}` };
}

export async function api(actor, path, init = {}) {
  const r = await fetch(BASE + path, {
    ...init,
    headers: { cookie: actor?.cookie ?? gateCookie, 'Content-Type':'application/json', ...(init.headers??{}) },
    redirect: 'manual',
  });
  const body = await r.text();
  return { status: r.status, body };
}

export function stage(id, name) {
  return { stage: { id, name, style:'professional', agentIds:[], dslVersion:'0.3.0',
    createdAt: Date.now(), updatedAt: Date.now(), description:'', videoManifest:{} },
    scenes: [], outlines: { outlines: [] } };
}
