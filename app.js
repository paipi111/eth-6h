// ====== 基本設定（把 Supabase 寫在程式裡；只放 anon key！） ======
const SUPABASE_URL = "https://iwvvlhpfffflnwdsdwqs.supabase.co";        // ← 換你的
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3dnZsaHBmZmZmbG53ZHNkd3FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzNDAxMDEsImV4cCI6MjA2NzkxNjEwMX0.uxFt3jCbQXlVNtGKeOr6Vdxb1tWMiYd8N-LfugsMiwU"; // ← 換你的 anon key
const PRICES_TABLE  = "prices_daily"; // 你提供的每日資料表
// 指標（圖一）若你的後端也有就改這些名稱；否則本程式會以前端計算的對應值來畫
const INDICATORS_TABLE = null; // 例如 "indicators_daily"；若為 null 就前端計算

// ====== 共用 ======
const $ = (s)=>document.querySelector(s);
const COINS = ["HOME","BTC","ETH","XRP","DOGE","BNB","ADA"]; // 沒有 SOL
const state = {
  theme: "light",
  charts: {},
  route: "HOME",
  ohlc: [],          // 當前幣種 1d 價格
  ind: {},           // 當前幣種的各指標（前端算）
  sample: null,      // 假資料快取
  source: 'sample',  // 'supabase' | 'sample'
  pred: null         // 模型預測資料（sample 或你的 API 結果）
};

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

// ====== 路由 ======
function currentRoute(){
  const h = (location.hash || "#home").replace("#","").toUpperCase();
  return COINS.includes(h) ? h : "HOME";
}
window.addEventListener('hashchange', main);

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
    state.sample = await fetchJSON("./data/daily_sample.json");
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

// ====== 模型預測（先用 sample，可換成你的 API） ======
async function loadPredSample(){
  if (state.pred) return state.pred;
  // 你可以把這裡改為 fetch(你的API)
  // 預期格式：{ y_pred: 4253.94, horizon_hours: 6, ci: [0.010, 0.0234], features: {...}, importances:[...], model:{...} }
  state.pred = await fetchJSON("./data/predict_sample.json").catch(()=> ({}));
  return state.pred;
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

// ====== 畫圖 ======
function mount(id){ return echarts.init(document.getElementById(id)); }
function optBase(x, yname=''){
  const C = themeColors();
  return {
    backgroundColor:'transparent',
    textStyle:{ color:C.fg }, legend:{ top:0 },
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
  state.charts.k.setOption({
    backgroundColor:'transparent', textStyle:{ color:C.fg },
    grid:{ left:50,right:20,top:10,bottom:40 },
    xAxis:{ type:'category', data:x, axisLabel:{ color:C.muted } },
    yAxis:{ scale:true, axisLabel:{ color:C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    dataZoom:[{type:'inside'},{type:'slider', textStyle:{ color:C.muted }}],
    tooltip: tipStyle('axis'),
    series:[{ type:'candlestick', name:`${coin} 1D`, data:k,
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

  // ===== 右側：y_pred / API 狀態 / 預測摘要 =====
  (() => {
    const last = rows.at(-1)?.c ?? NaN;

    // 取得 y_pred：可由 sample 或你的 API
    let yPred = null;
    if (state.pred && typeof state.pred.y_pred === 'number') {
      yPred = state.pred.y_pred;
    } else if (coin === 'ETH') {
      yPred = 4253.94; // 題主暫定值
    }

    // 顯示 y_pred
    const yEl = document.getElementById('yPred');
    if (yEl) yEl.textContent = (typeof yPred === 'number') ? yPred.toFixed(2) : '—';

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

    // 預測摘要
    const predBox = document.getElementById('predSummary');
    if (predBox) {
      const h = state.pred?.horizon_hours ?? 6;
      const ci = state.pred?.ci || [0.010, 0.0234]; // 以比例表示（1%~2.34%）
      let text;
      if (Number.isFinite(last) && Number.isFinite(yPred)) {
        const pct = (yPred / last - 1) * 100;
        const ciLow = (ci[0] * 100).toFixed(2);
        const ciHigh = (ci[1] * 100).toFixed(2);
        const dir = pct >= 0 ? '上漲' : '下跌';
        text = `未來 ${h}h ${dir} ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%  (95% 信心區間 ${ciLow}% ~ ${ciHigh}%)`;
      } else {
        text = `未來 6h 上漲 +1.67% (95%信心區間 1.0%~2.34%)`;
      }
      predBox.textContent = text;
    }
  })();
}

// ====== 首頁：模型資訊（沿用 sample） ======
async function renderHome(){
  const pred = await fetchJSON("./data/predict_sample.json").catch(()=>({}));
  const imp = (pred.importances||[]).slice().sort((a,b)=>b[1]-a[1]);
  const C = themeColors();

  // 重要度
  if(!state.charts.imp) state.charts.imp = echarts.init(document.getElementById('impChart'));
  state.charts.imp.setOption({
    backgroundColor:'transparent',
    textStyle:{ color:C.fg },
    grid:{ left: 80, right: 20, top: 20, bottom: 30 },
    xAxis:{ type:'value', axisLabel:{ color:C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    yAxis:{ type:'category', data: imp.map(x=>x[0]), axisLabel:{ color:C.muted } },
    series:[{ type:'bar', data: imp.map(x=>x[1]), name:'重要度' }],
    tooltip: tipStyle('item')
  });

  // 特徵
  const grid = $("#featGrid"); grid.innerHTML="";
  Object.entries(pred.features||{}).forEach(([k,v])=>{
    const el=document.createElement('div');
    el.innerHTML = `<div class="muted">${k}</div><div class="mono" style="font-size:18px; font-weight:700;">${v}</div>`;
    grid.appendChild(el);
  });

  // 模型文字
  const m = pred.model||{};
  const txt = [
    `模型：${m.name||'—'} (${m.version||'—'})`,
    `訓練區間：${m.trained_window||'—'}`,
    `目標：${m.target||'—'}，損失：${m.loss||'—'}`,
    `指標：F1=${m.metrics?.f1 ?? '—'}, Precision=${m.metrics?.precision ?? '—'}, Recall=${m.metrics?.recall ?? '—'}, RMSE=${m.metrics?.rmse ?? '—'}, MAPE=${m.metrics?.mape ?? '—'}`,
    `超參數：`, JSON.stringify(m.hyperparams||{}, null, 2)
  ].join('\n');
  $("#modelInfo").textContent = txt;

  // 混淆矩陣（沿用）
  const back = await fetchJSON("./data/backtest_sample.json").catch(()=>({}));
  const rows = back.data||[]; let TP=0,TN=0,FP=0,FN=0;
  rows.forEach(r=>{
    const p=(r.pred_dir==='up'), a=(r.actual_dir==='up');
    if(p&&a)TP++; else if(!p&&!a)TN++; else if(p&&!a)FP++; else FN++;
  });
  const N=rows.length, acc=N?(TP+TN)/N:0, prec=(TP+FP)?TP/(TP+FP):0, rec=(TP+FN)?TP/(TP+FN):0;
  if(!state.charts.cm) state.charts.cm = echarts.init(document.getElementById('cmChart'));
  state.charts.cm.setOption({
    tooltip: Object.assign(tipStyle('item'), { position:'top' }),
    textStyle:{ color:C.fg },
    grid:{ left:80, right:20, top:40, bottom:20 },
    xAxis:{ type:'category', data:['預測↓ / 真實→','up','down'], show:false },
    yAxis:{ type:'category', data:['up','down'], axisLabel:{ color:C.muted } },
    visualMap:{ min:0, max:Math.max(1,TP+TN+FP+FN), calculable:false, orient:'horizontal', left:'center', bottom:0, textStyle:{ color:C.muted } },
    series:[{ type:'heatmap', data:[[1,0,TP],[2,0,FP],[1,1,FN],[2,1,TN]], label:{ show:true, color:C.fg } }]
  });
  $("#btMetrics").innerHTML = `
    <tr><th>樣本數 N</th><td class="mono">${N}</td></tr>
    <tr><th>Accuracy</th><td class="mono">${(acc*100).toFixed(1)}%</td></tr>
    <tr><th>Precision (上漲)</th><td class="mono">${(prec*100).toFixed(1)}%</td></tr>
    <tr><th>Recall (上漲)</th><td class="mono">${(rec*100).toFixed(1)}%</td></tr>
    <tr><th>F1</th><td class="mono">${(2*prec*rec/(prec+rec||1e-9)*100).toFixed(1)}%</td></tr>
  `;
}

// ====== 進入分頁 ======
async function enterCoin(coin){
  $("#route-home").style.display = "none";
  $("#route-coin").style.display = "";
  // 清空（避免殘影）
  Object.values(state.charts).forEach(ch=> ch && ch.clear());

  state.ohlc = await getOHLC(coin);
  state.ind  = buildIndicators(state.ohlc);
  await loadPredSample(); // 先載入預測（之後可改成依幣種打你的 API）
  renderCoinPage(coin, state.ohlc);
}
async function enterHome(){
  $("#route-coin").style.display = "none";
  $("#route-home").style.display = "";
  Object.values(state.charts).forEach(ch=> ch && ch.clear());
  state.charts = {};
  await renderHome();
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

// 啟動
main();
