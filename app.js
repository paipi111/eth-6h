const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const params = new URLSearchParams(window.location.search);

const state = { history:null, predict:null, backtest:null, charts:{} };

/* ===== helpers ===== */
const getVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim() || "#e5e7eb";
function themeColors() { return { fg:getVar('--fg'), muted:getVar('--muted'), accent:getVar('--accent'), grid:'rgba(148,163,184,.2)' }; }
function getApiBase() { const el=$("#apiBase"); const v=el?el.value.trim():""; return v||""; }
function fmtPct(x){ return (x>0?"+":"")+x.toFixed(2)+"%"; }
function fmtTs(ts){ try{return new Date(ts).toLocaleString()}catch{return ts} }
async function fetchJson(url){ const r=await fetch(url); if(!r.ok) throw new Error("HTTP "+r.status); return await r.json(); }

/* ===== data ===== */
async function loadData() {
  const base = getApiBase();
  const useApi = !!base;
  if (useApi) {
    const [hist, pred, back] = await Promise.all([
      fetchJson(base + "/api/history?symbol=ETHUSDT&interval=6h&limit=400"),
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

/* ===== init charts (lazy-safe) ===== */
function ensureCharts() {
  const want = {
    price:'chart', imp:'impChart', cm:'cmChart',
    ema:'emaChart', rsi:'rsiChart', macd:'macdChart', kdj:'kdjChart', bb:'bbChart', atr:'atrChart'
  };
  Object.entries(want).forEach(([k,id])=>{
    const el=document.getElementById(id);
    if(el && !state.charts[k]) {
      state.charts[k]=echarts.init(el);
      window.addEventListener('resize', ()=> state.charts[k] && state.charts[k].resize());
    }
  });
}

/* ===== 技術指標計算 ===== */
function ema(arr, period){ const k=2/(period+1); let out=[], prev; for(let i=0;i<arr.length;i++){ const v=arr[i]; prev = (i===0)? v : v*k + prev*(1-k); out.push(prev);} return out; }
function sma(arr, p){ let out=[], sum=0; for(let i=0;i<arr.length;i++){ sum+=arr[i]; if(i>=p) sum-=arr[i-p]; out.push(i>=p-1? sum/p : NaN);} return out; }
function std(arr,p){ let out=[], q=[], sum=0, sumsq=0; for(let i=0;i<arr.length;i++){ const v=arr[i]; q.push(v); sum+=v; sumsq+=v*v; if(q.length>p){ const x=q.shift(); sum-=x; sumsq-=x*x;} if(q.length===p){ const m=sum/p; out.push(Math.sqrt(Math.max(0, sumsq/p - m*m))); } else out.push(NaN);} return out; }
function rsiWilder(c,p=14){ let g=0,l=0,rsis=new Array(c.length).fill(NaN); for(let i=1;i<c.length;i++){ const ch=c[i]-c[i-1]; if(i<=p){ if(ch>0) g+=ch; else l-=Math.min(ch,0); if(i===p){ const avgG=g/p, avgL=l/p, rs=avgL?avgG/avgL:0; rsis[i]=100-100/(1+rs);} } else { const up=Math.max(ch,0), dn=Math.max(-ch,0); g=(g*(p-1)+up)/p; l=(l*(p-1)+dn)/p; const rs=l?g/l:0; rsis[i]=100-100/(1+rs);} } return rsis; }
function macd(c,f=12,s=26,sig=9){ const ef=ema(c,f), es=ema(c,s); const dif=c.map((_,i)=>ef[i]-es[i]); const dea=ema(dif,sig); const hist=dif.map((d,i)=>d-dea[i]); return {dif,dea,hist}; }
function kdj(H,L,C,n=9,kP=3,dP=3){ const RSV=[]; for(let i=0;i<C.length;i++){ const st=Math.max(0,i-n+1); const h=Math.max(...H.slice(st,i+1)), l=Math.min(...L.slice(st,i+1)); RSV.push(h!==l? (C[i]-l)/(h-l)*100 : NaN);} const K=ema(RSV.map(x=>isNaN(x)?0:x),kP); const D=ema(K,dP); const J=K.map((k,i)=>3*k-2*D[i]); return {K,D,J}; }
function atr14(H,L,C,p=14){ const TR=[NaN]; for(let i=1;i<C.length;i++){ const hl=H[i]-L[i], hc=Math.abs(H[i]-C[i-1]), lc=Math.abs(L[i]-C[i-1]); TR[i]=Math.max(hl,hc,lc);} let out=new Array(C.length).fill(NaN), acc=0; for(let i=1;i<TR.length;i++){ if(i<=p){ acc+=TR[i]; if(i===p) out[i]=acc/p; } else { acc = (acc*(p-1) + TR[i]); out[i]= acc/p; } } return out; }

/* ===== render: price/predict ===== */
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

/* ===== render: 技術指標 ===== */
function renderTech() {
  const hist = state.history?.data || [];
  if (!hist.length) return;
  const t = hist.map(x=>x.t), H=hist.map(x=>x.h), L=hist.map(x=>x.l), C=hist.map(x=>x.c);
  const colors = themeColors();

  // EMA 6/24/56
  const e6=ema(C,6), e24=ema(C,24), e56=ema(C,56);
  if (state.charts.ema) state.charts.ema.setOption({
    background:'transparent', grid:{left:50,right:20,top:10,bottom:30},
    xAxis:{type:'category',data:t,axisLabel:{color:colors.muted}}, yAxis:{type:'value',axisLabel:{color:colors.muted},splitLine:{lineStyle:{color:colors.grid}}},
    dataZoom:[{type:'inside'},{type:'slider'}], series:[
      {type:'line',name:'EMA6',data:e6,showSymbol:false},
      {type:'line',name:'EMA24',data:e24,showSymbol:false},
      {type:'line',name:'EMA56',data:e56,showSymbol:false}
    ], tooltip:{trigger:'axis'}
  });

  // RSI(14)
  const rsi=rsiWilder(C,14);
  if (state.charts.rsi) state.charts.rsi.setOption({
    background:'transparent', grid:{left:50,right:20,top:10,bottom:30},
    xAxis:{type:'category',data:t,axisLabel:{color:colors.muted}}, yAxis:{type:'value',min:0,max:100,axisLabel:{color:colors.muted}},
    series:[{type:'line',name:'RSI14',data:rsi,showSymbol:false}], tooltip:{trigger:'axis'}
  });

  // MACD(12,26,9)
  const M=macd(C,12,26,9);
  if (state.charts.macd) state.charts.macd.setOption({
    background:'transparent', grid:{left:50,right:20,top:10,bottom:30},
    xAxis:{type:'category',data:t,axisLabel:{color:colors.muted}}, yAxis:{type:'value',axisLabel:{color:colors.muted}},
    series:[{type:'bar',name:'Hist',data:M.hist,barWidth:2},{type:'line',name:'DIF',data:M.dif,showSymbol:false},{type:'line',name:'DEA',data:M.dea,showSymbol:false}],
    tooltip:{trigger:'axis'}
  });

  // KDJ(9,3,3)
  const KDJ=kdj(H,L,C,9,3,3);
  if (state.charts.kdj) state.charts.kdj.setOption({
    background:'transparent', grid:{left:50,right:20,top:10,bottom:30},
    xAxis:{type:'category',data:t,axisLabel:{color:colors.muted}}, yAxis:{type:'value',min:0,max:100,axisLabel:{color:colors.muted}},
    series:[{type:'line',name:'K',data:KDJ.K,showSymbol:false},{type:'line',name:'D',data:KDJ.D,showSymbol:false},{type:'line',name:'J',data:KDJ.J,showSymbol:false}],
    tooltip:{trigger:'axis'}
  });

  // Bollinger(20,2) + BBW
  const ma20=sma(C,20), st20=std(C,20);
  const upper=ma20.map((m,i)=>isNaN(m)||isNaN(st20[i])?NaN:m+2*st20[i]);
  const lower=ma20.map((m,i)=>isNaN(m)||isNaN(st20[i])?NaN:m-2*st20[i]);
  const bbw=ma20.map((m,i)=> (isNaN(m)||isNaN(upper[i])||isNaN(lower[i])||m===0)?NaN:(upper[i]-lower[i])/m*100);
  if (state.charts.bb) state.charts.bb.setOption({
    background:'transparent', grid:{left:50,right:50,top:10,bottom:30},
    xAxis:{type:'category',data:t,axisLabel:{color:colors.muted}},
    yAxis:[{type:'value',axisLabel:{color:colors.muted},splitLine:{lineStyle:{color:colors.grid}}},{type:'value',position:'right',axisLabel:{color:colors.muted}}],
    series:[
      {type:'line',name:'SMA20',data:ma20,showSymbol:false,yAxisIndex:0},
      {type:'line',name:'上軌',data:upper,showSymbol:false,yAxisIndex:0},
      {type:'line',name:'下軌',data:lower,showSymbol:false,yAxisIndex:0},
      {type:'line',name:'BBW(%)',data:bbw,showSymbol:false,yAxisIndex:1}
    ], tooltip:{trigger:'axis'}
  });

  // ATR(14)
  const atr=atr14(H,L,C,14);
  if (state.charts.atr) state.charts.atr.setOption({
    background:'transparent', grid:{left:50,right:20,top:10,bottom:30},
    xAxis:{type:'category',data:t,axisLabel:{color:colors.muted}}, yAxis:{type:'value',axisLabel:{color:colors.muted}},
    series:[{type:'line',name:'ATR14',data:atr,showSymbol:false}], tooltip:{trigger:'axis'}
  });
}

/* ===== render: 重要度 / 最新指標 / 模型資訊 ===== */
function renderImpFeatModel() {
  const pred = state.predict || {};
  const C = themeColors();

  // 重要度
  const imp = (pred.importances || []).slice().sort((a,b)=>b[1]-a[1]);
  const impNames = imp.map(x=>x[0]); const impVals = imp.map(x=>x[1]);
  if (state.charts.imp) state.charts.imp.setOption({
    backgroundColor:'transparent', textStyle:{ color: C.fg },
    grid:{ left: 80, right: 20, top: 20, bottom: 30 },
    xAxis:{ type:'value', axisLabel:{ color:C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    yAxis:{ type:'category', data: impNames, axisLabel:{ color:C.muted } },
    series:[{ type:'bar', data: impVals, name:'重要度' }],
    tooltip:{ textStyle:{ color:C.fg }, backgroundColor:'rgba(30,41,59,.9)', borderColor:C.grid }
  });

  // 最新指標
  const grid = $("#featGrid");
  if (grid) {
    grid.innerHTML = "";
    const feats = pred.features || {};
    Object.entries(feats).forEach(([k,v])=>{
      const el=document.createElement('div');
      el.innerHTML = `<div class="muted">${k}</div><div class="mono" style="font-size:18px; font-weight:700;">${v}</div>`;
      grid.appendChild(el);
    });
  }

  // 模型資訊
  const m = pred.model || {};
  const txt = [
    `模型：${m.name || '—'} (${m.version || '—'})`,
    `訓練區間：${m.trained_window || '—'}`,
    `目標：${m.target || '—'}，損失：${m.loss || '—'}`,
    `指標：F1=${m.metrics?.f1 ?? '—'}, Precision=${m.metrics?.precision ?? '—'}, Recall=${m.metrics?.recall ?? '—'}, RMSE=${m.metrics?.rmse ?? '—'}, MAPE=${m.metrics?.mape ?? '—'}`,
    `超參數：`,
    JSON.stringify(m.hyperparams || {}, null, 2)
  ].join('\n');
  const infoEl=$("#modelInfo"); if(infoEl) infoEl.textContent = txt;
}

/* ===== render: 自製指標（對照命名） ===== */
function renderCustom() {
  const pred = state.predict || {};
  const feats = pred.features || {};
  const grid = $("#customGrid"); if(!grid) return;
  grid.innerHTML = "";

  // 你圖片裡的對照（左=原欄位 / 右=展示名稱）
  const mapping = [
    ["open_basis", "BASIS_O"], ["close_basis", "BASIS_C"],
    ["open_change", "BASIS_O_CHG%"], ["close_change", "BASIS_C_CHG%"],
    ["whale_index_value", "WHALE"],
    ["premium_rate", "CB_PREM%"],
    ["ret_6h", "R6%"], ["log_ret_6h", "LR6"],
    ["ret_24h", "R24%"], ["log_ret_24h", "LR24"],
    ["atr14", "ATR14"]
  ];

  mapping.forEach(([raw, alias])=>{
    const val = feats[raw];
    const card = document.createElement('div');
    card.className = "card";
    card.innerHTML = `
      <div class="muted mono">${raw} → <b>${alias}</b></div>
      <div class="mono" style="font-size:18px; font-weight:700; margin-top:6px;">${val ?? "—"}</div>
    `;
    grid.appendChild(card);
  });
}

/* ===== render: 回測 ===== */
function renderBacktest() {
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
  if (state.charts.cm) state.charts.cm.setOption({
    tooltip: { position: 'top', textStyle:{ color:C.fg }, backgroundColor:'rgba(30,41,59,.9)', borderColor:C.grid },
    textStyle:{ color: C.fg },
    grid: { left: 80, right: 20, top: 40, bottom: 20 },
    xAxis: { type: 'category', data: ['預測↓ / 真實→','up','down'], show: false },
    yAxis: { type: 'category', data: ['up','down'], axisLabel:{ color: C.muted }},
    visualMap: { min: 0, max: Math.max(1, TP+TN+FP+FN), calculable: false, orient: 'horizontal', left: 'center', bottom: 0, textStyle:{ color: C.muted } },
    series: [{ name:'Confusion', type:'heatmap', data:[[1,0,TP],[2,0,FP],[1,1,FN],[2,1,TN]], label:{ show:true, color:C.fg } }]
  });

  const tbl=$("#btMetrics");
  if (tbl) tbl.innerHTML = `
    <tr><th>樣本數 N</th><td class="mono">${N}</td></tr>
    <tr><th>Accuracy</th><td class="mono">${(acc*100).toFixed(1)}%</td></tr>
    <tr><th>Precision (上漲)</th><td class="mono">${(prec*100).toFixed(1)}%</td></tr>
    <tr><th>Recall (上漲)</th><td class="mono">${(rec*100).toFixed(1)}%</td></tr>
    <tr><th>F1</th><td class="mono">${(f1*100).toFixed(1)}%</td></tr>
  `;
}

/* ===== tabs ===== */
function switchTab(k){
  $$(".tab").forEach(b=> b.classList.toggle("active", b.dataset.tab===k));
  ["price","tech","custom","imp","feat","model","bt"].forEach(id=>{
    const el=document.getElementById(`page-${id}`);
    if (el) el.classList.toggle("active", id===k);
  });
  // 重新計算圖表大小
  Object.values(state.charts).forEach(ch=> ch && ch.resize());
}

/* ===== main ===== */
async function main() {
  if (params.get('theme') === 'dark') { document.body.setAttribute('data-theme','dark'); $("#themeLabel").textContent='黑'; }
  const bot = params.get('bot'); if (bot) $("#tgButton").href = `https://t.me/${bot}`;

  await loadData();
  ensureCharts();
  renderPriceAndPredict();
  renderTech();
  renderImpFeatModel();
  renderCustom();
  renderBacktest();
}

/* ===== events ===== */
$("#refreshBtn").addEventListener('click', main);
$("#themeToggle").addEventListener('click', () => {
  const now=document.body.getAttribute('data-theme');
  const next= now==='light' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', next);
  $("#themeLabel").textContent = next==='light' ? '白' : '黑';
  // 立即重繪（避免顏色殘留）
  renderPriceAndPredict(); renderTech(); renderImpFeatModel(); renderBacktest();
});
$$(".tab").forEach(btn => btn.addEventListener("click", ()=> switchTab(btn.dataset.tab)));

main();
