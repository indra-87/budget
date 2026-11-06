import { store } from './store.js';
import {
  CARDS, OTHER_METHODS, LEGACY_METHOD, DEFAULT_MERCHANTS, SOLSOL_BALANCE, solsolBalanceFor, DEFAULT_SETTINGS, cardById, payName, areaLabel,
  suggestArea, simulate, cardMonth, rewardIndex, periodKey, shiftPeriod, periodLabel,
  fmtReward, won, num, norm,
} from './cards.js';
import { findHeader, detectColumns, extractRows, classify, buildCommit } from './importer.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const parseAmount = (v) => parseInt(String(v).replace(/[^\d]/g, ''), 10) || 0;

const state = {
  txs: [],
  settings: { ...DEFAULT_SETTINGS },
  rewards: new Map(),
  payment: CARDS[0].id,
  editingId: null,
  areaTouched: false,
  cardsPeriod: null,
  loaded: false,
};

// ── 시작 ──────────────────────────────────────────────────────
async function init() {
  bindTabs(); bindForm(); bindHistory(); bindCards(); bindSettings(); bindLogin(); bindImport();
  if (store.isDemo) {
    $('#modeBadge').hidden = false;
    return showApp();
  }
  $('#logoutBtn').hidden = false;
  store.onAuth((s) => (s ? showApp() : showLogin()));
  (await store.getSession()) ? showApp() : showLogin();
}

function showLogin() {
  state.loaded = false;
  $('#app').hidden = true;
  $('#login').hidden = false;
}

async function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  if (state.loaded) return;
  state.loaded = true;
  try {
    const saved = await store.getSettings();
    state.settings = { ...DEFAULT_SETTINGS, ...saved, cardMap: { ...DEFAULT_SETTINGS.cardMap, ...(saved.cardMap || {}) } };
    state.txs = await store.list();
  } catch (e) {
    toast(`불러오기 실패: ${e.message}`);
  }
  state.cardsPeriod = periodKey(today(), state.settings.cycleStartDay);
  resetForm();
  renderAll();
}

function renderAll() {
  state.rewards = rewardIndex(state.txs, state.settings);
  renderDatalists();
  renderMerchantChips();
  renderPayChips();
  updateArea();
  renderPreview();
  renderRecent();
  renderHistory();
  renderCards();
  renderSettings();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

// ── 탭 ────────────────────────────────────────────────────────
function bindTabs() {
  document.querySelectorAll('.tabs button').forEach((b) =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));
}
function switchTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((s) => (s.hidden = s.id !== `tab-${name}`));
  window.scrollTo({ top: 0 });
}

// ── 로그인 ────────────────────────────────────────────────────
function bindLogin() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    $('#loginError').textContent = '';
    try { await store.signIn(f.email.value, f.password.value); }
    catch (err) { $('#loginError').textContent = err.message; }
  });
  $('#logoutBtn').addEventListener('click', () => store.signOut());
}

// ── 입력 폼 ───────────────────────────────────────────────────
const form = () => $('#txForm');
// form.elements.item 은 내장 메서드와 이름이 겹쳐서 name으로 직접 찾습니다
const F = () => new Proxy({}, { get: (_, k) => form().querySelector(`[name="${String(k)}"]`) });

function bindForm() {
  const f = F();
  f.amount.addEventListener('input', () => {
    const n = parseAmount(f.amount.value);
    f.amount.value = n ? n.toLocaleString('ko-KR') : '';
    syncLitersFromPrice();
    renderPreview();
  });
  f.merchant.addEventListener('input', () => { updateArea(); renderPreview(); renderMerchantChips(); });
  f.tx_date.addEventListener('change', renderPreview);
  f.item.addEventListener('input', renderItemHistory);
  f.area.addEventListener('change', () => { state.areaTouched = true; updateArea(); renderPreview(); });
  f.liters.addEventListener('input', renderPreview);
  f.unit_price.addEventListener('input', () => { syncLitersFromPrice(); renderPreview(); });
  form().addEventListener('submit', onSave);
  $('#cancelEdit').addEventListener('click', () => { resetForm(); renderAll(); });
}

function syncLitersFromPrice() {
  const f = F();
  const price = parseAmount(f.unit_price.value);
  const amt = parseAmount(f.amount.value);
  if (price && amt) f.liters.value = (amt / price).toFixed(2);
}

function readDraft() {
  const f = F();
  return {
    tx_date: f.tx_date.value || today(),
    item: f.item.value.trim(),
    amount: parseAmount(f.amount.value),
    merchant: f.merchant.value.trim(),
    payment: state.payment,
    area: cardById(state.payment) ? f.area.value : null,
    liters: parseFloat(f.liters.value) || null,
    note: f.note.value.trim(),
  };
}

function resetForm() {
  const keepDate = F().tx_date.value || today();
  form().reset();
  F().tx_date.value = keepDate;
  state.editingId = null;
  state.areaTouched = false;
  $('#formTitle').textContent = '새 내역';
  $('#saveBtn').textContent = '저장';
  $('#cancelEdit').hidden = true;
  $('#itemHistory').innerHTML = '';
}

function loadIntoForm(t) {
  const f = F();
  resetForm();
  state.editingId = t.id;
  state.payment = t.payment;
  state.areaTouched = true;
  f.tx_date.value = t.tx_date;
  f.item.value = t.item;
  f.amount.value = Number(t.amount).toLocaleString('ko-KR');
  f.merchant.value = t.merchant || '';
  f.note.value = t.note || '';
  f.liters.value = t.liters ?? '';
  renderPayChips();
  updateArea(t.area);
  renderPreview();
  renderMerchantChips();
  $('#formTitle').textContent = '내역 수정';
  $('#saveBtn').textContent = '수정 저장';
  $('#cancelEdit').hidden = false;
  switchTab('input');
}

function selectPayment(p) {
  state.payment = p;
  state.areaTouched = false;
  renderPayChips();
  updateArea();
  renderPreview();
}

function renderPayChips() {
  const opts = [...CARDS.map((c) => ({ id: c.id, name: c.name, color: c.color })), ...OTHER_METHODS.map((m) => ({ id: m, name: m }))];
  $('#payChips').innerHTML = opts.map((o) =>
    `<button type="button" class="chip ${o.id === state.payment ? 'on' : ''}" data-pay="${esc(o.id)}">` +
    `${o.color ? `<span class="dot" style="background:${o.color}"></span>` : ''}${esc(o.name)}</button>`).join('');
  $('#payChips').querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => selectPayment(b.dataset.pay)));
}

function updateArea(forceKey) {
  const f = F();
  const card = cardById(state.payment);
  $('#areaWrap').hidden = !card;
  if (!card) { $('#fuelWrap').hidden = true; return; }
  const suggested = suggestArea(card, f.merchant.value);
  const current = forceKey || (state.areaTouched ? f.area.value : suggested);
  f.area.innerHTML = card.areas.map((a) => `<option value="${a.key}">${esc(a.label)}</option>`).join('');
  f.area.value = card.areas.some((a) => a.key === current) ? current : suggested;
  const badge = $('#areaBadge');
  if (f.area.value === suggested && !state.areaTouched) { badge.textContent = '자동 추천'; badge.className = 'badge'; }
  else if (f.area.value === suggested) { badge.textContent = '추천과 같음'; badge.className = 'badge good'; }
  else { badge.textContent = `직접 선택 · 추천: ${areaLabel(card, suggested)}`; badge.className = 'badge manual'; }
  $('#fuelWrap').hidden = !(card.id === 'shinhan_hipoint' && f.area.value === 'fuel');
}

function renderPreview() {
  const d = readDraft();
  const box = $('#rewardPreview');
  if (!d.amount) {
    box.innerHTML = '<div class="empty">금액과 사용처를 입력하면 카드별 예상 적립과 남은 한도를 보여줘요. 원하는 카드를 눌러 선택하세요.</div>';
    return;
  }
  const rows = CARDS.map((card) => {
    const same = card.id === state.payment;
    const draft = { ...d, area: same ? d.area : null, liters: same ? d.liters : null };
    const r = simulate(card, state.txs, draft, state.settings, state.editingId);
    return { card, r, same };
  });
  const best = Math.max(...rows.map((x) => x.r.valueWon));
  box.innerHTML = '<span class="lbl">카드별 예상 적립 (이번 실적 기간 기준)</span>' + rows.map(({ card, r, same }) => {
    const isBest = r.valueWon === best && best > 0;
    const val = card.unit === '마일' ? `${fmtReward(card, r.earned)} <span class="sub">≈${won(r.valueWon)}</span>` : fmtReward(card, r.earned);
    return `<div class="reco ${same ? 'sel' : ''}" data-pay="${card.id}">
      <span class="name"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${card.color};margin-right:6px"></span>${esc(card.name)} ${isBest ? '<span class="badge good">추천</span>' : ''}</span>
      <span class="val">${val}</span>
      <span class="sub">${esc(areaLabel(card, r.area))} · ${esc(r.detail)}</span><span></span>
      ${r.warn ? `<span class="warnline">⚠ ${esc(r.warn)}</span>` : ''}
    </div>`;
  }).join('');
  box.querySelectorAll('[data-pay]').forEach((el) => el.addEventListener('click', () => selectPayment(el.dataset.pay)));
}

function renderItemHistory() {
  const q = norm(F().item.value);
  const box = $('#itemHistory');
  if (q.length < 2) { box.innerHTML = ''; return; }
  const hits = state.txs.filter((t) => norm(t.item).includes(q)).slice(0, 5);
  box.innerHTML = hits.length
    ? '이전 구매: ' + hits.map((t) => `<div class="item">${t.tx_date} · <b>${esc(t.item)}</b> · ${won(t.amount)} · ${esc(t.merchant || '-')} · ${esc(payName(t.payment))}</div>`).join('')
    : '';
}

async function onSave(e) {
  e.preventDefault();
  const d = readDraft();
  if (!d.item) return toast('내역을 입력하세요');
  if (!d.amount) return toast('금액을 입력하세요');
  const card = cardById(d.payment);
  const rec = {
    tx_date: d.tx_date, item: d.item, amount: d.amount, payment: d.payment,
    merchant: d.merchant || null, area: card ? d.area : null,
    liters: card?.id === 'shinhan_hipoint' && d.area === 'fuel' ? d.liters : null,
    note: d.note || null,
  };
  const btn = $('#saveBtn');
  btn.disabled = true;
  try {
    if (state.editingId) {
      const row = await store.update(state.editingId, rec);
      state.txs = state.txs.map((t) => (t.id === row.id ? row : t));
      toast('수정했어요');
    } else {
      const row = await store.insert(rec);
      state.txs = [row, ...state.txs];
      toast('저장했어요');
    }
    resetForm();
    renderAll();
    F().item.focus();
  } catch (err) {
    toast(`저장 실패: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ── 목록 공통 ─────────────────────────────────────────────────
function txRow(t, { actions = false } = {}) {
  const r = state.rewards.get(t.id);
  const card = cardById(t.payment);
  const rw = r ? `<span class="rw ${r.earned === 0 ? 'zero' : ''}" title="${esc(r.detail)}">+${fmtReward(r.card, r.earned)}</span>` : '<span></span>';
  return `<div class="tx ${actions ? '' : 'clickable'}" data-id="${t.id}">
    <span class="t1">${esc(t.item)}</span><span class="amt">${won(t.amount)}</span>
    <span class="t2">${t.tx_date} · ${esc(t.merchant || '-')} · ${esc(payName(t.payment))}${card && t.area ? ` · ${esc(areaLabel(card, t.area))}` : ''}${t.note ? ` · ${esc(t.note)}` : ''}</span>${rw}
    ${actions ? `<div class="acts"><button class="ghost small" data-edit>수정</button><button class="ghost small danger" data-del>삭제</button></div>` : ''}
  </div>`;
}

function renderRecent() {
  const list = [...state.txs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8);
  const box = $('#recentList');
  box.innerHTML = list.length ? list.map((t) => txRow(t)).join('') : '<div class="empty-msg">아직 입력한 내역이 없어요</div>';
  box.querySelectorAll('.tx').forEach((el) => el.addEventListener('click', () => loadIntoForm(state.txs.find((t) => t.id === el.dataset.id))));
}

function renderDatalists() {
  const items = [...new Set(state.txs.map((t) => t.item))].slice(0, 300);
  $('#itemList').innerHTML = items.map((i) => `<option value="${esc(i)}">`).join('');
  $('#merchantList').innerHTML = allMerchants().map((m) => `<option value="${esc(m)}">`).join('');
}

function merchantFreq() {
  const c = new Map();
  for (const t of state.txs) if (t.merchant) c.set(t.merchant, (c.get(t.merchant) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
}
function allMerchants() {
  return [...new Set([...state.settings.favoriteMerchants, ...merchantFreq(), ...DEFAULT_MERCHANTS])];
}

function renderMerchantChips() {
  const fav = state.settings.favoriteMerchants || [];
  const extra = merchantFreq().filter((m) => !fav.includes(m)).slice(0, 4);
  const cur = F().merchant.value.trim();
  $('#merchantChips').innerHTML = [...fav, ...extra].map((m) =>
    `<button type="button" class="chip ${m === cur ? 'on' : ''}" data-m="${esc(m)}">${esc(m)}</button>`).join('');
  $('#merchantChips').querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
    F().merchant.value = b.dataset.m;
    updateArea(); renderPreview(); renderMerchantChips();
  }));
}

// ── 내역 탭 ───────────────────────────────────────────────────
function bindHistory() {
  $('#hq').addEventListener('input', renderHistory);
  $('#hpay').addEventListener('change', renderHistory);
  $('#hperiod').addEventListener('change', renderHistory);
  $('#csvBtn').addEventListener('click', exportCsv);
}

function filteredTxs() {
  const q = norm($('#hq').value);
  const pay = $('#hpay').value;
  const per = $('#hperiod').value;
  return state.txs
    .filter((t) => !q || [t.item, t.merchant, t.note].some((v) => norm(v).includes(q)))
    .filter((t) => !pay || t.payment === pay)
    .filter((t) => !per || periodKey(t.tx_date, state.settings.cycleStartDay) === per)
    .sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date)) || String(b.created_at).localeCompare(String(a.created_at)));
}

function renderHistory() {
  const payOpts = [['', '전체 결제수단'], ...CARDS.map((c) => [c.id, c.name]), ...[...OTHER_METHODS, LEGACY_METHOD].map((m) => [m, m])];
  const curPay = $('#hpay').value;
  $('#hpay').innerHTML = payOpts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  $('#hpay').value = curPay;
  const periods = [...new Set(state.txs.map((t) => periodKey(t.tx_date, state.settings.cycleStartDay)))].sort().reverse();
  const curPer = $('#hperiod').value;
  $('#hperiod').innerHTML = `<option value="">전체 기간</option>` + periods.map((p) => `<option value="${p}">${periodLabel(p, state.settings.cycleStartDay)}</option>`).join('');
  $('#hperiod').value = periods.includes(curPer) ? curPer : '';

  const list = filteredTxs();
  const q = $('#hq').value.trim();
  const sum = list.reduce((s, t) => s + Number(t.amount), 0);
  let summary = `${list.length}건 · 합계 <b>${won(sum)}</b>`;
  if (q && list.length) {
    const amts = list.map((t) => Number(t.amount));
    const min = list.find((t) => Number(t.amount) === Math.min(...amts));
    summary = `“${esc(q)}” ${list.length}건 · 최저 <b>${won(min.amount)}</b> (${min.tx_date}, ${esc(min.merchant || '-')}) · 최고 ${won(Math.max(...amts))} · 평균 ${won(sum / list.length)}`;
  }
  $('#histSummary').innerHTML = state.txs.length ? summary : '';
  const box = $('#histList');
  box.innerHTML = list.length ? list.map((t) => txRow(t, { actions: true })).join('') : '<div class="empty-msg">해당하는 내역이 없어요</div>';
  box.querySelectorAll('.tx').forEach((el) => {
    const t = state.txs.find((x) => x.id === el.dataset.id);
    el.querySelector('[data-edit]').addEventListener('click', () => loadIntoForm(t));
    el.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm(`"${t.item}" (${won(t.amount)}) 내역을 삭제할까요?`)) return;
      try {
        await store.remove(t.id);
        state.txs = state.txs.filter((x) => x.id !== t.id);
        if (state.editingId === t.id) resetForm();
        renderAll();
        toast('삭제했어요');
      } catch (err) { toast(`삭제 실패: ${err.message}`); }
    });
  });
}

function exportCsv() {
  const rows = filteredTxs();
  const head = ['날짜', '내역', '금액', '결제수단', '사용처', '적립구분', '적립', '비고'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((t) => {
    const card = cardById(t.payment);
    const r = state.rewards.get(t.id);
    return [t.tx_date, t.item, t.amount, payName(t.payment), t.merchant, card ? areaLabel(card, t.area) : '', r ? fmtReward(r.card, r.earned) : '', t.note].map(cell).join(',');
  });
  const blob = new Blob(['﻿' + [head.map(cell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `가계부_${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── 카드 실적 탭 ──────────────────────────────────────────────
function bindCards() {
  $('#pPrev').addEventListener('click', () => { state.cardsPeriod = shiftPeriod(state.cardsPeriod, -1); renderCards(); });
  $('#pNext').addEventListener('click', () => { state.cardsPeriod = shiftPeriod(state.cardsPeriod, 1); renderCards(); });
}

function renderCards() {
  const p = state.cardsPeriod;
  const s = state.settings;
  $('#pLabel').textContent = periodLabel(p, s.cycleStartDay);
  const boards = CARDS.map((card) => {
    const { txs, summary } = cardMonth(card, state.txs, p, s);
    const spend = txs.reduce((a, t) => a + Number(t.amount), 0);
    const bars = summary.bars.map((b) => {
      const pct = b.max ? Math.min(100, (b.value / b.max) * 100) : 0;
      const cls = b.value > b.max ? 'over' : b.value >= b.max ? 'full' : '';
      const fmt = (v) => (b.unit === '원' ? won(v) : `${num(v)}${b.unit}`);
      return `<div class="bar ${cls}"><div class="lab"><span>${esc(b.label)}</span><span>${fmt(b.value)} / ${fmt(b.max)}</span></div>
        <div class="track"><div class="fill" style="width:${pct}%;background:${cls ? '' : card.color}"></div></div></div>`;
    }).join('');
    const byArea = card.areas.map((a) => {
      const list = txs.filter((t) => (t.area || card.defaultArea) === a.key);
      return list.length ? `<tr><td>${esc(a.label)}</td><td class="r">${list.length}건</td><td class="r">${won(list.reduce((x, t) => x + Number(t.amount), 0))}</td></tr>` : '';
    }).join('');
    const detail = txs.map((t) => {
      const r = summary.results.get(t.id);
      return `<tr><td>${t.tx_date.slice(5)}</td><td>${esc(t.item)}<div class="hint">${esc(t.merchant || '')} · ${esc(r.detail)}${r.warn ? ` · ⚠ ${esc(r.warn)}` : ''}</div></td><td class="r">${won(t.amount)}</td><td class="r">${fmtReward(card, r.earned)}</td></tr>`;
    }).join('');
    return `<div class="panel">
      <div class="board-head"><h2><span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${card.color};margin-right:6px"></span>${esc(card.name)}</h2>
        <span class="spend">이용금액 ${won(spend)} · ${txs.length}건</span></div>
      <div class="big">${fmtReward(card, summary.totalEarned)}${card.unit === '마일' ? ` <span class="hint">≈ ${won(summary.totalEarned * s.mileValue)}</span>` : ''}</div>
      ${bars}
      <ul class="hints">${summary.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
      ${summary.solsol ? solsolPicker(p, s) : ''}
      ${txs.length ? `<details><summary>영역별 · 건별 상세</summary>
        <table><tbody>${byArea}</tbody></table>
        <table><thead><tr><th>날짜</th><th>내역</th><th class="r">금액</th><th class="r">적립</th></tr></thead><tbody>${detail}</tbody></table>
      </details>` : ''}
    </div>`;
  }).join('');
  const others = [...OTHER_METHODS, LEGACY_METHOD].map((m) => {
    const list = state.txs.filter((t) => t.payment === m && periodKey(t.tx_date, s.cycleStartDay) === p);
    return list.length ? `<tr><td>${esc(m)}</td><td class="r">${list.length}건</td><td class="r">${won(list.reduce((x, t) => x + Number(t.amount), 0))}</td></tr>` : '';
  }).join('');
  $('#cardBoards').innerHTML = boards + (others ? `<div class="panel"><h3>기타 결제수단</h3><table><tbody>${others}</tbody></table></div>` : '');
  $('#cardBoards').querySelectorAll('[data-solsol]').forEach((el) => el.addEventListener('change', onSolsolChange));
}

// 쏠 플랜+ 담을수록: 전월 결제계좌 잔액 조건 고르기
function solsolPicker(period, s) {
  const prev = shiftPeriod(period, -1);
  const cur = solsolBalanceFor(s, period);
  return `<label class="solsol">${esc(periodLabel(prev, s.cycleStartDay))} 결제계좌 잔액 조건 (담을수록)
    <select data-solsol="${prev}">${SOLSOL_BALANCE.map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <span class="hint">신한 슈퍼SOL 앱에서 확인한 전월 잔액 조건을 고르세요. 전월 카드 이용금액은 앱에 입력·가져온 내역으로 계산해요.</span></label>`;
}

async function onSolsolChange(e) {
  const prev = e.target.dataset.solsol;
  state.settings = { ...state.settings, solsolBalance: { ...(state.settings.solsolBalance || {}), [prev]: e.target.value } };
  try { await store.saveSettings(state.settings); } catch (err) { toast(`저장 실패: ${err.message}`); }
  renderAll();
}

// ── 설정 탭 ───────────────────────────────────────────────────
function bindSettings() {
  const sel = $('#settingsForm').elements.cycleStartDay;
  sel.innerHTML = Array.from({ length: 28 }, (_, i) => i + 1)
    .map((d) => `<option value="${d}">${d === 1 ? '매월 1일 ~ 말일' : `매월 ${d}일 ~ 다음 달 ${d - 1}일`}</option>`).join('');
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const next = {
      ...state.settings,
      fuelPrice: parseAmount(f.fuelPrice.value) || DEFAULT_SETTINGS.fuelPrice,
      mileValue: parseFloat(f.mileValue.value) || 0,
      cycleStartDay: Number(f.cycleStartDay.value) || 1,
      favoriteMerchants: f.favoriteMerchants.value.split(',').map((x) => x.trim()).filter(Boolean),
      solsolBalanceDefault: f.solsolBalanceDefault.value,
    };
    try {
      await store.saveSettings(next);
      state.settings = next;
      state.cardsPeriod = periodKey(today(), next.cycleStartDay);
      renderAll();
      toast('설정을 저장했어요');
    } catch (err) { toast(`저장 실패: ${err.message}`); }
  });
}

function renderSettings() {
  const f = $('#settingsForm').elements;
  const s = state.settings;
  f.fuelPrice.value = s.fuelPrice;
  f.mileValue.value = s.mileValue;
  f.cycleStartDay.value = s.cycleStartDay;
  f.favoriteMerchants.value = (s.favoriteMerchants || []).join(', ');
  f.solsolBalanceDefault.value = s.solsolBalanceDefault || 'none';
}

// ── 명세서 가져오기 탭 ────────────────────────────────────────
const imp = { table: null, headerRow: 0, cols: null, items: [], filter: 'all', fileName: '' };
let XLSX = null;

function bindImport() {
  const opts = [...CARDS.map((c) => [c.id, c.name]), ['순천사랑', '순천사랑'], ['기타', '기타']];
  $('#impPay').innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  $('#impPay').addEventListener('change', runClassify);
  $('#impFile').addEventListener('change', onImportFile);
  $('#impConfirm').addEventListener('click', onImportConfirm);
}

async function readTable(file) {
  if (!XLSX) XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const buf = await file.arrayBuffer();
  let wb;
  if (/\.csv$/i.test(file.name)) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { text = new TextDecoder('euc-kr').decode(buf); } // 카드사 CSV는 EUC-KR인 경우가 많음
    wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', cellDates: true });
  } else {
    wb = XLSX.read(buf, { type: 'array', cellDates: true });
  }
  // 날짜·금액 열이 있는 첫 시트
  for (const name of wb.SheetNames) {
    const t = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const found = findHeader(t);
    if (found.cols.date >= 0 && found.cols.amount >= 0) return t;
  }
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
}

async function onImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    imp.table = await readTable(file);
    imp.fileName = file.name;
    const { headerRow, cols } = findHeader(imp.table);
    imp.headerRow = headerRow;
    imp.cols = cols;
    renderImportMap();
    runClassify();
  } catch (err) {
    toast(`파일을 읽지 못했어요: ${err.message}`);
  }
}

function renderImportMap() {
  const headers = imp.table[imp.headerRow] || [];
  const opt = (sel) => `<option value="-1">(없음)</option>` + headers.map((hd, i) =>
    `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(String(hd || `${i + 1}열`))}</option>`).join('');
  const rowOpts = imp.table.slice(0, 40).map((r, i) =>
    `<option value="${i}" ${i === imp.headerRow ? 'selected' : ''}>${i + 1}행: ${esc(r.filter((x) => x !== '').slice(0, 4).join(' | ').slice(0, 40))}</option>`).join('');
  const box = $('#impMap');
  box.hidden = false;
  box.innerHTML = `
    <label class="span2">머리글 행<select data-k="headerRow">${rowOpts}</select></label>
    <label>날짜 열<select data-k="date">${opt(imp.cols.date)}</select></label>
    <label>금액 열<select data-k="amount">${opt(imp.cols.amount)}</select></label>
    <label>가맹점 열<select data-k="merchant">${opt(imp.cols.merchant)}</select></label>
    <label>승인번호 열 (선택)<select data-k="approval">${opt(imp.cols.approval)}</select></label>
    <label class="span2">취소 구분 열 (선택)<select data-k="status">${opt(imp.cols.status)}</select></label>
    <p class="hint span2">자동으로 찾은 열이에요. 틀렸으면 바꿔주세요.</p>`;
  box.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => {
    const k = s.dataset.k;
    if (k === 'headerRow') {
      imp.headerRow = Number(s.value);
      imp.cols = detectColumns(imp.table[imp.headerRow] || []);
      renderImportMap();
    } else {
      imp.cols = { ...imp.cols, [k]: Number(s.value) };
    }
    runClassify();
  }));
}

function runClassify() {
  if (!imp.table) return;
  const pay = $('#impPay').value;
  const c = imp.cols;
  if (c.date < 0 || c.amount < 0) {
    $('#impResult').hidden = false;
    $('#impSummary').innerHTML = '날짜 열과 금액 열을 지정해 주세요.';
    $('#impList').innerHTML = '';
    return;
  }
  const rows = extractRows(imp.table, imp.headerRow, c, new Date());
  imp.rows = rows;
  renderCardMap();
  imp.items = classify(rows, state.txs, pay, { cardMap: state.settings.cardMap });
  imp.filter = 'all';
  renderImport();
}

const linkCount = (items) => items.filter((x) => ['dup', 'similar'].includes(x.status) && !x.checked).length;

// 파일 안 카드 구분값별로 결제수단 고르기
function renderCardMap() {
  const labels = [...new Set(imp.rows.map((r) => r.cardLabel).filter(Boolean))];
  imp.multiCard = labels.length > 0;
  let box = $('#impCards');
  if (!box) {
    box = document.createElement('div');
    box.id = 'impCards';
    box.className = 'span2';
    $('#impMap').appendChild(box);
  }
  if (!labels.length) { box.innerHTML = ''; return; }
  const opts = [...CARDS.map((c) => [c.id, c.name]), ['순천사랑', '순천사랑'], ['기타', '기타'], ['skip', '가져오지 않음']];
  const map = state.settings.cardMap || {};
  box.innerHTML = '<span class="lbl">파일 안의 카드 구분</span>' + labels.map((l) => {
    const n = imp.rows.filter((r) => r.cardLabel === l).length;
    const cur = map[l] || $('#impPay').value;
    return `<label class="cardmap"><span>${esc(l)} <span class="hint">(${n}건)</span></span>
      <select data-card="${esc(l)}">${opts.map(([v, t]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  }).join('');
  box.querySelectorAll('[data-card]').forEach((s) => s.addEventListener('change', async () => {
    state.settings = { ...state.settings, cardMap: { ...state.settings.cardMap, [s.dataset.card]: s.value } };
    try { await store.saveSettings(state.settings); } catch { /* 저장 실패해도 이번 가져오기는 진행 */ }
    runClassify();
  }));
}

const ST = {
  new: ['신규', 'good'], dup: ['중복 의심', 'warn'], imported: ['이미 가져옴', 'manual'],
  cancel: ['취소', 'bad'], cancelled: ['취소된 결제', 'bad'],
  similar: ['비슷한 내역 있음', 'warn'], skipped: ['가져오지 않는 카드', 'manual'],
};

function renderImport() {
  const items = imp.items;
  const count = (s) => items.filter((x) => x.status === s).length;
  const picked = items.filter((x) => x.checked);
  $('#impResult').hidden = false;
  $('#impSummary').innerHTML = `${esc(imp.fileName)} · ${items.length}건 — 신규 <b>${count('new')}</b> · 중복 의심 <b>${count('dup')}</b> · 비슷한 내역 ${count('similar')} · 이미 가져옴 ${count('imported')} · 취소 ${count('cancel') + count('cancelled')}${count('skipped') ? ` · 제외 카드 ${count('skipped')}` : ''}<br>`
    + `가져올 건: <b>${picked.length}건 ${won(picked.reduce((a, x) => a + x.amount, 0))}</b>`
    + (linkCount(items) ? ` · 중복으로 처리할 ${linkCount(items)}건은 기존 내역에 카드 정보가 연결돼요` : '');

  const filters = [['all', '전체'], ['new', '신규'], ['dup', '중복 의심'], ['similar', '비슷한 내역'], ['cancel', '취소'], ['imported', '이미 가져옴']]
    .filter(([k]) => k === 'all' || items.some((x) => x.status === k || (k === 'cancel' && x.status === 'cancelled')));
  $('#impFilter').innerHTML = filters.map(([k, l]) => `<button class="chip ${imp.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('');
  $('#impFilter').querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { imp.filter = b.dataset.f; renderImport(); }));

  const shown = items.filter((x) => imp.filter === 'all' || x.status === imp.filter || (imp.filter === 'cancel' && x.status === 'cancelled'));
  $('#impList').innerHTML = shown.length ? shown.map((it) => {
    const idx = items.indexOf(it);
    const [label, cls] = ST[it.status];
    const card = cardById(it.payment);
    const areaSel = card && it.checked
      ? `<select data-area="${idx}">${card.areas.map((a) => `<option value="${a.key}" ${a.key === it.area ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select>` : '';
    const match = it.matches.length
      ? `<div class="match">${it.status === 'similar'
          ? (it.checked ? '금액이 비슷한 내역이 있어요. 같은 결제면 체크를 해제하세요' : '↔ 아래 내역과 같은 결제로 처리 (금액 차이는 비고에 기록)')
          : (it.checked ? '체크 해제하면 아래 기존 내역과 같은 결제로 처리' : '↔ 이미 입력한 내역')}${it.matches.length > 1 ? ` (${it.matches.length}건 합계)` : ''}:<br>${it.matches.map((t) =>
          `${t.tx_date} · ${esc(t.merchant || '-')} · ${esc(t.item)} · <b>${won(t.amount)}</b> (${esc(payName(t.payment))})`).join('<br>')}</div>` : '';
    const pair = it.pair ? ` · ${it.status === 'cancel' ? '원거래' : '취소건'} ${it.pair}행` : '';
    const note = it.status === 'cancel' && !it.pair ? ' · 원거래가 이미 저장돼 있다면 내역 탭에서 직접 삭제하세요' : '';
    return `<div class="imp ${it.checked ? '' : 'off'}">
      <input type="checkbox" data-chk="${idx}" ${it.checked ? 'checked' : ''} ${['imported', 'cancel', 'skipped'].includes(it.status) ? 'disabled' : ''} />
      <span class="t1">${esc(it.merchantRaw || '(가맹점 없음)')}</span><span class="amt">${it.cancel ? '-' : ''}${won(it.amount)}</span>
      <div class="sub">${it.date} · <span class="badge ${cls}">${label}</span>${it.cardLabel || imp.multiCard ? ` · ${esc(payName(it.payment))}` : ''}${it.overseas ? ' · 해외' : ''}${it.merchant && it.merchant !== it.merchantRaw ? ` · 사용처: ${esc(it.merchant)}` : ''}${pair}${note}${areaSel ? '<br>' + areaSel : ''}</div>
      ${match}
    </div>`;
  }).join('') : '<div class="empty-msg">해당하는 행이 없어요</div>';

  $('#impList').querySelectorAll('[data-chk]').forEach((el) => el.addEventListener('change', () => {
    items[el.dataset.chk].checked = el.checked;
    renderImport();
  }));
  $('#impList').querySelectorAll('[data-area]').forEach((el) => el.addEventListener('change', () => {
    items[el.dataset.area].area = el.value;
  }));
  const links = linkCount(items);
  $('#impConfirm').textContent = `${picked.length}건 가져오기${links ? ` + 중복 ${links}건 연결` : ''}`;
  $('#impConfirm').disabled = !picked.length && !links;
}

async function onImportConfirm() {
  const { inserts, links } = buildCommit(imp.items);
  if (!inserts.length && !links.length) return;
  const btn = $('#impConfirm');
  btn.disabled = true;
  try {
    const rows = await store.insertMany(inserts);
    const updated = [];
    for (const l of links) updated.push(await store.update(l.id, l.patch));
    const byId = new Map(updated.map((r) => [r.id, r]));
    state.txs = [...rows, ...state.txs.map((t) => byId.get(t.id) || t)];
    toast(`${rows.length}건 가져오고 ${updated.length}건 연결했어요`);
    renderAll();
    runClassify(); // 같은 파일 기준으로 다시 분류 → 모두 '이미 가져옴'으로 표시됨
  } catch (err) {
    toast(`가져오기 실패: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

init();
