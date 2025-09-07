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

async function fetchTodayPrediction(asset='BTC') {
  const base = `${SB_BASE}/predictor.predictions_daily`;
  const today = todayUTC();
  // 先試今天
  let q = new URLSearchParams({ coin:`eq.${asset}`, dt:`eq.${today}`, order:'model_tag.asc' });
  let rows = await fetch(`${base}?${q}`, { headers: SB_HEADERS }).then(r=>r.json());
  // 沒有就拿最近一筆
  if (!rows.length) {
    q = new URLSearchParams({ coin:`eq.${asset}`, order:'dt.desc', limit:'1' });
    rows = await fetch(`${base}?${q}`, { headers: SB_HEADERS }).then(r=>r.json());
  }
  const r = rows[0];
  return r ? { prob_up:+r.prob_up, dir:r.yhat_dir, model:r.model_tag } : null;
}

// 右側「最近 5 次預測」：直接抓近 5 天
async function fetchRecentPredictions(asset = 'BTC', n = 5) {
  const q = new URLSearchParams({ coin:`eq.${asset}`, order:'dt.desc', limit:String(n) });
  const url = `${SB_BASE}/predictor.predictions_daily?${q}`;
  return fetch(url, { headers: SB_HEADERS }).then(r => r.json());
}

// ====== 路由 ======
function currentRoute(){
  const h = (location.hash || "#home").replace("#","").toUpperCase();
  return COINS.includes(h) ? h : "HOME";
}
window.addEventListener('hashchange', main);

async function fetchKlineNav(asset = 'BTC', view = 'V1') {
  const q = new URLSearchParams({
    asset_code: `eq.${asset}`,
    view_tag:   `eq.${view}`,
    strategy:   `eq.atr1pct_long_only`,
    order:      'dt.asc',
  });
  const url = `${SB_BASE}/api_kline_nav?${q}`;
  const rows = await fetch(url, { headers: SB_HEADERS }).then(r => r.json());
  if (!Array.isArray(rows)) {
    console.error("[fetchKlineNav] 非陣列回應：", rows);
    return { ohlc: [], nav: [], rows: [] };
  }
  // 映射到你現有的 OHLC 結構
  const ohlc = rows.map(r => ({
    t: r.dt, o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: NaN
  }));
  // nav_usd 留給副圖或次軸
  const nav = rows.map(r => +r.nav_usd);
  return { ohlc, nav, rows };
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

async function fetchPricesFromSB(coin) {
  // 將 #btc/#eth 轉為大寫幣別（你的 schema 就是 BTC/ETH…）
  const sym = String(coin || "").toUpperCase();
  if (!SUPABASE_URL || !SUPABASE_KEY || !sym) return null;

  const base = SUPABASE_URL.replace(/\/$/, '');
  const pageSize = 1000;
  let lastTs = -1;
  let all = [];

  while (true) {
    const q = new URLSearchParams({
      select: 'ts_utc,open,high,low,close,volume',
      coin: `eq.${sym}`,
      'ts_utc': `gt.${lastTs}`,
      order: 'ts_utc.asc',
      limit: String(pageSize),
    });
    const url = `${base}/rest/v1/${PRICES_TABLE}?${q.toString()}`;

    // 若單頁出錯（RLS、CORS、權限、Rate limit…），直接放棄 Supabase，由上層改走 sample
    let rows = [];
    try {
      rows = await fetchJSON(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: 'application/json',
          'Accept-Profile': 'predictor'  // 指定使用 predictor schema（你的新表就在這）
        }
      });
    } catch (e) {
      return null;
    }

    if (!rows.length) break;
    all = all.concat(rows);
    lastTs = rows[rows.length - 1].ts_utc;
    if (rows.length < pageSize) break;
  }

  if (!all.length) return null;

  return all.map(r => ({
    t: new Date(Number(r.ts_utc) < 1e12 ? Number(r.ts_utc) * 1000 : Number(r.ts_utc))
          .toISOString().slice(0, 10),
    o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: +r.volume
  }));
}

async function loadSample(){
  // 沒有 daily_sample.json 時不要整個爆掉，回傳空物件讓上層照常跑
  try {
    if (state.sample) return state.sample;
    state.sample = await fetchJSON(`${DATA_BASE}/daily_sample.json`);
    return state.sample;
  } catch {
    console.warn("[sample] ./data/daily_sample.json 不存在，返回空資料。");
    state.sample = {};
    return state.sample;
  }
}

async function getOHLC(coin){
  // 1) 先試 Supabase
  const sb = await fetchPricesFromSB(coin);
  if (Array.isArray(sb) && sb.length) {
    state.source = 'supabase';
    return sb;
  }
  // 2) fallback：sample（即使檔案不存在也不會讓頁面中斷）
  state.source = 'sample';
  const sample = await loadSample();
  return (sample[coin] || []).map(r => ({ t:r.t, o:+r.o, h:+r.h, l:+r.l, c:+r.c, v:+r.v }));
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
  const pageSize = 2000;   // 視需求調整
  let lastDt = '';         // 字串日期游標
  let all = [];

  while (true) {
    const q = new URLSearchParams({
      select: 'dt,asset_code,px_close,rsi14,rsi30,macd,macd_signal,ma5r,ma20r,ma50r,band_bb_w,band_kc_w,atr14,vol_z20,ret_1d,ret_5d,ret_20d,oi_change,oi_pct1,funding_z7,liq_abs,liq_net,exch_balance_pct_1d,week_ret_1w,week_rsi_1w,week_ma_cross_1w',
      asset_code: `eq.${sym}`,
      order: 'dt.asc',
      limit: String(pageSize),
      ...(lastDt ? { dt: `gt.${lastDt}` } : {})
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
      return null; // 交給上層 fallback
    }

    if (!rows.length) break;
    all = all.concat(rows);
    lastDt = rows[rows.length - 1].dt;
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
async function loadPredSample(coin){
  try {
    const p = await fetchTodayPrediction(coin, 'ENS'); // 或 V1/V2...
    if (p) {
      state.pred = {
        y_pred: p.prob_up,          // 0~1
        horizon_hours: 24,
        ci: null,
        model: { name: p.model },
      };
      state.pred_source = 'supabase';
      return state.pred;
    }
  } catch(e){
    console.warn('[pred] fetchTodayPrediction failed', e);
  }
  state.pred = {}; state.pred_source = 'none';
  return state.pred;
}

async function loadRecentPredictions(){
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

  try{
    const rows = await fetchRecentPredictions(state.route || 'BTC', 5);
    const bodyHtml = (rows && rows.length)
      ? rows.map(r=>{
          const dir = String(r.yhat_dir).toLowerCase()==='up' ? '↑ up' : '↓ down';
          const dirCol = /up/i.test(r.yhat_dir) ? '#22c55e' : '#ef4444';
          const p = Number(r.prob_up);
          const v = Number.isFinite(p) ? (p<=1? p*100 : p) : NaN;
          return `<tr>
            <td class="mono">${r.dt}</td>
            <td style="color:${dirCol};font-weight:700;">${dir}</td>
            <td class="mono">${Number.isFinite(v)? v.toFixed(2)+'%' : '—'}</td>
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
  }catch(e){
    console.error('[recentPred] failed', e);
    if (tbody) tbody.innerHTML = `<tr><td>—</td></tr>`;
    else if (container) container.innerHTML = `<table class="data-table"><tbody><tr><td>—</td></tr></tbody></table>`;
  }
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

  // ===== 右側：y_pred / API 狀態 / 預測摘要（升級：箭頭+百分比） =====
  (() => {
    // 顯示 y_pred
    const yEl = document.getElementById('yPred');
    if (yEl) yEl.textContent = (typeof yPred === 'number') ? (yPred*100).toFixed(1) + '%' : '—';

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

    // 預測摘要（箭頭 + 百分比 + CI）
    const predBox = document.getElementById('predSummary');
    if (predBox) {
      let html;
      if (Number.isFinite(yPred)) {
        const prob = (yPred * 100).toFixed(1);
        html = `上漲機率：<span class="mono" style="font-size:22px;font-weight:800;">${prob}%</span><br>
                時窗：${horizonH}h`;
      } else {
        html = `上漲機率：—`;
      }
      predBox.innerHTML = html;
    }
  })();

  // 更新「模型資料」指示燈
  if (typeof renderModelStatus === 'function') renderModelStatus();

  loadRecentPredictions();
  
  renderSparks(rows);
}

// ====== 進入分頁 ======
async function enterCoin(coin){
  $("#route-home").style.display = "none";
  $("#route-coin").style.display = "";
  Object.values(state.charts).forEach(ch=> ch && ch.clear());

  const kn = await fetchKlineNav(coin, 'V1');   // 或用你選的 view / ENS
  state.ohlc = kn.ohlc;
  state.source = 'supabase';
  await hydrateIndicators(coin, state.ohlc); // ← 這行會自動：Supabase→前端

  state.pred = null;
  state.pred_source = 'none';
  await loadPredSample(coin);

  renderCoinPage(coin, state.ohlc);
}

async function fetchApiStatus(){
  const url = `${SB_BASE}/predictor/api_status?order=asset_code.asc`;
  return fetch(url, { headers: SB_HEADERS }).then(r=>r.json());
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

async function fetchBacktestReport(asset='BTC'){
  const q = new URLSearchParams({ asset_code:`eq.${asset}`, order:'view_tag.asc' });
  const url = `${SB_BASE}/predictor/api_backtest_report?${q}`;
  return fetch(url,{ headers:SB_HEADERS }).then(r=>r.json());
}

async function fetchTrades(asset='BTC', view='V1'){
  const q = new URLSearchParams({
    asset_code:`eq.${asset}`, view_tag:`eq.${view}`,
    strategy:`eq.atr1pct_long_only`, order:'open_dt.asc'
  });
  const url = `${SB_BASE}/predictor/api_trades?${q}`;
  return fetch(url,{ headers:SB_HEADERS }).then(r=>r.json());
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
  const t = MH.train?.[MH.sym]?.[MH.view];
  const dir = t?.dir_avg, vol = t?.vol_avg, w = MH.weights?.[MH.sym]?.[MH.view];
  document.getElementById('mhDirF1').textContent  = mhFmt(dir?.f1);
  document.getElementById('mhDirAUC').textContent = mhFmt(dir?.auc);
  document.getElementById('mhDirBACC').textContent= mhFmt(dir?.bacc);
  document.getElementById('mhVolACC').textContent = mhFmt(vol?.acc);
  document.getElementById('mhVolF1').textContent  = mhFmt(vol?.macro_f1);
  document.getElementById('mhViewW').textContent  = (w!=null)? mhFmt(w) : '—';
}

function pickKey(sample, candidates){
  for (const k of candidates) if (k in sample) return k;
  return null;
}

function mhRenderFeat(){
  if(!MH.charts.feat){
  MH.charts.feat = initEC('mhFeat');   // ← 用 initEC
  if(!MH.charts.feat) return;          // ← 沒容器就跳出
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
    }));
    return;
  }

  const sample = rowsAll[0];
  const symK  = pickKey(sample, ['symbol','Symbol','coin','Coin','asset','Asset','ticker','Ticker','asset_code']);
  const viewK = pickKey(sample, ['view','View','view_name','ViewName','model_view','ModelView']);
  const featK = pickKey(sample, ['feature','Feature','feature_name','name','Name','column']);
  const valK  = pickKey(sample, ['importance','Importance','gain','Gain','weight','Weight','value','Value']);

  let rows = rowsAll.slice();
  if(symK)  rows = rows.filter(r => String(r[symK]||'').toUpperCase() === MH.sym);
  if(viewK) rows = rows.filter(r => String(r[viewK]||'').toUpperCase() === MH.view.toUpperCase());
  // 若篩到空，退回「不過濾 symbol/view」
  if(!rows.length) rows = rowsAll.slice();

  const top = rows
    .map(r => ({ f: r?.[featK], v: Number(r?.[valK]) }))
    .filter(d => d.f != null && Number.isFinite(d.v))
    .sort((a,b)=> b.v - a.v)
    .slice(0, 20);

  if(!top.length){
    MH.charts.feat.setOption(Object.assign({}, baseOpt, {
      title:{ text:'沒有對應欄位或數值為空', left:'center', top:'middle',
              textStyle:{ color:C.muted, fontSize:14 } }
    }));
    return;
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

  const fmt = (k,r) => {
    if(!k) return '—';
    const v = r[k];
    const n = Number(v);
    return (v==null || v==='') ? '—' : Number.isFinite(n) ? n.toFixed(3) : String(v);
  };

  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${symK? String(r[symK]).toUpperCase() : MH.sym}</td>
      <td>${viewK? (r[viewK] ?? MH.view) : MH.view}</td>
      <td>${foldK? (r[foldK] ?? '—') : '—'}</td>
      <td class="mono">${fmt(accK,r)}</td>
      <td class="mono">${fmt(f1K,r)}</td>
      <td class="mono">${fmt(aucK,r)}</td>
      <td class="mono">${fmt(baccK,r)}</td>
    `;
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
  const views = MH.train?.[MH.sym] ? Object.keys(MH.train[MH.sym]) : ['V1','V2','V3','V4'];
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
