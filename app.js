// ====== 基本設定 ======
const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(window.location.search);

const COINS = ['BTC','ETH','XRP','DOGE','BNB','SOL','ADA'];
const state = {
  history:null, predict:null, backtest:null,
  charts:{ home:null, imp:null, cm:null, coin:null },
  ind:null,        // （首頁其他指標留用）
  currentTab:'home',
  coinCache:{}     // { 'BTC': {data:[...]} }：簡單快取避免重複請求
};

// CSS 變數 → 主題色
const getVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim() || "#e5e7eb";
function themeColors() {
  return {
    fg: getVar('--fg'),
    muted: getVar('--muted'),
    accent: getVar('--accent'),
    grid: 'rgba(148,163,184,.2)',
    tbg: getVar('--tooltip-bg'),
    tfg: getVar('--tooltip-fg'),
  };
}
function tipStyle(trigger='axis', extra={}) {
  const C = themeColors();
  return Object.assign({
    trigger,
    textStyle:{ color: C.tfg },
    backgroundColor: C.tbg,
    borderColor: C.grid,
    axisPointer:{ type:'line' }
  }, extra);
}

// API Base（留空→使用 sample）
function getApiBase() {
  const val = $("#apiBase") ? $("#apiBase").value.trim() : "";
  return val || "";
}
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}
function fmtPct(x) { return (x>0?'+':'') + x.toFixed(2) + '%'; }
function fmtTs(ts) { try { return new Date(ts).toLocaleString(); } catch { return ts; } }

// ====== 首頁：沿用你原本的資料來源（sample 或 API） ======
async function loadHomeData() {
  const base = getApiBase();
  if (base) {
    const [hist, pred, back] = await Promise.all([
      fetchJson(base + "/api/history?symbol=ETHUSDT&interval=6h&limit=200"),
      fetchJson(base + "/api/predict?symbol=ETHUSDT&horizon=6h"),
      fetchJson(base + "/api/backtest?symbol=ETHUSDT&horizon=6h&limit=200"),
    ]);
    state.history = hist; state.predict = pred; state.backtest = back;
  } else {
    const [hist, pred, back] = await Promise.all([
      fetchJson("./data/history_6h_sample.json"),
      fetchJson("./data/predict_sample.json"),
      fetchJson("./data/backtest_sample.json"),
    ]);
    state.history = hist; state.predict = pred; state.backtest = back;
  }
}

// ====== 首頁圖表（沿用既有） ======
function ensureHomeCharts() {
  if (!state.charts.home) {
    state.charts.home = echarts.init(document.getElementById('chart'));
    window.addEventListener('resize', () => state.charts.home.resize());
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
function renderPriceAndPredict() {
  const hist = state.history?.data || [];
  const pred = state.predict || null;
  const categories = hist.map(d => d.t);
  const kdata = hist.map(d => [d.o, d.c, d.l, d.h]);
  let markLine = [], markArea = [];
  if (pred && hist.length) {
    const nextTs = pred.timestamp;
    const lastClose = hist[hist.length-1].c;
    const low = lastClose * (1 + pred.conf_interval_pct[0]/100);
    const high = lastClose * (1 + pred.conf_interval_pct[1]/100);
    markArea = [[{ xAxis: nextTs, itemStyle:{color:'rgba(37,99,235,0.08)'} }, { xAxis: nextTs }]];
    markLine = [
      { name:'預測價格', xAxis: nextTs, yAxis: pred.y_pred },
      { name:'區間低', xAxis: nextTs, yAxis: low },
      { name:'區間高', xAxis: nextTs, yAxis: high },
    ];
  }
  const C = themeColors();
  state.charts.home.setOption({
    backgroundColor: 'transparent',
    animation: true,
    textStyle: { color: C.fg },
    grid: { left: 50, right: 20, top: 10, bottom: 40 },
    xAxis: { type:'category', data: categories, axisLabel:{ color: C.muted } },
    yAxis: { scale: true, axisLabel:{ color: C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    dataZoom: [{ type:'inside' }, { type:'slider', textStyle:{ color: C.muted } }],
    tooltip: tipStyle('axis'),
    series: [{
      type:'candlestick', name:'ETH 6h', data: kdata,
      itemStyle: { color:'#ef4444', color0:'#10b981', borderColor:'#ef4444', borderColor0:'#10b981' },
      markArea: { data: markArea },
      markLine: { symbol:['none','none'], data: markLine, lineStyle:{ type:'dashed' }, label:{ show:true, color:C.fg } },
    }]
  });

  if (pred) {
    $("#dir").textContent = (pred.direction === 'up' ? '▲ 上漲' : '▼ 下跌');
    $("#delta").textContent = fmtPct(pred.delta_pct);
    $("#conf").textContent = (pred.confidence*100).toFixed(0) + '%';
    $("#band").textContent = pred.conf_interval_pct.map(p=> (p>0?'+':'')+p.toFixed(2)+'%').join(' ~ ');
    $("#predTs").textContent = fmtTs(pred.timestamp);
  }
}
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

  const grid = $("#featGrid"); grid.innerHTML = "";
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
  if (!state.charts.cm) return;
  state.charts.cm.setOption({
    tooltip: tipStyle('item', { position:'top' }),
    textStyle:{ color: C.fg },
    grid: { left: 80, right: 20, top: 40, bottom: 20 },
    xAxis: { type: 'category', data: ['預測↓ / 真實→','up','down'], show: false },
    yAxis: { type: 'category', data: ['up','down'], axisLabel:{ color: C.muted }},
    visualMap: { min: 0, max: Math.max(1, TP+TN+FP+FN), calculable: false, orient: 'horizontal', left: 'center', bottom: 0,
                 textStyle:{ color: C.muted } },
    series: [{ name:'Confusion', type:'heatmap',
      data: [[1,0,TP],[2,0,FP],[1,1,FN],[2,1,TN]], label:{ show:true, color:C.fg } }]
  });

  $("#btMetrics").innerHTML = `
    <tr><th>樣本數 N</th><td class="mono">${N}</td></tr>
    <tr><th>Accuracy</th><td class="mono">${(acc*100).toFixed(1)}%</td></tr>
    <tr><th>Precision (上漲)</th><td class="mono">${(prec*100).toFixed(1)}%</td></tr>
    <tr><th>Recall (上漲)</th><td class="mono">${(rec*100).toFixed(1)}%</td></tr>
    <tr><th>F1</th><td class="mono">${(f1*100).toFixed(1)}%</td></tr>
  `;
}

// ====== 幣別 1d K 線 ======
function ensureCoinChart() {
  if (!state.charts.coin) {
    state.charts.coin = echarts.init(document.getElementById('coinChart'));
    window.addEventListener('resize', () => state.charts.coin.resize());
  }
}
async function loadCoinHistory(symbol) {
  if (state.coinCache[symbol]) return state.coinCache[symbol];
  const base = getApiBase();
  if (!base) {
    // 沒 API 就給空資料（顯示「請設定 API」）
    state.coinCache[symbol] = { data: [] };
    return state.coinCache[symbol];
  }
  const url = `${base}/api/history?symbol=${symbol}USDT&interval=1d&limit=500`;
  const data = await fetchJson(url);
  state.coinCache[symbol] = data;
  return data;
}
function renderCoin(symbol, data) {
  $("#coinTitle").textContent = symbol;
  const rows = data?.data || [];
  const x = rows.map(d => d.t);
  const k = rows.map(d => [d.o, d.c, d.l, d.h]);
  const C = themeColors();
  state.charts.coin.setOption({
    backgroundColor:'transparent',
    textStyle:{ color:C.fg },
    grid:{ left:50, right:20, top:10, bottom:40 },
    xAxis:{ type:'category', data:x, axisLabel:{ color:C.muted } },
    yAxis:{ scale:true, axisLabel:{ color:C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    dataZoom:[{type:'inside'},{type:'slider', textStyle:{color:C.muted}}],
    tooltip: tipStyle('axis'),
    series:[{
      type:'candlestick', name:`${symbol} 1d`, data:k,
      itemStyle:{ color:'#ef4444', color0:'#10b981', borderColor:'#ef4444', borderColor0:'#10b981' }
    }]
  });
}

// ====== Router（hash 分頁） ======
function showPage(tab) {
  state.currentTab = tab;
  // tabbar 標記
  document.querySelectorAll('#tabbar .btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  // 顯示/隱藏頁面
  $("#page-home").classList.toggle('show', tab === 'home');
  $("#page-coin").classList.toggle('show', tab !== 'home');

  if (tab === 'home') {
    ensureHomeCharts();
    renderPriceAndPredict();
    renderImportancesAndFeatures();
    confusionMatrixAndMetrics();
  } else {
    ensureCoinChart();
    loadCoinHistory(tab).then(d => renderCoin(tab, d)).catch(()=>{
      renderCoin(tab, {data:[]});
    });
  }
}
function applyHashRoute() {
  const h = (location.hash || '').replace(/^#/, '').toUpperCase();
  if (!h || h === 'HOME') showPage('home');
  else if (COINS.includes(h)) showPage(h);
  else showPage('home');
}
window.addEventListener('hashchange', applyHashRoute);
document.getElementById('tabbar').addEventListener('click', (e)=>{
  const t = e.target.closest('[data-tab]'); if (!t) return;
  const tab = t.dataset.tab;
  location.hash = tab.toLowerCase();
});

// ====== 初始化 ======
async function main() {
  if (params.get('theme') === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    $("#themeLabel").textContent = '黑';
  }
  const bot = params.get('bot');
  if (bot) $("#tgButton")?.setAttribute('href', `https://t.me/${bot}`);

  await loadHomeData();      // 首頁資料（樣例/你的 API）
  ensureHomeCharts();
  ensureCoinChart();
  renderPriceAndPredict();
  renderImportancesAndFeatures();
  confusionMatrixAndMetrics();

  applyHashRoute();          // 根據目前 hash 顯示正確頁
}
$("#themeToggle").addEventListener('click', () => {
  const now = document.body.getAttribute('data-theme');
  const next = now === 'light' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', next);
  $("#themeLabel").textContent = next === 'light' ? '白' : '黑';
  // 依目前分頁重繪
  if (state.currentTab === 'home') {
    renderPriceAndPredict(); renderImportancesAndFeatures(); confusionMatrixAndMetrics();
  } else if (COINS.includes(state.currentTab)) {
    loadCoinHistory(state.currentTab).then(d => renderCoin(state.currentTab, d));
  }
});
main();
