const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const params = new URLSearchParams(window.location.search);

const state = { history:null, predict:null, backtest:null, charts:{}, activeTab:'price' };

function getApiBase() {
  const val = $("#apiBase").value.trim();
  return val || ""; // empty means use local samples
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
  state.charts.price.setOption({
    backgroundColor: 'transparent',
    animation: true,
    grid: { left: 50, right: 20, top: 10, bottom: 40 },
    xAxis: { type:'category', data: categories, axisLabel:{ color: 'var(--muted)' } },
    yAxis: { scale: true, axisLabel:{ color: 'var(--muted)' }, splitLine:{ lineStyle:{ color:'rgba(148,163,184,.2)'} } },
    dataZoom: [{ type:'inside' }, { type:'slider' }],
    series: [
      { type:'candlestick', name:'ETH 6h', data: kdata,
        itemStyle: { color:'#ef4444', color0:'#10b981', borderColor:'#ef4444', borderColor0:'#10b981' },
        markArea: { data: markArea },
        markLine: { symbol:['none','none'], data: markLine, lineStyle:{ type:'dashed' } },
      }
    ],
    tooltip: { trigger:'axis' }
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
  state.charts.imp.setOption({
    backgroundColor:'transparent',
    grid:{ left: 80, right: 20, top: 20, bottom: 30 },
    xAxis:{ type:'value', axisLabel:{ color:'var(--muted)'} },
    yAxis:{ type:'category', data: impNames, axisLabel:{ color:'var(--muted)' } },
    series:[{ type:'bar', data: impVals, name:'重要度' }],
    tooltip:{}
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

  state.charts.cm.setOption({
    tooltip: { position: 'top' },
    grid: { left: 80, right: 20, top: 40, bottom: 20 },
    xAxis: { type: 'category', data: ['預測↓ / 真實→','up','down'], show: false },
    yAxis: { type: 'category', data: ['up','down'], axisLabel:{ color:'var(--muted)' }},
    visualMap: { min: 0, max: Math.max(1, TP+TN+FP+FN), calculable: false, orient: 'horizontal', left: 'center', bottom: 0 },
    series: [{
      name: 'Confusion', type: 'heatmap',
      data: [ [1,0,TP],[2,0,FP], [1,1,FN],[2,1,TN] ],
      label: { show: true }
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

function switchTab(tabKey){
  state.activeTab = tabKey;
  // navbar
  $$(".tab").forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabKey));
  // pages
  ["price","imp","feat","model","bt"].forEach(k => {
    const el = document.getElementById(`page-${k}`);
    el.classList.toggle('active', k === tabKey);
  });
  // fix chart sizing when revealing a hidden canvas
  if (tabKey === 'price' && state.charts.price) state.charts.price.resize();
  if (tabKey === 'imp' && state.charts.imp) state.charts.imp.resize();
  if (tabKey === 'bt' && state.charts.cm) state.charts.cm.resize();
}

async function main() {
  if (params.get('theme') === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    $("#themeLabel").textContent = '黑';
  }
  const bot = params.get('bot');
  if (bot) $("#tgButton").href = `https://t.me/${bot}`;

  await loadData();
  ensureCharts();
  renderPriceAndPredict();
  renderImportancesAndFeatures();
  confusionMatrixAndMetrics();
}

// events
$("#refreshBtn").addEventListener('click', main);
$("#themeToggle").addEventListener('click', () => {
  const now = document.body.getAttribute('data-theme');
  const next = now === 'light' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', next);
  $("#themeLabel").textContent = next === 'light' ? '白' : '黑';
});

// tab click
$$(".tab").forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

main();