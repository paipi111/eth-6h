//////////////////////////
// 基本設定
//////////////////////////
const SUPABASE_URL = "https://iwvvlhpfffflnwdsdwqs.supabase.co";
const SUPABASE_ANON_KEY = "sb_secret_xGd3-DRXbCmz97AP8Keq7g_bk3QPwz9";
const TABLE_NAME = "eth_6h";     // ← 改成你的表
const TS_FIELD = "ts";           // ← 改成你的時間欄位（ISO字串或毫秒/秒）
const ROW_LIMIT = 1500;          // 拉回的資料筆數（可調）

// 建立 Supabase client（CDN 版本）
const supabase = supabase_js.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // :contentReference[oaicite:1]{index=1}

// 工具：平滑捲動
document.querySelectorAll('.toolbar .btn[data-target]').forEach(btn => {
  btn.addEventListener('click', () => {
    const el = document.querySelector(btn.dataset.target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); // :contentReference[oaicite:2]{index=2}
  });
});

// 主題切換
document.getElementById('themeBtn').addEventListener('click', () => {
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === 'light' ? 'dark' : 'light';
});

// 取圖表節點 → echarts instance
function mountChart(id) {
  const dom = document.getElementById(id);
  return echarts.init(dom, null, { renderer: 'canvas' });
}

// 封裝查詢：一次抓多欄，時間升序
async function fetchSeries(fields) {
  const columns = [TS_FIELD, ...fields];
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select(columns.join(','))
    .order(TS_FIELD, { ascending: true })
    .limit(ROW_LIMIT);

  if (error) { console.error(error); throw error; }

  // x 軸時間字串
  const x = data.map(d => {
    const v = d[TS_FIELD];
    if (typeof v === 'number') { // epoch
      return new Date(v * (v < 2e10 ? 1000 : 1)).toISOString().slice(0, 16).replace('T',' ');
    }
    return String(v).slice(0, 16).replace('T',' ');
  });

  // 各欄位的 series 值
  const seriesMap = {};
  for (const f of fields) seriesMap[f] = data.map(d => d[f]);

  return { x, seriesMap };
}

// 共用樣式
function line(name, data, smooth=true, area=false) {
  return {
    type: 'line',
    name, data, smooth,
    showSymbol: false,
    emphasis: { focus: 'series' },
    ...(area ? { areaStyle: {} } : {})
  };
}

function basicOption(x, yName="%") {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 16, top: 16, bottom: 32 },
    xAxis: { type: 'category', data: x, boundaryGap: false, axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'value', name: yName, axisLabel: { color: '#94a3b8' }, splitLine: { show: true } },
    legend: { top: 0 },
  };
}

//////////////////////////
// 繪圖（依你的欄位）
//////////////////////////

// 1) Overview（可接價格或你原本主圖）
async function renderOverview() {
  const chart = mountChart('chart-overview');
  // 若你有 close 價與 EMA，可一起畫；沒有就先畫空架構
  try {
    const FIELDS = ['close', 'ema6', 'ema24', 'ema56'];
    const { x, seriesMap } = await fetchSeries(FIELDS);
    const opt = basicOption(x, null);
    opt.yAxis.name = '';
    opt.series = [
      line('Close', seriesMap['close'], true),
      line('EMA6', seriesMap['ema6'], true),
      line('EMA24', seriesMap['ema24'], true),
      line('EMA56', seriesMap['ema56'], true),
    ];
    chart.setOption(opt, true);
  } catch (e) {
    chart.setOption({ title: { text: '主圖掛載點（等待資料）', left: 'center' } });
  }
}

// 2) BASIS_O / BASIS_C（年化）
async function renderBasis() {
  const chart = mountChart('chart-basis');
  const FIELDS = ['open_basis', 'close_basis']; // → 對應：BASIS_O / BASIS_C
  const { x, seriesMap } = await fetchSeries(FIELDS);
  const opt = basicOption(x, '%');
  opt.series = [
    line('BASIS_O', seriesMap['open_basis']),
    line('BASIS_C', seriesMap['close_basis']),
  ];
  chart.setOption(opt, true);
}

// 3) 基差變化率
async function renderBasisChg() {
  const chart = mountChart('chart-basischg');
  const FIELDS = ['open_change', 'close_change']; // → 對應：BASIS_O_CHG% / BASIS_C_CHG%
  const { x, seriesMap } = await fetchSeries(FIELDS);
  const opt = basicOption(x, '%');
  opt.series = [
    line('BASIS_O_CHG%', seriesMap['open_change']),
    line('BASIS_C_CHG%', seriesMap['close_change']),
  ];
  chart.setOption(opt, true);
}

// 4) 鯨魚指數
async function renderWhale() {
  const chart = mountChart('chart-whale');
  const FIELDS = ['whale_index_value']; // → WHALE
  const { x, seriesMap } = await fetchSeries(FIELDS);
  const opt = basicOption(x, '');
  opt.series = [ line('WHALE', seriesMap['whale_index_value'], true, true) ];
  chart.setOption(opt, true);
}

// 5) Coinbase 溢價率
async function renderCBPrem() {
  const chart = mountChart('chart-cbprem');
  const FIELDS = ['premium_rate']; // → CB_PREM%
  const { x, seriesMap } = await fetchSeries(FIELDS);
  const opt = basicOption(x, '%');
  opt.series = [ line('CB_PREM%', seriesMap['premium_rate'], false) ];
  chart.setOption(opt, true);
}

// 6) 報酬率（6h / 24h）
async function renderReturns() {
  const chart = mountChart('chart-returns');
  const FIELDS = ['ret_6h', 'ret_24h']; // → R6%, R24%
  const { x, seriesMap } = await fetchSeries(FIELDS);
  const opt = basicOption(x, '%');
  opt.series = [
    line('R6%', seriesMap['ret_6h']),
    line('R24%', seriesMap['ret_24h']),
  ];
  chart.setOption(opt, true);
}

// 7) 對數報酬（6h / 24h）
async function renderLogRets() {
  const chart = mountChart('chart-logrets');
  const FIELDS = ['log_ret_6h', 'log_ret_24h']; // → LR6, LR24
  const { x, seriesMap } = await fetchSeries(FIELDS);
  const opt = basicOption(x, '');
  opt.series = [
    line('LR6', seriesMap['log_ret_6h']),
    line('LR24', seriesMap['log_ret_24h']),
  ];
  chart.setOption(opt, true);
}

// 8) ATR14
async function renderATR() {
  const chart = mountChart('chart-atr');
  const FIELDS = ['atr14']; // → ATR14
  const { x, seriesMap } = await fetchSeries(FIELDS);
  const opt = basicOption(x, '');
  opt.series = [ line('ATR14', seriesMap['atr14']) ];
  chart.setOption(opt, true);
}

// 9) EMA(6/24/56)
async function renderEMA() {
  const chart = mountChart('chart-ema');
  const FIELDS = ['ema6','ema24','ema56'];
  const { x, seriesMap } = await fetchSeries(FIELDS);
  const opt = basicOption(x, '');
  opt.series = [
    line('EMA6', seriesMap['ema6']),
    line('EMA24', seriesMap['ema24']),
    line('EMA56', seriesMap['ema56']),
  ];
  chart.setOption(opt, true);
}

// 10) RSI(14)
async function renderRSI() {
  const chart = mountChart('chart-rsi');
  const FIELDS = ['rsi14'];
  const { x, seriesMap } = await fetchSeries(FIELDS);
  const opt = basicOption(x, '');
  opt.yAxis.min = 0; opt.yAxis.max = 100;
  opt.series = [ line('RSI14', seriesMap['rsi14']) ];
  chart.setOption(opt, true);
}

// 11) MACD(12,26,9)
async function renderMACD() {
  const chart = mountChart('chart-macd');
  const FIELDS = ['macd_dif','macd_dea','macd_hist']; // 後端算好
  const { x, seriesMap } = await fetchSeries(FIELDS);
  const opt = basicOption(x, '');
  opt.series = [
    line('DIF', seriesMap['macd_dif']),
    line('DEA', seriesMap['macd_dea']),
    { // 柱狀圖顯示 hist
      type: 'bar', name: 'Hist', data: seriesMap['macd_hist'],
      barWidth: 2
    }
  ];
  chart.setOption(opt, true);
}

// 12) KD(9,3,3)
async function renderKD() {
  const chart = mountChart('chart-kd');
  const FIELDS = ['k','d','j'];
  const { x, seriesMap } = await fetchSeries(FIELDS);
  const opt = basicOption(x, '');
  opt.yAxis.min = 0; opt.yAxis.max = 100;
  opt.series = [
    line('K', seriesMap['k']),
    line('D', seriesMap['d']),
    line('J', seriesMap['j'])
  ];
  chart.setOption(opt, true);
}

// 13) Boll(20,2) / BBW
async function renderBoll() {
  const chart = mountChart('chart-boll');
  const FIELDS = ['bb_upper','bb_middle','bb_lower','bbw'];
  const { x, seriesMap } = await fetchSeries(FIELDS);
  const opt = basicOption(x, '');
  opt.series = [
    line('BB Upper', seriesMap['bb_upper']),
    line('BB Middle', seriesMap['bb_middle']),
    line('BB Lower', seriesMap['bb_lower']),
    line('BBW(20,2)', seriesMap['bbw'])
  ];
  chart.setOption(opt, true);
}

// 啟動：依序繪製
(async function bootstrap(){
  await renderOverview();
  await renderBasis();
  await renderBasisChg();
  await renderWhale();
  await renderCBPrem();
  await renderReturns();
  await renderLogRets();
  await renderATR();
  await renderEMA();
  await renderRSI();
  await renderMACD();
  await renderKD();
  await renderBoll();
})();
