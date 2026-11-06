// 실행: node tests/cards.test.mjs
import assert from 'node:assert/strict';
import { CARDS, cardById, suggestArea, DEFAULT_SETTINGS as S, simulate, periodKey } from '../js/cards.js';

let n = 0;
const tx = (amount, area, extra = {}) => ({ id: `t${++n}`, tx_date: '2026-11-0' + ((n % 9) + 1), amount, area, ...extra });
const run = (id, txs, s = S) => cardById(id).compute(txs, s);
const ok = (name, fn) => { fn(); console.log('✓', name); };

// ── 자동 분류 ──
const hp = cardById('shinhan_hipoint'), sol = cardById('shinhan_solplan'), sm = cardById('samsung_andmileage');
ok('자동 분류', () => {
  assert.equal(suggestArea(hp, '이마트 성수점'), 'shopping');
  assert.equal(suggestArea(hp, '이마트24'), 'general');
  assert.equal(suggestArea(hp, 'S-OIL 강남주유소'), 'fuel');
  assert.equal(suggestArea(hp, 'G마켓'), 'general');
  assert.equal(suggestArea(sol, '쿠팡이츠'), 'delivery');
  assert.equal(suggestArea(sol, '쿠팡'), 'online');
  assert.equal(suggestArea(sol, 'GS칼텍스'), 'fuel');
  assert.equal(suggestArea(sol, 'GS25'), 'general');
  assert.equal(suggestArea(sm, '스타벅스'), 'extra');
  assert.equal(suggestArea(sm, '현대백화점'), 'extra');
  assert.equal(suggestArea(sm, '11번가'), 'base');
});

// ── 하이포인트 ──
ok('하이포인트 일반/쇼핑', () => {
  const a = tx(10000, 'general'), b = tx(10000, 'shopping');
  const r = run('shinhan_hipoint', [a, b]);
  assert.equal(r.results.get(a.id).earned, 200);
  assert.equal(r.results.get(b.id).earned, 500);
});
ok('하이포인트 주유: 리터 입력 / 추정 / 20만원 초과분 2%', () => {
  const a = tx(150000, 'fuel', { liters: 90 });        // 90L × 60 = 5,400
  const b = tx(100000, 'fuel', { liters: 60 });        // 50,000원분만 리터당(30L×60=1,800) + 50,000×2% = 1,000
  const r = run('shinhan_hipoint', [a, b]);
  assert.equal(r.results.get(a.id).earned, 5400);
  assert.equal(r.results.get(b.id).earned, 2800);
  const c = tx(66000, 'fuel');                         // 66,000/1,650 = 40L → 2,400
  assert.equal(run('shinhan_hipoint', [c]).results.get(c.id).earned, 2400);
});
ok('하이포인트 통합 한도 5만P', () => {
  const a = tx(900000, 'shopping'), b = tx(200000, 'shopping'); // 45,000 + 10,000 → 5,000만
  const r = run('shinhan_hipoint', [a, b]);
  assert.equal(r.results.get(b.id).earned, 5000);
  assert.equal(r.totalEarned, 50000);
});

// ── 쏠 플랜+ ──
ok('쏠 플랜+ 영역 30만원 초과 건 전액 제외', () => {
  const a = tx(290000, 'online'), b = tx(30000, 'online'), c = tx(10000, 'general');
  const r = run('shinhan_solplan', [a, b, c]);
  assert.equal(r.results.get(a.id).earned, 14500);
  assert.equal(r.results.get(b.id).earned, 0);
  assert.equal(r.results.get(c.id).earned, 150);
});
ok('쏠 플랜+ 초과 후 소액도 계속 제외', () => {
  const a = tx(290000, 'online'), b = tx(30000, 'online'), c = tx(5000, 'online');
  assert.equal(run('shinhan_solplan', [a, b, c]).results.get(c.id).earned, 0);
});
ok('쏠 플랜+ 29만원 후 9,000원 적립 / 10,000원 제외', () => {
  const a = tx(290000, 'online'), b = tx(9000, 'online');
  assert.equal(run('shinhan_solplan', [a, b]).results.get(b.id).earned, 450);
  const c = tx(290000, 'online'), d = tx(10000, 'online');
  assert.equal(run('shinhan_solplan', [c, d]).results.get(d.id).earned, 0);
});

// ── 앤마일리지 ──
ok('앤마일리지 반올림 + 추가적립', () => {
  const a = tx(1499, 'base'), b = tx(1500, 'base'), c = tx(4500, 'extra');
  const r = run('samsung_andmileage', [a, b, c]);
  assert.equal(r.results.get(a.id).earned, 1);
  assert.equal(r.results.get(b.id).earned, 2);
  assert.equal(r.results.get(c.id).earned, 10); // 기본 5 + 추가 5 (4.5 → 5)
});
ok('앤마일리지 추가적립 한도 2,000마일 초과 시 기본만', () => {
  const a = tx(1990000, 'extra'), b = tx(50000, 'extra'); // 추가 1,990 → 남은 10
  const r = run('samsung_andmileage', [a, b]);
  assert.equal(r.results.get(b.id).earned, 50 + 10);
});

// ── 시뮬레이션 / 기간 ──
ok('결제 시뮬레이션', () => {
  const all = [{ id: 'x', tx_date: '2026-11-02', amount: 290000, payment: 'shinhan_solplan', area: 'online', merchant: '쿠팡' }];
  const r = simulate(sol, all, { tx_date: '2026-11-05', amount: 30000, merchant: '쿠팡' }, S);
  assert.equal(r.earned, 0);
  assert.ok(r.warn);
  const r2 = simulate(sol, all, { tx_date: '2026-11-05', amount: 9999, merchant: '쿠팡' }, S);
  assert.equal(r2.earned, 499);
});
ok('실적 기간', () => {
  assert.equal(periodKey('2026-11-06'), '2026-11');
  assert.equal(periodKey('2026-01-10', 15), '2025-12');
  assert.equal(periodKey('2026-01-20', 15), '2026-01');
});
console.log(`\n모든 테스트 통과 (${CARDS.length}개 카드)`);
