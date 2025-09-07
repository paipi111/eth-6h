// script.js (V4 - 靜態/動態分離版)

let fullData = {}; // 全域變數，儲存完整數據
let myEquityChart = null; // 圖表實例，方便銷毀和重建

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('results.json?t=' + new Date().getTime());
        if (!response.ok) throw new Error('無法載入 results.json');
        fullData = await response.json();

        // 1. 載入頁面時，設定一次「靜態」的元件 (KPIs 和圓餅圖)
        displayStaticComponents(fullData);

        // 2. 初始載入「動態」元件，顯示總體數據
        updateDynamicComponents(null); // null 代表總體

        // 3. 為篩選按鈕綁定事件
        setupFilters();

    } catch (error) {
        console.error('處理數據時發生錯誤:', error);
        alert('載入數據失敗，請檢查 console。');
    }
});

function displayStaticComponents(data) {
    // --- 更新頂部的 KPI (只執行一次) ---
    const kpis = data.kpis;
    document.getElementById('finalEquity').textContent = `$ ${kpis.finalEquity.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('cagr').textContent = `${kpis.cagr.toFixed(2)}%`;
    document.getElementById('maxDrawdown').textContent = `${kpis.maxDrawdown.toFixed(2)}%`;
    document.getElementById('sharpe').textContent = kpis.sharpe.toFixed(2);
    document.getElementById('winRate').textContent = `${kpis.winRate.toFixed(2)}%`;
    document.getElementById('profitFactor').textContent = kpis.profitFactor.toFixed(2);

    // --- 更新模擬期間 (只執行一次) ---
    const startDate = data.equity_curve[0].date;
    const endDate = data.equity_curve[data.equity_curve.length - 1].date;
    document.getElementById('simulationPeriod').textContent = `模擬期間: ${startDate} ~ ${endDate}`;

    // --- 繪製信號分佈圓餅圖 (只執行一次) ---
    createSignalPieChart(data.signal_log);
}

function setupFilters() {
    document.getElementById('filter-overall').addEventListener('click', () => updateDynamicComponents(null));
    document.getElementById('filter-btc').addEventListener('click', () => updateDynamicComponents('BTC'));
    document.getElementById('filter-eth').addEventListener('click', () => updateDynamicComponents('ETH'));
    // ---【核心修改】為新按鈕綁定事件 ---
    document.getElementById('filter-xrp').addEventListener('click', () => updateDynamicComponents('XRP'));
    document.getElementById('filter-doge').addEventListener('click', () => updateDynamicComponents('DOGE'));
    document.getElementById('filter-bnb').addEventListener('click', () => updateDynamicComponents('BNB'));
    document.getElementById('filter-ada').addEventListener('click', () => updateDynamicComponents('ADA'));
    // --- ------------------------- ---
}

function updateDynamicComponents(filterSymbol) {
    // --- 根據 filterSymbol 篩選交易日誌 ---
    const filteredTradeLog = filterSymbol
        ? fullData.trade_log.filter(d => d.symbol === filterSymbol)
        : fullData.trade_log;

    // --- 更新權益曲線圖 ---
    createEquityCurveChart(filteredTradeLog, filterSymbol);

    // --- 更新詳細日誌表格 ---
    populateTradeLogTable(filteredTradeLog);

    // --- 更新表格標題 ---
    const tableTitle = document.getElementById('tableTitle');
    tableTitle.textContent = `詳細交易日誌 (${filterSymbol || '總體'})`;

    // --- 更新按鈕的 active 狀態 ---
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtnId = filterSymbol ? `filter-${filterSymbol.toLowerCase()}` : 'filter-overall';
    document.getElementById(activeBtnId).classList.add('active');
}

function createEquityCurveChart(tradeLog, filterSymbol) {
    const ctx = document.getElementById('equityCurveChart').getContext('2d');
    if (myEquityChart) {
        myEquityChart.destroy();
    }

    let chartData, chartTitle;

    if (!filterSymbol) {
        // 總體視圖：顯示真實的投資組合權益曲線
        chartTitle = '總體投資組合權益曲線';
        const equityData = fullData.equity_curve;
        chartData = {
            labels: equityData.map(d => d.date),
            datasets: [{
                label: '投資組合權益 ($)',
                data: equityData.map(d => d.equity),
                borderColor: '#00bcd4',
                backgroundColor: 'rgba(0, 188, 212, 0.1)',
                fill: true,
                borderWidth: 2,
                tension: 0.1,
            }]
        };
    } else {
        // 單一幣種視圖：顯示該幣種的累計盈虧 (Cumulative PnL)
        chartTitle = `${filterSymbol} 累計盈虧曲線`;
        let cumulativePnl = 0;
        const pnlData = tradeLog.map(trade => {
            cumulativePnl += trade.pnl;
            return cumulativePnl;
        });

        chartData = {
            labels: tradeLog.map(d => d.entry_date),
            datasets: [{
                label: `${filterSymbol} 累計 PnL ($)`,
                data: pnlData,
                borderColor: '#4CAF50',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                fill: true,
                borderWidth: 2,
                tension: 0.1,
            }]
        };
    }

    myEquityChart = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: chartTitle }
            }
        }
    });
}

function createSignalPieChart(signalLog) {
    const ctx = document.getElementById('signalPieChart').getContext('2d');
    const signals = { '做多 (Long)': 0, '做空 (Short)': 0, '觀望 (Hold)': 0 };
    signalLog.forEach(d => {
        if (signals[d.predicted_signal] !== undefined) {
            signals[d.predicted_signal]++;
        }
    });

    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(signals),
            datasets: [{
                data: Object.values(signals),
                backgroundColor: [ '#00bcd4', '#F44336', '#9E9E9E' ]
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function populateTradeLogTable(tradeLog) {
    const tableBody = document.getElementById('tradeLogTable').getElementsByTagName('tbody')[0];
    let tableHtml = '';
    tradeLog.forEach(row => {
        const pnlClass = row.pnl > 0 ? 'correct-true' : 'correct-false';
        tableHtml += `
            <tr>
                <td>${row.entry_date}</td>
                <td>${row.symbol}</td>
                <td>${row.direction}</td>
                <td>${row.entry_price}</td>
                <td>${row.exit_price}</td>
                <td>${row.position_size.toFixed(4)}</td>
                <td class="${pnlClass}">${row.pnl.toFixed(2)}</td>
            </tr>
        `;
    });
    tableBody.innerHTML = tableHtml;
}