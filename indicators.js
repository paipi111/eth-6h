// ====== 主題 / 工具 ======
const $ = s => document.querySelector(s);
const getVar = name => getComputedStyle(document.body).getPropertyValue(name).trim();
function themeColors(){
  return { fg:getVar('--fg')||'#e5e7eb', muted:getVar('--muted')||'#94a3b8', grid:'rgba(148,163,184,.2)' };
}

// ====== API 入口（之後改這裡） ======
function apiBase(){
  const t = $('#apiBase')?.value?.trim();
  return t || ''; // 留空→使用範例數據
}

// 範例數據（placeholder）
async function loadSample(kind){
  // 可依 tab kind 回傳不同假資料
  const now = Date.now(), n = 120;
  const xs = Array.from({length:n},(_,i)=> new Date(now-(n-i)*6*3600*1000).toISOString());
  const close = xs.map((_,i)=> 3800 + 300*Math.sin(i/10) + (Math.random()-0.5)*60 );
  return { ts: xs, close };
}

// 真實 API 介面：給你參考（之後把路徑換掉）
async function fetchSeries(kind){
  const base = apiBase();
  if (!base) return loadSample(kind);

  // 你們可實作：/api/indicators?symbol=ETHUSDT&kind=EMA&window=...
  const url = new URL(base.replace(/\/$/,'')+'/api/indicators');
  url.searchParams.set('symbol','ETHUSDT');
  url.searchParams.set('interval','6h');
  url.searchParams.set('kind',kind);
  const r = await fetch(url);
  if (!r.ok) throw new Error('API ' + r.status);
  return await r.json(); // 統一期望 { ts:[...], series:{name:[], data:[[]]} 或 {ts, close, extra...}
}

// ====== 圖表初始化 ======
const charts = {
  price: echarts.init($('#view-price')),
  deriv: echarts.init($('#view-deriv')),
};
window.addEventListener('resize', ()=>{ charts.price.resize(); charts.deriv.resize(); });

function baseOption(xname='時間'){
  const C = themeColors();
  return {
    backgroundColor:'transparent',
    textStyle:{ color:C.fg },
    grid:{ left:50,right:20,top:20,bottom:40 },
    xAxis:{ type:'category', name:xname, axisLabel:{ color:C.muted } },
    yAxis:{ type:'value', axisLabel:{ color:C.muted }, splitLine:{ lineStyle:{ color:C.grid } } },
    tooltip:{ trigger:'axis', backgroundColor:'rgba(30,41,59,.9)', borderColor:C.grid, textStyle:{ color:C.fg } },
    dataZoom:[{type:'inside'},{type:'slider', textStyle:{ color:C.muted }}]
  };
}

// ====== 各分頁渲染 ======
async function showEMA(){
  const d = await fetchSeries('EMA');
  const C = themeColors();
  charts.price.setOption({
    ...baseOption(),
    legend:{ data:['Close','EMA6','EMA24','EMA56'], textStyle:{ color:C.muted } },
    series:[
      { type:'line', name:'Close', data:d.close || [], smooth:true },
      { type:'line', name:'EMA6',  data:d.ema6  || [], smooth:true },
      { type:'line', name:'EMA24', data:d.ema24 || [], smooth:true },
      { type:'line', name:'EMA56', data:d.ema56 || [], smooth:true },
    ],
    xAxis:{ ...baseOption().xAxis, data: d.ts }
  });
}
async function showRSI(){
  const d = await fetchSeries('RSI');
  charts.price.setOption({
    ...baseOption(),
    legend:{ data:['RSI14'] },
    series:[ { type:'line', name:'RSI14', data:d.rsi14||[], smooth:true } ],
    xAxis:{ ...baseOption().xAxis, data:d.ts },
    yAxis:{ ...baseOption().yAxis, min:0, max:100,
      axisPointer:{}, axisLabel:{ color: themeColors().muted } }
  });
}
async function showMACD(){
  const d = await fetchSeries('MACD');
  const C = themeColors();
  charts.price.setOption({
    ...baseOption(),
    legend:{ data:['DIF','DEA','Hist'], textStyle:{ color:C.muted } },
    series:[
      { type:'line', name:'DIF', data:d.dif||[], smooth:true },
      { type:'line', name:'DEA', data:d.dea||[], smooth:true },
      { type:'bar',  name:'Hist', data:d.hist||[] },
    ],
    xAxis:{ ...baseOption().xAxis, data:d.ts }
  });
}
async function showKDJ(){
  const d = await fetchSeries('KDJ');
  charts.price.setOption({
    ...baseOption(),
    legend:{ data:['K','D','J'] },
    series:[
      { type:'line', name:'K', data:d.k||[], smooth:true },
      { type:'line', name:'D', data:d.d||[], smooth:true },
      { type:'line', name:'J', data:d.j||[], smooth:true },
    ],
    xAxis:{ ...baseOption().xAxis, data:d.ts }
  });
}
async function showBOLL(){
  const d = await fetchSeries('BOLL');
  charts.price.setOption({
    ...baseOption(),
    legend:{ data:['Close','Upper','Middle','Lower'] },
    series:[
      { type:'line', name:'Close',  data:d.close||[], smooth:true },
      { type:'line', name:'Upper',  data:d.upper||[], smooth:true },
      { type:'line', name:'Middle', data:d.middle||[], smooth:true },
      { type:'line', name:'Lower',  data:d.lower||[], smooth:true },
    ],
    xAxis:{ ...baseOption().xAxis, data:d.ts }
  });
}
async function showATR(){
  const d = await fetchSeries('ATR');
  charts.price.setOption({
    ...baseOption(),
    legend:{ data:['ATR14'] },
    series:[ { type:'line', name:'ATR14', data:d.atr14||[], smooth:true } ],
    xAxis:{ ...baseOption().xAxis, data:d.ts }
  });
}

// ===== 衍生品/因子 =====
async function showBASIS(){
  const d = await fetchSeries('BASIS'); // 期貨基差/變化率
  charts.deriv.setOption({
    ...baseOption(),
    legend:{ data:['BASIS_O','BASIS_C','BASIS_O_CHG%','BASIS_C_CHG%'] },
    series:[
      { type:'line', name:'BASIS_O', data:d.basis_o||[], smooth:true },
      { type:'line', name:'BASIS_C', data:d.basis_c||[], smooth:true },
      { type:'line', name:'BASIS_O_CHG%', data:d.basis_o_chg||[], smooth:true },
      { type:'line', name:'BASIS_C_CHG%', data:d.basis_c_chg||[], smooth:true },
    ],
    xAxis:{ ...baseOption().xAxis, data:d.ts }
  });
}
async function showWHALE(){
  const d = await fetchSeries('WHALE');
  charts.deriv.setOption({
    ...baseOption(),
    legend:{ data:['WHALE'] },
    series:[ { type:'line', name:'WHALE', data:d.whale||[], smooth:true } ],
    xAxis:{ ...baseOption().xAxis, data:d.ts }
  });
}
async function showCBPREM(){
  const d = await fetchSeries('CBPREM');
  charts.deriv.setOption({
    ...baseOption(),
    legend:{ data:['CB_PREM%'] },
    series:[ { type:'line', name:'CB_PREM%', data:d.cb_prem||[], smooth:true } ],
    xAxis:{ ...baseOption().xAxis, data:d.ts }
  });
}
async function showRET(){
  const d = await fetchSeries('RET');
  charts.deriv.setOption({
    ...baseOption(),
    legend:{ data:['R6%','LR6','R24%','LR24'] },
    series:[
      { type:'line', name:'R6%', data:d.ret6||[], smooth:true },
      { type:'line', name:'LR6', data:d.log_ret6||[], smooth:true },
      { type:'line', name:'R24%', data:d.ret24||[], smooth:true },
      { type:'line', name:'LR24', data:d.log_ret24||[], smooth:true },
    ],
    xAxis:{ ...baseOption().xAxis, data:d.ts }
  });
}
async function showATR14(){
  const d = await fetchSeries('ATR14');
  charts.deriv.setOption({
    ...baseOption(),
    legend:{ data:['ATR14(6h)'] },
    series:[ { type:'line', name:'ATR14(6h)', data:d.atr14||[], smooth:true } ],
    xAxis:{ ...baseOption().xAxis, data:d.ts }
  });
}

// ====== 事件繫結 & 路由 ======
const routes = {
  EMA:showEMA, RSI:showRSI, MACD:showMACD, KDJ:showKDJ, BOLL:showBOLL, ATR:showATR,
  BASIS:showBASIS, WHALE:showWHALE, CBPREM:showCBPREM, RET:showRET, ATR14:showATR14
};
function activateTab(groupId, name){
  document.querySelectorAll(`#${groupId} .tab`).forEach(b=>{
    b.classList.toggle('active', b.dataset.tab===name);
  });
}
function navTo(name){
  // 判斷屬於哪個區塊
  if(['EMA','RSI','MACD','KDJ','BOLL','ATR'].includes(name)) activateTab('tabs-price', name);
  else activateTab('tabs-deriv', name);
  location.hash = name;
  (routes[name]||showEMA)();
}
window.addEventListener('hashchange',()=>navTo(location.hash.replace('#','')||'EMA'));

document.querySelectorAll('#tabs-price .tab, #tabs-deriv .tab').forEach(btn=>{
  btn.addEventListener('click', ()=> navTo(btn.dataset.tab));
});

$('#reload').addEventListener('click', ()=> navTo(location.hash.replace('#','')||'EMA'));

$('#themeToggle').addEventListener('click', ()=>{
  const now = document.documentElement.getAttribute('data-theme')||'light';
  const next = now==='light'?'dark':'light';
  document.documentElement.setAttribute('data-theme', next);
  $('#themeLabel').textContent = next==='light'?'白':'黑';
  // 重新套用文字色
  navTo(location.hash.replace('#','')||'EMA');
});

// 預設：從 URL 參數帶入 API base、或 hash 選單
(function init(){
  const p = new URLSearchParams(location.search);
  const base = p.get('api') || '';
  if (base) $('#apiBase').value = base;
  const theme = p.get('theme')||'light';
  document.documentElement.setAttribute('data-theme', theme);
  $('#themeLabel').textContent = theme==='light'?'白':'黑';
  navTo(location.hash.replace('#','')||'EMA');
})();
