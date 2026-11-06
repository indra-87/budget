// 실행: node tests/importer.test.mjs
import assert from 'node:assert/strict';
import { parseDate, parseAmount, findHeader, extractRows, classify, buildCommit, canonicalMerchant } from '../js/importer.js';
const ok = (name, fn) => { fn(); console.log('✓', name); };
const today = new Date(2026, 10, 6);

ok('날짜/금액 파싱', () => {
  assert.equal(parseDate('2026.11.05', today), '2026-11-05');
  assert.equal(parseDate('26/11/05 13:22', today), '2026-11-05');
  assert.equal(parseDate('2026년 11월 5일', today), '2026-11-05');
  assert.equal(parseDate('11.05', today), '2026-11-05');
  assert.equal(parseDate('12.20', today), '2025-12-20');
  assert.equal(parseDate(46331, today), '2026-11-05');
  assert.equal(parseDate('20261105', today), '2026-11-05');
  assert.equal(parseDate('합계', today), null);
  assert.equal(parseAmount('12,000원'), 12000);
  assert.equal(parseAmount('-5,500'), -5500);
  assert.equal(parseAmount('△3,000'), -3000);
});

ok('사용처 통일', () => {
  assert.equal(canonicalMerchant('쿠팡(주)'), '쿠팡');
  assert.equal(canonicalMerchant('쿠팡이츠'), '쿠팡이츠');
  assert.equal(canonicalMerchant('(주)지마켓'), 'G마켓');
  assert.equal(canonicalMerchant('네이버페이'), '네이버');
  assert.equal(canonicalMerchant('동네빵집'), '동네빵집');
});

const table = [
  ['신한카드 이용내역'], [''],
  ['이용일자', '이용카드', '가맹점명', '이용금액', '승인번호', '취소상태'],
  ['2026.11.01', '본인', '쿠팡(주)', '17,130', '111', ''],
  ['2026.11.02', '본인', '(주)지마켓', '37,140', '112', ''],   // 삼진어묵 22,260 + 스팸 14,880 묶음
  ['2026.11.03', '본인', '넷플릭스', '17,000', '113', ''],    // 구독 → 신규
  ['2026.11.03', '본인', '스타벅스', '5,500', '114', ''],
  ['2026.11.04', '본인', '스타벅스', '5,500', '115', '취소'],
  ['2026.11.05', '본인', '네이버페이', '18,300', '116', ''],
  ['합계', '', '', '100,570', '', ''],
];
const txs = [
  { id: 'a', tx_date: '2026-11-01', item: '핫식스', amount: 17130, payment: '미기록', merchant: '쿠팡' },
  { id: 'b', tx_date: '2026-11-02', item: '삼진어묵', amount: 22260, payment: '미기록', merchant: 'G마켓' },
  { id: 'c', tx_date: '2026-11-02', item: '스팸', amount: 14880, payment: '미기록', merchant: 'G마켓' },
  { id: 'd', tx_date: '2026-11-04', item: '김치', amount: 18300, payment: 'shinhan_solplan', merchant: '네이버' },
  { id: 'e', tx_date: '2026-10-20', item: '과거', amount: 1000, payment: 'shinhan_solplan', merchant: 'x', import_key: 'old' },
];

ok('머리글 찾기 + 행 추출', () => {
  const { headerRow, cols } = findHeader(table);
  assert.equal(headerRow, 2);
  assert.deepEqual([cols.date, cols.merchant, cols.amount, cols.approval, cols.status], [0, 2, 3, 4, 5]);
  const rows = extractRows(table, headerRow, cols, today);
  assert.equal(rows.length, 6);
  assert.equal(rows[4].cancel, true);
});

ok('분류: 중복(단건/묶음), 신규, 취소 짝', () => {
  const { headerRow, cols } = findHeader(table);
  const items = classify(extractRows(table, headerRow, cols, today), txs, 'shinhan_solplan');
  const by = (m) => items.find((x) => x.merchantRaw === m && !x.cancel);
  assert.equal(by('쿠팡(주)').status, 'dup');
  assert.equal(by('쿠팡(주)').area, 'online');
  assert.equal(by('(주)지마켓').status, 'dup');
  assert.equal(by('(주)지마켓').matches.length, 2);
  assert.equal(by('넷플릭스').status, 'new');
  assert.equal(by('스타벅스').status, 'cancelled');
  assert.equal(items.find((x) => x.cancel).status, 'cancel');
  assert.equal(by('네이버페이').status, 'dup');
  assert.equal(by('네이버페이').matches[0].id, 'd');

  const { inserts, links } = buildCommit(items);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].item, '넷플릭스');
  assert.equal(links.length, 4);
  const la = links.find((l) => l.id === 'a');
  assert.equal(la.patch.payment, 'shinhan_solplan');
  assert.equal(la.patch.area, 'online');
  assert.equal(links.find((l) => l.id === 'd').patch.payment, undefined);

  // 반영 후 같은 파일을 다시 올리면 전부 '이미 가져옴'
  const after = txs.map((t) => { const l = links.find((x) => x.id === t.id); return l ? { ...t, ...l.patch } : t; })
    .concat(inserts.map((r, i) => ({ ...r, id: `n${i}` })));
  const again = classify(extractRows(table, headerRow, cols, today), after, 'shinhan_solplan');
  assert.equal(again.filter((x) => x.status === 'imported').length, 4);
  assert.equal(again.filter((x) => x.status === 'new' || x.status === 'dup').length, 0);
});

ok('승인번호 없을 때 같은 날 같은 금액 2건 구분', () => {
  const t = [['거래일', '가맹점', '금액'], ['2026-11-01', 'A', 1000], ['2026-11-01', 'A', 1000]];
  const { headerRow, cols } = findHeader(t);
  const items = classify(extractRows(t, headerRow, cols, today), [], 'shinhan_hipoint');
  assert.notEqual(items[0].key, items[1].key);
});
console.log('\n가져오기 테스트 통과');
