// app.js — ETH 6h 首頁版
// --------------------------------------------------
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

// 全域狀態
const state = { history: null, predict: null, backtest: null, charts: {} };

// 讀 CSS 變數 → 主題色
const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function themeColors() {
  return {
    fg: cssVar('--fg') || '#e5e7eb',
    muted: cssVar('--muted') || '#94a3b8',
    accent: cssVar('--accent') || '#60a5fa',
    grid: 'rgba(148,163,184,.2)',
  };
}

// 取得 API Base（留空就吃本地 sample）
function getApiBase() {
  const el = $('#apiBase');
  return el ? (el.value || '').trim() : '';
}

// 小工具
const fmtPct = (x) => (isFinite(x) ? ((x > 0 ? '+' : '') + x.toFixed(2) + '%') : '—');
const fmtTs = (ts) => {
  try { return new Date(ts).toLocaleString(); } catch { return ts || '—'; }
};
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// 載資料（有 API 用 API；否則讀 /data/xxx_sample.json）
async function loadData() {
  const base = getApiBase().replace(/\/$/, '');
  if (base) {
    const [hist, pred, back] = await Promise.all([
      fetchJson(`${base}/api/history?symbol=ETHUSDT&interval=6h&limit=200`),
      fetchJson(`${base}/api/predict?symbol=ETHUSDT&horizon=6h`),
      fetchJson(`${base}/api/backtest?symbol=ETHUSDT&horizon=6h&limit=200`),
    ]);
    state.history = hist;
    state.predict = pred;
    state.backtest = back;
  } else {
    const [hist, pred, back] = await Promise.all([
      fetchJson('./data/history_6h_sample.json'),
      fetchJson('./data/predict_sample.json'),
      fetchJson('./data/backtest_sample.json'),
    ]);
    state.history = hist;
    state.predict = pred;
    state.backtest = back;
  }
}

// 初始化/確保 ECharts 物件存在
function ensureCharts() {
  if (!state.charts.price && $('#chart')) {
    state.charts.price = echarts.init($('#chart'));
    addEventListener('resize', () => state.charts.price && state.charts.price.resize());
  }
  if (!state.charts.imp && $('#impChart')) {
    state.charts.imp = echarts.init($('#impChart'));
    addEventListener('resize', () => state.charts.imp && state.charts.imp.resize());
  }
  if (!state.charts.cm && $('#cmChart')) {
    state.charts.cm = echarts.init($('#cmChart'));
    addEventListener('resize', () => state.charts.cm && state.charts.cm.resize());
  }
}

// 主圖（K 線 + 下一根預測/區間）
function renderPriceAndPredict() {
  if (!state.charts.price || !state.history) return;
  const C = themeColors();

  const rows = state.history.data || state.history || [];
  const x = rows.map(d => d.t);
  // 按 echarts K 線順序：[open, close, low, high]
  const k = rows.map(d => [d.o, d.c, d.l, d.h]);

  // 可能存在的預測資訊
  const p = state.predict || {};
  const lastClose = rows.length ? rows[rows.length - 1].c : undefined;
  let markArea = [], markLine = [];

  // 嘗試從各種欄位讀取：方向、信心、區間（百分比）
  const dir = (p.direction || p.dir || (p.delta_pct >= 0 ? 'up' : 'down')) || '—';
  const deltaPct = Number(
    p.delta_pct ??
    p.delta ??
    (typeof p.y_pred_pct === 'number' ? p.y_pred_pct : NaN)
  );
  const conf = Number(p.confidence ?? p.conf ?? NaN);
  const tsNext = p.timestamp || p.ts_next;

  if (tsNext && isFinite(lastClose)) {
    // 信賴區間：百分比上下界（例如 [-1.0, +2.3]）
    const bandPct = p.conf_interval_pct || p.band_pct || p.conf_band || [NaN, NaN];
    const yPred = Number(p.y_pred ?? (isFinite(deltaPct) ? lastClose * (1 + deltaPct / 100) : NaN));
    const yLow = isFinite(bandPct[0]) ? lastClose * (1 + bandPct[0] / 100) : NaN;
    const yHigh = isFinite(bandPct[1]) ? lastClose * (1 + bandPct[1] / 100) : NaN;

    markArea = [[{ xAxis: tsNext, itemStyle: { color: 'rgba(37,99,235,.08)' } }, { xAxis: tsNext }]];
    markLine = [
      ...(isFinite(yPred) ? [{ name: '預測價格', xAxis: tsNext, yAxis: yPred }] : []),
      ...(isFinite(yLow) ? [{ name: '區間低', xAxis: tsNext, yAxis: yLow }] : []),
      ...(isFinite(yHigh) ? [{ name: '區間高', xAxis: tsNext, yAxis: yHigh }] : []),
    ];
  }

  state.charts.price.setOption({
    backgroundColor: 'transparent',
    textStyle: { color: C.fg },
    grid: { left: 50, right: 20, top: 10, bottom: 40 },
    xAxis: { type: 'category', data: x, axisLabel: { color: C.muted } },
    yAxis: { scale: true, axisLabel: { color: C.muted }, splitLine: { lineStyle: { color: C.grid } } },
    dataZoom: [{ type: 'inside' }, { type: 'slider', textStyle: { color: C.muted } }],
    tooltip: { trigger: 'axis', textStyle: { color: C.fg }, backgroundColor: 'rgba(30,41,59,.9)', borderColor: C.grid },
    series: [{
      type: 'candlestick',
      name: 'ETH 6h',
      data: k,
      itemStyle: { color: '#ef4444', color0: '#10b981', borderColor: '#ef4444', borderColor0: '#10b981' },
      markArea: { data: markArea },
      markLine: { symbol: ['none', 'none'], data: markLine, lineStyle: { type: 'dashed' }, label: { show: true, color: C.fg } },
    }],
  });

  // KPI 卡片（存在才填）
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setText('#dir', dir === 'up' ? '▲ 上漲' : (dir === 'down' ? '▼ 下跌' : '—'));
  setText('#delta', isFinite(deltaPct) ? fmtPct(deltaPct) : '—');
  setText('#conf', isFinite(conf) ? Math.round(conf) + '%' : '—');

  const bandPct = (state.predict && (state.predict.conf_interval_pct || state.predict.band_pct)) || null;
  setText('#band', bandPct && isFinite(bandPct[0]) && isFinite(bandPct[1])
    ? `${fmtPct(bandPct[0])} ~ ${fmtPct(bandPct[1])}` : '—');

  setText('#predTs', fmtTs(tsNext));

  // Telegram Bot（可用 URL 參數 ?bot=YOUR_BOT_USERNAME 覆寫）
  const bot = params.get('bot');
  const tgBtn = $('#tgButton');
  if (tgBtn) tgBtn.href = `https://t.me/${bot || 'eth6h_predict_bot'}`;
}

// 特徵重要度 + 目前特徵值
function renderImportancesAndFeatures() {
  const C = themeColors();
  const pred = state.predict || {};

  // 重要度資料的容錯抓取
  const importance =
    pred.feature_importance ||
    pred.features_importance ||
    pred.importance ||
    pred.model?.importance ||
    {};

  const entries = Array.isArray(importance)
    ? importance.map(([k, v]) => [k, Number(v)])
    : Object.entries(importance).map(([k, v]) => [k, Number(v)]);

  // 排序、只取前 12
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 12);
  if (state.charts.imp && top.length) {
    state.charts.imp.setOption({
      backgroundColor: 'transparent',
      textStyle: { color: C.fg },
      grid: { left: 100, right: 20, top: 10, bottom: 40 },
      xAxis: { type: 'value', axisLabel: { color: C.muted }, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'category', data: top.map(([k]) => k), axisLabel: { color: C.muted } },
      series: [{ type: 'bar', data: top.map(([, v]) => v), itemStyle: { color: C.accent } }],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(30,41,59,.9)', borderColor: C.grid, textStyle: { color: C.fg } },
    });
  }

  // 最新特徵值（若有）
  const featBox = $('#featGrid');
  if (featBox) {
    featBox.innerHTML = '';
    const feats =
      pred.features ||
      pred.latest_features ||
      pred.model_features ||
      {};
    Object.entries(feats).forEach(([k, v]) => {
      const div = document.createElement('div');
      div.innerHTML = `<div class="muted">${k}</div><div class="mono" style="font-size:18px;font-weight:700;">${v}</div>`;
      featBox.appendChild(div);
    });
  }

  // 模型資訊（若有）
  const info = $('#modelInfo');
  if (info) {
    const m = pred.model || {};
    const text = [
      `模型：${m.name || '—'}${m.version ? ` (${m.version})` : ''}`,
      `訓練區間：${m.trained_window || '—'}`,
      `目標：${m.target || '—'}，損失：${m.loss || '—'}`,
      `指標：F1=${m.metrics?.f1 ?? '—'}, Precision=${m.metrics?.precision ?? '—'}, Recall=${m.metrics?.recall ?? '—'}, RMSE=${m.metrics?.rmse ?? '—'}, MAPE=${m.metrics?.mape ?? '—'}`,
      `超參數：`,
      JSON.stringify(m.hyperparams || {}, null, 2),
    ].join('\n');
    info.textContent = text;
  }
}

// 回測：混淆矩陣 + 指標表
function renderBacktest() {
  if (!state.charts.cm || !state.backtest) return;
  const C = themeColors();

  const rows = state.backtest.data || state.backtest || [];
  let TP = 0, TN = 0, FP = 0, FN = 0;
  rows.forEach((r) => {
    const p = r.pred_dir === 'up' || r.pred === 'up' || r.pred === 1;
    const a = r.actual_dir === 'up' || r.actual === 'up' || r.actual === 1;
    if (p && a) TP++;
    else if (!p && !a) TN++;
    else if (p && !a) FP++;
    else if (!p && a) FN++;
  });
  const N = rows.length;
  const acc = N ? (TP + TN) / N : 0;
  const prec = TP + FP ? TP / (TP + FP) : 0;
  const rec = TP + FN ? TP / (TP + FN) : 0;
  const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;

  state.charts.cm.setOption({
    backgroundColor: 'transparent',
    textStyle: { color: C.fg },
    grid: { left: 80, right: 20, top: 40, bottom: 20 },
    xAxis: { type: 'category', data: ['預測↓ / 真實→', 'up', 'down'], show: false },
    yAxis: { type: 'category', data: ['up', 'down'], axisLabel: { color: C.muted } },
    visualMap: {
      min: 0, max: Math.max(1, TP + TN + FP + FN),
      orient: 'horizontal', left: 'center', bottom: 0,
      textStyle: { color: C.muted }, calculable: false,
    },
    tooltip: { position: 'top', textStyle: { color: C.fg }, backgroundColor: 'rgba(30,41,59,.9)', borderColor: C.grid },
    series: [{
      type: 'heatmap',
      data: [
        [1, 0, TP], [2, 0, FP],
        [1, 1, FN], [2, 1, TN],
      ],
      label: { show: true, color: C.fg },
    }],
  });

  const tbl = $('#btMetrics');
  if (tbl) {
    tbl.innerHTML = `
      <tr><th>樣本數 N</th><td class="mono">${N}</td></tr>
      <tr><th>Accuracy</th><td class="mono">${(acc * 100).toFixed(1)}%</td></tr>
      <tr><th>Precision (上漲)</th><td class="mono">${(prec * 100).toFixed(1)}%</td></tr>
      <tr><th>Recall (上漲)</th><td class="mono">${(rec * 100).toFixed(1)}%</td></tr>
      <tr><th>F1</th><td class="mono">${(f1 * 100).toFixed(1)}%</td></tr>
    `;
  }
}

// 入口：載入→作圖
async function main() {
  // URL ?theme=dark 支援
  const theme = params.get('theme');
  if (theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const label = $('#themeLabel');
    if (label) label.textContent = theme === 'light' ? '白' : '黑';
  }

  // URL ?bot=YOUR_BOT_USERNAME 支援（在 renderPriceAndPredict 裡套用）
  await loadData();
  ensureCharts();
  renderPriceAndPredict();
  renderImportancesAndFeatures();
  renderBacktest();
}

// 事件
const refresh = $('#refreshBtn');
if (refresh) refresh.addEventListener('click', main);

const themeBtn = $('#themeToggle');
if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme') || 'light';
    const next = now === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    const label = $('#themeLabel');
    if (label) label.textContent = next === 'light' ? '白' : '黑';
    // 重新渲染以套入新主題字色
    renderPriceAndPredict();
    renderImportancesAndFeatures();
    renderBacktest();
  });
}

main().catch(console.error);
