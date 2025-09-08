// ====== 基本設定（把 Supabase 寫在程式裡；只放 anon key！） ======
const SUPABASE_URL = "https://iwvvlhpfffflnwdsdwqs.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3dnZsaHBmZmZmbG53ZHNkd3FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzNDAxMDEsImV4cCI6MjA2NzkxNjEwMX0.uxFt3jCbQXlVNtGKeOr6Vdxb1tWMiYd8N-LfugsMiwU";
const PRICES_TABLE  = "prices_daily";
const INDICATORS_TABLE = "api_features_flat";

// ====== 共用 ======
const $ = (s)=>document.querySelector(s);
const COINS = ["HOME","BTC","ETH","XRP","DOGE","BNB","ADA"];
const state = {
  theme: "light",
  charts: {},
  route: "HOME",
  ohlc: [],
  ind: {},
  sample: null,
  source: 'sample',
  pred: null,
  pred_source: 'none',
  impSort: 'desc'
};

// ---- 統一路徑：讓 GitHub Pages / 子路徑都能正確抓到 /data ----
const REPO_BASE = (function(){
  // e.g. pathname: "/eth-6h/home" -> repo = "eth-6h"
  const parts = location.pathname.split('/').filter(Boolean);
  // GitHub Pages 的專案站通常是 /<repo>/...；個人網域或本機可能在根目錄
  return (location.hostname.endsWith('github.io') && parts.length) ? `/${parts[0]}` : '';
})();
const DATA_BASE = `${REPO_BASE}/data`;

// === 迷你走勢：要畫哪些指標 ===
const SPARK_LIST = [
  ['RSI14', 'rsi14', {min:0, max:100}],
  ['ATR14', 'atr14', {}],
  ['BBW', 'bbw', {}],
  ['Ret 1d', 'log_r1', {}],
  ['Ret 5d', 'log_r5', {}],
  ['MACD', 'macd', {macd:true}]
];

// 直接走你標準化後的視圖
const SB_BASE = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`;
const SB_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  Accept: 'application/json',
  'Accept-Profile': 'predictor', // 你的 schema
};

// 交易日誌分頁器（無限下拉）
const TradeLog = {
  asset:'BTC', view:'V1',
  pageSize: 200,          // 每次抓幾筆（可調）
  lastOpenDt: '',         // keyset 游標（用 open_dt）
  offset: 0,              // Range fallback 時使用
  loading: false,
  done: false
};

function fmtNum(x){
  if (x==null || isNaN(x)) return '—';
  const ax = Math.abs(x);
  if (ax >= 1000) return x.toFixed(0);
  if (ax >= 100)  return x.toFixed(1);
  if (ax >= 1)    return x.toFixed(2);
  return x.toFixed(4);
}

function renderSparks(rows){
  const box = document.getElementById('indSparks');
  if (!box) return;
  const N = 80;
  const xs = rows.map(r => r.t).slice(-N);
  box.innerHTML = '';

  SPARK_LIST.forEach(([label, key, opt])=>{
    if (opt.macd) {
      const dif = state.ind?.macd_dif?.slice(-N) || [];
      const dea = state.ind?.macd_dea?.slice(-N) || [];
      const hist = state.ind?.macd_hist?.slice(-N) || [];
      if (!dif.length) return;
      const card = document.createElement('div');
      card.className = 'spark-card';
      card.innerHTML = `<div class="muted" style="font-size:12px;">${label}
          <span class="mono" style="float:right; font-weight:700;">${fmtNum(dif.at(-1))}</span></div>
        <div class="spark"></div>`;
      box.appendChild(card);
      const chart = echarts.init(card.querySelector('.spark'));
      chart.setOption({
        animation: false,
        backgroundColor: 'transparent',
        grid: { left:0, right:0, top:0, bottom:0 },
        xAxis: { type:'category', data: xs, show:false },
        yAxis: { type:'value', show:false, scale:true },
        series: [
          { type:'line', data:dif, name:'DIF', smooth:true, showSymbol:false, lineStyle:{ width:1.2, color:'#22c55e' }},
          { type:'line', data:dea, name:'DEA', smooth:true, showSymbol:false, lineStyle:{ width:1.2, color:'#3b82f6' }},
          { type:'bar',  data:hist, name:'Hist', barWidth:1.2,
            itemStyle:{ color:(p)=> p.value>=0 ? '#ef4444' : '#10b981' } }
        ]
      });
    } else {
      const arr = state.ind?.[key];
      if (!Array.isArray(arr) || !arr.length) return;
      const ys = arr.slice(-N);
      const card = document.createElement('div');
      card.className = 'spark-card';
      card.innerHTML = `<div class="muted" style="font-size:12px;">${label}
          <span class="mono" style="float:right; font-weight:700;">${fmtNum(ys.at(-1))}</span></div>
        <div class="spark"></div>`;
      box.appendChild(card);
      const chart = echarts.init(card.querySelector('.spark'));
      chart.setOption({
        animation:false,
        backgroundColor:'transparent',
        grid:{left:0,right:0,top:0,bottom:0},
        xAxis:{ type:'category', data:xs, show:false },
        yAxis:Object.assign({ type:'value', show:false, scale:true }, opt||{}),
        series:[{ type:'line', data:ys, smooth:true, showSymbol:false, lineStyle:{ width:1.5 }, areaStyle:{ opacity:0.08 } }]
      });
    }
  });
}

// 建 tabs
function buildTabs(){
  const el = $("#tabs"); el.innerHTML = "";
  COINS.forEach(c=>{
    const a = document.createElement("a");
    a.className = "tab" + (state.route===c?" active":"");
    a.textContent = c==="HOME"?"Home":c;
    a.href = "#"+c.toLowerCase();
    el.appendChild(a);
  });
}
function isDark(){ return document.body.getAttribute('data-theme')==='dark'; }
function themeColors(){
  const cs = getComputedStyle(document.body);
  return {
    fg: cs.getPropertyValue('--fg').trim(),
    muted: cs.getPropertyValue('--muted').trim(),
    accent: cs.getPropertyValue('--accent').trim(),
    grid: 'rgba(148,163,184,.2)'
  };
}
function tipStyle(trigger='axis'){
  return {
    trigger,
    textStyle:{ color: isDark() ? '#e5e7eb' : '#0f172a' },
    backgroundColor: isDark() ? 'rgba(30,41,59,.92)' : 'rgba(255,255,255,.95)',
    borderColor: isDark() ? 'rgba(148,163,184,.25)' : 'rgba(0,0,0,.12)',
    axisPointer:{ type:'line' }
  };
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// === helpers: group predictions by date, prefer ENS ===
function pickOneForDate(arr) {
  // 先找 ENS
  const ens = arr.find(r => String(r.model_tag || '').toUpperCase() === 'ENS');
  if (ens) {
    const prob = Number(ens.prob_up);
    return {
      ...ens,
      yhat_dir: ens.yhat_dir || (prob > 0.5 ? 'up' : 'down'),
    };
  }
  // 沒有 ENS -> 取平均機率
  const m = arr.reduce((s, r) => s + (Number(r.prob_up) || 0), 0) / (arr.length || 1);
  const base = arr[0] || {};
  return {
    ...base,
    prob_up: m,
    yhat_dir: m > 0.5 ? 'up' : 'down',
  };
}

function groupByDate(rows) {
  if (!Array.isArray(rows)) return [];
  const map = new Map();
  rows.forEach(r => {
    const d = r.dt;
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(r);
  });
  return Array.from(map.entries())
    .sort((a,b) => b[0].localeCompare(a[0]))
    .map(([dt, arr]) => ({ ...pickOneForDate(arr), dt }));
}

// 取得今日「波動」預測（高波動機率）——強化版：支援 view 與 rpc 兩種實作
// 最穩健版本：嘗試多個來源與欄位別名，抓「今日高波動機率」
async function fetchTodayVolatility(asset = 'BTC') {
  const tryJSON = async (url, init) => {
    const r = await fetch(url, init);
    if (!r.ok) throw new Error(`[vol] ${r.status} ${r.statusText} @ ${url}`);
    return r.json();
  };
  const mapRow = (row) => {
    // 欄位別名自動對應
    const prob = Number(
      row.prob_vol ?? row.y_pred ?? row.prob ?? row.p ?? row.prob_high_vol ?? NaN
    );
    const model =
      row.model_tag ?? row.view_tag ?? row.model ?? row.view ?? row.tag ?? null;
    const dt = row.dt ?? row.pred_dt ?? row.ts ?? row.date ?? null;
    return Number.isFinite(prob) ? { prob_vol: prob, model, dt } : null;
  };

  // A. view: predictor.api_vol_today?asset_code=eq.BTC
  try {
    const qA = new URLSearchParams({
      select: 'asset_code,coin,model_tag,view_tag,dt,prob_vol,y_pred,prob',
      or: `(asset_code.eq.${asset},coin.eq.${asset})`
    });
    let rows = await tryJSON(`${SB_BASE}/api_vol_today?${qA.toString()}`, { headers: SB_HEADERS });
    if (Array.isArray(rows) && rows.length) {
      const ens = rows.find(r => String(r.model_tag||r.view_tag||'').toUpperCase()==='ENS');
      const base = ens || rows[0];
      const m = mapRow(base);
      if (m) { console.log('[vol] from view/api_vol_today', m); return m; }
    }
  } catch (e) { console.warn('[vol] view/api_vol_today miss', e.message); }

  // B. table: predictions_vol_daily / vol_predictions_daily
  const tableCandidates = ['predictions_vol_daily', 'vol_predictions_daily', 'predictions_vol'];
  for (const tbl of tableCandidates) {
    try {
      const qB = new URLSearchParams({
        select: 'asset_code,coin,model_tag,view_tag,dt,prob_vol,y_pred,prob',
        or: `(asset_code.eq.${asset},coin.eq.${asset})`,
        order: 'dt.desc',
        limit: '8'
      });
      let rows = await tryJSON(`${SB_BASE}/${tbl}?${qB.toString()}`, { headers: SB_HEADERS });
      if (Array.isArray(rows) && rows.length) {
        const ens = rows.find(r => String(r.model_tag||r.view_tag||'').toUpperCase()==='ENS');
        const base = ens || rows[0];
        const m = mapRow(base);
        if (m) { console.log(`[vol] from table/${tbl}`, m); return m; }
      }
    } catch (e) { console.warn(`[vol] table/${tbl} miss`, e.message); }
  }

  // C. 共表：predictions_daily（以 target/label 區分）
  // 常見欄位：target='VOL' 或 label='vol' / task='volatility'
  try {
    const qC = new URLSearchParams({
      select: 'asset_code,coin,model_tag,view_tag,dt,prob_vol,y_pred,prob,target,label,task',
      or: `(asset_code.eq.${asset},coin.eq.${asset})`,
      order: 'dt.desc',
      limit: '20'
    });
    let rows = await tryJSON(`${SB_BASE}/predictions_daily?${qC.toString()}`, { headers: SB_HEADERS });
    rows = (rows||[]).filter(r => {
      const t = String(r.target||r.label||r.task||'').toLowerCase();
      return t.includes('vol');
    });
    if (rows.length) {
      const ens = rows.find(r => String(r.model_tag||r.view_tag||'').toUpperCase()==='ENS');
      const base = ens || rows[0];
      const m = mapRow(base);
      if (m) { console.log('[vol] from predictions_daily (target=vol)', m); return m; }
    }
  } catch (e) { console.warn('[vol] predictions_daily miss', e.message); }

  // D. rpc: /rpc/api_vol_today 以 JSON body 傳 asset_code
  try {
    const rows = await tryJSON(`${SB_BASE}/rpc/api_vol_today`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_code: asset })
    });
    const arr = Array.isArray(rows) ? rows : (Array.isArray(rows?.data) ? rows.data : [rows]);
    if (arr.length) {
      const ens = arr.find(r => String(r.model_tag||r.view_tag||'').toUpperCase()==='ENS');
      const base = ens || arr[0];
      const m = mapRow(base);
      if (m) { console.log('[vol] from rpc/api_vol_today', m); return m; }
    }
  } catch (e) { console.warn('[vol] rpc/api_vol_today miss', e.message); }

  console.warn('[vol] 沒找到任何來源，顯示 —');
  return null;
}

async function fetchTodayPrediction(asset = 'BTC') {
  const base = `${SB_BASE}/predictions_daily`;

  // 1) 先找最新 ENS
  let q = new URLSearchParams({
    coin: `eq.${asset}`,
    model_tag: 'eq.ENS',
    order: 'dt.desc',
    limit: '1',
  });
  let rows = await fetch(`${base}?${q}`, { headers: SB_HEADERS }).then(r => r.json());

  // 2) 沒有 ENS -> 最新任一模型
  if (!rows.length) {
    q = new URLSearchParams({ coin: `eq.${asset}`, order: 'dt.desc', limit: '1' });
    rows = await fetch(`${base}?${q}`, { headers: SB_HEADERS }).then(r => r.json());
  }

  const r = rows[0];
  if (!r) return null;
  const prob = Number(r.prob_up);
  return {
    prob_up: prob,
    dir: r.yhat_dir || (prob > 0.5 ? 'up' : 'down'),
    model: r.model_tag,
    dt: r.dt,
  };
}

// 右側「最近 5 次預測」：直接抓近 5 天
async function fetchRecentPredictions(asset = 'ETH') {
  const urlMax = `${SB_BASE}/api_status?asset_code=eq.${asset}&select=asset_code,pred_dt_max`;
  const r1 = await fetch(urlMax, { headers: SB_HEADERS });
  if (!r1.ok) throw new Error('api_status failed');
  const s = await r1.json();
  const latest = s?.[0]?.pred_dt_max;
  if (!latest) throw new Error('no pred_dt_max');

  const q = new URLSearchParams({
    coin:  `eq.${asset}`,
    dt:    `eq.${latest}`,
    order: 'model_tag.asc'
  });
  const url = `${SB_BASE}/predictions_daily?${q}`;
  const r2 = await fetch(url, { headers: SB_HEADERS });
  if (!r2.ok) throw new Error('predictions_daily failed');
  const rows = await r2.json();

  return rows
    .map(x => ({
      dt: x.dt,                          // ⬅️ 用 dt
      yhat_dir: x.yhat_dir,
      prob_up: x.prob_up                 // ⬅️ 用 prob_up
    }))
    .sort((a,b)=> (a.dt < b.dt ? 1 : -1))
    .slice(0,5);
}

// ====== 路由 ======
function currentRoute(){
  const h = (location.hash || "#home").replace("#","").toUpperCase();
  return COINS.includes(h) ? h : "HOME";
}
window.addEventListener('hashchange', main);

async function fetchKlineNav(asset = 'ETH', view = 'ENS') {
  const pageSize = 2000;
  const out = [];

  // --- 方案 A：keyset 分頁（最快、最省資源）
  let lastDt = '';
  for (let page = 0; page < 200; page++) { // safety cap
    const qs = new URLSearchParams({
      asset_code: `eq.${asset}`,
      view_tag:   `eq.${view}`,
      strategy:   `eq.atr1pct_long_only`,
      order:      'dt.asc',
      limit:      String(pageSize),
      ...(lastDt ? { dt: `gt.${lastDt}` } : {})
    });
    const url = `${SB_BASE}/api_kline_nav?${qs}`;
    const r = await fetch(url, { headers: SB_HEADERS });
    if (!r.ok) {
      console.warn('[kline] keyset 分頁失敗，嘗試 Range offset：', r.status, r.statusText);
      lastDt = null; // 觸發 fallback
      break;
    }
    const rows = await r.json();
    if (!rows.length) break;
    out.push(...rows);
    lastDt = rows.at(-1).dt;
    if (rows.length < pageSize) break; // 已抓完
  }

  // --- 方案 B：Range offset 分頁（某些 view 不支援 dt 過濾就用這招）
  if (lastDt === null) {
    let offset = 0;
    for (let page = 0; page < 200; page++) { // safety cap
      const qs = new URLSearchParams({
        asset_code: `eq.${asset}`,
        view_tag:   `eq.${view}`,
        strategy:   `eq.atr1pct_long_only`,
        order:      'dt.asc'
      });
      const url = `${SB_BASE}/api_kline_nav?${qs}`;
      const r = await fetch(url, {
        headers: {
          ...SB_HEADERS,
          Range: `rows=${offset}-${offset + pageSize - 1}`
        }
      });
      if (!r.ok) throw new Error(`[kline] Range 分頁失敗 ${r.status} ${r.statusText}`);
      const rows = await r.json();
      if (!rows.length) break;
      out.push(...rows);
      offset += rows.length;
      if (rows.length < pageSize) break; // 已抓完
    }
  }

  if (!out.length) throw new Error('api_kline_nav empty');

  // 轉成全站統一欄位
  return out.map(d => ({
    t: d.dt,
    o: +d.open,
    h: +d.high,
    l: +d.low,
    c: +d.close,
    nav: d.nav_usd ?? null
  }));
}

// ====== 讀資料：Supabase（或 sample） ======
async function fetchJSON(url, opts){
  try {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (e) {
    console.error("[fetchJSON] ", url, e);
    throw e; // 交給上層決定是否 fallback
  }
}

async function hydrateIndicators(coin, rows){
  // 先做一份完整的前端計算，當作「底」
  const localInd = buildIndicators(rows);

  // 再試著抓 Supabase 的指標
  const sbInd = await fetchIndicatorsFromSB(coin);

  // 合併：Supabase 有的鍵覆蓋掉前端；Supabase 沒提供的(K/D/J、bb_*等)仍保留
  state.ind = sbInd && Object.keys(sbInd).length
    ? { ...localInd, ...sbInd }
    : localInd;

  return sbInd ? 'supabase' : 'frontend';
}

async function fetchIndicatorsFromSB(coin) {
  if (!INDICATORS_TABLE) return null;
  const sym = String(coin || "").toUpperCase();
  const base = SUPABASE_URL.replace(/\/$/, '');
  const pageSize = 2000;
  let lastTs = 0;
  let all = [];

  while (true) {
    const q = new URLSearchParams({
      select: 'dt,asset_code,px_close,rsi14,atr14,...,ts_utc',
      asset_code: `eq.${sym}`,
      order: 'ts_utc.asc',
      limit: String(pageSize),
      ...(lastTs ? { ts_utc: `gt.${lastTs}` } : {})
    });
    const url = `${base}/rest/v1/${INDICATORS_TABLE}?${q.toString()}`;

    let rows = [];
    try {
      rows = await fetchJSON(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: 'application/json',
          'Accept-Profile': 'predictor'
        }
      });
    } catch (e) {
      console.warn('[indicators] Supabase 取數失敗', e);
      return null;
    }

    if (!rows.length) break;
    all = all.concat(rows);
    lastTs = rows[rows.length - 1].ts_utc;   // ⬅️ 改用 bigint 游標
    if (rows.length < pageSize) break;
  }

  if (!all.length) return null;

  // 1) 小工具：把每個欄位抽成數列（缺值→NaN）
  const byKey = k => all.map(r => (r[k] == null ? NaN : +r[k]));

  // 2) 先取出 DIF / DEA
  const macd_dif = byKey('macd');           // 後端欄位名：macd
  const macd_dea = byKey('macd_signal');    // 後端欄位名：macd_signal

  // 3) 柱狀圖：Histogram = DIF - DEA
  const macd_hist = macd_dif.map((v, i) =>
    (Number.isFinite(v) && Number.isFinite(macd_dea[i])) ? (v - macd_dea[i]) : NaN
  );

  // 4) 回傳給圖表用的物件
  return {
    // 技術指標
    rsi14:      byKey('rsi14'),
    macd_dif,   // 給「DIF」線
    macd_dea,   // 給「DEA」線
    macd_hist,  // 給「Hist」柱

    // 你 view 有提供的其餘欄位
    bbw:        byKey('band_bb_w'),
    atr14:      byKey('atr14'),

    // 報酬 / 衍生品 / 資金流...
    log_r1:     byKey('ret_1d'),
    log_r5:     byKey('ret_5d'),
    log_r30:    byKey('ret_20d'),   // 先暫接到 30 線位
    oi_change:  byKey('oi_change'),
    oi_pct1:    byKey('oi_pct1'),
    funding_z7: byKey('funding_z7'),
    liq_abs:    byKey('liq_abs'),
    liq_net:    byKey('liq_net'),
    exch_bal_1d:byKey('exch_balance_pct_1d'),
    week_ret_1w:byKey('week_ret_1w'),
    week_rsi_1w:byKey('week_rsi_1w'),
    week_ma_x_1w: byKey('week_ma_cross_1w')
  };
}

// ====== 模型預測（先用 sample，可換成你的 API） ======
// 右側摘要用（取今天）
async function loadPredSample(coin) {
  try {
    const p = await fetchTodayPrediction(coin);
    let vol = null;
    try {
      vol = await fetchTodayVolatility(coin);   // ← 新增：抓波動
    } catch (e) {
      console.warn('[vol] fetchTodayVolatility failed', e);
    }

    if (p) {
      state.pred = {
        y_pred: p.prob_up,          // 0~1 上漲機率
        horizon_hours: 24,
        ci: null,
        model: { name: p.model },
        // 新增：把波動機率也放到 state
        vol_pred: vol?.prob_vol ?? null,
        vol_model: vol?.model ?? null,
        vol_dt: vol?.dt ?? null,
      };
      state.pred_source = 'supabase';
      return state.pred;
    }
  } catch (e) {
    console.warn('[pred] fetchTodayPrediction failed', e);
  }
  state.pred = {}; state.pred_source = 'none';
  return state.pred;
}

async function loadRecentPredictions() {
  let tbody = document.querySelector('#recentPredTable tbody') 
            || document.getElementById('lastPreds');
  let container = tbody;
  if (container && container.tagName !== 'TBODY') {
    if (container.tagName === 'TABLE') {
      tbody = container.querySelector('tbody') || container.appendChild(document.createElement('tbody'));
    } else {
      tbody = null;
    }
  }

  try {
    const rows = await fetchRecentPredictions(state.route || 'BTC');
    const bodyHtml = (rows && rows.length)
      ? rows.map(r => {
          const prob = Number(r.prob_up);
          const probPct = Number.isFinite(prob) ? (prob <= 1 ? prob * 100 : prob) : NaN;
          const isUp = prob > 0.5;
          const dir = isUp ? '↑ up' : '↓ down';
          const dirCol = isUp ? '#22c55e' : '#ef4444';
          return `<tr>
            <td class="mono">${r.dt}</td>
            <td style="color:${dirCol};font-weight:700;">${dir}</td>
            <td class="mono">${Number.isFinite(probPct) ? probPct.toFixed(1) + '%' : '—'}</td>
            <td class="mono">—</td>
          </tr>`;
        }).join('')
      : `<tr><td>—</td></tr>`;

    if (tbody) {
      tbody.innerHTML = bodyHtml;
    } else if (container) {
      const headHtml = `<thead><tr><th>時間</th><th>預測</th><th>幅度</th><th>真實</th></tr></thead>`;
      container.innerHTML = `<table class="data-table">${headHtml}<tbody>${bodyHtml}</tbody></table>`;
    }
  } catch (e) {
    console.error('[recentPred] failed', e);
    if (tbody) tbody.innerHTML = `<tr><td>—</td></tr>`;
    else if (container) container.innerHTML = `<table class="data-table"><tbody><tr><td>—</td></tr></tbody></table>`;
  }
}

function safeRender(fn, onOk, onFail){
  fn().then(onOk).catch(err=>{
    console.error(err);
    onFail?.(err);
  });
}

// ====== 指標計算（前端） ======
function ema(arr, n){
  const k = 2/(n+1); const out=[]; let prev = null;
  for(let i=0;i<arr.length;i++){
    const v = arr[i];
    prev = (prev===null)? v : (v*k + prev*(1-k));
    out.push(prev);
  }
  return out;
}
function sma(arr, n){
  const out=[], q=[]; let s=0;
  for(let i=0;i<arr.length;i++){
    q.push(arr[i]); s+=arr[i];
    if(q.length>n) s-=q.shift();
    out.push(q.length===n? s/n : NaN);
  }
  return out;
}
function rsi(arr, n=14){
  const out=[]; let gain=0, loss=0;
  for(let i=1;i<arr.length;i++){
    const ch = arr[i]-arr[i-1];
    const up = ch>0? ch:0, dn = ch<0? -ch:0;
    if(i<=n){ gain+=up; loss+=dn; out.push(NaN); continue; }
    if(i===n+1){ const rs=(gain/n)/((loss/n)||1e-9); out.push(100-100/(1+rs)); }
    else { gain=(gain*(n-1)+up)/n; loss=(loss*(n-1)+dn)/n; const rs=gain/(loss||1e-9); out.push(100-100/(1+rs)); }
  }
  out.unshift(NaN);
  return out;
}
function macd(arr, fast=12, slow=26, sig=9){
  const ef=ema(arr,fast), es=ema(arr,slow);
  const dif = ef.map((v,i)=> v - es[i]);
  const dea = ema(dif.map(v=>isFinite(v)?v:0), sig);
  const hist = dif.map((v,i)=> v - dea[i]);
  return { dif, dea, hist };
}
function kd(high, low, close, n=9, kN=3, dN=3){
  const RSV=[], K=[], D=[]; let k=50, d=50;
  for(let i=0;i<close.length;i++){
    const s = Math.max(0,i-n+1), hh = Math.max(...high.slice(s,i+1)), ll = Math.min(...low.slice(s,i+1));
    const r = (hh===ll)? 50 : ((close[i]-ll)/(hh-ll))*100;
    k = (2*k + r)/3; d = (2*d + k)/3;
    RSV.push(r); K.push(k); D.push(d);
  }
  const J = K.map((v,i)=> 3*v - 2*D[i]);
  return {K,D,J};
}
function boll(close, n=20, k=2){
  const ma = sma(close, n);
  const sd = [];
  for(let i=0;i<close.length;i++){
    if(i<n-1){ sd.push(NaN); continue; }
    const s = close.slice(i-n+1,i+1);
    const m = ma[i]; const v = s.reduce((a,x)=>a+(x-m)*(x-m),0)/n;
    sd.push(Math.sqrt(v));
  }
  const upper = ma.map((m,i)=> m + (sd[i]*k));
  const lower = ma.map((m,i)=> m - (sd[i]*k));
  const bbw   = ma.map((m,i)=> (upper[i]-lower[i])/(m||1e-9));
  return { ma, upper, lower, bbw };
}
function atr14(high, low, close, n=14){
  const tr=[NaN];
  for(let i=1;i<close.length;i++){
    tr.push(Math.max(high[i]-low[i], Math.abs(high[i]-close[i-1]), Math.abs(low[i]-close[i-1])));
  }
  // Wilder ATR
  const out=[]; let prev=null;
  for(let i=0;i<tr.length;i++){
    const v=tr[i];
    if(i<n) { out.push(NaN); continue; }
    if(i===n){ const s=tr.slice(1,n+1).reduce((a,x)=>a+x,0); prev=s/n; out.push(prev); }
    else { prev=(prev*(n-1)+v)/n; out.push(prev); }
  }
  return out;
}
function logRet(close, k){
  const out = close.map(()=>NaN);
  for(let i=k;i<close.length;i++){ out[i]=Math.log(close[i]/close[i-k]); }
  return out;
}

// 由 OHLC 產生所有前端用指標
function buildIndicators(rows){
  const close = rows.map(r=>r.c), high=rows.map(r=>r.h), low=rows.map(r=>r.l);
  const ema6  = ema(close,6),  ema24=ema(close,24), ema56=ema(close,56);
  const rsi14v= rsi(close,14);
  const {dif,dea,hist} = macd(close,12,26,9);
  const {K,D,J} = kd(high,low,close,9,3,3);
  const {ma:bb_mid, upper:bb_up, lower:bb_low, bbw} = boll(close,20,2);
  const atr = atr14(high,low,close,14);
  const lr1 = logRet(close,1), lr5 = logRet(close,5), lr7 = logRet(close,7), lr30 = logRet(close,30);

  return {
    ema6, ema24, ema56, rsi14:rsi14v, macd_dif:dif, macd_dea:dea, macd_hist:hist,
    k:K, d:D, j:J, bb_upper:bb_up, bb_middle:bb_mid, bb_lower:bb_low, bbw,
    atr14:atr, log_r1:lr1, log_r5:lr5, log_r7:lr7, log_r30:lr30
  };
}

// ====== 模型資料狀態指示燈（動態插入，不用改 HTML） ======
function ensureModelStatusWidget(){
  // 在「API 狀態」那格下方插入一個新的 badge
  const apiCell = document.getElementById('apiLabel')?.parentElement?.parentElement;
  if (!apiCell) return;
  if (!document.getElementById('modelLabel')) {
    const wrap = document.createElement('div');
    wrap.style.marginTop = '8px';
    wrap.innerHTML = `
      <div class="muted">模型資料</div>
      <div class="badge" style="font-size:16px;">
        <span id="modelDot" class="dot"></span>
        <span id="modelLabel" class="mono">—</span>
      </div>`;
    apiCell.appendChild(wrap);
  }
}

function renderModelStatus(){
  ensureModelStatusWidget();
  const mdot = document.getElementById('modelDot');
  const mlabel = document.getElementById('modelLabel');
  if (!mdot || !mlabel) return;

  mdot.classList.remove('ok','warn');
  if (state.pred_source === 'supabase') {
    mdot.classList.add('ok');
    mlabel.textContent = '已取得（Supabase）';
  } else if (state.pred_source === 'sample') {
    mdot.classList.add('warn');
    mlabel.textContent = '使用假資料（sample）';
  } else {
    mdot.classList.add('warn');
    mlabel.textContent = '未取得';
  }
}

// 安全初始化 ECharts（容器不存在就不畫，不會 throw）
function initEC(id){
  const el = document.getElementById(id);
  if(!el){ console.warn(`[ECharts] container #${id} not found`); return null; }
  try {
    return echarts.getInstanceByDom(el) || echarts.init(el);
  } catch (e) {
    console.error(`[ECharts] init #${id} failed`, e);
    return null;
  }
}

// ====== 畫圖 ======
function mount(id){ return echarts.init(document.getElementById(id)); }
function optBase(x, yname=''){
  const C = themeColors();
  return {
    backgroundColor:'transparent',
    textStyle:{ color:C.fg },
    legend:{ top:0, textStyle:{ color:C.fg } },   // ← 這裡加
    grid:{ left:50, right:20, top:10, bottom:40 },
    xAxis:{ type:'category', data:x, boundaryGap:false, axisLabel:{ color:C.muted } },
    yAxis:{ type:'value', name:yname, axisLabel:{ color:C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    tooltip: tipStyle('axis')
  };
}

const lineS = (name,data,smooth=true)=>({ type:'line', name, data, smooth, showSymbol:false });

function renderCoinPage(coin, rows){
  // K 線
  const x = rows.map(r=>r.t);
  const k = rows.map(r=>[r.o,r.c,r.l,r.h]);
  if(!state.charts.k) state.charts.k = mount('kChart');
  const C = themeColors();

  // 右側需要的資料
  const last = rows.at(-1)?.c ?? NaN;

  // 取得 y_pred：可由 sample 或你的 API
  let yPred = null, ci = [0.010, 0.0234], horizonH = 6;
  if (state.pred && typeof state.pred.y_pred === 'number') {
    yPred = state.pred.y_pred;
    ci = state.pred?.ci || ci;
    horizonH = state.pred?.horizon_hours ?? 6;
  } 

  // 把預測點與區間帶畫在 K 線圖上（markPoint / markArea）
  // 參考：ECharts markPoint / markArea 官方說明（candlestick 也支援） :contentReference[oaicite:1]{index=1}

  state.charts.k.setOption({
    backgroundColor:'transparent', textStyle:{ color:C.fg },
    grid:{ left:50,right:20,top:10,bottom:40 },
    xAxis:{ type:'category', data:x, axisLabel:{ color:C.muted } },
    yAxis:{ scale:true, axisLabel:{ color:C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    dataZoom:[{type:'inside'},{type:'slider', textStyle:{ color:C.muted }}],
    tooltip: tipStyle('axis'),
    series: [{
      type:'candlestick',
      name:`${coin} 1D`,
      data:k,
      itemStyle:{ color:'#ef4444', color0:'#10b981', borderColor:'#ef4444', borderColor0:'#10b981' }
    }]
  });

  // 概覽
  $("#coinTitle").textContent = coin;
  $("#lastClose").textContent = rows.at(-1)?.c?.toFixed(2) ?? "—";
  $("#rowsInfo").textContent = rows.length;
  $("#rangeInfo").textContent = `${rows[0]?.t ?? "—"} ~ ${rows.at(-1)?.t ?? "—"}`;
  $("#atrInfo").textContent = (state.ind.atr14.at(-1) ?? NaN).toFixed(2);

  // 圖一：你的自製指標位（目前用 placeholder：以 log 報酬近 1/5 日代理）
  if(!state.charts.basis) state.charts.basis = mount('chart-basis');
  state.charts.basis.setOption(Object.assign(optBase(x,'%'),{
    series:[ lineS('BASIS_O', state.ind.log_r1), lineS('BASIS_C', state.ind.log_r5) ]
  }));
  if(!state.charts.basischg) state.charts.basischg = mount('chart-basischg');
  state.charts.basischg.setOption(Object.assign(optBase(x,'%'),{
    series:[ lineS('BASIS_O_CHG%', state.ind.log_r7), lineS('BASIS_C_CHG%', state.ind.log_r30) ]
  }));
  if(!state.charts.whale) state.charts.whale = mount('chart-whale');
  state.charts.whale.setOption(Object.assign(optBase(x,''),{ series:[ lineS('WHALE', state.ind.log_r30) ] }));
  if(!state.charts.cbprem) state.charts.cbprem = mount('chart-cbprem');
  state.charts.cbprem.setOption(Object.assign(optBase(x,'%'),{ series:[ lineS('CB_PREM%', state.ind.log_r7, false) ] }));

  // 對數報酬區
  if(!state.charts.ret) state.charts.ret = mount('chart-returns');
  state.charts.ret.setOption(Object.assign(optBase(x,'log'),{
    series:[ lineS('log 1d', state.ind.log_r1), lineS('log 5d', state.ind.log_r5) ]
  }));
  if(!state.charts.lr) state.charts.lr = mount('chart-logrets');
  state.charts.lr.setOption(Object.assign(optBase(x,'log'),{
    series:[ lineS('log 7d', state.ind.log_r7), lineS('log 30d', state.ind.log_r30) ]
  }));

  // 圖二：技術指標
  if(!state.charts.atr) state.charts.atr = mount('chart-atr');
  state.charts.atr.setOption(Object.assign(optBase(x,''),{ series:[ lineS('ATR14', state.ind.atr14) ] }));

  if(!state.charts.ema) state.charts.ema = mount('chart-ema');
  state.charts.ema.setOption(Object.assign(optBase(x,''),{
    series:[ lineS('EMA6', state.ind.ema6), lineS('EMA24', state.ind.ema24), lineS('EMA56', state.ind.ema56) ]
  }));

  if(!state.charts.rsi) state.charts.rsi = mount('chart-rsi');
  const o = optBase(x,''); o.yAxis.min=0; o.yAxis.max=100;
  state.charts.rsi.setOption(Object.assign(o, { series:[ lineS('RSI14', state.ind.rsi14) ] }));

  if(!state.charts.macd) state.charts.macd = mount('chart-macd');
  state.charts.macd.setOption(Object.assign(optBase(x,''),{
    series:[
      lineS('DIF', state.ind.macd_dif),
      lineS('DEA', state.ind.macd_dea),
      { type:'bar', name:'Hist', data: state.ind.macd_hist, barWidth: 2 }
    ]
  }));

  if(!state.charts.kd) state.charts.kd = mount('chart-kd');
  const okd=optBase(x,''); okd.yAxis.min=0; okd.yAxis.max=100;
  state.charts.kd.setOption(Object.assign(okd, {
    series:[ lineS('K', state.ind.k), lineS('D', state.ind.d), lineS('J', state.ind.j) ]
  }));

  if(!state.charts.boll) state.charts.boll = mount('chart-boll');
  state.charts.boll.setOption(Object.assign(optBase(x,''),{
    series:[
      lineS('BB Upper', state.ind.bb_upper),
      lineS('BB Middle', state.ind.bb_middle),
      lineS('BB Lower', state.ind.bb_lower),
      lineS('BBW', state.ind.bbw)
    ]
  }));

  // ===== 右側：機率卡 + API 狀態（已移除預測摘要卡） =====
  (() => {
    const yPred = state?.pred?.y_pred;      // 方向機率
    const vPred = state?.pred?.vol_pred;    // 高波動機率
    const upPct  = Number.isFinite(yPred) ? (yPred <= 1 ? yPred * 100 : yPred) : null;
    const volPct = Number.isFinite(vPred) ? (vPred <= 1 ? vPred * 100 : vPred) : null;

    const upEl  = document.getElementById('predUpVal');
    const volEl = document.getElementById('predVolVal');
    if (upEl)  upEl.textContent  = upPct  != null ? upPct.toFixed(1)  + '%' : '—';
    if (volEl) volEl.textContent = volPct != null ? volPct.toFixed(1) + '%' : '—';

    // API 狀態指示燈
    const dot = document.getElementById('apiDot');
    const apiLabel = document.getElementById('apiLabel');
    if (dot && apiLabel) {
      if (state.source === 'supabase') {
        dot.classList.remove('warn'); dot.classList.add('ok');
        apiLabel.textContent = '連線成功（Supabase）';
      } else {
        dot.classList.remove('ok'); dot.classList.add('warn');
        apiLabel.textContent = '使用假資料（sample）';
      }
    }
  })();

  // 更新「模型資料」指示燈
  if (typeof renderModelStatus === 'function') renderModelStatus();

  initTradeLogInfinite(state.route || 'BTC');
  
  renderSparks(rows);
}

(function bindSparkToggle(){
  const btn = document.getElementById('sparkToggle');
  const wrap = document.getElementById('sparkWrap');
  if(!btn || !wrap) return;

  btn.onclick = () => {
    const show = wrap.style.display === 'none';
    wrap.style.display = show ? 'block' : 'none';
    btn.textContent = show ? '收合' : '展開';
    if (show) {
      // 確保展開時重繪（state.ohlc 由 enterCoin 填好）
      renderSparks(state.ohlc || []);
    }
  };
})();

// ====== 進入分頁 ======
async function enterCoin(coin){
  $("#route-home").style.display = "none";
  $("#route-coin").style.display = "";
  Object.values(state.charts).forEach(ch=> ch && ch.clear());

  const kn = await fetchKlineNav(coin, 'V1');   // 或用你選的 view / ENS
  state.ohlc = kn;
  state.source = 'supabase';
  await hydrateIndicators(coin, state.ohlc); // ← 這行會自動：Supabase→前端

  state.pred = null;
  state.pred_source = 'none';
  await loadPredSample(coin);

  renderCoinPage(coin, state.ohlc);
}

async function fetchApiStatus(asset = 'ETH') {
  const url = `${SB_BASE}/api_status?asset_code=eq.${asset}&select=asset_code,pred_dt_max`;
  const r = await fetch(url, { headers: SB_HEADERS });
  if (!r.ok) throw new Error('api_status failed');
  const s = await r.json();
  const row = s?.[0];
  return {
    predOK: !!row?.tplus1_pred_ok,
    featOK: !!row?.features_ok_for_yday,
    predDt: row?.pred_dt_max || '—',
    navDt:  row?.nav_dt_max  || '—'
  };
}

// ====== 主流程 ======
async function main(){
  state.route = currentRoute();
  buildTabs();
  if(state.route==="HOME") await enterHome();
  else await enterCoin(state.route);
}

// ====== 主題切換 ======
$("#themeToggle").addEventListener('click', ()=>{
  const now = document.body.getAttribute('data-theme');
  const next = now==='light' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', next);
  $("#themeLabel").textContent = next==='light' ? '白' : '黑';
  main(); // 重新畫（套用 tooltip 顏色）
});

// 在 app.js 前半段，全域位置（不要包在 function 裡）
const MH = {
  train:null, weights:null, feat:null, oof:null, bt:null,
  charts:{ feat:null, vw:null },
  sym:'BTC', view:'V1'
};

async function fetchBacktestReport(asset = 'ETH') {
  const q = new URLSearchParams({
    asset_code: `eq.${asset}`,
    order:      'view_tag.asc'
  });
  const url = `${SB_BASE}/api_backtest_report?${q}`;
  const r = await fetch(url, { headers: SB_HEADERS });
  if (!r.ok) throw new Error('api_backtest_report failed');
  const rows = await r.json();
  if (!rows?.length) throw new Error('api_backtest_report empty');
  // 取 ENS（或沒有 ENS 就取第一筆）
  const row = rows.find(x => x.view_tag === 'ENS') || rows[0];
  return {
    start: row.start_dt, end: row.end_dt, n_days: row.n_days,
    cagr: row.cagr, sharpe: row.sharpe_annual,
    vol: row.vol_annual, mdd: row.max_drawdown,
    n_trades: row.n_trades, win_rate: row.win_rate
  };
}

async function fetchTrades(asset='BTC', view='V1'){
  const q = new URLSearchParams({
    asset_code:`eq.${asset}`, view_tag:`eq.${view}`,
    strategy:`eq.atr1pct_long_only`, order:'open_dt.asc'
  });
  const url = `${SB_BASE}/api_trades?${q}`;
  return fetch(url,{ headers:SB_HEADERS }).then(r=>r.json());
}

// 交易日誌：抓最近 50 筆（按開倉時間由新到舊）
async function fetchTradesLatest(asset='BTC', view='V1', limit=50){
  const q = new URLSearchParams({
    asset_code:`eq.${asset}`,
    view_tag:`eq.${view}`,
    strategy:`eq.atr1pct_long_only`,
    order:'open_dt.desc',
    limit:String(limit)
  });
  const url = `${SB_BASE}/api_trades?${q}`;
  const r = await fetch(url,{ headers:SB_HEADERS });
  if(!r.ok) throw new Error('api_trades failed');
  return r.json();
}

function renderTradeLog(rows){
  const table = document.getElementById('recentPredTable');
  if(!table) return;

  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  // 強制只有 5 欄（清掉舊的報酬%、天數）
  thead.innerHTML = `
    <tr>
      <th>開倉</th><th>平倉</th><th>方向</th>
      <th class="num">開</th><th class="num">平</th>
    </tr>`;

  const get = (row, ks)=> { for(const k of ks){ if(k in row) return row[k]; } return null; };
  const fmtNum = (v, d=2)=> Number.isFinite(+v) ? (+v).toFixed(d) : '—';

  const html = (rows||[]).map(row=>{
    const open_dt  = get(row, ['open_dt','entry_dt','open_date']);
    const close_dt = get(row, ['close_dt','exit_dt','close_date']);
    const sideRaw  = (get(row, ['side','direction']) || 'long').toString().toLowerCase();
    const sideStr  = sideRaw.includes('short') ? 'short' : 'long';
    const sideCol  = sideStr==='short' ? '#ef4444' : '#22c55e';

    const open_px  = +get(row, ['open_px','entry_px','px_open','open_price']);
    const close_px = +get(row, ['close_px','exit_px','px_close','close_price']);

    return `
      <tr>
        <td class="mono">${open_dt || '—'}</td>
        <td class="mono">${close_dt || '—'}</td>
        <td style="color:${sideCol};font-weight:700;">${sideStr}</td>
        <td class="mono num">${fmtNum(open_px)}</td>
        <td class="mono num">${fmtNum(close_px)}</td>
      </tr>`;
  }).join('');

  tbody.innerHTML = html || `<tr><td colspan="5">—</td></tr>`;
}

// A) 初始化（重設狀態 + 綁定 scroll 事件）
function initTradeLogInfinite(asset){
  TradeLog.asset   = asset || 'BTC';
  TradeLog.view    = 'V1';
  TradeLog.pageSize= 200;
  TradeLog.lastOpenDt = '';
  TradeLog.offset  = 0;
  TradeLog.loading = false;
  TradeLog.done    = false;

  const tbody = document.querySelector('#recentPredTable tbody');
  const wrap  = document.getElementById('tradeWrap');
  const hint  = document.getElementById('tradeHint');
  if (tbody) tbody.innerHTML = '';
  if (hint)  hint.textContent = '下拉載入更多…';

  if (wrap){
    // 先解除舊的（避免重複綁定）
    wrap.onscroll = null;
    wrap.onscroll = () => {
      if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 8){
        loadMoreTrades();   // 觸底 → 載入更多
      }
    };
  }
  // 先載入第一頁
  loadMoreTrades(true);
}

// B) 取下一頁（優先 keyset，用 open_dt；失敗就 Range fallback）
async function loadMoreTrades(reset=false){
  if (TradeLog.loading || TradeLog.done) return;
  const tbody = document.querySelector('#recentPredTable tbody');
  const hint  = document.getElementById('tradeHint');
  if (!tbody) return;

  if (reset){ TradeLog.lastOpenDt=''; TradeLog.offset=0; TradeLog.done=false; tbody.innerHTML=''; }
  TradeLog.loading = true;
  if (hint) hint.textContent = '載入中…';

  let rows = [];
  // --- Keyset（open_dt < lastOpenDt）
  try {
    const q = new URLSearchParams({
      asset_code: `eq.${TradeLog.asset}`,
      view_tag:   `eq.${TradeLog.view}`,
      strategy:   `eq.atr1pct_long_only`,
      order:      'open_dt.desc',
      limit:      String(TradeLog.pageSize),
      ...(TradeLog.lastOpenDt ? { open_dt: `lt.${TradeLog.lastOpenDt}` } : {})
    });
    const url = `${SB_BASE}/api_trades?${q}`;
    const r = await fetch(url, { headers: SB_HEADERS });
    if (!r.ok) throw new Error('keyset failed');
    rows = await r.json();
  } catch (e) {
    // --- Range fallback（某些 view 不支援 open_dt 過濾）
    try {
      const q = new URLSearchParams({
        asset_code: `eq.${TradeLog.asset}`,
        view_tag:   `eq.${TradeLog.view}`,
        strategy:   `eq.atr1pct_long_only`,
        order:      'open_dt.desc'
      });
      const url = `${SB_BASE}/api_trades?${q}`;
      const r = await fetch(url, {
        headers: { ...SB_HEADERS, Range: `rows=${TradeLog.offset}-${TradeLog.offset + TradeLog.pageSize - 1}` }
      });
      if (!r.ok) throw new Error('range failed');
      rows = await r.json();
      TradeLog.offset += rows.length;
    } catch (e2) {
      console.warn('[tradeLog] both paginations failed', e2);
      if (hint) hint.textContent = '載入失敗';
      TradeLog.loading = false;
      return;
    }
  }

  renderTradeLogAppend(rows);

  // 更新游標 / 是否到底
  if (rows.length < TradeLog.pageSize){
    TradeLog.done = true;
    if (hint) hint.textContent = '已到底';
  } else {
    if (hint) hint.textContent = '下拉載入更多…';
  }
  // 嘗試從多種欄位抓 open_dt（保險）
  const tail = rows.at(-1) || {};
  TradeLog.lastOpenDt = tail.open_dt || tail.entry_dt || TradeLog.lastOpenDt;

  TradeLog.loading = false;
}

// C) 追加渲染（append，不覆蓋）
function renderTradeLogAppend(rows){
  const tbody = document.querySelector('#recentPredTable tbody');
  if(!tbody) return;

  const pick = (row, ks)=> { for(const k of ks){ if(k in row) return row[k]; } return null; };
  const n = (v, d=2)=> Number.isFinite(+v) ? (+v).toFixed(d) : '—';

  const html = (rows||[]).map(r=>{
    const open_dt  = pick(r, ['open_dt','entry_dt','open_date']);
    const close_dt = pick(r, ['close_dt','exit_dt','close_date']);
    const sideRaw  = (pick(r, ['side','direction']) || 'long').toString().toLowerCase();
    const sideStr  = sideRaw.includes('short') ? 'short' : 'long';
    const sideCol  = sideStr==='short' ? '#ef4444' : '#22c55e';
    const open_px  = +pick(r, ['open_px','entry_px','px_open','open_price']);
    const close_px = +pick(r, ['close_px','exit_px','px_close','close_price']);

    return `
      <tr>
        <td class="mono">${open_dt || '—'}</td>
        <td class="mono">${close_dt || '—'}</td>
        <td style="color:${sideCol};font-weight:700;">${sideStr}</td>
        <td class="mono num">${n(open_px)}</td>
        <td class="mono num">${n(close_px)}</td>
      </tr>`;
  }).join('');

  if (!html && !tbody.children.length){
    tbody.innerHTML = `<tr><td colspan="5">—</td></tr>`;
  } else {
    tbody.insertAdjacentHTML('beforeend', html);
  }
}

/* ===================== Home：模型檔案總覽（覆蓋 renderHome） ===================== */

// 簡易 CSV 解析（你的檔很乾淨就夠用）
function parseCSV_MH(text){
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',').map(s=>s.trim());
  return lines.slice(1).map(line=>{
    const cells = line.split(',').map(s=>s.trim());
    const o={}; head.forEach((h,i)=> o[h]=cells[i]); return o;
  });
}

async function fetchCSV_MH(url){
  const r = await fetch(url, { cache: 'no-store' });   // ⬅️ 加這行
  return parseCSV_MH(await r.text());
}

async function mhLoadAll(){
  const base = DATA_BASE;
  const [train, weights, feat, oof, bt] = await Promise.all([
    fetchJSON(`${base}/train_report_multiview.json`, { cache: 'no-store' }),
    fetchJSON(`${base}/view_weights_init.json`,      { cache: 'no-store' }),
    fetchCSV_MH(`${base}/oos_feature_importance.csv`),
    fetchCSV_MH(`${base}/oof_metrics.csv`),
    fetchCSV_MH(`${base}/backtest_summary.csv`)
  ]);
  MH.train=train; MH.weights=weights; MH.feat=feat; MH.oof=oof; MH.bt=bt;
}

function mhFmt(x,d=3){ if(x==null||x==='')return '—'; const n=Number(x); return Number.isNaN(n)? String(x): n.toFixed(d); }

function mhRenderKPIs(){
  const sym = MH.sym, view = MH.view;
  const t = MH.train?.[sym]?.[view];
  const wAll = MH.weights?.[sym] || {};

  let dirF1, dirAUC, dirBACC, volACC, volF1;

  if (t) {
    // ✅ 原生 view（包含 ENS）直接取
    dirF1  = t?.dir_avg?.f1;
    dirAUC = t?.dir_avg?.auc;
    dirBACC= t?.dir_avg?.bacc;
    volACC = t?.vol_avg?.acc;
    volF1  = t?.vol_avg?.macro_f1;
  } else if (view === 'ENS') {
    // ⬇︎ 沒有原生 ENS 時才 fallback：用權重對 V* 加權
    const views = Object.keys(MH.train?.[sym] || {}).filter(v => /^V\d+$/i.test(v));
    let sw=0,f1=0,auc=0,bacc=0,vacc=0,vmacro=0;
    views.forEach(v=>{
      const w = +wAll[v] || 0;
      const tv = MH.train[sym][v] || {};
      const d = tv.dir_avg || {}, vl = tv.vol_avg || {};
      f1+=w*(+d.f1||0); auc+=w*(+d.auc||0); bacc+=w*(+d.bacc||0);
      vacc+=w*(+vl.acc||0); vmacro+=w*(+vl.macro_f1||0); sw+=w;
    });
    if (sw>0){ dirF1=f1/sw; dirAUC=auc/sw; dirBACC=bacc/sw; volACC=vacc/sw; volF1=vmacro/sw; }
  }

  document.getElementById('mhDirF1').textContent   = mhFmt(dirF1);
  document.getElementById('mhDirAUC').textContent  = mhFmt(dirAUC);
  document.getElementById('mhDirBACC').textContent = mhFmt(dirBACC);
  document.getElementById('mhVolACC').textContent  = mhFmt(volACC);
  document.getElementById('mhVolF1').textContent   = mhFmt(volF1);

  // View 權重卡：原生 ENS 顯示「—」
  const w = wAll?.[view];
  document.getElementById('mhViewW').textContent = (view==='ENS') ? '—' : (w!=null ? mhFmt(w) : '—');
}

function pickKey(sample, candidates){
  for (const k of candidates) if (k in sample) return k;
  return null;
}

function mhRenderFeat(){
  if(!MH.charts.feat){
    MH.charts.feat = initEC('mhFeat');
    if(!MH.charts.feat) return;
    window.addEventListener('resize', ()=> MH.charts.feat && MH.charts.feat.resize());
  }

  const rowsAll = MH.feat || [];
  const C = themeColors();
  const baseOpt = {
    backgroundColor:'transparent', textStyle:{color:C.fg},
    grid:{ left:120, right:20, top:20, bottom:30 },
    xAxis:{ type:'value', axisLabel:{ color:C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    yAxis:{ type:'category', data:[], axisLabel:{ color:C.muted } },
    series:[{ type:'bar', data:[], name:'重要度', barMaxWidth:22 }],
    tooltip: tipStyle('item')
  };
  if(!rowsAll.length){
    MH.charts.feat.setOption(Object.assign({}, baseOpt, {
      title:{ text:'沒有讀到 oos_feature_importance.csv', left:'center', top:'middle',
              textStyle:{ color:C.muted, fontSize:14 } }
    })); return;
  }

  const sample = rowsAll[0];
  const symK  = pickKey(sample,['symbol','Symbol','coin','Coin','asset','Asset','ticker','Ticker','asset_code']);
  const viewK = pickKey(sample,['view','View','view_name','ViewName','model_view','ModelView']);
  const featK = pickKey(sample,['feature','Feature','feature_name','name','Name','column']);
  const valK  = pickKey(sample,['importance','Importance','gain','Gain','weight','Weight','value','Value']);

  let rows = rowsAll.slice();
  if(symK) rows = rows.filter(r => String(r[symK]||'').toUpperCase() === MH.sym);

  let top = [];
  if (MH.view === 'ENS') {
    // ✅ 先嘗試原生 ENS 列
    const ensRows = viewK ? rows.filter(r => String(r[viewK]||'').toUpperCase()==='ENS') : [];
    if (ensRows.length){
      top = ensRows.map(r=>({f:r?.[featK], v:+r?.[valK]}))
                   .filter(d=>d.f!=null && Number.isFinite(d.v))
                   .sort((a,b)=>b.v-a.v).slice(0,20);
    } else {
      // ⬇︎ 沒有原生 ENS 再用權重加總 V* 的重要度
      const w = MH.weights?.[MH.sym] || {};
      const acc = new Map();
      rows.forEach(r=>{
        const vName = String(r?.[viewK]||'').toUpperCase();
        if(!/^V\d+$/i.test(vName)) return;
        const f=r?.[featK], iv=+r?.[valK], ww=+w[vName]||0;
        if(!f || !Number.isFinite(iv) || !ww) return;
        acc.set(f,(acc.get(f)||0)+ww*iv);
      });
      top = Array.from(acc.entries()).map(([f,v])=>({f,v}))
             .sort((a,b)=>b.v-a.v).slice(0,20);
    }
  } else {
    // 一般單一 view
    if(viewK) rows = rows.filter(r => String(r[viewK]||'').toUpperCase() === MH.view.toUpperCase());
    top = rows.map(r=>({f:r?.[featK], v:+r?.[valK]}))
              .filter(d=>d.f!=null && Number.isFinite(d.v))
              .sort((a,b)=>b.v-a.v).slice(0,20);
  }

  if(!top.length){
    MH.charts.feat.setOption(Object.assign({}, baseOpt, {
      title:{ text:'沒有對應欄位或數值為空', left:'center', top:'middle',
              textStyle:{ color:C.muted, fontSize:14 } }
    })); return;
  }
  MH.charts.feat.setOption(Object.assign({}, baseOpt, {
    yAxis:{ type:'category', data: top.map(x=>x.f).reverse(), axisLabel:{ color:C.muted } },
    series:[{ type:'bar', data: top.map(x=>x.v).reverse(), barMaxWidth:22 }]
  }));
}

function mhRenderViewW(){
  if(!MH.charts.vw){ MH.charts.vw = initEC('mhViewChart'); window.addEventListener('resize', ()=> MH.charts.vw && MH.charts.vw.resize()); }
  if(!MH.charts.vw) return;
  const w = MH.weights?.[MH.sym] || {};
  const kv = Object.entries(w).sort((a,b)=> a[0].localeCompare(b[0]));
  const C = themeColors();
  MH.charts.vw.setOption({
    backgroundColor:'transparent', textStyle:{ color:C.fg },
    grid:{ left:40, right:20, top:20, bottom:30 },
    xAxis:{ type:'category', data: kv.map(e=>e[0]), axisLabel:{ color:C.muted } },
    yAxis:{ type:'value', axisLabel:{ color:C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    series:[{ type:'bar', data: kv.map(e=>Number(e[1])), barMaxWidth:28 }],
    tooltip: tipStyle('axis')
  });
}

function mhRenderOOF(){
  const thead = document.querySelector('#mhOOF thead');
  const tbody = document.querySelector('#mhOOF tbody');
  thead.innerHTML = `<tr><th>Symbol</th><th>View</th><th>Fold</th><th>ACC</th><th>F1</th><th>AUC</th><th>BACC</th></tr>`;
  tbody.innerHTML = '';

  if (MH.view === 'ENS') {
    tbody.innerHTML = `<tr><td colspan="7">Ensemble 無單一折數；上方 KPI 已為依權重的加權平均。</td></tr>`;
    return;
  }

  // ……下面保留你原本的實作……
  const rowsAll = MH.oof || [];
  if(!rowsAll.length){
    tbody.innerHTML = `<tr><td colspan="7">—</td></tr>`;
    return;
  }
  const s = rowsAll[0];
  const symK  = pickKey(s, ['symbol','Symbol','coin','Coin','asset','Asset','ticker','Ticker','asset_code']);
  const viewK = pickKey(s, ['view','View','view_name','ViewName','model_view','ModelView']);
  const foldK = pickKey(s, ['fold','Fold','kfold','cv','CV']);
  const accK  = pickKey(s, ['acc','ACC','accuracy','Accuracy']);
  const f1K   = pickKey(s, ['f1','F1','macro_f1','MacroF1']);
  const aucK  = pickKey(s, ['auc','AUC','roc_auc','ROC_AUC']);
  const baccK = pickKey(s, ['bacc','BACC','balanced_accuracy','Balanced_Accuracy']);

  let rows = rowsAll.slice();
  if(symK)  rows = rows.filter(r => String(r[symK]||'').toUpperCase() === MH.sym);
  if(viewK) rows = rows.filter(r => String(r[viewK]||'').toUpperCase() === MH.view.toUpperCase());

  if(!rows.length){
    tbody.innerHTML = `<tr><td colspan="7">（沒有符合目前 Symbol/View 的紀錄）</td></tr>`;
    return;
  }

  const fmt = (k,r) => { if(!k) return '—'; const v=r[k], n=Number(v); return (v==null||v==='')?'—':(Number.isFinite(n)?n.toFixed(3):String(v)); };
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${symK? String(r[symK]).toUpperCase() : MH.sym}</td>
      <td>${viewK? (r[viewK] ?? MH.view) : MH.view}</td>
      <td>${foldK? (r[foldK] ?? '—') : '—'}</td>
      <td class="mono">${fmt(accK,r)}</td>
      <td class="mono">${fmt(f1K,r)}</td>
      <td class="mono">${fmt(aucK,r)}</td>
      <td class="mono">${fmt(baccK,r)}</td>`;
    tbody.appendChild(tr);
  });
}

function mhRenderBT(){
  const thead = document.querySelector('#mhBT thead');
  const tbody = document.querySelector('#mhBT tbody');
  thead.innerHTML = ''; tbody.innerHTML = '';
  if(!(MH.bt?.length)) return;

  const sample = MH.bt[0];
  const symK = pickKey(sample, ['symbol','Symbol','coin','Coin','asset','Asset','ticker','Ticker']); // ← 新增多種別名

  const cols = Object.keys(sample);
  thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr>`;

  // 依幣別過濾（若檔案沒有幣別欄位就不過濾）
  const rows = symK ? MH.bt.filter(r => String(r[symK]||'').toUpperCase()===MH.sym) : MH.bt;

  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = cols.map(c=>{
      const v=r[c];
      return `<td>${Number.isFinite(Number(v)) ? mhFmt(v) : (v??'—')}</td>`;
    }).join('');
    tbody.appendChild(tr);
  });
}

function mhRefreshViewOptions(){
  const sel = document.getElementById('mhView');
  // 直接從資料取 view 清單（已含 ENS 就不手動加）
  let views = MH.train?.[MH.sym] ? Object.keys(MH.train[MH.sym]) : ['V1','V2','V3','V4'];
  // 排序：V1…Vn、其他（如 ENS）放後面
  views.sort((a,b)=> {
    const na = +String(a).match(/\d+/)?.[0] ?? 999;
    const nb = +String(b).match(/\d+/)?.[0] ?? 999;
    return (na-nb) || a.localeCompare(b);
  });
  sel.innerHTML = views.map(v=>`<option>${v}</option>`).join('');
  if(!views.includes(MH.view)) MH.view = views[0];
  sel.value = MH.view;
}

function mhRenderAll(){
  mhRefreshViewOptions();
  mhRenderKPIs();
  mhRenderFeat();
  mhRenderViewW();
  mhRenderOOF();
  mhRenderBT();
}

function mhBindUI(){
  const s = document.getElementById('mhSym');
  const v = document.getElementById('mhView');
  if(s) s.onchange = ()=>{ MH.sym = s.value; mhRenderAll(); };
  if(v) v.onchange = ()=>{ MH.view = v.value; mhRenderAll(); };
}

// 覆蓋原本的 renderHome：改成讀五份檔案
async function renderHome(){
  try{
    if(!MH.train){ await mhLoadAll(); }
    // 預設用 BTC / V1（保留使用者切換）
    MH.sym = document.getElementById('mhSym')?.value || 'BTC';
    MH.view = document.getElementById('mhView')?.value || 'V1';
    mhBindUI();
    mhRenderAll();
  }catch(err){
    console.error('Home 模型檔案載入失敗', err);
    // 顯示簡短錯誤，避免空白
    const box = document.getElementById('route-home');
    if (box) box.insertAdjacentHTML('beforeend',
      `<div class="card" style="border-color:#ef4444;">
        <div class="title" style="color:#ef4444;">載入失敗</div>
        <div class="muted">請確認 /data/ 目錄下的五個檔案是否存在且可讀：</div>
        <div class="mono" style="white-space:pre-wrap; font-size:12px; margin-top:6px;">
data/oof_metrics.csv
data/oos_feature_importance.csv
data/view_weights_init.json
data/train_report_multiview.json
data/backtest_summary.csv
        </div>
      </div>`);
  }
}

async function enterHome(){
  $("#route-coin").style.display = "none";
  $("#route-home").style.display = "";
  Object.values(state.charts).forEach(ch=> ch && ch.clear());
  state.charts = {};
  await renderHome();
}

// 啟動
(async function boot() {
  try {
    if (window._echartsReady) { await window._echartsReady; }
  } catch (e) {
    console.error(e);
    // 可選：給個友善提示
    document.body.insertAdjacentHTML("afterbegin",
      '<div style="padding:12px;color:#ef4444;font-weight:700;">ECharts 載入失敗，請檢查網路或防火牆。</div>');
    return;
  }
  main();
})();
