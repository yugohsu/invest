/****************************************************************
 * 投資經理人 v7｜Beta 再平衡系統 ＋ 手機介面 ＋ 即時報價 ＋ 走勢研判
 * ---------------------------------------------------------------
 * 邏輯（只有一條規則）：
 *   Beta ＝ 所有持股的曝險 ÷ 總資產
 *          （正二、QLD 算 2 倍，一般股票/ETF 算 1 倍，現金 0 倍）
 *   目標 Beta 1.2（＝60% 正二 ＋ 40% 現金）
 *   Beta 高於 1.32（＋10%）→ 賣正二換現金，拉回 1.2
 *   Beta 低於 1.08（－10%）→ 用現金買正二，拉回 1.2
 *   不猜漲跌、不管時機，只看 Beta 有沒有超出範圍
 *
 * 防火牆：現金要留「4 年生活費」，買正二時絕不動用這筆錢
 * 再平衡交易一律用 00631L（成交量最大）；
 * 00685L（費用率低、長抱）與 QLD（美股）只做曝險計算，不會叫你頻繁買賣
 *
 * 只依規則計算，僅供參考，不是投資建議。
 *
 * 【安裝】
 *  1. 修改下方 CONFIG：LINE_TOKEN、WEB_PIN（網頁密碼）、初始持股
 *  2. 函式選 testAnalysis → 執行（第一次需授權；結果看「執行記錄」）
 *  3. 函式選 installTriggers → 執行（每個交易日約 11 點、16 點推播）
 *  4. 部署 → 管理部署作業 → ✏️ 編輯 → 版本選「新版本」→ 部署（網址不變）
 *  5. LINE 傳「綁定」接收推播；打開網址可看報告、增減持股
 ****************************************************************/

const CONFIG = {
  LINE_TOKEN: '在這裡貼上 Channel access token',
  LINE_TO: '',             // 可留空：在 LINE 傳「綁定」自動設定
  WEB_PIN: '',             // 網頁密碼（必填），例如 '8888'

  /* 初始持股：之後在網頁或 LINE 修改即可（改這裡會覆蓋網頁上的修改） */
  CASH: 300000,
  HOLDINGS: [
    { code: '2330', shares: 800, cost: 1527.08 },
    { code: '00631L', shares: 24000, cost: 34.05 }
    // 美股寫法：{ code: 'QLD', shares: 50, cost: 120 }（成本用美元）
  ],
  TRADE_CODE: '00631L'     // 再平衡時買賣的標的
};

/* 只有這幾個設定（網頁「設定」頁可改） */
const DEFAULT_SETTINGS = {
  targetBeta: 1.2,         // 目標 Beta：1.2＝60% 正二；新手建議 0.6＝30% 正二
  band: 10,                // 觸發範圍 ±%：10 → 1.08～1.32
  annualExpense: 0,        // 一年生活費（元）：用來檢查「4 年防火牆」，0＝還沒設定
  feeDiscount: 60,         // 手續費折數 %（6 折填 60）
  lot: 1,                  // 最小交易股數：零股 1、整張 1000
  pushIntraday: true,      // 盤中約 11 點推播
  pushClose: true,         // 盤後約 16 點推播
  pushOnlyAction: false,   // 只有要買賣才推播
  pushPremarket: true      // 每個交易日早上 8 點推播「盤前展望」（美股收盤後）
};

const FIREWALL_YEARS = 4;
const LEVERAGE = {
  '00631L': 2, '00675L': 2, '00663L': 2, '00685L': 2, '00670L': 2, '00647L': 2,
  '00632R': -1, '00676R': -1, '00664R': -1, '00686R': -1, '00669R': -1,
  'QLD': 2, 'SSO': 2, 'TQQQ': 3, 'UPRO': 3, 'SQQQ': -3, 'PSQ': -1
};
const NAMES = {
  '0050': '元大台灣50', '006208': '富邦台50', '00631L': '元大台灣50正2', '00685L': '群益臺灣加權正2',
  '00675L': '富邦臺灣加權正2', '00663L': '國泰臺灣加權正2', '00632R': '台灣50反1',
  '2330': '台積電', 'QLD': '那斯達克100 正2', 'QQQ': '那斯達克100', 'TQQQ': '那斯達克100 正3'
};
const TSMC_ETFS = { '0050': 0.6, '006208': 0.6, '00631L': 0.6, '00685L': 0.4, '00675L': 0.4, '00663L': 0.4 };
const TZ = 'Asia/Taipei';

/* ============================ 編輯器執行 ============================ */

function testAnalysis() {
  const r = runAnalysis_('manual', { push: false });
  console.log(r ? r.text : '目前取不到資料，請稍後再試。');
}

function pushNow() {
  const r = runAnalysis_('manual', { push: true, forcePush: true });
  console.log(r ? r.text : '目前取不到資料，請稍後再試。');
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['scheduledIntraday', 'scheduledClose', 'scheduledPremarket'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scheduledPremarket').timeBased().everyDays(1).atHour(8).nearMinute(0).inTimezone(TZ).create();
  ScriptApp.newTrigger('scheduledIntraday').timeBased().everyDays(1).atHour(11).nearMinute(0).inTimezone(TZ).create();
  ScriptApp.newTrigger('scheduledClose').timeBased().everyDays(1).atHour(16).nearMinute(0).inTimezone(TZ).create();
  console.log('已建立每日自動推播：約 8 點（盤前展望）、11 點（盤中）、16 點（盤後）。週末、休市日自動略過。');
}

function resetHoldingsFromCode() {
  const p = PropertiesService.getScriptProperties();
  p.setProperty('HOLDINGS_JSON', configSeed_());
  p.setProperty('CONFIG_SEED', configSeed_());
  console.log(holdingsText_());
}

/* ============================ 排程 ============================ */

function scheduledIntraday() {
  if (getSettings_().pushIntraday) runAnalysis_('intraday', { push: true, scheduled: true });
}

function scheduledPremarket() {
  if (getSettings_().pushPremarket) runAnalysis_('premarket', { push: true, scheduled: true });
}

function scheduledClose() {
  if (getSettings_().pushClose) runAnalysis_('close', { push: true, scheduled: true });
}

function asyncAnalysis() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'asyncAnalysis') ScriptApp.deleteTrigger(t);
  });
  try {
    const r = runAnalysis_('manual', { push: true, forcePush: true });
    if (!r) pushLine_('目前取不到資料，請稍後再傳一次「分析」。');
  } catch (e) {
    try { pushLine_('分析時發生錯誤：' + e.message); } catch (e2) { console.error(e2); }
  }
}

/* ============================ 設定與持股 ============================ */

function getSettings_() {
  let s = {};
  try { s = JSON.parse(PropertiesService.getScriptProperties().getProperty('SETTINGS_JSON') || '{}'); } catch (e) { s = {}; }
  const out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { out[k] = (k in s) ? s[k] : DEFAULT_SETTINGS[k]; });
  return out;
}

function saveSettings_(obj) {
  const cur = getSettings_();
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (!(k in obj)) return;
    const def = DEFAULT_SETTINGS[k];
    let v = obj[k];
    if (typeof def === 'number') { v = Number(v); if (!isFinite(v) || v < 0) v = def; }
    else if (typeof def === 'boolean') v = (v === true || v === 'true');
    cur[k] = v;
  });
  if (cur.targetBeta <= 0) cur.targetBeta = DEFAULT_SETTINGS.targetBeta;
  if (cur.band <= 0) cur.band = DEFAULT_SETTINGS.band;
  PropertiesService.getScriptProperties().setProperty('SETTINGS_JSON', JSON.stringify(cur));
  return cur;
}

function configSeed_() {
  return JSON.stringify({
    cash: Number(CONFIG.CASH) || 0,
    items: (CONFIG.HOLDINGS || []).map(function (h) {
      return { code: String(h.code).trim().toUpperCase(), shares: Number(h.shares) || 0, cost: Number(h.cost) || 0 };
    }).filter(function (h) { return h.code && h.shares > 0; })
  });
}

function loadHoldings_() {
  const p = PropertiesService.getScriptProperties();
  const seed = configSeed_();
  if (p.getProperty('CONFIG_SEED') !== seed || !p.getProperty('HOLDINGS_JSON')) {
    p.setProperty('HOLDINGS_JSON', seed);
    p.setProperty('CONFIG_SEED', seed);
  }
  try { return JSON.parse(p.getProperty('HOLDINGS_JSON')); } catch (e) { return JSON.parse(seed); }
}

function saveHoldings_(h) {
  h.items = (h.items || []).filter(function (x) { return x.shares > 0; });
  h.cash = round_(Number(h.cash) || 0, 0);
  PropertiesService.getScriptProperties().setProperty('HOLDINGS_JSON', JSON.stringify(h));
  return h;
}

// 買進／賣出。台股：價格為台幣；美股：價格為美元，現金以當下匯率換算
function applyTrade_(side, code, qty, price, adjustCash) {
  code = normCode_(code);
  qty = Number(qty); price = Number(price);
  if (!code) throw new Error('看不懂這個代號');
  if (!(qty > 0) || !(price > 0)) throw new Error('股數和價格要大於 0');
  const S = getSettings_();
  const h = loadHoldings_();
  let it = h.items.filter(function (x) { return x.code === code; })[0];
  const fx = isUS_(code) ? (fetchFx_() || 0) : 1;
  if (isUS_(code) && adjustCash && !(fx > 0)) throw new Error('取不到美元匯率，請稍後再試或取消「同步調整現金」');
  const amtTwd = qty * price * fx;
  const fee = tradeCost_(code, side, amtTwd, qty, S);
  if (side === 'buy') {
    if (!it) { it = { code: code, shares: 0, cost: 0 }; h.items.push(it); }
    const feeLocal = fee / (fx || 1);
    it.cost = round_((it.cost * it.shares + qty * price + feeLocal) / (it.shares + qty), 2);
    it.shares += qty;
    if (adjustCash) h.cash -= (amtTwd + fee);
  } else {
    if (!it || it.shares < qty) throw new Error('登記的 ' + code + ' 只有 ' + comma_(it ? it.shares : 0) + ' 股，不夠賣');
    it.shares -= qty;
    if (adjustCash) h.cash += (amtTwd - fee);
  }
  saveHoldings_(h);
  return { fee: fee };
}

function setHolding_(code, shares, cost) {
  code = normCode_(code);
  if (!code) throw new Error('看不懂這個代號');
  const h = loadHoldings_();
  let it = h.items.filter(function (x) { return x.code === code; })[0];
  if (!it) { it = { code: code, shares: 0, cost: 0 }; h.items.push(it); }
  it.shares = Math.max(0, Number(shares) || 0);
  if (cost !== undefined && cost !== null && cost !== '') it.cost = Number(cost) || 0;
  return saveHoldings_(h);
}

function deleteHolding_(code) {
  code = normCode_(code);
  const h = loadHoldings_();
  h.items = h.items.filter(function (x) { return x.code !== code; });
  return saveHoldings_(h);
}

function setCash_(v) { const h = loadHoldings_(); h.cash = Number(v) || 0; return saveHoldings_(h); }

function holdingsText_() {
  const h = loadHoldings_();
  const L = ['📋 目前登記的持股'];
  h.items.forEach(function (x) {
    L.push('・' + nameOf_(x.code) + ' ' + x.code + '：' + comma_(x.shares) + ' 股（平均成本 ' + (x.cost ? comma_(x.cost, 2) : '—') + (isUS_(x.code) ? ' 美元' : ' 元') + '）');
  });
  if (!h.items.length) L.push('・（還沒有股票）');
  L.push('・現金：' + comma_(h.cash) + ' 元');
  return L.join('\n');
}

/* ============================ 主流程 ============================ */

function runAnalysis_(mode, opt) {
  opt = opt || {};
  const S = getSettings_();
  const now = new Date();
  const todayIso = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const todayYmd = todayIso.replace(/-/g, '');
  if (opt.scheduled && Number(Utilities.formatDate(now, TZ, 'u')) >= 6) return null;

  const hold = loadHoldings_();
  const twCodes = [], usCodes = [];
  hold.items.forEach(function (x) { (isUS_(x.code) ? usCodes : twCodes).push(x.code); });
  if (twCodes.indexOf(CONFIG.TRADE_CODE) < 0) twCodes.push(CONFIG.TRADE_CODE);

  const hist = updateHistory_();
  let rt = null;
  try { rt = fetchRealtime_(twCodes); } catch (e) { rt = null; }

  if (opt.scheduled && mode !== 'premarket') {
    if (rt && rt.t00 && rt.t00.date && rt.t00.date !== todayYmd) return null;
    if (!rt) {
      if (mode === 'intraday') return null;
      if (!hist.length || hist[hist.length - 1][0] !== todayIso) return null;
    }
  }

  const quotes = {};
  twCodes.forEach(function (c) {
    if (rt && rt[c] && rt[c].price > 0) quotes[c] = { price: rt[c].price, prev: rt[c].prev, name: rt[c].name, fx: 1 };
    else { const q = fetchLastClose_(c); if (q) quotes[c] = { price: q.price, prev: q.prev, name: '', fx: 1 }; }
  });
  let fx = null;
  if (usCodes.length) {
    fx = fetchFx_();
    usCodes.forEach(function (c) {
      const q = fetchUsQuote_(c);
      if (q && fx > 0) quotes[c] = { price: q.price, prev: q.prev, name: '', fx: fx };
    });
  }

  const mk = analyzeMarket_(hist, rt, todayIso);
  const pf = analyzePortfolio_(hold, quotes, S);
  const plan = betaPlan_(pf, quotes, S, mk);
  const confirmed = !(mk && mk.isIntraday);
  let outlook = null;
  try { outlook = buildOutlook_(mk, pf, plan, S, mode); } catch (e) { console.error(e); outlook = null; }

  let title;
  if (mode === 'premarket') title = '盤前展望';
  else if (mode === 'intraday') title = '盤中快報';
  else if (mode === 'close') title = '盤後報告';
  else title = (mk && mk.isIntraday) ? '即時報告（盤中）' : '即時報告（收盤後）';

  const text = compose_({ title: title, now: now, mk: mk, pf: pf, plan: plan, S: S, fx: fx, confirmed: confirmed, outlook: outlook, mode: mode });
  if (opt.push) {
    if (opt.forcePush || mode === 'premarket' || !S.pushOnlyAction || plan.actions.length) pushLine_(text);
  }
  PropertiesService.getScriptProperties().setProperty('LAST_RUN', Utilities.formatDate(now, TZ, 'yyyy/MM/dd HH:mm'));
  return { text: text, pf: pf, plan: plan, mk: mk, title: title, fx: fx, confirmed: confirmed, quotes: quotes, outlook: outlook };
}

/* ============================ 持股與 Beta ============================ */

function analyzePortfolio_(hold, quotes, S) {
  const items = [], missing = [];
  hold.items.forEach(function (h) {
    const q = quotes[h.code];
    if (!q || !(q.price > 0)) { missing.push(h.code); return; }
    const mult = expMult_(h.code);
    const value = h.shares * q.price * q.fx;
    let tsmc = 0;
    if (h.code === '2330') tsmc = value;
    else if (TSMC_ETFS[h.code]) tsmc = value * TSMC_ETFS[h.code] * Math.max(mult, 0);
    items.push({
      code: h.code, name: nameOf_(h.code, q.name), shares: h.shares, cost: h.cost, us: isUS_(h.code),
      price: q.price, prev: q.prev, fx: q.fx, value: value, mult: mult, expValue: value * mult, tsmc: tsmc,
      pnl: h.cost > 0 ? (q.price - h.cost) * h.shares * q.fx : NaN
    });
  });
  const cash = Number(hold.cash) || 0;
  const stock = items.reduce(function (s, x) { return s + x.value; }, 0);
  const A = stock + cash;
  const expo = items.reduce(function (s, x) { return s + x.expValue; }, 0);
  const levValue = items.filter(function (x) { return x.mult >= 2; }).reduce(function (s, x) { return s + x.value; }, 0);
  const tsmc = items.reduce(function (s, x) { return s + x.tsmc; }, 0);
  return {
    items: items, missing: missing, cash: cash, A: A, expo: expo,
    beta: A > 0 ? expo / A : NaN,
    levPct: A > 0 ? levValue / A : NaN, cashPct: A > 0 ? cash / A : NaN,
    tsmcPct: A > 0 ? tsmc / A : NaN, empty: A <= 0
  };
}

// 大盤（台股）一起漲跌 m 時，Beta 會變成多少（2 倍標的漲跌 2m）
function betaAt_(pf, m) {
  let A = pf.cash, E = 0;
  pf.items.forEach(function (x) {
    const v = x.value * Math.max(0, 1 + x.mult * m);
    A += v; E += v * x.mult;
  });
  return A > 0 ? E / A : NaN;
}

// 找出 Beta 碰到某個值時，大盤要漲跌多少
function solveMove_(pf, target) {
  const b0 = betaAt_(pf, 0);
  let lo, hi;
  if (target > b0) { lo = 0; hi = 3; } else { lo = -0.49; hi = 0; }
  const f = function (m) { return betaAt_(pf, m) - target; };
  if (!(f(lo) * f(hi) <= 0)) return NaN;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

function betaPlan_(pf, quotes, S, mk) {
  const T = Number(S.targetBeta), band = Number(S.band) / 100;
  const up = T * (1 + band), dn = T * (1 - band);
  const lot = Math.max(1, Number(S.lot) || 1);
  const code = CONFIG.TRADE_CODE;
  const p = quotes[code] ? quotes[code].price : NaN;
  const firewall = FIREWALL_YEARS * (Number(S.annualExpense) || 0);
  const out = { T: T, up: up, dn: dn, state: 'ok', actions: [], notes: [], firewall: firewall };
  if (pf.empty || !isFinite(pf.beta)) { out.state = 'empty'; return out; }
  if (!(p > 0)) { out.notes.push('取不到 ' + code + ' 價格，今天無法計算買賣股數。'); return out; }

  const b = pf.beta;
  if (b > up) {
    out.state = 'high';
    // 賣出正二 X 元換現金：(expo − 2X) / A = T
    let X = (pf.expo - T * pf.A) / 2;
    const sells = [];
    const order = [code, '00685L', '00675L', '00663L'];
    order.forEach(function (c) {
      if (X <= 0) return;
      const it = pf.items.filter(function (x) { return x.code === c; })[0];
      if (!it) return;
      const q = Math.min(it.shares, roundDown_(X / it.price, lot));
      if (q > 0) { sells.push({ side: 'sell', code: c, qty: q, price: it.price, amount: q * it.price, fee: tradeCost_(c, 'sell', q * it.price, q, S) }); X -= q * it.price; }
    });
    if (sells.length) {
      out.actions.push({
        title: sells.map(function (s) { return '賣出 ' + nameOf_(s.code) + ' ' + s.code + ' ' + comma_(s.qty) + ' 股（約 ' + money_(s.amount) + '）'; }).join('、') + '，錢轉入現金',
        why: 'Beta ' + b.toFixed(2) + ' 已高於上限 ' + up.toFixed(2) + '。股市漲多了，賣掉一部分正二把獲利放回現金，Beta 回到 ' + T.toFixed(2) + '。這就是系統幫你做的「高賣」。',
        trades: sells
      });
    }
    if (X > p * lot) out.notes.push('台股正二不夠賣，還差約 ' + money_(X) + '。可以考慮減少 QLD 或其他持股。');
  } else if (b < dn) {
    out.state = 'low';
    const need = (T * pf.A - pf.expo) / 2;              // 買正二 X 元：(expo + 2X) / A = T
    const usable = Math.max(0, pf.cash - firewall);
    const use = Math.min(need, usable);
    const q = roundDown_(use / p, lot);
    if (q > 0) {
      const tr = { side: 'buy', code: code, qty: q, price: p, amount: q * p, fee: tradeCost_(code, 'buy', q * p, q, S) };
      out.actions.push({
        title: '用現金買進 ' + nameOf_(code) + ' ' + code + ' ' + comma_(q) + ' 股（約 ' + money_(tr.amount) + '）',
        why: 'Beta ' + b.toFixed(2) + ' 已低於下限 ' + dn.toFixed(2) + '。股市跌了，用現金買便宜的正二，Beta 回到 ' + T.toFixed(2) + '。這就是系統幫你做的「低買」。' +
          (use < need ? '（為了守住 ' + FIREWALL_YEARS + ' 年生活費防火牆，只買到 Beta ' + betaAfterBuy_(pf, q * p).toFixed(2) + '）' : ''),
        trades: [tr]
      });
    } else {
      out.notes.push('Beta 偏低，但扣掉 ' + FIREWALL_YEARS + ' 年生活費防火牆後沒有可用現金，所以不加碼。生活優先。');
    }
  }

  // 何時會觸發（以大盤一起漲跌估算）
  const mUp = solveMove_(pf, up), mDn = solveMove_(pf, dn);
  out.trigger = {
    upMove: mUp, dnMove: mDn,
    upIdx: mk && isFinite(mUp) ? mk.price * (1 + mUp) : NaN,
    dnIdx: mk && isFinite(mDn) ? mk.price * (1 + mDn) : NaN,
    upPrice: isFinite(mUp) ? p * (1 + 2 * mUp) : NaN,
    dnPrice: isFinite(mDn) ? p * (1 + 2 * mDn) : NaN
  };
  out.actions.forEach(function (a) { a.fee = a.trades.reduce(function (s, x) { return s + x.fee; }, 0); });
  return out;
}

function betaAfterBuy_(pf, amt) { return pf.A > 0 ? (pf.expo + 2 * amt) / pf.A : NaN; }

/* ============================ 大盤（簡要） ============================ */

function analyzeMarket_(hist, rt, todayIso) {
  if (!hist || hist.length < 30) return null;
  const highs = hist.map(function (r) { return r[1]; });
  const closes = hist.map(function (r) { return r[2]; });
  let lastDate = hist[hist.length - 1][0], isIntraday = false;
  if (rt && rt.t00 && rt.t00.price > 0 && rt.t00.date) {
    const d = rt.t00.date;
    const iso = d.substr(0, 4) + '-' + d.substr(4, 2) + '-' + d.substr(6, 2);
    if (iso > lastDate) {
      closes.push(rt.t00.price); highs.push(Math.max(rt.t00.high || 0, rt.t00.price));
      lastDate = iso; isIntraday = (iso === todayIso && (rt.t00.time || '') < '13:30:00');
    } else if (iso === lastDate) {
      closes[closes.length - 1] = rt.t00.price;
      highs[highs.length - 1] = Math.max(highs[highs.length - 1], rt.t00.price);
    }
  }
  const n = closes.length, price = closes[n - 1], prev = closes[n - 2];
  const ma240 = sma_(closes, 240);
  const high252 = Math.max.apply(null, highs.slice(-252));
  return {
    price: price, chg: price / prev - 1, isIntraday: isIntraday, ma240: ma240, lastDate: lastDate,
    ma5: sma_(closes, 5), ma20: sma_(closes, 20), ma60: sma_(closes, 60),
    bias240: isFinite(ma240) ? price / ma240 - 1 : NaN, high252: high252, dd: price / high252 - 1
  };
}

/* ============================ 白話報告 ============================ */

function compose_(c) {
  const pf = c.pf, pl = c.plan, mk = c.mk, S = c.S;
  const L = [];
  const wk = ['日', '一', '二', '三', '四', '五', '六'][Number(Utilities.formatDate(c.now, TZ, 'u')) % 7];
  L.push('📊 投資經理人｜' + c.title);
  L.push(Utilities.formatDate(c.now, TZ, 'M/d') + '（' + wk + '）' + Utilities.formatDate(c.now, TZ, 'HH:mm'));
  L.push('');

  if (pf.empty) { L.push('還沒有持股資料，請先到網頁新增持股。'); return L.join('\n'); }

  L.push('━━ Beta 監控 ━━');
  const icon = pl.state === 'high' ? '🔴' : pl.state === 'low' ? '🔵' : '🟢';
  L.push(icon + ' 目前 Beta ' + pf.beta.toFixed(2) + '（目標 ' + pl.T.toFixed(2) + '，範圍 ' + pl.dn.toFixed(2) + '～' + pl.up.toFixed(2) + '）');
  L.push('意思是：大盤漲跌 10%，你的資產大約 ±' + pct_(pf.beta * 0.1, 1) + '（約 ' + money_(pf.A * pf.beta * 0.1) + '）');
  L.push('');

  if (c.outlook) outlookLines_(c.outlook, L);

  L.push('━━ 今天要做什麼（系統規則）━━');
  if (pl.actions.length) {
    pl.actions.forEach(function (a, i) {
      L.push((i + 1) + '️⃣ ' + a.title);
      L.push('　為什麼：' + a.why);
      if (a.fee > 0) L.push('　手續費＋稅：約 ' + comma_(a.fee) + ' 元');
    });
    if (!c.confirmed) L.push('⏰ 現在是盤中，數字還會變。收盤前 Beta 若還在範圍外再執行。');
    L.push('✍️ 成交後到網頁按「我已成交」，或在 LINE 傳「賣 正二 1000 37.2」。');
  } else {
    L.push('✅ Beta 在範圍內，不用買賣。不猜漲跌，照系統抱著就好。');
  }
  pl.notes.forEach(function (n) { L.push('・' + n); });

  if (pl.trigger && pl.state === 'ok') {
    L.push('');
    L.push('━━ 什麼時候會觸發？━━');
    const t = pl.trigger;
    if (isFinite(t.upMove)) L.push('🔺 大盤再漲約 ' + pct_(t.upMove, 1) + (isFinite(t.upIdx) ? '（約 ' + comma_(t.upIdx, 0) + ' 點，' + CONFIG.TRADE_CODE + ' 約 ' + comma_(t.upPrice, 2) + ' 元）' : '') + ' → 賣正二');
    if (isFinite(t.dnMove)) L.push('🔻 大盤再跌約 ' + pct_(-t.dnMove, 1) + (isFinite(t.dnIdx) ? '（約 ' + comma_(t.dnIdx, 0) + ' 點，' + CONFIG.TRADE_CODE + ' 約 ' + comma_(t.dnPrice, 2) + ' 元）' : '') + ' → 買正二');
    L.push('（假設所有持股跟著台股大盤一起動來估算；有美股時會有誤差）');
  }

  L.push('');
  L.push('━━ 你的資產 ━━');
  pf.items.forEach(function (x) {
    const pnl = x.cost > 0 ? '，' + (x.price >= x.cost ? '賺 ' : '賠 ') + pct_(Math.abs(x.price / x.cost - 1), 1) : '';
    L.push('・' + x.name + ' ' + x.code + '：' + comma_(x.shares) + ' 股 ＝ ' + money_(x.value) + (x.mult !== 1 ? '（' + x.mult + ' 倍）' : '') + pnl);
  });
  L.push('・現金：' + money_(pf.cash));
  L.push('・合計：' + money_(pf.A) + '｜槓桿部位 ' + pct_(pf.levPct, 0) + '、現金 ' + pct_(pf.cashPct, 0));
  if (c.fx) L.push('・美元匯率 ' + c.fx.toFixed(2));

  L.push('');
  L.push('━━ 防火牆（' + FIREWALL_YEARS + ' 年生活費）━━');
  if (!(S.annualExpense > 0)) {
    L.push('⚠️ 還沒設定一年生活費。請到網頁「設定」填入，系統才會幫你守住防火牆。');
  } else {
    const years = pf.cash / S.annualExpense;
    L.push((years >= FIREWALL_YEARS ? '🛡️ ' : '⚠️ ') + '現金可以撐 ' + years.toFixed(1) + ' 年生活費（目標 ' + FIREWALL_YEARS + ' 年 ＝ ' + money_(pl.firewall) + '）');
    if (years < FIREWALL_YEARS) L.push('現金不足 ' + FIREWALL_YEARS + ' 年：大跌時系統不會叫你加碼，有新的錢先存進現金。');
  }

  L.push('');
  L.push('━━ 壓力測試 ━━');
  [-0.2, -0.3].forEach(function (m) {
    const A2 = pf.cash + pf.items.reduce(function (s, x) { return s + x.value * Math.max(0, 1 + x.mult * m); }, 0);
    L.push('大盤跌 ' + pct_(-m, 0) + ' → 資產約剩 ' + money_(A2) + '（' + pct_(A2 / pf.A - 1, 0) + '）');
  });
  L.push('能接受這個數字嗎？睡不著就把目標 Beta 調低（新手建議 0.6）。');

  if (mk) {
    L.push('');
    L.push('━━ 市場（只供參考，不影響系統判斷）━━');
    L.push('台股大盤 ' + comma_(mk.price, 0) + ' 點，' + updown_(mk.chg) + (mk.isIntraday ? '（盤中）' : ''));
    L.push('離一年高點 ' + (mk.dd < -0.001 ? '跌 ' + pct_(-mk.dd, 1) : '在高點附近') + (isFinite(mk.bias240) ? '｜' + (mk.bias240 >= 0 ? '高於' : '低於') + '年線 ' + pct_(Math.abs(mk.bias240), 1) : ''));
  }
  if (isFinite(pf.tsmcPct) && pf.tsmcPct > 0.6) L.push('・提醒：資產約 ' + pct_(pf.tsmcPct, 0) + ' 押在台積電（含 ETF 內含），集中度很高。');
  if (pf.missing.length) L.push('・取不到 ' + pf.missing.join('、') + ' 的價格，這次沒算進去。');
  L.push('');
  L.push('（依規則計算，只供參考，不是投資建議）');
  return L.join('\n');
}

/* ============================ 走勢研判（美股 ＋ 消息面 ＋ 籌碼 ＋ 技術面） ============================ */
/*
 * 評分方式（每一項都會寫在報告裡，讓你知道依據）：
 *  ① 美股：台積電 ADR、費半、那斯達克 → 推估台股開盤漲跌
 *       推估 ≈ 0.85 ×（0.45×台積電ADR ＋ 0.30×費半 ＋ 0.25×那斯達克）
 *  ② 籌碼：外資買賣超（證交所三大法人）
 *  ③ 風險：VIX 恐慌指數、美債 10 年殖利率、布蘭特油價
 *  ④ 技術：大盤相對 5 日線、月線、季線的位置
 *  ⑤ 消息：Google 新聞「台股」最新標題的多空關鍵字
 * 只是參考，不改變 Beta 系統的買賣規則。
 */
function buildOutlook_(mk, pf, plan, S, mode) {
  const cache = CacheService.getScriptCache();
  let ext = null;
  const hit = cache.get('OUTLOOK_EXT');
  if (hit) ext = JSON.parse(hit);
  else {
    ext = {
      tsm: yahooChg_('TSM'), sox: yahooChg_('^SOX'), ndx: yahooChg_('^IXIC'), spx: yahooChg_('^GSPC'),
      vix: yahooChg_('^VIX'), tnx: yahooChg_('^TNX'), oil: yahooChg_('BZ=F'), nvda: yahooChg_('NVDA')
    };
    try { ext.inst = lastInstitutional_(); } catch (e) { ext.inst = null; }
    try { ext.news = newsSentiment_(); } catch (e) { ext.news = null; }
    cache.put('OUTLOOK_EXT', JSON.stringify(ext), 1200);
  }

  const reasons = [], plus = [], minus = [];
  let score = 0;

  // ① 美股推估
  let est = NaN;
  if (ext.tsm && ext.sox && ext.ndx) {
    est = 0.85 * (0.45 * ext.tsm.chg + 0.30 * ext.sox.chg + 0.25 * ext.ndx.chg);
    const s1 = Math.max(-3, Math.min(3, est * 100));
    score += s1;
    (est >= 0 ? plus : minus).push('美股：台積電 ADR ' + sgn_(ext.tsm.chg) + '、費半 ' + sgn_(ext.sox.chg) + '、那斯達克 ' + sgn_(ext.ndx.chg));
  }
  // ② 外資
  if (ext.inst && isFinite(ext.inst.foreign)) {
    const f = ext.inst.foreign / 1e8;
    if (f <= -300) { score -= 1; minus.push('外資賣超 ' + Math.round(-f) + ' 億'); }
    else if (f >= 300) { score += 1; plus.push('外資買超 ' + Math.round(f) + ' 億'); }
    if (ext.inst.trust >= 50e8) plus.push('投信買超 ' + Math.round(ext.inst.trust / 1e8) + ' 億（內資承接）');
  }
  // ③ 風險指標
  if (ext.vix) {
    if (ext.vix.price >= 30) { score -= 1; minus.push('VIX 恐慌指數 ' + ext.vix.price.toFixed(1) + '（市場很恐慌）'); }
    else if (ext.vix.price >= 22) { score -= 0.5; minus.push('VIX 恐慌指數 ' + ext.vix.price.toFixed(1) + '（偏緊張）'); }
    else if (ext.vix.price < 15) plus.push('VIX ' + ext.vix.price.toFixed(1) + '（市場平靜）');
  }
  if (ext.tnx && ext.tnx.price >= 4.8) { score -= 0.5; minus.push('美債 10 年殖利率 ' + ext.tnx.price.toFixed(2) + '%（資金成本高）'); }
  if (ext.oil && ext.oil.price >= 100) { score -= 0.5; minus.push('布蘭特油價 ' + ext.oil.price.toFixed(0) + ' 美元（通膨壓力）'); }
  // ④ 技術面
  if (mk && isFinite(mk.ma20)) {
    if (mk.price < mk.ma20) { score -= 0.5; minus.push('大盤在月線（' + comma_(mk.ma20, 0) + '）之下'); }
    else plus.push('大盤在月線（' + comma_(mk.ma20, 0) + '）之上');
  }
  // ⑤ 消息面
  if (ext.news && ext.news.n > 0) {
    if (ext.news.score <= -2) { score -= 1; minus.push('新聞偏空（' + ext.news.neg + ' 則偏空、' + ext.news.pos + ' 則偏多）'); }
    else if (ext.news.score >= 2) { score += 1; plus.push('新聞偏多（' + ext.news.pos + ' 則偏多、' + ext.news.neg + ' 則偏空）'); }
  }

  let label, icon;
  if (score <= -3) { label = '偏空，可能明顯開低'; icon = '🌧️'; }
  else if (score <= -1) { label = '小幅偏空'; icon = '☁️'; }
  else if (score < 1) { label = '中性震盪'; icon = '⛅'; }
  else if (score < 3) { label = '小幅偏多'; icon = '🌤️'; }
  else { label = '偏多，可能明顯開高'; icon = '☀️'; }

  const base = mk ? mk.price : NaN;
  const lo = isFinite(est) ? est - 0.007 : NaN, hi = isFinite(est) ? est + 0.007 : NaN;
  const levels = [];
  if (mk) {
    if (isFinite(mk.ma5)) levels.push({ name: '5 日線', v: mk.ma5 });
    if (isFinite(mk.ma20)) levels.push({ name: '月線', v: mk.ma20 });
    if (isFinite(mk.ma60)) levels.push({ name: '季線', v: mk.ma60 });
    if (isFinite(mk.ma240)) levels.push({ name: '年線', v: mk.ma240 });
  }
  const estIdx = base * (1 + (isFinite(est) ? est : 0));
  const key = levels.slice().sort(function (a, b) { return Math.abs(a.v - estIdx) - Math.abs(b.v - estIdx); })
    .filter(function (x) { return Math.abs(x.v / estIdx - 1) <= 0.02; })[0] || null;   // 推估點位附近 2% 內的均線＝攻防線
  const support = key || levels.filter(function (x) { return x.v < estIdx; }).sort(function (a, b) { return b.v - a.v; })[0] || null;
  const resist = levels.filter(function (x) { return x.v >= estIdx; }).sort(function (a, b) { return a.v - b.v; })[0] || null;

  // 投資參考建議（配合你的 Beta 系統）
  const tips = [];
  const expoLoss = isFinite(est) ? pf.expo * est : NaN;
  if (isFinite(expoLoss)) tips.push('依推估，你的資產可能' + (expoLoss >= 0 ? '增加' : '減少') + '約 ' + money_(Math.abs(expoLoss)) + '（曝險 ' + money_(pf.expo) + ' × ' + sgn_(est) + '）');
  if (plan && plan.trigger && plan.state === 'ok') {
    const t = plan.trigger;
    if (isFinite(est) && est < 0 && isFinite(t.dnMove) && est <= t.dnMove) tips.push('⚠️ 推估跌幅可能讓 Beta 跌破下限 → 收盤確認後，照系統用現金買正二');
    else if (isFinite(est) && est > 0 && isFinite(t.upMove) && est >= t.upMove) tips.push('⚠️ 推估漲幅可能讓 Beta 超過上限 → 收盤確認後，照系統賣正二');
    else tips.push('推估漲跌不會觸發再平衡（還差：再跌 ' + pct_(-(t.dnMove || 0), 1) + ' 或再漲 ' + pct_(t.upMove || 0, 1) + '）→ 照系統，不用動');
  } else if (plan && plan.state !== 'ok' && plan.state !== 'empty') {
    tips.push('Beta 已超出範圍，請看「今天要做什麼」');
  }
  if (score <= -1) {
    tips.push('偏空日：不要恐慌殺低；系統沒叫你賣就不賣');
    tips.push('有新的錢想投入：可以先存進現金，等系統觸發或分 2～3 天慢慢買，避免買在開盤最低迷時的情緒');
    if (key) tips.push(key.name + ' ' + comma_(key.v, 0) + ' 點是今天的攻防線：收盤守住偏向止穩，跌破代表短線還會弱一段');
    else if (support) tips.push('下方支撐看' + support.name + ' ' + comma_(support.v, 0) + ' 點');
  } else if (score >= 1) {
    tips.push('偏多日：不要因為大漲追買正二；Beta 超過上限系統會提醒你賣');
    if (resist) tips.push('上方壓力看' + resist.name + ' ' + comma_(resist.v, 0) + ' 點');
  } else {
    tips.push('中性日：照系統抱著就好，不需要特別動作');
  }
  if (S.annualExpense > 0 && pf.cash < S.annualExpense * FIREWALL_YEARS) tips.push('現金低於 4 年生活費防火牆，波動大時更要守住現金');

  return {
    label: label, icon: icon, score: Math.round(score * 10) / 10, est: est, lo: lo, hi: hi, base: base,
    estIdx: estIdx, loIdx: base * (1 + lo), hiIdx: base * (1 + hi),
    plus: plus, minus: minus, key: key, support: support, resist: resist, levels: levels, tips: tips,
    us: { tsm: ext.tsm, sox: ext.sox, ndx: ext.ndx, spx: ext.spx, nvda: ext.nvda, vix: ext.vix, tnx: ext.tnx, oil: ext.oil },
    usDate: ext.tsm ? ext.tsm.date : '', inst: ext.inst,
    news: ext.news ? ext.news.items.slice(0, 5) : [], mode: mode
  };
}

function outlookLines_(o, L) {
  L.push('━━ ' + o.icon + ' 走勢研判：' + o.label + ' ━━');
  if (isFinite(o.est)) {
    L.push('推估台股開盤：' + sgn_(o.est) + '（約 ' + comma_(o.loIdx, 0) + '～' + comma_(o.hiIdx, 0) + ' 點）');
  }
  if (o.us.tsm) {
    L.push('美股' + (o.usDate ? '（' + o.usDate + '）' : '') + '：台積電ADR ' + sgn_(o.us.tsm.chg) + '｜費半 ' + sgn_(o.us.sox ? o.us.sox.chg : NaN) +
      '｜那斯達克 ' + sgn_(o.us.ndx ? o.us.ndx.chg : NaN) + '｜標普 ' + sgn_(o.us.spx ? o.us.spx.chg : NaN) + '｜輝達 ' + sgn_(o.us.nvda ? o.us.nvda.chg : NaN));
  }
  if (o.minus.length) L.push('🔻 偏空因素：' + o.minus.join('；'));
  if (o.plus.length) L.push('🔺 偏多因素：' + o.plus.join('；'));
  const lv = o.levels.map(function (x) { return x.name + ' ' + comma_(x.v, 0); }).join('｜');
  if (lv) L.push('關鍵價位：' + lv);
  if (o.news && o.news.length) {
    L.push('📰 最新消息：');
    o.news.slice(0, 3).forEach(function (n) { L.push('・' + (n.tone > 0 ? '🔺' : n.tone < 0 ? '🔻' : '▫️') + ' ' + n.title); });
  }
  L.push('');
  L.push('━━ 💡 投資參考建議 ━━');
  o.tips.forEach(function (t) { L.push('・' + t); });
  L.push('（走勢研判是機率推估，常會不準；真正的買賣仍以 Beta 系統為準）');
  L.push('');
}

function yahooChg_(sym) {
  const j = httpJson_('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=5d&interval=1d');
  try {
    const r = j.chart.result[0], meta = r.meta;
    const closes = (r.indicators.quote[0].close || []).filter(function (x) { return x != null; });
    const price = Number(meta.regularMarketPrice);
    let prev = closes.length >= 2 ? closes[closes.length - 2] : Number(meta.chartPreviousClose);
    if (closes.length >= 1 && Math.abs(closes[closes.length - 1] - price) / price > 0.002) prev = closes[closes.length - 1];
    if (!(price > 0) || !(prev > 0)) return null;
    const date = meta.regularMarketTime ? Utilities.formatDate(new Date(meta.regularMarketTime * 1000), 'America/New_York', 'M/d') : '';
    return { price: price, prev: prev, chg: price / prev - 1, date: date };
  } catch (e) { return null; }
}

function lastInstitutional_() {
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    if (Number(Utilities.formatDate(d, TZ, 'u')) >= 6) continue;
    if (i === 0 && Number(Utilities.formatDate(now, TZ, 'H')) < 15) continue;
    const ymd = Utilities.formatDate(d, TZ, 'yyyyMMdd');
    const j = httpJson_('https://www.twse.com.tw/rwd/zh/fund/BFI82U?type=day&dayDate=' + ymd + '&response=json');
    if (j && j.stat === 'OK' && j.data && j.data.length) {
      const o = { foreign: 0, trust: 0, dealer: 0, date: ymd };
      j.data.forEach(function (r) {
        const name = String(r[0]), v = num_(r[3]);
        if (!isFinite(v)) return;
        if (name.indexOf('自營商') === 0) o.dealer += v;
        else if (name.indexOf('投信') === 0) o.trust = v;
        else if (name.indexOf('外資及陸資') === 0) o.foreign = v;
      });
      return o;
    }
  }
  return null;
}

// Google 新聞「台股」標題，用關鍵字判斷多空
function newsSentiment_() {
  const NEG = ['崩', '重挫', '大跌', '暴跌', '下殺', '狂殺', '賣超', '疑慮', '泡沫', '升息', '制裁', '衝突', '戰爭', '跌破', '恐慌', '利空', '黑', '殺', '摜', '失守', '拋售', '爆倉'];
  const POS = ['大漲', '創高', '新高', '買超', '反彈', '降息', '利多', '強勁', '亮眼', '攻', '紅盤', '回升', '止穩', '樂觀', '上修', '噴'];
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent('台股 when:1d') + '&hl=zh-TW&gl=TW&ceid=TW:zh-Hant';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const doc = XmlService.parse(res.getContentText());
  const items = doc.getRootElement().getChild('channel').getChildren('item').slice(0, 20);
  let pos = 0, neg = 0;
  const out = items.map(function (it) {
    const title = it.getChildText('title').replace(/\s+-\s+[^-]+$/, '');
    let t = 0;
    NEG.forEach(function (w) { if (title.indexOf(w) >= 0) t--; });
    POS.forEach(function (w) { if (title.indexOf(w) >= 0) t++; });
    const tone = t > 0 ? 1 : t < 0 ? -1 : 0;
    if (tone > 0) pos++; else if (tone < 0) neg++;
    return { title: title, tone: tone, link: it.getChildText('link') };
  });
  return { n: out.length, pos: pos, neg: neg, score: Math.round((pos - neg) / 3), items: out };
}

function sgn_(x) { return isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—'; }

/* ============================ 網頁 API ============================ */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('投資經理人')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function checkPin_(pin) {
  if (!CONFIG.WEB_PIN) throw new Error('尚未設定網頁密碼：請在程式 CONFIG 的 WEB_PIN 填入密碼後重新部署。');
  if (String(pin) !== String(CONFIG.WEB_PIN)) throw new Error('密碼錯誤');
}

function apiLogin(pin) { checkPin_(pin); return true; }

function apiDashboard(pin) {
  checkPin_(pin);
  const r = runAnalysis_('manual', { push: false });
  const pf = r.pf, pl = r.plan;
  return {
    title: r.title, text: r.text, confirmed: r.confirmed, fx: r.fx,
    beta: pf.beta, A: pf.A, cash: pf.cash, levPct: pf.levPct, cashPct: pf.cashPct, tsmcPct: pf.tsmcPct,
    plan: { T: pl.T, up: pl.up, dn: pl.dn, state: pl.state, actions: pl.actions, notes: pl.notes, trigger: pl.trigger || null, firewall: pl.firewall },
    market: r.mk ? { price: r.mk.price, chg: r.mk.chg } : null,
    items: pf.items.map(function (x) {
      return { code: x.code, name: x.name, shares: x.shares, cost: x.cost, price: x.price, prev: x.prev, value: x.value, mult: x.mult, pnl: x.pnl, us: x.us };
    }),
    missing: pf.missing, holdings: loadHoldings_(), settings: getSettings_(),
    tradeCode: CONFIG.TRADE_CODE,
    tradePrice: r.quotes[CONFIG.TRADE_CODE] ? r.quotes[CONFIG.TRADE_CODE].price : null,
    firewallYears: FIREWALL_YEARS,
    outlook: r.outlook,
    lastRun: PropertiesService.getScriptProperties().getProperty('LAST_RUN') || ''
  };
}

// 輕量即時報價：網頁每分鐘呼叫一次，只抓價格，不做完整分析
function apiLive(pin) {
  checkPin_(pin);
  const hold = loadHoldings_();
  const tw = [], us = [];
  hold.items.forEach(function (x) { (isUS_(x.code) ? us : tw).push(x.code); });
  if (tw.indexOf(CONFIG.TRADE_CODE) < 0) tw.push(CONFIG.TRADE_CODE);
  let rt = null;
  try { rt = fetchRealtime_(tw); } catch (e) { rt = null; }
  const quotes = {};
  tw.forEach(function (c) { if (rt && rt[c]) quotes[c] = { price: rt[c].price, prev: rt[c].prev }; });
  let fx = null;
  if (us.length) {
    const cache = CacheService.getScriptCache();
    us.forEach(function (c) {
      const k = 'US_' + c;
      let q = null;
      const hit = cache.get(k);
      if (hit) q = JSON.parse(hit);
      else { q = fetchUsQuote_(c); if (q) cache.put(k, JSON.stringify(q), 60); }
      if (q) quotes[c] = q;
    });
    const fh = cache.get('FX');
    if (fh) fx = Number(fh);
    else { fx = fetchFx_(); if (fx) cache.put('FX', String(fx), 300); }
  }
  const idx = rt && rt.t00 ? { price: rt.t00.price, prev: rt.t00.prev, date: rt.t00.date, time: rt.t00.time } : null;
  return {
    ok: !!rt, index: idx, quotes: quotes, fx: fx,
    serverTime: Utilities.formatDate(new Date(), TZ, 'HH:mm:ss'),
    today: Utilities.formatDate(new Date(), TZ, 'yyyyMMdd')
  };
}

function apiTrade(pin, side, code, qty, price, adjustCash) {
  checkPin_(pin);
  const r = applyTrade_(side, code, qty, price, adjustCash !== false);
  return { ok: true, msg: '已記錄' + (side === 'buy' ? '買進 ' : '賣出 ') + normCode_(code) + ' ' + comma_(qty) + ' 股（手續費＋稅約 ' + comma_(r.fee) + ' 元）' };
}
function apiSetHolding(pin, code, shares, cost) { checkPin_(pin); setHolding_(code, shares, cost); return { ok: true, msg: '已更新 ' + normCode_(code) }; }
function apiDelete(pin, code) { checkPin_(pin); deleteHolding_(code); return { ok: true, msg: '已刪除 ' + normCode_(code) }; }
function apiSetCash(pin, v) { checkPin_(pin); setCash_(v); return { ok: true, msg: '現金已更新' }; }
function apiSaveSettings(pin, o) { checkPin_(pin); saveSettings_(o); return { ok: true, msg: '設定已儲存' }; }
function apiPush(pin) { checkPin_(pin); const r = runAnalysis_('manual', { push: true, forcePush: true }); return { ok: !!r, msg: r ? '已推播到 LINE' : '取不到資料' }; }

function apiQuote(pin, code) {
  checkPin_(pin);
  code = normCode_(code);
  if (!code) throw new Error('看不懂這個代號');
  if (isUS_(code)) {
    const q = fetchUsQuote_(code);
    if (q) return { code: code, name: nameOf_(code), price: q.price, us: true };
  } else {
    let rt = null;
    try { rt = fetchRealtime_([code]); } catch (e) { rt = null; }
    if (rt && rt[code]) return { code: code, name: nameOf_(code, rt[code].name), price: rt[code].price, us: false };
    const q = fetchLastClose_(code);
    if (q) return { code: code, name: nameOf_(code), price: q.price, us: false };
  }
  throw new Error('找不到 ' + code + ' 的價格');
}

/* ============================ LINE ============================ */

function lineToken_() { const t = CONFIG.LINE_TOKEN; return t && t.indexOf('貼上') < 0 ? t : ''; }

function pushLine_(text) {
  const token = lineToken_();
  const to = PropertiesService.getScriptProperties().getProperty('LINE_TO') || CONFIG.LINE_TO;
  if (!token || !to) throw new Error('還沒設定 LINE：請在 CONFIG 貼上 LINE_TOKEN，並在 LINE 傳「綁定」');
  const msgs = splitText_(text, 4800).slice(0, 5).map(function (t) { return { type: 'text', text: t }; });
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ to: to, messages: msgs })
  });
  if (res.getResponseCode() !== 200) throw new Error('LINE 推播失敗：' + res.getContentText());
}

function replyLine_(replyToken, text) {
  const token = lineToken_();
  if (!token) return;
  const msgs = splitText_(text, 4800).slice(0, 5).map(function (t) { return { type: 'text', text: t }; });
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ replyToken: replyToken, messages: msgs })
  });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const p = PropertiesService.getScriptProperties();
    (body.events || []).forEach(function (ev) {
      if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
      const src = ev.source || {};
      const uid = src.userId || '';
      const target = src.groupId || src.roomId || src.userId;
      const owner = p.getProperty('OWNER_ID');
      const text = String(ev.message.text || '').trim();
      if (text === '綁定') {
        if (!owner && uid) { p.setProperty('OWNER_ID', uid); p.setProperty('LINE_TO', target); replyLine_(ev.replyToken, '✅ 綁定完成！傳「說明」看指令。'); }
        else if (owner === uid) { p.setProperty('LINE_TO', target); replyLine_(ev.replyToken, '✅ 已改送到這個聊天室。'); }
        return;
      }
      if (!owner || uid !== owner) return;
      const reply = handleCommand_(text);
      if (reply) replyLine_(ev.replyToken, reply);
    });
  } catch (err) { console.error(err); }
  return ContentService.createTextOutput('OK');
}

function handleCommand_(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  let m;
  try {
    if (/^(分析|報告|beta|Beta)$/i.test(t)) {
      ScriptApp.newTrigger('asyncAnalysis').timeBased().after(1000).create();
      return '🔍 收到！約 20～40 秒後把報告傳給你。';
    }
    if (/^持股$/.test(t)) return holdingsText_();
    if ((m = t.match(/^(買進?|賣出?)\s*(\S+?)\s+([\d,]+)\s*股?\s+([\d.,]+)\s*元?$/))) {
      const side = /^買/.test(m[1]) ? 'buy' : 'sell';
      const r = applyTrade_(side, m[2], num_(m[3]), num_(m[4]), true);
      return '✅ 已記錄（手續費＋稅約 ' + comma_(r.fee) + ' 元，現金已自動調整）\n\n' + holdingsText_();
    }
    if ((m = t.match(/^設定\s*(\S+?)\s+([\d,]+)(?:\s+([\d.,]+))?$/))) { setHolding_(m[1], num_(m[2]), m[3] ? num_(m[3]) : undefined); return '✅ 已設定\n\n' + holdingsText_(); }
    if ((m = t.match(/^現金\s*([\d,]+)\s*元?$/))) { setCash_(num_(m[1])); return '✅ 現金已更新\n\n' + holdingsText_(); }
    if ((m = t.match(/^刪除\s*(\S+)$/))) { deleteHolding_(m[1]); return '✅ 已刪除\n\n' + holdingsText_(); }
    if (/^(說明|help|\?|？)$/i.test(t)) {
      return '📈 指令\n・分析\n・持股\n・買 正二 1000 37.2\n・賣 00685L 500 25.3\n・買 QLD 10 115.5（美元）\n・設定 2330 800 1527\n・現金 300000\n・刪除 0050\n・綁定';
    }
  } catch (e) { return '⚠️ ' + e.message; }
  return null;
}

function normCode_(s) {
  const x = String(s || '').trim().toUpperCase();
  if (/^(正二|正2)$/.test(x)) return CONFIG.TRADE_CODE;
  if (/^(台積電|台積)$/.test(x)) return '2330';
  if (/^\d{4,6}[A-Z]?$/.test(x)) return x;
  if (/^[A-Z]{1,5}$/.test(x)) return x;   // 美股代號
  return '';
}

function isUS_(code) { return /^[A-Z]{1,5}$/.test(code); }

/* ============================ 資料抓取 ============================ */

function httpJson_(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json,text/plain,*/*' } });
      if (res.getResponseCode() === 200) { try { return JSON.parse(res.getContentText()); } catch (e) { } }
    } catch (e) { }
    Utilities.sleep(1000 * (i + 1));
  }
  return null;
}

// 美股報價（Yahoo Finance）
function fetchUsQuote_(code) {
  const j = httpJson_('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(code) + '?range=5d&interval=1d');
  try {
    const meta = j.chart.result[0].meta;
    const price = Number(meta.regularMarketPrice);
    const prev = Number(meta.chartPreviousClose || meta.previousClose);
    return price > 0 ? { price: price, prev: prev } : null;
  } catch (e) { return null; }
}

// 美元兌台幣匯率（取不到時用上次的）
function fetchFx_() {
  const p = PropertiesService.getScriptProperties();
  const q = fetchUsQuote_('TWD=X');
  if (q && q.price > 20 && q.price < 50) { p.setProperty('LAST_FX', String(q.price)); return q.price; }
  const last = Number(p.getProperty('LAST_FX'));
  return last > 0 ? last : null;
}

function updateHistory_() {
  const map = {};
  loadHist_().forEach(function (r) { map[r[0]] = r; });
  const now = new Date();
  const months = [];
  const keys0 = Object.keys(map).sort();
  if (keys0.length < 250) {
    for (let i = 14; i >= 0; i--) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  } else {
    const last = keys0[keys0.length - 1];
    if (last === Utilities.formatDate(now, TZ, 'yyyy-MM-dd')) return keys0.map(function (k) { return map[k]; });
    const p = last.split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1, 1);
    while (d <= now) { months.push(new Date(d.getTime())); d.setMonth(d.getMonth() + 1); }
  }
  months.forEach(function (d, idx) {
    const ds = Utilities.formatDate(d, TZ, 'yyyyMM') + '01';
    const j = httpJson_('https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?date=' + ds + '&response=json');
    if (j && j.stat === 'OK' && j.data) {
      j.data.forEach(function (r) {
        const k = rocToIso_(r[0]), hi = num_(r[2]), cl = num_(r[4]);
        if (k && cl > 0) map[k] = [k, round_(hi, 1), round_(cl, 1)];
      });
    }
    if (idx < months.length - 1) Utilities.sleep(700);
  });
  let data = Object.keys(map).sort().map(function (k) { return map[k]; });
  if (data.length > 300) data = data.slice(-300);
  saveHist_(data);
  return data;
}

function saveHist_(rows) {
  const str = rows.map(function (r) { return r[0].replace(/-/g, '') + ',' + r[1] + ',' + r[2]; }).join(';');
  const n = Math.ceil(str.length / 8000);
  const obj = { HIST_N: String(n) };
  for (let i = 0; i < n; i++) obj['HIST_' + i] = str.substr(i * 8000, 8000);
  PropertiesService.getScriptProperties().setProperties(obj);
}

function loadHist_() {
  const p = PropertiesService.getScriptProperties();
  const n = Number(p.getProperty('HIST_N') || 0);
  let str = '';
  for (let i = 0; i < n; i++) str += p.getProperty('HIST_' + i) || '';
  if (!str) return [];
  return str.split(';').map(function (s) {
    const a = s.split(','), d = a[0];
    return [d.substr(0, 4) + '-' + d.substr(4, 2) + '-' + d.substr(6, 2), Number(a[1]), Number(a[2])];
  }).filter(function (r) { return r[2] > 0; });
}

function fetchRealtime_(codes) {
  const ch = ['tse_t00.tw'];
  codes.forEach(function (c) { ch.push('tse_' + c + '.tw'); ch.push('otc_' + c + '.tw'); });
  const j = httpJson_('https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' + encodeURIComponent(ch.join('|')) + '&json=1&delay=0&_=' + Date.now());
  if (!j || !j.msgArray || !j.msgArray.length) return null;
  const out = {};
  j.msgArray.forEach(function (m) {
    let price = num_(m.z);
    if (!(price > 0)) price = num_(String(m.b || '').split('_')[0]);
    if (!(price > 0)) price = num_(m.y);
    if (!(price > 0)) return;
    const key = String(m.c) === 't00' ? 't00' : String(m.c).toUpperCase();
    out[key] = { price: price, prev: num_(m.y), high: num_(m.h), date: m.d, time: m.t, name: m.n };
  });
  return out;
}

function fetchLastClose_(code) {
  const now = new Date();
  for (let back = 0; back < 2; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const j = httpJson_('https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=' + Utilities.formatDate(d, TZ, 'yyyyMM') + '01&stockNo=' + code + '&response=json');
    if (j && j.stat === 'OK' && j.data && j.data.length) {
      const row = j.data[j.data.length - 1];
      const close = num_(row[6]);
      const chg = num_(String(row[7]).replace(/[^\d.\-+]/g, ''));
      let prev = isFinite(chg) ? close - chg : NaN;
      if (!(prev > 0) && j.data.length > 1) prev = num_(j.data[j.data.length - 2][6]);
      return { price: close, prev: prev };
    }
    Utilities.sleep(600);
  }
  return null;
}

/* ============================ 小工具 ============================ */

// 台股：手續費（折數後，整股最低 20、零股最低 1）＋賣出交易稅（ETF 0.1%、股票 0.3%）
// 美股：依各家複委託費率不同，這裡概估 0.25%（最低 0）
function tradeCost_(code, side, amount, qty, S) {
  if (!(amount > 0)) return 0;
  if (isUS_(code)) return Math.round(amount * 0.0025);
  const fee = Math.max(qty % 1000 === 0 ? 20 : 1, Math.floor(amount * 0.001425 * (Number(S.feeDiscount) || 100) / 100));
  const tax = side === 'sell' ? Math.floor(amount * (/^00/.test(code) ? 0.001 : 0.003)) : 0;
  return fee + tax;
}

function expMult_(code) {
  if (LEVERAGE[code] !== undefined) return LEVERAGE[code];
  if (/^00\d+L$/.test(code)) return 2;
  if (/^00\d+R$/.test(code)) return -1;
  return 1;
}

function nameOf_(code, fb) { return NAMES[code] || (fb ? String(fb).trim() : '') || ''; }
function sma_(a, n) { if (a.length < n) return NaN; let s = 0; for (let i = a.length - n; i < a.length; i++) s += a[i]; return s / n; }
function num_(s) { if (s === null || s === undefined) return NaN; if (typeof s === 'number') return s; const v = parseFloat(String(s).replace(/,/g, '').trim()); return isFinite(v) ? v : NaN; }
function round_(x, d) { const p = Math.pow(10, d || 0); return Math.round(x * p) / p; }
function roundDown_(x, lot) { return (!isFinite(x) || x <= 0) ? 0 : Math.floor(x / lot) * lot; }
function comma_(n, d) { if (!isFinite(n)) return '—'; d = d || 0; const p = Math.abs(n).toFixed(d).split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (n < 0 ? '-' : '') + p.join('.'); }
function money_(v) { if (!isFinite(v)) return '—'; return Math.abs(v) >= 10000 ? (v / 10000).toFixed(1).replace(/\.0$/, '') + ' 萬元' : comma_(v) + ' 元'; }
function pct_(x, d) { return isFinite(x) ? (x * 100).toFixed(d === undefined ? 1 : d) + '%' : '—'; }
function updown_(x) { if (!isFinite(x)) return '—'; if (Math.abs(x) < 0.0005) return '平盤'; return (x > 0 ? '漲 ' : '跌 ') + pct_(Math.abs(x), 2); }
function rocToIso_(s) { const p = String(s).split('/'); if (p.length !== 3) return ''; return (Number(p[0]) + 1911) + '-' + ('0' + p[1]).slice(-2) + '-' + ('0' + p[2]).slice(-2); }
function splitText_(text, size) {
  const out = []; let cur = '';
  text.split('\n').forEach(function (line) { if ((cur + '\n' + line).length > size) { out.push(cur); cur = line; } else cur = cur ? cur + '\n' + line : line; });
  if (cur) out.push(cur);
  return out;
}
