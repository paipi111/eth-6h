const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(window.location.search);

const state = { history:null, predict:null, backtest:null, charts:{} };

// 讀取 CSS 變數
const getVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim() || "#e5e7eb";
function themeColors() {
  return {
    fg: getVar('--fg'),
    muted: getVar('--muted'),
    accent: getVar('--accent'),
    grid: 'rgba(148,163,184,.2)',
  };
}

function getApiBase() {
  const val = $("#apiBase") ? $("#apiBase").value.trim() : "";
  return val || ""; // 空的時候用範例資料
}

function fmtPct(x) { return (x>0?"+":"") + x.toFixed(2) + "%"; }
function fmtTs(ts) { try { return new Date(ts).toLocaleString(); } catch { return ts; } }

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

async function loadData() {
  const base = getApiBase();
  const useApi = !!base;
  if (useApi) {
    const [hist, pred, back] = await Promise.all([
      fetchJson(base + "/api/history?symbol=ETHUSDT&interval=6h&limit=200"),
      fetchJson(base + "/api/predict?symbol=ETHUSDT&horizon=6h"),
      fetchJson(base + "/api/backtest?symbol=ETHUSDT&horizon=6h&limit=200")
    ]);
    state.history = hist; state.predict = pred; state.backtest = back;
  } else {
    const [hist, pred, back] = await Promise.all([
      fetchJson("./data/history_6h_sample.json"),
      fetchJson("./data/predict_sample.json"),
      fetchJson("./data/backtest_sample.json")
    ]);
    state.history = hist; state.predict = pred; state.backtest = back;
  }
}

// ===== 指標資料（Supabase REST） =====
state.ind = null; // 指標 rows

function isSupabaseBase(url) { return /^https:\/\/[^/]+\.supabase\.co\/?$/.test(url); }

// 你實際的資料表名（例如 btc_6h / eth_6h）
const IND_TABLE = 'btc_6h';
const IND_FIELDS = [
  'ts', // 時間欄位
  'open_basis','close_basis','open_change','close_change',
  'whale_index_value','premium_rate',
  'ret_6h','ret_24h','log_ret_6h','log_ret_24h','atr14',
  // 圖二技術指標（建議後端算好）
  'ema6','ema24','ema56',
  'rsi14',
  'macd_dif','macd_dea','macd_hist',
  'k','d','j',
  'bb_upper','bb_middle','bb_lower','bbw'
];

async function loadIndicators() {
  const base = getApiBase();
  if (!isSupabaseBase(base)) { state.ind = null; return; }

  const url = `${base}/rest/v1/${IND_TABLE}?select=${IND_FIELDS.join(',')}&order=ts.asc&limit=1500`;
  const r = await fetch(url, { headers: { 'apikey': '<YOUR-ANON-KEY>', 'Authorization': 'Bearer <YOUR-ANON-KEY>' }});
  if (!r.ok) { console.warn('ind fetch failed', r.status); state.ind = null; return; }
  state.ind = await r.json(); // array of rows
}


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

function renderPriceAndPredict() {
  const hist = state.history?.data || [];
  const pred = state.predict || null;
  const categories = hist.map(d => d.t);
  const kdata = hist.map(d => [d.o, d.c, d.l, d.h]);
  let markLine = [], markArea = [];
  if (pred && hist.length) {
    const nextTs = pred.timestamp;
    const lastClose = hist[hist.length-1].c;
    const low = lastClose * (1 + pred.conf_interval_pct[0]/100.0);
    const high = lastClose * (1 + pred.conf_interval_pct[1]/100.0);
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
    tooltip: { trigger:'axis', textStyle:{ color:C.fg }, backgroundColor:'rgba(30,41,59,.9)', borderColor:C.grid },
    series: [
      { type:'candlestick', name:'ETH 6h', data: kdata,
        itemStyle: { color:'#ef4444', color0:'#10b981', borderColor:'#ef4444', borderColor0:'#10b981' },
        markArea: { data: markArea },
        markLine: { symbol:['none','none'], data: markLine, lineStyle:{ type:'dashed' }, label:{ show:true, color:C.fg } },
      }
    ]
  });

  if (pred) {
    $("#dir").textContent = (pred.direction === 'up' ? '▲ 上漲' : '▼ 下跌');
    $("#delta").textContent = fmtPct(pred.delta_pct);
    $("#conf").textContent = (pred.confidence*100).toFixed(0) + '%';
    $("#band").textContent = pred.conf_interval_pct.map(p=> (p>0?'+':'')+p.toFixed(2)+'%').join(' ~ ');
    $("#predTs").textContent = fmtTs(pred.timestamp);
  }
}

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
    tooltip:{ trigger:'axis', textStyle:{ color:C.fg }, backgroundColor:'rgba(30,41,59,.9)', borderColor:C.grid }
  };
}
function line(name,data,smooth=true){ return { type:'line', name, data, smooth, showSymbol:false }; }

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
    tooltip:{ textStyle:{ color:C.fg }, backgroundColor:'rgba(30,41,59,.9)', borderColor:C.grid }
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

function getInd(){ return Array.isArray(state.ind) ? state.ind : []; }
function X(){ return getInd().map(r => String(r.ts).slice(0,16).replace('T',' ')); }

function render_BASIS(){ const x=X(), rows=getInd();
  mount('chart-basis').setOption(Object.assign(optBase(x,'%'),{
    series:[
      line('BASIS_O', rows.map(r=>r.open_basis)),
      line('BASIS_C', rows.map(r=>r.close_basis)),
    ]
  }));
}
function render_BASIS_CHG(){ const x=X(), rows=getInd();
  mount('chart-basischg').setOption(Object.assign(optBase(x,'%'),{
    series:[
      line('BASIS_O_CHG%', rows.map(r=>r.open_change)),
      line('BASIS_C_CHG%', rows.map(r=>r.close_change)),
    ]
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
  mount('chart-returns').setOption(Object.assign(optBase(x,'%'),{
    series:[
      line('R6%', rows.map(r=>r.ret_6h)),
      line('R24%', rows.map(r=>r.ret_24h)),
    ]
  }));
}
function render_LOGRET(){ const x=X(), rows=getInd();
  mount('chart-logrets').setOption(Object.assign(optBase(x,''),{
    series:[
      line('LR6', rows.map(r=>r.log_ret_6h)),
      line('LR24', rows.map(r=>r.log_ret_24h)),
    ]
  }));
}
function render_ATR(){ const x=X(), rows=getInd();
  mount('chart-atr').setOption(Object.assign(optBase(x,''),{
    series:[ line('ATR14', rows.map(r=>r.atr14)) ]
  }));
}
function render_EMA(){ const x=X(), rows=getInd();
  mount('chart-ema').setOption(Object.assign(optBase(x,''),{
    series:[
      line('EMA6', rows.map(r=>r.ema6)),
      line('EMA24', rows.map(r=>r.ema24)),
      line('EMA56', rows.map(r=>r.ema56)),
    ]
  }));
}
function render_RSI(){ const x=X(), rows=getInd();
  const o = optBase(x,''); o.yAxis.min=0; o.yAxis.max=100;
  mount('chart-rsi').setOption(Object.assign(o,{
    series:[ line('RSI14', rows.map(r=>r.rsi14)) ]
  }));
}
function render_MACD(){ const x=X(), rows=getInd();
  mount('chart-macd').setOption(Object.assign(optBase(x,''),{
    series:[
      line('DIF', rows.map(r=>r.macd_dif)),
      line('DEA', rows.map(r=>r.macd_dea)),
      { type:'bar', name:'Hist', data: rows.map(r=>r.macd_hist), barWidth: 2 }
    ]
  }));
}
function render_KD(){ const x=X(), rows=getInd();
  const o = optBase(x,''); o.yAxis.min=0; o.yAxis.max=100;
  mount('chart-kd').setOption(Object.assign(o,{
    series:[
      line('K', rows.map(r=>r.k)),
      line('D', rows.map(r=>r.d)),
      line('J', rows.map(r=>r.j)),
    ]
  }));
}
function render_BOLL(){ const x=X(), rows=getInd();
  mount('chart-boll').setOption(Object.assign(optBase(x,''),{
    series:[
      line('BB Upper', rows.map(r=>r.bb_upper)),
      line('BB Middle', rows.map(r=>r.bb_middle)),
      line('BB Lower', rows.map(r=>r.bb_lower)),
      line('BBW(20,2)', rows.map(r=>r.bbw)),
    ]
  }));
}

// 一鍵渲染
function renderAllIndicators(){
  if (!getInd().length) return; // 沒填 Supabase 就略過
  render_BASIS(); render_BASIS_CHG(); render_WHALE(); render_CBPREM();
  render_RET(); render_LOGRET(); render_ATR();
  render_EMA(); render_RSI(); render_MACD(); render_KD(); render_BOLL();
}

function confusionMatrixAndMetrics() {
  const rows = (state.backtest?.data || []);
  const N = rows.length;
  let TP=0, TN=0, FP=0, FN=0;
  rows.forEach(r => {
    const p = (r.pred_dir === 'up');
    const a = (r.actual_dir === 'up');
    if (p && a) TP++;
    else if (!p && !a) TN++;
    else if (p && !a) FP++;
    else if (!p && a) FN++;
  });
  const acc = N ? (TP+TN)/N : 0;
  const prec = (TP+FP) ? TP/(TP+FP) : 0;
  const rec = (TP+FN) ? TP/(TP+FN) : 0;
  const f1 = (prec+rec) ? 2*prec*rec/(prec+rec) : 0;

  const C = themeColors();
  state.charts.cm.setOption({
    tooltip: { position: 'top', textStyle:{ color:C.fg }, backgroundColor:'rgba(30,41,59,.9)', borderColor:C.grid },
    textStyle:{ color: C.fg },
    grid: { left: 80, right: 20, top: 40, bottom: 20 },
    xAxis: { type: 'category', data: ['預測↓ / 真實→','up','down'], show: false },
    yAxis: { type: 'category', data: ['up','down'], axisLabel:{ color: C.muted }},
    visualMap: { min: 0, max: Math.max(1, TP+TN+FP+FN), calculable: false, orient: 'horizontal', left: 'center', bottom: 0,
                 textStyle:{ color: C.muted } },
    series: [{
      name: 'Confusion',
      type: 'heatmap',
      data: [
        [1,0,TP],[2,0,FP],
        [1,1,FN],[2,1,TN]
      ],
      label: { show: true, color: C.fg }
    }]
  });

  const tbl = $("#btMetrics");
  tbl.innerHTML = `
    <tr><th>樣本數 N</th><td class="mono">${N}</td></tr>
    <tr><th>Accuracy</th><td class="mono">${(acc*100).toFixed(1)}%</td></tr>
    <tr><th>Precision (上漲)</th><td class="mono">${(prec*100).toFixed(1)}%</td></tr>
    <tr><th>Recall (上漲)</th><td class="mono">${(rec*100).toFixed(1)}%</td></tr>
    <tr><th>F1</th><td class="mono">${(f1*100).toFixed(1)}%</td></tr>
  `;
}

async function main() {
  if (params.get('theme') === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    $("#themeLabel").textContent = '黑';
  }
  const bot = params.get('bot');
  if (bot) {
    $("#tgButton").href = `https://t.me/${bot}`;
  }
  await loadData();
  await loadIndicators();   // 新增：有 Supabase Base 才會生效
  ensureCharts();
  renderPriceAndPredict();
  renderImportancesAndFeatures();
  confusionMatrixAndMetrics();
  renderAllIndicators();    // 新增：畫指標
}

$("#refreshBtn").addEventListener('click', main);

$("#themeToggle").addEventListener('click', () => {
  const now = document.body.getAttribute('data-theme');
  const next = now === 'light' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', next);
  $("#themeLabel").textContent = next === 'light' ? '白' : '黑';
  renderPriceAndPredict();
  renderImportancesAndFeatures();
  confusionMatrixAndMetrics();
});

main();
