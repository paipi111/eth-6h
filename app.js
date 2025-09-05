// === Supabase 設定（在前端常數中設定；請只放 anon key） ===
const SUPABASE_URL = "https://iwvvlhpfffflnwdsdwqs.supabase.co";   // ← 換成你的
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3dnZsaHBmZmZmbG53ZHNkd3FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzNDAxMDEsImV4cCI6MjA2NzkxNjEwMX0.uxFt3jCbQXlVNtGKeOr6Vdxb1tWMiYd8N-LfugsMiwU";                       // ← 換成你的 anon key（只讀）
// 指標表與欄位
const IND_TABLE = "lake";  // 或你實際表名 / view 名稱
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

const state = { history:null, predict:null, backtest:null, charts:{}, ind:null };

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

// 讀 API Base（你原本的行為）
function getApiBase() {
  const val = $("#apiBase") ? $("#apiBase").value.trim() : "";
  return val || ""; // 空的時候用範例資料
}

// Supabase 讀取設定（從抬頭右上輸入框）
function getSbCfg() {
  const url = ($("#sbUrl")?.value || "").trim().replace(/\/$/, "");
  const key = ($("#sbKey")?.value || "").trim();
  return { url, key };
}

function fmtPct(x) { return (x>0?"+":"") + x.toFixed(2) + "%"; }
function fmtTs(ts) { try { return new Date(ts).toLocaleString(); } catch { return ts; } }

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

// ===== 讀主資料（歷史 / 預測 / 回測） =====
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

async function loadIndicators() {
  if (!SUPABASE_URL || !SUPABASE_KEY) { state.ind = null; return; }

  const q = IND_FIELDS.join(",");
  const endpoint = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${IND_TABLE}`
                 + `?select=${encodeURIComponent(q)}&order=ts.asc&limit=1500`;

  const r = await fetch(endpoint, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });
  if (!r.ok) {
    console.warn("ind fetch failed", r.status, await r.text());
    state.ind = null;
    return;
  }
  state.ind = await r.json();
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
    tooltip:{ trigger:'axis', textStyle:{ color:C.fg }, backgroundColor:'rgba(30,41,59,.9)', borderColor:C.grid }
  };
}
function line(name,data,smooth=true){ return { type:'line', name, data, smooth, showSymbol:false }; }

function getInd(){ return Array.isArray(state.ind) ? state.ind : []; }
function X(){ return getInd().map(r => String(r.ts).slice(0,16).replace('T',' ')); }

// ===== 13 張指標圖 =====
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
  mount('chart-returns').setOption(Object.assign(optBase(x,'%'),{
    series:[ line('R6%', rows.map(r=>r.ret_6h)), line('R24%', rows.map(r=>r.ret_24h)) ]
  }));
}
function render_LOGRET(){ const x=X(), rows=getInd();
  mount('chart-logrets').setOption(Object.assign(optBase(x,''),{
    series:[ line('LR6', rows.map(r=>r.log_ret_6h)), line('LR24', rows.map(r=>r.log_ret_24h)) ]
  }));
}
function render_ATR(){ const x=X(), rows=getInd();
  mount('chart-atr').setOption(Object.assign(optBase(x,''),{
    series:[ line('ATR14', rows.map(r=>r.atr14)) ]
  }));
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
  if (!getInd().length) return; // 沒填 Supabase 就略過
  render_BASIS(); render_BASIS_CHG(); render_WHALE(); render_CBPREM();
  render_RET(); render_LOGRET(); render_ATR();
  render_EMA(); render_RSI(); render_MACD(); render_KD(); render_BOLL();
}

// ===== 混淆矩陣與指標 =====
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

// ===== 主流程 =====
async function main() {
  if (params.get('theme') === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    $("#themeLabel").textContent = '黑';
  }
  const bot = params.get('bot');
  if (bot) { $("#tgButton").href = `https://t.me/${bot}`; }

  await loadData();
  await loadIndicators(); // 若填了 SB 設定就抓指標
  ensureCharts();
  renderPriceAndPredict();
  renderImportancesAndFeatures();
  confusionMatrixAndMetrics();
  renderAllIndicators();
}

// 綁定：主題切換（保留你原本的樣式刷新序列）
$("#themeToggle").addEventListener('click', () => {
  const now = document.body.getAttribute('data-theme');
  const next = now === 'light' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', next);
  $("#themeLabel").textContent = next === 'light' ? '白' : '黑';
  renderPriceAndPredict();
  renderImportancesAndFeatures();
  confusionMatrixAndMetrics();
});

// 初始化
main();
