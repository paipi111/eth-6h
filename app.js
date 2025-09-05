/* ====== 基本設定 ====== */
const $ = (s)=>document.querySelector(s);
const params = new URLSearchParams(location.search);
const COINS = ["BTC","ETH","XRP","DOGE","BNB","ADA"]; // 沒有 SOL
const STATE = {
  supabase: { url:"", key:"" },
  charts: {}, // 存放已初始化的 echarts
  cache: { prices:{}, indicators:{} }, // 依 coin 快取
  home: { history:null, predict:null, backtest:null }
};

// 色系
const cssVar = n => getComputedStyle(document.body).getPropertyValue(n).trim();
const C = () => ({
  fg: cssVar("--fg") || "#0f172a",
  muted: cssVar("--muted") || "#64748b",
  accent: cssVar("--accent") || "#2563eb",
  grid: "rgba(148,163,184,.2)"
});
const isDark = () => document.body.getAttribute("data-theme")==="dark";
const tipStyle = (trigger="axis") => ({
  trigger,
  textStyle: { color: isDark()? "#e5e7eb":"#0f172a" },
  backgroundColor: isDark()? "rgba(30,41,59,.92)":"rgba(255,255,255,.95)",
  borderColor: isDark()? "rgba(148,163,184,.25)":"rgba(0,0,0,.12)",
  axisPointer: { type: "line" }
});

/* ====== Supabase helper ====== */
const getSb = () => {
  const url = ($("#sbUrl")?.value||"").replace(/\/$/,"");
  const key = ($("#sbKey")?.value||"").trim();
  return { url, key };
};
async function sbSelect({table, select, filter="", order="ts_utc.asc", limit=1500}) {
  const { url, key } = getSb();
  if (!url || !key) return null;
  const qp = `select=${encodeURIComponent(select)}${filter?`&${filter}`:""}&order=${encodeURIComponent(order)}&limit=${limit}`;
  const r = await fetch(`${url}/rest/v1/${table}?${qp}`, {
    headers: { apikey:key, Authorization:`Bearer ${key}` }
  });
  if (!r.ok) throw new Error(`SB ${r.status} ${await r.text()}`);
  return await r.json();
}

/* ====== Home：用你原來的 6h 示範資料（不影響 1d 頁） ====== */
async function loadHome() {
  const base = ($("#apiBase")?.value||"").trim();
  if (base) {
    const [hist,pred,back] = await Promise.all([
      fetch(`${base}/api/history?symbol=ETHUSDT&interval=6h&limit=200`).then(r=>r.json()),
      fetch(`${base}/api/predict?symbol=ETHUSDT&horizon=6h`).then(r=>r.json()),
      fetch(`${base}/api/backtest?symbol=ETHUSDT&horizon=6h&limit=200`).then(r=>r.json())
    ]);
    STATE.home.history = hist; STATE.home.predict = pred; STATE.home.backtest = back;
  } else {
    const [hist,pred,back] = await Promise.all([
      fetch("./data/history_6h_sample.json").then(r=>r.json()),
      fetch("./data/predict_sample.json").then(r=>r.json()),
      fetch("./data/backtest_sample.json").then(r=>r.json())
    ]);
    STATE.home.history = hist; STATE.home.predict = pred; STATE.home.backtest = back;
  }
}
function ensure(elId){
  if(!STATE.charts[elId]){
    STATE.charts[elId] = echarts.init(document.getElementById(elId));
    window.addEventListener("resize", ()=>STATE.charts[elId].resize());
  }
  return STATE.charts[elId];
}
function renderHomeKline() {
  const h = STATE.home.history?.data||[];
  const p = STATE.home.predict;
  const kdata = h.map(d=>[d.o,d.c,d.l,d.h]);
  const x = h.map(d=>d.t);
  let markLine=[], markArea=[];
  if (p && h.length){
    const nextTs = p.timestamp;
    const lastClose = h[h.length-1].c;
    const low = lastClose*(1+p.conf_interval_pct[0]/100);
    const high= lastClose*(1+p.conf_interval_pct[1]/100);
    markArea = [[{xAxis:nextTs,itemStyle:{color:"rgba(37,99,235,.08)"}},{xAxis:nextTs}]];
    markLine = [
      {name:"預測價格",xAxis:nextTs,yAxis:p.y_pred},
      {name:"區間低",xAxis:nextTs,yAxis:low},
      {name:"區間高",xAxis:nextTs,yAxis:high},
    ];
  }
  const col = C();
  ensure("chart").setOption({
    backgroundColor:"transparent",
    textStyle:{ color: col.fg },
    grid:{ left:50,right:20,top:10,bottom:40 },
    xAxis:{ type:"category", data:x, axisLabel:{ color: col.muted } },
    yAxis:{ scale:true, axisLabel:{ color: col.muted }, splitLine:{ lineStyle:{ color: col.grid } } },
    dataZoom:[{type:"inside"},{type:"slider",textStyle:{color:col.muted}}],
    tooltip: tipStyle("axis"),
    series:[{
      type:"candlestick", name:"示例 6h", data:kdata,
      itemStyle:{ color:"#ef4444", color0:"#10b981", borderColor:"#ef4444", borderColor0:"#10b981" },
      markArea:{ data: markArea },
      markLine:{ symbol:["none","none"], data: markLine, lineStyle:{type:"dashed"}, label:{show:true,color:col.fg} }
    }]
  });

  if (p){
    $("#dir").textContent = (p.direction==="up"?"▲ 上漲":"▼ 下跌");
    $("#delta").textContent = ((p.delta_pct>0?"+":"")+p.delta_pct.toFixed(2)+"%");
    $("#conf").textContent = (p.confidence*100).toFixed(0)+"%";
    $("#band").textContent = p.conf_interval_pct.map(v=>(v>0?"+":"")+v.toFixed(2)+"%").join(" ~ ");
    $("#predTs").textContent = new Date(p.timestamp).toLocaleString();
  }
}
function renderImportancesAndFeatures(){
  const pred = STATE.home.predict || {};
  const imp = (pred.importances||[]).slice().sort((a,b)=>b[1]-a[1]);
  const names = imp.map(x=>x[0]);
  const vals  = imp.map(x=>x[1]);
  const col = C();
  ensure("impChart").setOption({
    backgroundColor:"transparent",
    textStyle:{ color: col.fg },
    grid:{ left:80, right:20, top:20, bottom:30 },
    xAxis:{ type:"value", axisLabel:{ color:col.muted }, splitLine:{ lineStyle:{ color:col.grid } } },
    yAxis:{ type:"category", data:names, axisLabel:{ color: col.muted } },
    tooltip: tipStyle("item"),
    series:[{ type:"bar", data: vals }]
  });

  const grid = $("#featGrid"); grid.innerHTML="";
  const feats = pred.features||{};
  Object.entries(feats).forEach(([k,v])=>{
    const el = document.createElement("div");
    el.innerHTML = `<div class="muted">${k}</div><div class="mono" style="font-size:18px;font-weight:700;">${v}</div>`;
    grid.appendChild(el);
  });

  const m = pred.model||{};
  $("#modelInfo").textContent = [
    `模型：${m.name||"—"} (${m.version||"—"})`,
    `訓練區間：${m.trained_window||"—"}`,
    `目標：${m.target||"—"}，損失：${m.loss||"—"}`,
    `指標：F1=${m.metrics?.f1??"—"}, Precision=${m.metrics?.precision??"—"}, Recall=${m.metrics?.recall??"—"}, RMSE=${m.metrics?.rmse??"—"}, MAPE=${m.metrics?.mape??"—"}`,
    `超參數：`,
    JSON.stringify(m.hyperparams||{}, null, 2)
  ].join("\n");
}
function renderHomeBacktest(){
  const rows = STATE.home.backtest?.data||[];
  let TP=0,TN=0,FP=0,FN=0;
  rows.forEach(r=>{
    const p = r.pred_dir==="up"; const a = r.actual_dir==="up";
    if(p&&a)TP++; else if(!p&&!a)TN++; else if(p&&!a)FP++; else if(!p&&a)FN++;
  });
  const N = rows.length||1;
  const acc = (TP+TN)/N, prec = (TP+FP)?TP/(TP+FP):0, rec=(TP+FN)?TP/(TP+FN):0, f1=(prec+rec)?2*prec*rec/(prec+rec):0;
  const col = C();
  ensure("cmChart").setOption({
    tooltip: Object.assign(tipStyle("item"), { position:"top" }),
    textStyle:{ color: col.fg },
    grid:{ left:80,right:20,top:40,bottom:20 },
    xAxis:{ type:"category", data:["預測↓ / 真實→","up","down"], show:false },
    yAxis:{ type:"category", data:["up","down"], axisLabel:{ color: col.muted }},
    visualMap:{ min:0, max:Math.max(1,TP+TN+FP+FN), calculable:false, orient:"horizontal", left:"center", bottom:0,
      textStyle:{ color: col.muted } },
    series:[{ name:"Confusion", type:"heatmap",
      data:[[1,0,TP],[2,0,FP],[1,1,FN],[2,1,TN]], label:{ show:true, color: col.fg } }]
  });
  $("#btMetrics").innerHTML = `
    <tr><th>樣本數 N</th><td class="mono">${N}</td></tr>
    <tr><th>Accuracy</th><td class="mono">${(acc*100).toFixed(1)}%</td></tr>
    <tr><th>Precision (上漲)</th><td class="mono">${(prec*100).toFixed(1)}%</td></tr>
    <tr><th>Recall (上漲)</th><td class="mono">${(rec*100).toFixed(1)}%</td></tr>
    <tr><th>F1</th><td class="mono">${(f1*100).toFixed(1)}%</td></tr>`;
}

/* ====== 幣別分頁：K 線 + 指標 ====== */
// 小工具
const toTs = (d)=> (typeof d==="number"?d:Date.parse(d));
function optBase(x, yname=""){
  const col = C();
  return {
    backgroundColor:"transparent",
    textStyle:{ color: col.fg },
    grid:{ left:50,right:20,top:10,bottom:40 },
    xAxis:{ type:"category", data:x, boundaryGap:false, axisLabel:{ color: col.muted } },
    yAxis:{ type:"value", name:yname, axisLabel:{ color: col.muted }, splitLine:{ lineStyle:{ color: col.grid } } },
    legend:{ top:0 },
    tooltip: tipStyle("axis")
  };
}
const line = (name,data,smooth=true)=>({ type:"line", name, data, smooth, showSymbol:false });

// 讀 1d K 線（Supabase -> prices_daily；沒有就讀 sample）
async function getDailyPrices(coin){
  if (STATE.cache.prices[coin]) return STATE.cache.prices[coin];
  try {
    const rows = await sbSelect({
      table:"prices_daily",
      select:"ts_utc, open, high, low, close, volume",
      filter:`coin=eq.${encodeURIComponent(coin)}`
    });
    if (rows && rows.length){
      const data = rows.map(r=>({
        t: new Date(Number(r.ts_utc)).toISOString(),
        o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume
      }));
      STATE.cache.prices[coin] = data;
      return data;
    }
  } catch(e){ console.warn("prices_daily 讀取失敗", e); }
  // fallback：sample
  const sample = await fetch("./data/daily_prices_sample.json").then(r=>r.json());
  STATE.cache.prices[coin] = sample[coin]||[];
  return STATE.cache.prices[coin];
}

// 讀 1d 指標（Supabase -> ind_daily / 你的 view；沒有就讀 sample）
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
function toLogFromPct(pct){
  const r = Number(pct)/100;
  if (!isFinite(r) || r<=-0.999999999) return NaN;
  return Math.log(1+r);
}
function transformIndicators(rows){
  return (rows||[]).map(r=>{
    const o={...r};
    if (o.log_ret_6h==null && o.ret_6h!=null)  o.log_ret_6h  = toLogFromPct(o.ret_6h);
    if (o.log_ret_24h==null && o.ret_24h!=null) o.log_ret_24h = toLogFromPct(o.ret_24h);
    return o;
  });
}
async function getDailyIndicators(coin){
  if (STATE.cache.indicators[coin]) return STATE.cache.indicators[coin];
  try{
    // 你可以把 ind_daily 換成你的實際表/檢視名稱 (例如 lake)
    const rows = await sbSelect({
      table:"ind_daily",
      select: IND_FIELDS.join(","),
      filter:`coin=eq.${encodeURIComponent(coin)}`
    });
    if (rows && rows.length){
      const data = transformIndicators(rows);
      STATE.cache.indicators[coin] = data;
      return data;
    }
  }catch(e){ console.warn("ind_daily 讀取失敗", e); }
  // fallback：sample
  const sample = await fetch("./data/daily_indicators_sample.json").then(r=>r.json());
  STATE.cache.indicators[coin] = sample[coin]||[];
  return STATE.cache.indicators[coin];
}

// 畫幣別 K 線
async function renderCoinKline(coin){
  $("#coinTitle").textContent = coin;
  const rows = await getDailyPrices(coin);
  const x = rows.map(d=>d.t);
  const k = rows.map(d=>[d.o,d.c,d.l,d.h]);
  const col = C();
  ensure("coinKline").setOption({
    backgroundColor:"transparent",
    textStyle:{ color: col.fg },
    grid:{ left:50,right:20,top:10,bottom:40 },
    xAxis:{ type:"category", data: x, axisLabel:{ color: col.muted } },
    yAxis:{ scale:true, axisLabel:{ color: col.muted }, splitLine:{ lineStyle:{ color: col.grid } } },
    dataZoom:[{type:"inside"},{type:"slider",textStyle:{color:col.muted}}],
    tooltip: tipStyle("axis"),
    series:[{
      type:"candlestick", name:`${coin} 1d`, data:k,
      itemStyle:{ color:"#ef4444", color0:"#10b981", borderColor:"#ef4444", borderColor0:"#10b981" }
    }]
  });
}

// 指標通用
function X(rows){ return rows.map(r=> String(r.ts).slice(0,10)); }
function drawIndicators(rows){
  const x = X(rows);
  const base = (id,y='') => ({ ...optBase(x,y) });
  echarts.init($("#chart-basis")).setOption({
    ...base('chart-basis','%'),
    series:[ line('BASIS_O', rows.map(r=>r.open_basis)),
             line('BASIS_C', rows.map(r=>r.close_basis)) ]
  });
  echarts.init($("#chart-basischg")).setOption({
    ...base('chart-basischg','%'),
    series:[ line('BASIS_O_CHG%', rows.map(r=>r.open_change)),
             line('BASIS_C_CHG%', rows.map(r=>r.close_change)) ]
  });
  echarts.init($("#chart-whale")).setOption({
    ...base('chart-whale'),
    series:[ line('WHALE', rows.map(r=>r.whale_index_value)) ]
  });
  echarts.init($("#chart-cbprem")).setOption({
    ...base('chart-cbprem','%'),
    series:[ line('CB_PREM%', rows.map(r=>r.premium_rate), false) ]
  });
  echarts.init($("#chart-returns")).setOption({
    ...base('chart-returns','log'),
    series:[ line('log R6', rows.map(r=>r.log_ret_6h)),
             line('log R24', rows.map(r=>r.log_ret_24h)) ]
  });
  echarts.init($("#chart-logrets")).setOption({
    ...base('chart-logrets','log'),
    series:[ line('LR6', rows.map(r=>r.log_ret_6h)),
             line('LR24', rows.map(r=>r.log_ret_24h)) ]
  });
  echarts.init($("#chart-atr")).setOption({
    ...base('chart-atr'),
    series:[ line('ATR14', rows.map(r=>r.atr14)) ]
  });
  echarts.init($("#chart-ema")).setOption({
    ...base('chart-ema'),
    series:[ line('EMA6', rows.map(r=>r.ema6)),
             line('EMA24', rows.map(r=>r.ema24)),
             line('EMA56', rows.map(r=>r.ema56)) ]
  });
  const rsiO = optBase(x,''); rsiO.yAxis.min=0; rsiO.yAxis.max=100;
  echarts.init($("#chart-rsi")).setOption({
    ...rsiO, series:[ line('RSI14', rows.map(r=>r.rsi14)) ]
  });
  echarts.init($("#chart-macd")).setOption({
    ...base('chart-macd'),
    series:[ line('DIF', rows.map(r=>r.macd_dif)),
             line('DEA', rows.map(r=>r.macd_dea)),
             { type:'bar', name:'Hist', data: rows.map(r=>r.macd_hist), barWidth:2 } ]
  });
  const kdO = optBase(x,''); kdO.yAxis.min=0; kdO.yAxis.max=100;
  echarts.init($("#chart-kd")).setOption({
    ...kdO, series:[ line('K', rows.map(r=>r.k)), line('D', rows.map(r=>r.d)), line('J', rows.map(r=>r.j)) ]
  });
  echarts.init($("#chart-boll")).setOption({
    ...base('chart-boll'),
    series:[ line('BB Upper', rows.map(r=>r.bb_upper)),
             line('BB Middle', rows.map(r=>r.bb_middle)),
             line('BB Lower', rows.map(r=>r.bb_lower)),
             line('BBW(20,2)', rows.map(r=>r.bbw)) ]
  });
}

// 分頁切換
async function gotoTab(tab){
  // 標籤狀態
  [...document.querySelectorAll(".tab")].forEach(el=>{
    el.classList.toggle("active", el.dataset.tab===tab);
  });

  if (tab==="home"){
    $("#page-home").style.display = "";
    $("#page-coin").style.display = "none";
    await loadHome();
    renderHomeKline();
    renderImportancesAndFeatures();
    renderHomeBacktest();
  } else {
    $("#page-home").style.display = "none";
    $("#page-coin").style.display = "";
    await renderCoinKline(tab);
    const ind = await getDailyIndicators(tab);
    drawIndicators(ind);
  }
  history.replaceState(null,"",`#${tab}`);
}

// 綁定
$("#themeToggle").addEventListener("click", ()=>{
  const now = document.body.getAttribute("data-theme");
  const next = now==="light" ? "dark":"light";
  document.body.setAttribute("data-theme", next);
  $("#themeLabel").textContent = next==="light" ? "白" : "黑";
  // 重新套一下 tooltip 顏色
  const tab = location.hash?.slice(1) || "home";
  gotoTab(tab); // 直接重畫當前頁
});
document.querySelectorAll(".tab").forEach(el=>{
  el.addEventListener("click", ()=> gotoTab(el.dataset.tab));
});

// 進入頁面
(async function init(){
  if (params.get("theme")==="dark"){
    document.body.setAttribute("data-theme","dark");
    $("#themeLabel").textContent = "黑";
  }
  const tab = location.hash?.slice(1) || "home";
  await gotoTab(tab);
})();
