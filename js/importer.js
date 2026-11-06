// ─────────────────────────────────────────────────────────────
// 카드사 명세서 가져오기 (순수 로직: 브라우저/Node 모두에서 동작)
//  1) 표(2차원 배열)에서 머리글 행과 열(날짜·가맹점·금액·승인번호·취소구분)을 찾고
//  2) 행을 정리한 뒤
//  3) 이미 저장된 내역과 비교해 신규 / 중복 의심 / 이미 가져옴 / 취소 로 분류
// ─────────────────────────────────────────────────────────────
import { norm, suggestArea, cardById, LEGACY_METHOD } from './cards.js';

// ── 사용처 이름 통일 (명세서 가맹점명 → 앱에서 쓰는 이름) ──────────
const ALIASES = [
  ['쿠팡이츠', ['쿠팡이츠']],
  ['쿠팡', ['쿠팡', 'coupang']],
  ['G마켓', ['G마켓', '지마켓', 'gmarket', '이베이코리아', '지마켓글로벌']],
  ['옥션', ['옥션', 'auction']],
  ['11번가', ['11번가', '십일번가', '11st']],
  ['네이버', ['네이버', 'naver', 'NAVER', '스마트스토어']],
  ['SSG', ['SSG', '에스에스지닷컴', '쓱닷컴']],
  ['롯데ON', ['롯데온', '롯데ON', 'lotteon']],
  ['무신사', ['무신사', 'musinsa']],
  ['29CM', ['29CM', '에이플러스비']],
  ['배달의민족', ['배달의민족', '우아한형제들', '배민']],
  ['요기요', ['요기요', '위대한상사']],
  ['땡겨요', ['땡겨요']],
  ['CJ온스타일', ['CJ온스타일', 'CJ ENM', '씨제이이엔엠']],
  ['스타벅스', ['스타벅스', 'starbucks', '에스씨케이컴퍼니']],
  ['카카오T', ['카카오T', '카카오모빌리티', '카카오택시']],
];
export function canonicalMerchant(raw) {
  const m = norm(raw);
  if (!m) return '';
  for (const [name, keys] of ALIASES) if (keys.some((k) => m.includes(norm(k)))) return name;
  return String(raw).trim();
}
export function sameMerchant(a, b) {
  const ca = norm(canonicalMerchant(a)), cb = norm(canonicalMerchant(b));
  if (!ca || !cb) return false;
  return ca === cb || ca.includes(cb) || cb.includes(ca);
}

// ── 값 파싱 ──────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function parseDate(v, today = new Date()) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') {
    if (v > 19000000 && v < 21000000) { const s = String(Math.trunc(v)); return ymd(s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)); }
    if (v > 20000 && v < 80000) { // 엑셀 날짜 일련번호
      const d = new Date(Math.round((v - 25569) * 86400000));
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return ymd(m[1], +m[2], +m[3]);
  m = s.match(/(\d{2,4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (m) {
    let y = +m[1]; if (y < 100) y += 2000;
    const mo = +m[2], d = +m[3];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? ymd(y, mo, d) : null;
  }
  m = s.match(/^(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/); // 연도 없는 날짜 → 올해(미래면 작년)
  if (m) {
    const mo = +m[1], d = +m[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    let y = today.getFullYear();
    if (ymd(y, mo, d) > ymd(y, today.getMonth() + 1, today.getDate())) y -= 1;
    return ymd(y, mo, d);
  }
  return null;
}

export function parseAmount(v) {
  if (typeof v === 'number') return Math.round(v);
  if (v == null) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  const neg = /^[-−△▲]|^\(.*\)$/.test(s);
  s = s.replace(/[^\d.]/g, '');
  if (!s) return NaN;
  const n = Math.round(parseFloat(s));
  return neg ? -n : n;
}

// ── 머리글/열 찾기 ────────────────────────────────────────────
const RX = {
  date: /(이용|거래|승인|매출|결제|사용)\s*(일자|일시|날짜|일)$|^(일자|일시|날짜)$|이용일|거래일|승인일|매출일/,
  merchant: /가맹점|이용처|사용처|상호|이용\s*하신\s*곳|거래처|이용내역/,
  approval: /승인\s*번호/,
  status: /상태|취소|승인\s*구분|매출\s*구분|거래\s*구분/,
  card: /^이용카드$|카드번호|^카드명?$/,
};
const AMOUNT_ORDER = ['이용금액', '승인금액', '거래금액', '매출금액', '결제금액', '사용금액', '청구금액', '금액'];
const AMOUNT_EXCLUDE = /수수료|포인트|할인|적립|잔액|원금|이자|외화|현지|해외|달러|usd|예정|취소금액|부가/i;

const h = (v) => String(v ?? '').replace(/\s+/g, '');
export function detectColumns(headers) {
  const hs = headers.map(h);
  const find = (rx) => hs.findIndex((x) => x && rx.test(x));
  let amount = -1;
  const bare = (x) => x.replace(/\(.*?\)/g, '');
  for (const key of AMOUNT_ORDER) { // 머리글이 정확히 같은 열 먼저 ('금액', '승인금액(원)')
    amount = hs.findIndex((x) => bare(x) === key);
    if (amount >= 0) break;
  }
  if (amount < 0) {
    for (const key of AMOUNT_ORDER) {
      amount = hs.findIndex((x) => x.includes(key) && !AMOUNT_EXCLUDE.test(x));
      if (amount >= 0) break;
    }
  }
  return { date: find(RX.date), merchant: find(RX.merchant), amount, approval: find(RX.approval), status: find(RX.status), card: find(RX.card) };
}

export function findHeader(table) {
  for (let i = 0; i < Math.min(table.length, 40); i++) {
    const c = detectColumns(table[i] || []);
    if (c.date >= 0 && c.amount >= 0 && c.merchant >= 0) return { headerRow: i, cols: c };
  }
  return { headerRow: 0, cols: detectColumns(table[0] || []) };
}

// ── 행 추출 ──────────────────────────────────────────────────
export function extractRows(table, headerRow, cols, today) {
  const out = [];
  for (let i = headerRow + 1; i < table.length; i++) {
    const r = table[i] || [];
    const date = parseDate(r[cols.date], today);
    let amount = parseAmount(r[cols.amount]);
    if (!date || !Number.isFinite(amount) || amount === 0) continue;
    const merchantRaw = String(r[cols.merchant] ?? '').trim();
    const status = cols.status >= 0 ? String(r[cols.status] ?? '') : '';
    const cancel = amount < 0 || /취소/.test(status) || /취소/.test(merchantRaw);
    out.push({
      line: i + 1, date, merchantRaw, amount: Math.abs(amount), cancel,
      cardLabel: cols.card >= 0 ? String(r[cols.card] ?? '').trim() : '',
      overseas: r.some((v) => typeof v === 'string' && v.includes('해외')),
      approval: cols.approval >= 0 ? String(r[cols.approval] ?? '').trim() : '',
    });
  }
  return out;
}

// ── 분류 ─────────────────────────────────────────────────────
const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

// 금액이 정확히 맞는 2~5건 조합 찾기 (장바구니 묶음 결제 대비)
function findCombo(target, cands, maxSize = 5) {
  const list = cands.slice(0, 14);
  let best = null;
  const walk = (start, sum, picked) => {
    if (best) return;
    if (sum === target && picked.length >= 2) { best = [...picked]; return; }
    if (picked.length >= maxSize || sum >= target) return;
    for (let i = start; i < list.length; i++) {
      picked.push(list[i]);
      walk(i + 1, sum + Number(list[i].amount), picked);
      picked.pop();
    }
  };
  walk(0, 0, []);
  return best;
}

// 파일 안 카드 구분값(예: '본인008*') → 결제수단. 매핑이 없으면 기본 결제수단, 'skip'이면 가져오지 않음
export function resolvePayment(row, defaultPayment, cardMap = {}) {
  return (row.cardLabel && cardMap[row.cardLabel]) || defaultPayment;
}

export function classify(rows, txs, defaultPayment, { windowDays = 3, cardMap = {} } = {}) {
  const importedKeys = new Set(txs.filter((t) => t.import_key).map((t) => t.import_key));
  const pool = txs.filter((t) => !t.import_key);
  const used = new Set();
  const inPool = (t, pay) => !used.has(t.id) && (t.payment === pay || t.payment === LEGACY_METHOD);

  // 1) 결제수단 + 식별키 (같은 날·금액·가맹점이 여러 번이면 순번으로 구분)
  const seen = new Map();
  const items = rows.map((r) => {
    const payment = resolvePayment(r, defaultPayment, cardMap);
    const card = cardById(payment);
    const base = r.approval
      ? `${payment}|A|${r.approval}|${r.cancel ? 'C' : ''}${r.amount}`
      : `${payment}|${r.date}|${r.cancel ? 'C' : ''}${r.amount}|${norm(r.merchantRaw)}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const key = n > 1 ? `${base}|${n}` : base;
    const merchant = canonicalMerchant(r.merchantRaw);
    let area = card ? suggestArea(card, `${r.merchantRaw} ${merchant}`) : null;
    if (card && r.overseas && card.areas.some((a) => a.key === 'overseas')) area = 'overseas';
    return { ...r, payment, key, merchant, area, status: 'new', matches: [], checked: true };
  });

  // 2) 가져오지 않을 카드 / 이미 가져온 행
  for (const it of items) {
    if (it.payment === 'skip') { it.status = 'skipped'; it.checked = false; }
    else if (importedKeys.has(it.key)) { it.status = 'imported'; it.checked = false; }
  }

  // 3) 명세서 안의 취소 ↔ 원거래 짝짓기
  for (const c of items.filter((x) => x.cancel && x.status === 'new')) {
    const open = items.filter((x) => !x.cancel && x.status === 'new' && x.amount === c.amount && x.payment === c.payment);
    const orig = open.find((x) => x.approval && x.approval === c.approval)
      || open.find((x) => norm(x.merchantRaw) === norm(c.merchantRaw));
    c.status = 'cancel'; c.checked = false;
    if (orig) { orig.status = 'cancelled'; orig.checked = false; c.pair = orig.line; orig.pair = c.line; }
  }

  // 4) 직접 입력한 내역(같은 카드 또는 결제수단 미기록)과 비교
  const live = items.filter((x) => x.status === 'new').sort((a, b) => a.date.localeCompare(b.date));
  const score = (it, t) => dayDiff(it.date, t.tx_date) * 10 + (t.payment === it.payment ? 0 : 3) - (sameMerchant(it.merchantRaw, t.merchant) ? 20 : 0);
  // 4-1) 금액이 같은 1건
  for (const it of live) {
    const cands = pool.filter((t) => inPool(t, it.payment) && Number(t.amount) === it.amount && dayDiff(it.date, t.tx_date) <= windowDays)
      .sort((a, b) => score(it, a) - score(it, b));
    if (cands.length) { it.status = 'dup'; it.checked = false; it.matches = [cands[0]]; used.add(cands[0].id); }
  }
  // 4-2) 여러 건의 합 (같은 사용처, 같은 날 ±1일)
  for (const it of live.filter((x) => x.status === 'new')) {
    const cands = pool.filter((t) => inPool(t, it.payment) && Number(t.amount) < it.amount
      && dayDiff(it.date, t.tx_date) <= 1 && sameMerchant(it.merchantRaw, t.merchant));
    const combo = findCombo(it.amount, cands);
    if (combo) { it.status = 'dup'; it.checked = false; it.matches = combo; combo.forEach((t) => used.add(t.id)); }
  }
  // 4-3) 금액이 비슷한 1건 (배송비·할인 차이) → 기본은 가져오고, 같은 결제면 체크 해제
  for (const it of live.filter((x) => x.status === 'new')) {
    const cands = pool.filter((t) => inPool(t, it.payment) && dayDiff(it.date, t.tx_date) <= 1
      && sameMerchant(it.merchantRaw, t.merchant) && Math.abs(Number(t.amount) - it.amount) <= it.amount * 0.2)
      .sort((a, b) => Math.abs(a.amount - it.amount) - Math.abs(b.amount - it.amount));
    if (cands.length) { it.status = 'similar'; it.matches = [cands[0]]; used.add(cands[0].id); }
  }
  return items;
}

// 확정: 넣을 행과, 같은 결제로 확인된 기존 내역에 붙일 정보
export function buildCommit(items) {
  const inserts = [], links = [];
  for (const it of items) {
    const card = cardById(it.payment);
    if (it.checked && ['new', 'dup', 'similar', 'cancelled'].includes(it.status)) {
      inserts.push({
        tx_date: it.date, item: it.merchantRaw || it.merchant || '(가맹점 없음)', amount: it.amount, payment: it.payment,
        merchant: it.merchant || null, area: card ? it.area : null, liters: null, note: null,
        source: 'import', import_key: it.key,
      });
    } else if (!it.checked && ['dup', 'similar'].includes(it.status)) {
      it.matches.forEach((t, i) => {
        const patch = { import_key: i === 0 ? it.key : `${it.key}#${i + 1}` };
        if (t.payment !== it.payment) {
          patch.payment = it.payment;
          patch.area = card ? (it.overseas && it.area === 'overseas' ? 'overseas' : suggestArea(card, `${t.merchant || ''} ${it.merchantRaw}`)) : null;
        }
        if (it.status === 'similar' && Number(t.amount) !== it.amount) {
          patch.note = [t.note, `카드 결제액 ${it.amount.toLocaleString('ko-KR')}원`].filter(Boolean).join(' · ');
        }
        links.push({ id: t.id, patch });
      });
    }
  }
  return { inserts, links };
}
