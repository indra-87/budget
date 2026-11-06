// 데이터 계층: Supabase 또는 (설정이 비었을 때) 브라우저 localStorage 데모 모드
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const isDemo = !SUPABASE_URL || !SUPABASE_ANON_KEY;
let sb = null;
if (!isDemo) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const COLS = 'id,tx_date,item,amount,payment,merchant,area,liters,note,source,import_key,face_amount,discount_rate,created_at';
const LS_TX = 'gagyebu.demo.transactions';
const LS_SET = 'gagyebu.demo.settings';
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const check = ({ data, error }) => { if (error) throw error; return data; };

export const store = {
  isDemo,

  async getSession() {
    if (isDemo) return { demo: true };
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  onAuth(cb) { if (!isDemo) sb.auth.onAuthStateChange((_e, s) => cb(s)); },
  async signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signOut() { if (!isDemo) await sb.auth.signOut(); },

  async list() {
    if (isDemo) return lsGet(LS_TX, []);
    const all = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const rows = check(await sb.from('gb_transactions').select(COLS)
        .order('tx_date', { ascending: false }).order('created_at', { ascending: false })
        .range(from, from + PAGE - 1));
      all.push(...rows);
      if (rows.length < PAGE) break;
    }
    return all.map(fix);
  },
  async insert(rec) {
    if (isDemo) {
      const row = { ...rec, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      lsSet(LS_TX, [row, ...lsGet(LS_TX, [])]);
      return row;
    }
    return fix(check(await sb.from('gb_transactions').insert(rec).select(COLS).single()));
  },
  async insertMany(recs) {
    if (!recs.length) return [];
    if (isDemo) {
      const now = Date.now();
      const rows = recs.map((r, i) => ({ ...r, id: crypto.randomUUID(), created_at: new Date(now + i).toISOString() }));
      lsSet(LS_TX, [...rows, ...lsGet(LS_TX, [])]);
      return rows;
    }
    const out = [];
    for (let i = 0; i < recs.length; i += 200) {
      out.push(...check(await sb.from('gb_transactions').insert(recs.slice(i, i + 200)).select(COLS)));
    }
    return out.map(fix);
  },
  async update(id, rec) {
    if (isDemo) {
      const rows = lsGet(LS_TX, []).map((r) => (r.id === id ? { ...r, ...rec } : r));
      lsSet(LS_TX, rows);
      return rows.find((r) => r.id === id);
    }
    return fix(check(await sb.from('gb_transactions').update(rec).eq('id', id).select(COLS).single()));
  },
  async remove(id) {
    if (isDemo) { lsSet(LS_TX, lsGet(LS_TX, []).filter((r) => r.id !== id)); return; }
    check(await sb.from('gb_transactions').delete().eq('id', id));
  },

  async getSettings() {
    if (isDemo) return lsGet(LS_SET, {});
    const row = check(await sb.from('gb_settings').select('data').maybeSingle());
    return row?.data || {};
  },
  async saveSettings(data) {
    if (isDemo) { lsSet(LS_SET, data); return; }
    const { data: { session } } = await sb.auth.getSession();
    check(await sb.from('gb_settings').upsert(
      { user_id: session.user.id, data, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    ));
  },
};

// numeric 컬럼은 문자열로 올 수 있어 숫자로 정리
function fix(r) { return { ...r, amount: Number(r.amount), liters: r.liters == null ? null : Number(r.liters) }; }
