// ====== Supabase 設定（只放 anon key） ======
const SUPABASE_URL = "https://iwvvlhpfffflnwdsdwqs.supabase.co"; // 改成你的
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3dnZsaHBmZmZmbG53ZHNkd3FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzNDAxMDEsImV4cCI6MjA2NzkxNjEwMX0.uxFt3jCbQXlVNtGKeOr6Vdxb1tWMiYd8N-LfugsMiwU";
const PRICES_TABLE = "prices_daily"; // 日K表

// ====== 共用 ======
const $ = (s) => document.querySelector(s);
const COINS = ["HOME","BTC","ETH","XRP","DOGE","BNB","ADA"];
const SYMBOL_MAP = { BTC:"BTC", ETH:"ETH", XRP:"XRP", DOGE:"DOGE", BNB:"BNB", ADA:"ADA" };

const state = {
  route: "HOME",
  theme: "light",
  charts: {},
  source: "sample", // 'supabase' | 'sample'
  ohlc: [],
  ind: {},
  pred: null,
};

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

function currentRoute(){
  const h = (location.hash || "#home").replace("#","").toUpperCase();
  return COINS.includes(h) ? h : "HOME";
}
window.addEventListener('hashchange', main);

// ====== 讀資料 ======
async function fetchJSON(url, opts){
  const r = await fetch(url, opts);
  if(!r.ok){ const t = await r.text().catch(()=>String(r.status)); throw new Error(`Fetch ${url} -> ${r.status}: ${t}`); }
  return r.json();
}

function tsToISODate(ts){
  const n = Number(ts);
  const ms = n < 1e12 ? n*1000 : n; // 兼容秒/毫秒
  return new Date(ms).toISOString().slice(0,10);
}

async function fetchPricesFromSB(coin){
  if(!SUPABASE_URL || !SUPABASE_KEY) return null;
  const base = SUPABASE_URL.replace(/\/$/, '');
  const pageSize = 1000;
  const sym = SYMBOL_MAP[coin] || coin;
  let lastTs = -1, all = [];

  while(true){
    const q = new URLSearchParams({
      select: 'ts_utc,open,high,low,close,volume',
      coin: `eq.${sym}`,
      'ts_utc': `gt.${lastTs}`,
      order: 'ts_utc.asc',
      limit: String(pageSize),
    });
    const url = `${base}/rest/v1/${PRICES_TABLE}?${q.toString()}`;
    const rows = await fetchJSON(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    }).catch(()=>[]);
    if(!rows.length) break;
    all = all.concat(rows);
    lastTs = rows[rows.length-1].ts_utc;
    if(rows.length < pageSize) break;
  }
  if(!all.length) return null;

  return all.map(r=>({
    t: tsToISODate(r.ts_utc),
    o:+r.open, h:+r.high, l:+r.low, c:+r.close, v:+r.volume
  }));
}

// 將 6h K sample 聚合成日K（避免沒有 daily_sample.json 時整頁空白）
function toDailyFrom6h(sample6h){
  const byDay = new Map();
  (sample6h?.data||[]).forEach(k=>{
    const d = k.t.slice(0,10);
    if(!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(k);
  });
  const out = [];
  for(const [d, arr] of byDay){
    const o = arr[0].o;
    const c = arr[arr.length-1].c;
    const h = Math.max(...arr.map(x=>x.h));
    const l = Math.min(...arr.map(x=>x.l));
    const v = arr.reduce((s,x)=>s+Number(x.v||0),0);
    out.push({ t:d, o,h,l,c,v });
  }
  out.sort((a,b)=> a.t < b.t ? -1 : 1);
  return out;
}

async function loadSampleDaily(){
  // 優先嘗試 /data/daily_sample.json
  const daily = await fetchJSON("./data/daily_sample.json").catch(()=>null);
  if(daily) return daily;

  // 退而求其次：用 6h sample 聚合出 ETH 的日K
  const h6 = await fetchJSON("./data/history_6h_sample.json").catch(()=>null);
  if(!h6) return {};
  return { ETH: toDailyFrom6h(h6) };
}

async function getOHLC(coin){
  // 1) 先試 Supabase
  const sb = await fetchPricesFromSB(coin);
  if(Array.isArray(sb) && sb.length){
    state.source = 'supabase';
    return sb;
  }
  // 2) fallback：sample
  const sample = await loadSampleDaily();
  state.source = 'sample';
  return (sample[coin] || sample[coin?.toUpperCase()] || sample.ETH || []).map(r=>({...r}));
}

// ====== 模型預測（sample） ======
async function loadPred(){
  if(state.pred) return state.pred;
  state.pred = await fetchJSON("./data/predict_sample.json").catch(()=>({}));
  return state.pred;
}

// ====== 指標計算 ======
function ema(arr, n){ const k=2/(n+1); const out=[]; let p=null; for(let i=0;i<arr.length;i++){ const v=arr[i]; p=(p===null)?v:(v*k+p*(1-k)); out.push(p); } return out; }
function sma(arr, n){ const out=[], q=[]; let s=0; for(let i=0;i<arr.length;i++){ q.push(arr[i]); s+=arr[i]; if(q.length>n) s-=q.shift(); out.push(q.length===n? s/n : NaN); } return out; }
function rsi(arr,n=14){ const out=[]; let g=0, l=0; for(let i=1;i<arr.length;i++){ const ch=arr[i]-arr[i-1], up=ch>0?ch:0, dn=ch<0?-ch:0; if(i<=n){ g+=up; l+=dn; out.push(NaN); continue; } if(i===n+1){ const rs=(g/n)/((l/n)||1e-9); out.push(100-100/(1+rs)); } else { g=(g*(n-1)+up)/n; l=(l*(n-1)+dn)/n; const rs=g/(l||1e-9); out.push(100-100/(1+rs)); } } out.unshift(NaN); return out; }
function macd(arr, fast=12, slow=26, sig=9){ const ef=ema(arr,fast), es=ema(arr,slow); const dif=ef.map((v,i)=>v-es[i]); const dea=ema(dif.map(v=>isFinite(v)?v:0), sig); const hist=dif.map((v,i)=> v-dea[i]); return {dif,dea,hist}; }
function boll(close, n=20, k=2){ const ma=sma(close,n), sd=[]; for(let i=0;i<close.length;i++){ if(i<n-1){ sd.push(NaN); continue; } const s=close.slice(i-n+1,i+1); const m=ma[i]; const v=s.reduce((a,x)=>a+(x-m)*(x-m),0)/n; sd.push(Math.sqrt(v)); } const up=ma.map((m,i)=> m+sd[i]*k), lo=ma.map((m,i)=> m-sd[i]*k), bbw=ma.map((m,i)=>(up[i]-lo[i])/(m||1e-9)); return {ma,up,lo,bbw}; }
function atr14(h,l,c,n=14){ const tr=[NaN]; for(let i=1;i<c.length;i++){ tr.push(Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1]))); } const out=[]; let prev=null; for(let i=0;i<tr.length;i++){ const v=tr[i]; if(i<n){ out.push(NaN); continue; } if(i===n){ const s=tr.slice(1,n+1).reduce((a,x)=>a+x,0); prev=s/n; out.push(prev); } else { prev=(prev*(n-1)+v)/n; out.push(prev); } } return out; }

function buildIndicators(rows){
  const c = rows.map(r=>r.c), h=rows.map(r=>r.h), l=rows.map(r=>r.l);
  const e6=ema(c,6), e24=ema(c,24), e56=ema(c,56);
  const r=rsi(c,14);
  const {dif,dea,hist} = macd(c,12,26,9);
  const {ma,up,lo,bbw} = boll(c,20,2);
  const a=atr14(h,l,c,14);
  return { ema6:e6, ema24:e24, ema56:e56, rsi14:r, macd_dif:dif, macd_dea:dea, macd_hist:hist, bb_mid:ma, bb_up:up, bb_lo:lo, bbw, atr14:a };
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
  const x = rows.map(r=>r.t);
  const k = rows.map(r=>[r.o,r.c,r.l,r.h]);

  // K 線
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

  // EMA / RSI / MACD / BOLL
  if(!state.charts.ema) state.charts.ema = mount('chart-ema');
  state.charts.ema.setOption(Object.assign(optBase(x,''),{
    series:[ lineS('EMA6', state.ind.ema6), lineS('EMA24', state.ind.ema24), lineS('EMA56', state.ind.ema56) ]
  }));

  if(!state.charts.rsi) state.charts.rsi = mount('chart-rsi');
  const oRSI = optBase(x,''); oRSI.yAxis.min=0; oRSI.yAxis.max=100;
  state.charts.rsi.setOption(Object.assign(oRSI,{ series:[ lineS('RSI14', state.ind.rsi14) ] }));

  if(!state.charts.macd) state.charts.macd = mount('chart-macd');
  state.charts.macd.setOption(Object.assign(optBase(x,''),{
    series:[ lineS('DIF', state.ind.macd_dif), lineS('DEA', state.ind.macd_dea), { type:'bar', name:'Hist', data: state.ind.macd_hist, barWidth: 2 } ]
  }));

  if(!state.charts.boll) state.charts.boll = mount('chart-boll');
  state.charts.boll.setOption(Object.assign(optBase(x,''),{
    series:[ lineS('BB Upper', state.ind.bb_up), lineS('BB Middle', state.ind.bb_mid), lineS('BB Lower', state.ind.bb_lo), lineS('BBW', state.ind.bbw) ]
  }));

  // 右側：y_pred / API 狀態 / 預測摘要
  (async ()=>{
    const pred = await loadPred();
    const last = rows.at(-1)?.c ?? NaN;
    const yPred = (typeof pred.y_pred === 'number') ? pred.y_pred : null;

    $("#yPred").textContent = (typeof yPred === 'number') ? yPred.toFixed(2) : '—';

    const dot = $("#apiDot"), lab=$("#apiLabel");
    if(state.source==='supabase'){ dot.classList.remove('warn'); dot.classList.add('ok'); lab.textContent='連線成功（Supabase）'; }
    else { dot.classList.remove('ok'); dot.classList.add('warn'); lab.textContent='使用假資料（sample）'; }

    const h = pred?.horizon_hours ?? 6;
    const ci = pred?.ci || [0.010, 0.0234];
    let text;
    if(Number.isFinite(last) && Number.isFinite(yPred)){
      const pct = (yPred / last - 1) * 100;
      const ciLow = (ci[0]*100).toFixed(2), ciHigh = (ci[1]*100).toFixed(2);
      const dir = pct >= 0 ? '上漲' : '下跌';
      text = `未來 ${h}h ${dir} ${pct>=0?'+':''}${pct.toFixed(2)}%  (95% 信心區間 ${ciLow}% ~ ${ciHigh}%)`;
    } else {
      text = `未來 6h 上漲 +1.67% (95%信心區間 1.0%~2.34%)`;
    }
    $("#predSummary").textContent = text;
  })();
}

// ====== 首頁（沿用 sample） ======
async function renderHome(){
  const pred = await fetchJSON("./data/predict_sample.json").catch(()=>({}));
  const imp = (pred.importances||[]).slice().sort((a,b)=>b[1]-a[1]);
  const C = themeColors();

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

  const grid = $("#featGrid"); grid.innerHTML="";
  Object.entries(pred.features||{}).forEach(([k,v])=>{
    const el=document.createElement('div');
    el.innerHTML = `<div class="muted">${k}</div><div class="mono" style="font-size:18px; font-weight:700;">${v}</div>`;
    grid.appendChild(el);
  });

  const m = pred.model||{};
  const txt = [
    `模型：${m.name||'—'} (${m.version||'—'})`,
    `訓練區間：${m.trained_window||'—'}`,
    `目標：${m.target||'—'}，損失：${m.loss||'—'}`,
    `指標：F1=${m.metrics?.f1 ?? '—'}, Precision=${m.metrics?.precision ?? '—'}, Recall=${m.metrics?.recall ?? '—'}, RMSE=${m.metrics?.rmse ?? '—'}, MAPE=${m.metrics?.mape ?? '—'}`,
    `超參數：`, JSON.stringify(m.hyperparams||{}, null, 2)
  ].join('\n');
  $("#modelInfo").textContent = txt;

  const back = await fetchJSON("./data/backtest_sample.json").catch(()=>({}));
  const rows = back.data||[]; let TP=0,TN=0,FP=0,FN=0;
  rows.forEach(r=>{ const p=r.pred_dir==='up', a=r.actual_dir==='up';
    if(p&&a)TP++; else if(!p&&!a)TN++; else if(p&&!a)FP++; else FN++; });
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
  Object.values(state.charts).forEach(ch=> ch && ch.clear());
  state.charts = {};

  state.ohlc = await getOHLC(coin);
  state.ind  = buildIndicators(state.ohlc);
  await loadPred();
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
  main(); // 重新渲染套用樣式
});

// 啟動
main();
