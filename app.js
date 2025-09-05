// === Supabase（只放 anon key）與表對應：1d / 各幣種 ===
const SUPABASE_URL = "";   // 之後填你的 https://xxx.supabase.co
const SUPABASE_KEY = "";   // 之後填你的 anon key（不要用 service_role）

// 幣種 → 交易對
const SYMBOL_MAP = {
  btc: "BTCUSDT",
  eth: "ETHUSDT",
  xrp: "XRPUSDT",
  doge: "DOGEUSDT",
  bnb: "BNBUSDT",
  sol: "SOLUSDT",
  ada: "ADAUSDT",
};
// 幣種 → 指標表名（1d）← 之後改成你的 Supabase view/table 名稱
const IND_TABLE_1D = {
  btc: "btc_1d",
  eth: "eth_1d",
  xrp: "xrp_1d",
  doge: "doge_1d",
  bnb: "bnb_1d",
  sol: "sol_1d",
  ada: "ada_1d",
};

// 指標欄位（跟 Supabase 取回結構一致）
const IND_FIELDS = [
  "ts",
  "open_basis","close_basis","open_change","close_change",
  "whale_index_value","premium_rate",
  "ret_6h","ret_24h","log_ret_6h","log_ret_24h","atr14",
  "ema6","ema24","ema56",
  "rsi14",
  "macd_dif","macd_dea","macd_hist",
  "k","d","j",
  "bb_upper","bb_middle","bb_lower","bbw"
];

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(window.location.search);
const state = { history:null, predict:null, backtest:null, charts:{}, ind:null, priceSeriesName:"" };

// 顏色/樣式
const getVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim() || "#e5e7eb";
function themeColors() {
  return { fg:getVar('--fg'), muted:getVar('--muted'), accent:getVar('--accent'), grid:'rgba(148,163,184,.2)' };
}
function isDark() { return document.body.getAttribute('data-theme') === 'dark'; }
function tipStyle(trigger = 'axis') {
  return {
    trigger,
    textStyle: { color: isDark() ? '#e5e7eb' : '#0f172a' },
    backgroundColor: isDark() ? 'rgba(30,41,59,.92)' : 'rgba(255,255,255,.95)',
    borderColor: isDark() ? 'rgba(148,163,184,.25)' : 'rgba(0,0,0,.12)',
    axisPointer: { type: 'line' }
  };
}

// 工具
function getApiBase() { return $("#apiBase")?.value.trim() || ""; }
function fmtPct(x) { return (x>0?"+":"") + x.toFixed(2) + "%"; }
function fmtTs(ts) { try { return new Date(ts).toLocaleString(); } catch { return ts; } }
async function fetchJson(url) { const r = await fetch(url); if (!r.ok) throw new Error("HTTP "+r.status); return r.json(); }

function getRouteCoin() {
  const hash = (location.hash || "").replace("#","").toLowerCase();
  if (hash && SYMBOL_MAP[hash]) return hash;
  return "home";
}
function switchSection() {
  const coin = getRouteCoin();
  const isHome = (coin === "home");
  document.querySelectorAll(".home-only").forEach(x=>x.style.display = isHome ? "" : "none");
  document.querySelectorAll(".coin-only").forEach(x=>x.style.display = isHome ? "none" : "");
  if (!isHome) $("#coinTitle").textContent = `${coin.toUpperCase()} 1d K 線`;
}

// ===== 主資料（歷史/預測/回測）1d + 幣種 =====
async function loadData() {
  const coin = getRouteCoin();
  if (coin === "home") { state.history=null; state.predict=null; state.backtest=null; return; }
  const base = getApiBase();
  const symbol = SYMBOL_MAP[coin];
  const interval = "1d";
  state.priceSeriesName = `${coin.toUpperCase()} ${interval}`;

  if (base) {
    const [hist, pred, back] = await Promise.all([
      fetchJson(`${base}/api/history?symbol=${symbol}&interval=${interval}&limit=400`),
      fetchJson(`${base}/api/predict?symbol=${symbol}&horizon=${interval}`),
      fetchJson(`${base}/api/backtest?symbol=${symbol}&horizon=${interval}&limit=400`)
    ]);
    state.history = hist; state.predict = pred; state.backtest = back;
  } else {
    // 本地 1d 假資料（你可自行替換）
    const [hist, pred, back] = await Promise.all([
      fetchJson("./data/history_1d_sample.json"),
      fetchJson("./data/predict_sample.json").catch(()=>({})),
      fetchJson("./data/backtest_sample.json").catch(()=>({data:[]})),
    ]);
    state.history = hist; state.predict = pred; state.backtest = back;
  }
}

// ===== 指標資料（Supabase 或本地假資料）=====
function toLogFromPct(pct) {
  const r = Number(pct) / 100;
  if (!isFinite(r) || r <= -0.999999999) return NaN;
  return Math.log(1 + r);
}
function transformIndicators(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(r => {
    const o = { ...r };
    if (o.log_ret_6h == null && o.ret_6h != null)  o.log_ret_6h  = toLogFromPct(o.ret_6h);
    if (o.log_ret_24h == null && o.ret_24h != null) o.log_ret_24h = toLogFromPct(o.ret_24h);
    return o;
  });
}
async function loadIndicators() {
  const coin = getRouteCoin();
  if (coin === "home") { state.ind = null; return; }

  const table = IND_TABLE_1D[coin];
  try {
    if (SUPABASE_URL && SUPABASE_KEY && table) {
      const endpoint = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}`
                     + `?select=${encodeURIComponent(IND_FIELDS.join(","))}&order=ts.asc&limit=2000`;
      const r = await fetch(endpoint, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
      if (r.ok) {
        const raw = await r.json();
        if (Array.isArray(raw) && raw.length) { state.ind = transformIndicators(raw); return; }
      } else {
        console.warn("Supabase 指標請求失敗:", r.status, await r.text());
      }
    }
  } catch(e) { console.warn("Supabase 指標抓取錯誤:", e); }

  // fallback：本地假資料
  const local = await fetch("./data/indicators_1d_sample.json").then(r=>r.json());
  state.ind = transformIndicators(local);
}

// ===== 圖表初始化 =====
function ensureCharts() {
  if (!state.charts.price) {
    state.charts.price = echarts.init(document.getElementById('chart'));
    window.addEventListener('resize', () => state.charts.price.resize());
  }
  if (!state.charts.imp) {
    state.charts.imp = echarts.init(document.getElementById('impChart'));
    window.addEventListener('resize', () => state.charts.imp.resize());
  }
  if (!state.charts.cm) {
    state.charts.cm = echarts.init(document.getElementById('cmChart'));
    window.addEventListener('resize', () => state.charts.cm.resize());
  }
}

// ===== 價格與預測 =====
function renderPriceAndPredict() {
  if (!state.history || !document.querySelector(".coin-only") || getRouteCoin()==="home") return;
  const hist = state.history?.data || [];
  const pred = state.predict || null;
  const categories = hist.map(d => d.t);
  const kdata = hist.map(d => [d.o, d.c, d.l, d.h]);

  let markLine = [], markArea = [];
  if (pred && hist.length) {
    const nextTs = pred.timestamp;
    const lastClose = hist[hist.length-1].c;
    const low = lastClose * (1 + pred.conf_interval_pct?.[0]/100.0);
    const high = lastClose * (1 + pred.conf_interval_pct?.[1]/100.0);
    markArea = [ [ { xAxis: nextTs, itemStyle:{color:'rgba(37,99,235,0.08)'} }, { xAxis: nextTs } ] ];
    markLine = [
      { name:'預測價格', xAxis: nextTs, yAxis: pred.y_pred },
      { name:'區間低', xAxis: nextTs, yAxis: low },
      { name:'區間高', xAxis: nextTs, yAxis: high },
    ];
  }
  const C = themeColors();
  state.charts.price.setOption({
    backgroundColor: 'transparent',
    animation: true,
    textStyle: { color: C.fg },
    grid: { left: 50, right: 20, top: 10, bottom: 40 },
    xAxis: { type:'category', data: categories, axisLabel:{ color: C.muted } },
    yAxis: { scale: true, axisLabel:{ color: C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    dataZoom: [{ type:'inside' }, { type:'slider', textStyle:{ color: C.muted } }],
    tooltip: tipStyle('axis'),
    series: [{
      type:'candlestick', name: state.priceSeriesName || 'K', data: kdata,
      itemStyle: { color:'#ef4444', color0:'#10b981', borderColor:'#ef4444', borderColor0:'#10b981' },
      markArea: { data: markArea },
      markLine: { symbol:['none','none'], data: markLine, lineStyle:{ type:'dashed' }, label:{ show:true, color:C.fg } },
    }]
  });

  if (pred) {
    $("#dir").textContent = (pred.direction === 'up' ? '▲ 上漲' : '▼ 下跌');
    $("#delta").textContent = pred.delta_pct != null ? fmtPct(pred.delta_pct) : "—";
    $("#conf").textContent = pred.confidence != null ? (pred.confidence*100).toFixed(0) + '%' : '—';
    $("#band").textContent = Array.isArray(pred.conf_interval_pct)
      ? pred.conf_interval_pct.map(p=> (p>0?'+':'')+Number(p).toFixed(2)+'%').join(' ~ ')
      : '—';
    $("#predTs").textContent = pred.timestamp ? fmtTs(pred.timestamp) : '—';
  }
}

// ===== 共用繪圖 util（指標區） =====
function mount(id){ return echarts.init(document.getElementById(id)); }
function optBase(x, yname=''){
  const C = themeColors();
  return {
    backgroundColor:'transparent',
    textStyle:{ color:C.fg },
    grid:{ left:50, right:20, top:10, bottom:40 },
    xAxis:{ type:'category', data:x, boundaryGap:false, axisLabel:{ color:C.muted } },
    yAxis:{ type:'value', name:yname, axisLabel:{ color:C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    legend:{ top:0 },
    tooltip: tipStyle('axis')
  };
}
function line(name,data,smooth=true){ return { type:'line', name, data, smooth, showSymbol:false }; }

function getInd(){ return Array.isArray(state.ind) ? state.ind : []; }
function X(){ return getInd().map(r => String(r.ts).slice(0,16).replace('T',' ')); }

// ===== 指標圖（圖一 + 圖二） =====
function render_BASIS(){ const x=X(), rows=getInd();
  mount('chart-basis').setOption(Object.assign(optBase(x,'%'),{
    series:[ line('BASIS_O', rows.map(r=>r.open_basis)), line('BASIS_C', rows.map(r=>r.close_basis)) ]
  }));
}
function render_BASIS_CHG(){ const x=X(), rows=getInd();
  mount('chart-basischg').setOption(Object.assign(optBase(x,'%'),{
    series:[ line('BASIS_O_CHG%', rows.map(r=>r.open_change)), line('BASIS_C_CHG%', rows.map(r=>r.close_change)) ]
  }));
}
function render_WHALE(){ const x=X(), rows=getInd();
  mount('chart-whale').setOption(Object.assign(optBase(x,''),{
    series:[ line('WHALE', rows.map(r=>r.whale_index_value)) ]
  }));
}
function render_CBPREM(){ const x=X(), rows=getInd();
  mount('chart-cbprem').setOption(Object.assign(optBase(x,'%'),{
    series:[ line('CB_PREM%', rows.map(r=>r.premium_rate), false) ]
  }));
}
function render_RET(){ const x=X(), rows=getInd();
  mount('chart-returns').setOption(Object.assign(optBase(x,'log'),{
    series:[ line('log R6', rows.map(r=>r.log_ret_6h)), line('log R24', rows.map(r=>r.log_ret_24h)) ]
  }));
}
function render_LOGRET(){ const x=X(), rows=getInd();
  mount('chart-logrets').setOption(Object.assign(optBase(x,'log'),{
    series:[ line('LR6', rows.map(r=>r.log_ret_6h)), line('LR24', rows.map(r=>r.log_ret_24h)) ]
  }));
}
function render_ATR(){ const x=X(), rows=getInd();
  mount('chart-atr').setOption(Object.assign(optBase(x,''),{ series:[ line('ATR14', rows.map(r=>r.atr14)) ] }));
}
function render_EMA(){ const x=X(), rows=getInd();
  mount('chart-ema').setOption(Object.assign(optBase(x,''),{
    series:[ line('EMA6', rows.map(r=>r.ema6)), line('EMA24', rows.map(r=>r.ema24)), line('EMA56', rows.map(r=>r.ema56)) ]
  }));
}
function render_RSI(){ const x=X(), rows=getInd();
  const o = optBase(x,''); o.yAxis.min=0; o.yAxis.max=100;
  mount('chart-rsi').setOption(Object.assign(o,{ series:[ line('RSI14', rows.map(r=>r.rsi14)) ] }));
}
function render_MACD(){ const x=X(), rows=getInd();
  mount('chart-macd').setOption(Object.assign(optBase(x,''),{
    series:[ line('DIF', rows.map(r=>r.macd_dif)), line('DEA', rows.map(r=>r.macd_dea)),
             { type:'bar', name:'Hist', data: rows.map(r=>r.macd_hist), barWidth: 2 } ]
  }));
}
function render_KD(){ const x=X(), rows=getInd();
  const o = optBase(x,''); o.yAxis.min=0; o.yAxis.max=100;
  mount('chart-kd').setOption(Object.assign(o,{
    series:[ line('K', rows.map(r=>r.k)), line('D', rows.map(r=>r.d)), line('J', rows.map(r=>r.j)) ]
  }));
}
function render_BOLL(){ const x=X(), rows=getInd();
  mount('chart-boll').setOption(Object.assign(optBase(x,''),{
    series:[ line('BB Upper', rows.map(r=>r.bb_upper)), line('BB Middle', rows.map(r=>r.bb_middle)),
             line('BB Lower', rows.map(r=>r.bb_lower)), line('BBW(20,2)', rows.map(r=>r.bbw)) ]
  }));
}
function renderAllIndicators(){
  if (!getInd().length || getRouteCoin()==="home") return;
  render_BASIS(); render_BASIS_CHG(); render_WHALE(); render_CBPREM();
  render_RET(); render_LOGRET(); render_ATR();
  render_EMA(); render_RSI(); render_MACD(); render_KD(); render_BOLL();
}

// ===== 混淆矩陣與指標（Home）=====
function confusionMatrixAndMetrics() {
  const rows = (state.backtest?.data || []);
  const N = rows.length;
  let TP=0, TN=0, FP=0, FN=0;
  rows.forEach(r => {
    const p = (r.pred_dir === 'up');
    const a = (r.actual_dir === 'up');
    if (p && a) TP++; else if (!p && !a) TN++; else if (p && !a) FP++; else if (!p && a) FN++;
  });
  const acc = N ? (TP+TN)/N : 0;
  const prec = (TP+FP) ? TP/(TP+FP) : 0;
  const rec = (TP+FN) ? TP/(TP+FN) : 0;
  const f1 = (prec+rec) ? 2*prec*rec/(prec+rec) : 0;

  const C = themeColors();
  state.charts.cm.setOption({
    tooltip: Object.assign(tipStyle('item'), { position: 'top' }),
    textStyle:{ color: C.fg },
    grid: { left: 80, right: 20, top: 40, bottom: 20 },
    xAxis: { type: 'category', data: ['預測↓ / 真實→','up','down'], show: false },
    yAxis: { type: 'category', data: ['up','down'], axisLabel:{ color: C.muted }},
    visualMap: { min: 0, max: Math.max(1, TP+TN+FP+FN), calculable: false, orient: 'horizontal', left: 'center', bottom: 0,
                 textStyle:{ color: C.muted } },
    series: [{ name:'Confusion', type:'heatmap',
      data: [[1,0,TP],[2,0,FP],[1,1,FN],[2,1,TN]], label: { show: true, color: C.fg } }]
  });

  const tbl = $("#btMetrics");
  tbl.innerHTML = `
    <tr><th>樣本數 N</th><td class="mono">${N}</td></tr>
    <tr><th>Accuracy</th><td class="mono">${(acc*100).toFixed(1)}%</td></tr>
    <tr><th>Precision (上漲)</th><td class="mono">${(prec*100).toFixed(1)}%</td></tr>
    <tr><th>Recall (上漲)</th><td class="mono">${(rec*100).toFixed(1)}%</td></tr>
    <tr><th>F1</th><td class="mono">${(f1*100).toFixed(1)}%</td></tr>`;
}

// ===== 模型重要度/特徵（Home）=====
function renderImportancesAndFeatures() {
  const pred = state.predict || {};
  const imp = (pred.importances || []).slice().sort((a,b)=>b[1]-a[1]);
  const impNames = imp.map(x=>x[0]);
  const impVals = imp.map(x=>x[1]);
  const C = themeColors();
  state.charts.imp.setOption({
    backgroundColor:'transparent',
    textStyle:{ color: C.fg },
    grid:{ left: 80, right: 20, top: 20, bottom: 30 },
    xAxis:{ type:'value', axisLabel:{ color:C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    yAxis:{ type:'category', data: impNames, axisLabel:{ color:C.muted } },
    series:[{ type:'bar', data: impVals, name:'重要度', label:{ show:false, color:C.fg } }],
    tooltip: tipStyle('item')
  });

  const grid = $("#featGrid");
  grid.innerHTML = "";
  const feats = pred.features || {};
  Object.entries(feats).forEach(([k,v]) => {
    const el = document.createElement('div');
    el.innerHTML = `<div class="muted">${k}</div><div class="mono" style="font-size:18px; font-weight:700;">${v}</div>`;
    grid.appendChild(el);
  });

  const m = pred.model || {};
  const txt = [
    `模型：${m.name || '—'} (${m.version || '—'})`,
    `訓練區間：${m.trained_window || '—'}`,
    `目標：${m.target || '—'}，損失：${m.loss || '—'}`,
    `指標：F1=${m.metrics?.f1 ?? '—'}, Precision=${m.metrics?.precision ?? '—'}, Recall=${m.metrics?.recall ?? '—'}, RMSE=${m.metrics?.rmse ?? '—'}, MAPE=${m.metrics?.mape ?? '—'}`,
    `超參數：`,
    JSON.stringify(m.hyperparams || {}, null, 2)
  ].join('\n');
  $("#modelInfo").textContent = txt;
}

// ===== 主流程 =====
async function main() {
  // 題面提供主題參數
  if (params.get('theme') === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    $("#themeLabel").textContent = '黑';
  }
  switchSection();          // 決定顯示 Home 或 Coin
  ensureCharts();           // 初始化
  await loadData();         // 讀資料（依分頁）
  await loadIndicators();   // 讀指標（依分頁）
  renderPriceAndPredict();
  renderImportancesAndFeatures();
  confusionMatrixAndMetrics();
  renderAllIndicators();
}

window.addEventListener('hashchange', main);
window.addEventListener('popstate', main);

// 主題切換
$("#themeToggle").addEventListener('click', () => {
  const now = document.body.getAttribute('data-theme');
  const next = now === 'light' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', next);
  $("#themeLabel").textContent = next === 'light' ? '白' : '黑';
  renderPriceAndPredict(); renderImportancesAndFeatures(); confusionMatrixAndMetrics();
});

main();
