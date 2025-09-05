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

// ===== 指標資料（Supabase REST） =====
const IND_TABLE = 'btc_6h'; // 依你的實際表名調整
const IND_FIELDS = [
  'ts',
  'open_basis','close_basis','open_change','close_change',
  'whale_index_value','premium_rate',
  'ret_6h','ret_24h','log_ret_6h','log_ret_24h','atr14',
  'ema6','ema24','ema56',
  'rsi14',
  'macd_dif','macd_dea','macd_hist',
  'k','d','j',
  'bb_upper','bb_middle','bb_lower','bbw'
];

async function loadIndicators() {
  const { url, key } = getSbCfg();
  if (!url || !key) { state.ind = null; return; } // 沒填就跳過

  const q = IND_FIELDS.join(',');
  const endpoint = `${url}/rest/v1/${IND_TABLE}?select=${q}&order=ts.asc&limit=1500`;
  const r = await fetch(endpoint, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) { console.warn('ind fetch failed', r.status); state.ind = null; return; }
  state.ind = await r.json(); // array
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
function render_RET(){ const_
