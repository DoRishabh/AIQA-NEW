const state = {
    charts: [],
    schema: null,
    isLoading: false
};

const chartColors = {
    primary: ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff'],
    vibrant: ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'],
    gradient: [
        'rgba(99, 102, 241, 0.8)',
        'rgba(14, 165, 233, 0.8)',
        'rgba(16, 185, 129, 0.8)',
        'rgba(245, 158, 11, 0.8)',
        'rgba(239, 68, 68, 0.8)',
        'rgba(139, 92, 246, 0.8)',
        'rgba(236, 72, 153, 0.8)',
        'rgba(20, 184, 166, 0.8)'
    ]
};

const elements = {
    queryInput: document.getElementById('queryInput'),
    runQueryBtn: document.getElementById('runQuery'),
    dashboardGrid: document.getElementById('dashboardGrid'),
    emptyState: document.getElementById('emptyState'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    connectionStatus: document.getElementById('connectionStatus'),
    toastContainer: document.getElementById('toastContainer'),
    dashboardView: document.getElementById('dashboardView'),
    schemaView: document.getElementById('schemaView'),
    schemaGrid: document.getElementById('schemaGrid'),
    clearDashboard: document.getElementById('clearDashboard'),
    exportDashboard: document.getElementById('exportDashboard')
};

document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    checkConnection();
    loadSchema();
});

function initializeEventListeners() {

    elements.runQueryBtn.addEventListener('click', () => executeQuery());

    elements.queryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            executeQuery();
        }
    });

    document.querySelectorAll('.sample-query-btn').forEach(btn => {

        btn.addEventListener('click', () => {

            elements.queryInput.value = btn.dataset.query;
            executeQuery();
        });
    });

    document.querySelectorAll('.quick-query').forEach(btn => {

        btn.addEventListener('click', () => {

            elements.queryInput.value = btn.dataset.query;
            executeQuery();
        });
    });

    document.querySelectorAll('.nav-btn').forEach(btn => {

        btn.addEventListener('click', () => {

            document.querySelectorAll('.nav-btn').forEach(b => {
                b.classList.remove('active');
            });

            btn.classList.add('active');

            const view = btn.dataset.view;

            if (view === 'dashboard') {

                elements.dashboardView.classList.remove('hidden');
                elements.schemaView.classList.add('hidden');

            } else {

                elements.dashboardView.classList.add('hidden');
                elements.schemaView.classList.remove('hidden');
            }
        });
    });

    elements.clearDashboard.addEventListener('click', clearDashboard);

    elements.exportDashboard.addEventListener('click', exportDashboard);
}

async function checkConnection() {

    try {

        const response = await fetch('/api/health');
        const data = await response.json();

        if (data.success) {

            elements.connectionStatus.classList.add('connected');

            elements.connectionStatus.innerHTML = `
                <i class="fas fa-circle"></i>
                <span>Connected to ${data.database}</span>
            `;

        } else {

            throw new Error(data.error);
        }

    } catch (error) {

        elements.connectionStatus.classList.add('disconnected');

        elements.connectionStatus.innerHTML = `
            <i class="fas fa-circle"></i>
            <span>Connection Failed</span>
        `;

        showToast('Connection Error', error.message, 'error');
    }
}

async function loadSchema() {

    try {

        const response = await fetch('/api/schema');
        const data = await response.json();

        if (data.success) {

            state.schema = data.schema;
            renderSchema(data.schema);
        }

    } catch (error) {

        console.error(error);
    }
}

function renderSchema(schema) {

    elements.schemaGrid.innerHTML = Object.entries(schema)
        .map(([tableName, columns]) => `

            <div class="schema-card">

                <div class="schema-card-header">
                    <i class="fas fa-table"></i>
                    <h3>${tableName}</h3>
                </div>

                <div class="schema-card-body">

                    ${columns.map(col => `

                        <div class="schema-column">
                            <span class="schema-column-name">${col.name}</span>
                            <span class="schema-column-type">${col.type}</span>
                        </div>

                    `).join('')}

                </div>

            </div>

        `).join('');
}

async function executeQuery() {

    const query = elements.queryInput.value.trim();

    if (!query) {

        showToast('Empty Query', 'Please enter a query', 'error');
        return;
    }

    setLoading(true);

    try {

        const response = await fetch('/api/query', {

            method: 'POST',

            headers: {
                'Content-Type': 'application/json'
            },

            body: JSON.stringify({ query })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Query failed');
        }

        hideEmptyState();

        addChartCard(data);

        showToast('Success', 'Visualization created successfully', 'success');

    } catch (error) {

        console.error(error);

        showToast('Query Failed', error.message, 'error');

    } finally {

        setLoading(false);
    }
}

function addChartCard(data) {

    const cardId = `chart-${Date.now()}`;

    const card = document.createElement('div');

    card.className = 'chart-card';
    card.id = cardId;

    const chartType = data.chartType || 'table';

    const config = data.chartConfig || {};

    card.innerHTML = `

        <div class="chart-card-header">

            <div class="chart-card-title">
                <h3>${config.title || 'Query Result'}</h3>
                <p>${config.description || ''}</p>
            </div>

            <div class="chart-card-actions">

                <button onclick="toggleSql('${cardId}')" title="SQL Query">
                    <i class="fas fa-code"></i>
                </button>

                <button onclick="refreshChart('${cardId}')" title="Refresh">
                    <i class="fas fa-sync-alt"></i>
                </button>

                <button onclick="removeChart('${cardId}')" title="Remove">
                    <i class="fas fa-times"></i>
                </button>

            </div>

        </div>

        <div class="sql-box" id="sql-${cardId}" style="display:none;">
            <pre>${escapeHtml(data.sql || 'No SQL Generated')}</pre>
        </div>

        <div class="chart-card-body">
            ${renderChartContent(cardId, chartType, data.data, config)}
        </div>

    `;

    elements.dashboardGrid.prepend(card);

    if (
        chartType === 'bar' ||
        chartType === 'line' ||
        chartType === 'pie' ||
        chartType === 'doughnut' ||
        chartType === 'area' ||
        chartType === 'scatter'
    ) {

        setTimeout(() => {
            initializeChart(cardId, chartType, data.data, config);
        }, 100);
    }

    state.charts.push({
        id: cardId,
        query: elements.queryInput.value,
        type: chartType,
        config
    });
}

function renderChartContent(cardId, chartType, data, config) {

    if (chartType === 'metric') {
        return renderMetric(data);
    }

    if (chartType === 'table') {
        return renderTable(data);
    }

    return `
        <div style="height:400px;">
            <canvas id="canvas-${cardId}"></canvas>
        </div>
    `;
}

function renderMetric(data) {

    if (!data || data.length === 0) {
        return `<p>No data found</p>`;
    }

    const row = data[0];

    const keys = Object.keys(row);

    return `
        <div style="display:flex;flex-wrap:wrap;gap:20px;justify-content:center;">
            ${keys.map(key => `
                <div class="metric-display">
                    <div class="metric-value">${formatValue(row[key])}</div>
                    <div class="metric-label">${key}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderTable(data) {

    if (!data || data.length === 0) {
        return `<p>No data found</p>`;
    }

    const columns = Object.keys(data[0]);

    return `

        <div class="data-table-wrapper">

            <table class="data-table">

                <thead>
                    <tr>
                        ${columns.map(col => `<th>${col}</th>`).join('')}
                    </tr>
                </thead>

                <tbody>

                    ${data.map(row => `

                        <tr>

                            ${columns.map(col => `
                                <td>${formatValue(row[col])}</td>
                            `).join('')}

                        </tr>

                    `).join('')}

                </tbody>

            </table>

        </div>

    `;
}

function initializeChart(cardId, chartType, data, config) {

    const canvas = document.getElementById(`canvas-${cardId}`);

    if (!canvas) {
        console.error('Canvas not found');
        return;
    }

    if (!data || data.length === 0) {
        console.error('No chart data');
        return;
    }

    const ctx = canvas.getContext('2d');

    const keys = Object.keys(data[0]);

    const labelField =
        config.labelField ||
        config.xAxis ||
        keys[0];

    const valueField =
        config.valueField ||
        config.yAxis ||
        keys[1];

    const labels = data.map(row => row[labelField]);

    const values = data.map(row => {

        const value = row[valueField];

        return Number(value) || 0;
    });

    new Chart(ctx, {

        type: chartType === 'area' ? 'line' : chartType,

        data: {

            labels,

            datasets: [{

                label: valueField,

                data: values,

                backgroundColor:
                    chartType === 'pie' || chartType === 'doughnut'
                        ? chartColors.gradient
                        : chartColors.gradient[0],

                borderColor: '#6366f1',

                borderWidth: 2,

                fill: chartType === 'area',

                tension: 0.4
            }]
        },

        options: {

            responsive: true,

            maintainAspectRatio: false,

            plugins: {

                legend: {

                    display:
                        chartType === 'pie' ||
                        chartType === 'doughnut'
                }
            },

            scales:
                chartType === 'pie' || chartType === 'doughnut'
                    ? {}
                    : {
                        y: {
                            beginAtZero: true
                        }
                    }
        }
    });
}

function toggleSql(cardId) {

    const sqlBox = document.getElementById(`sql-${cardId}`);

    if (!sqlBox) return;

    sqlBox.style.display =
        sqlBox.style.display === 'none'
            ? 'block'
            : 'none';
}

function removeChart(cardId) {

    const card = document.getElementById(cardId);

    if (card) {
        card.remove();
    }

    state.charts = state.charts.filter(chart => chart.id !== cardId);

    if (state.charts.length === 0) {
        showEmptyState();
    }
}

async function refreshChart(cardId) {

    const chart = state.charts.find(c => c.id === cardId);

    if (!chart) return;

    elements.queryInput.value = chart.query;

    removeChart(cardId);

    await executeQuery();
}

function clearDashboard() {

    state.charts.forEach(chart => {

        const card = document.getElementById(chart.id);

        if (card) {
            card.remove();
        }
    });

    state.charts = [];

    showEmptyState();

    showToast('Dashboard Cleared', 'All charts removed', 'info');
}

function exportDashboard() {

    const exportData = JSON.stringify(state.charts, null, 2);

    const blob = new Blob([exportData], {
        type: 'application/json'
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url;
    a.download = 'dashboard.json';

    a.click();

    URL.revokeObjectURL(url);

    showToast('Exported', 'Dashboard exported successfully', 'success');
}

function hideEmptyState() {

    if (elements.emptyState) {
        elements.emptyState.style.display = 'none';
    }
}

function showEmptyState() {

    if (elements.emptyState) {
        elements.emptyState.style.display = 'block';
    }
}

function setLoading(loading) {

    state.isLoading = loading;

    elements.loadingOverlay.classList.toggle('hidden', !loading);

    elements.runQueryBtn.disabled = loading;
}

function showToast(title, message, type = 'info') {

    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        info: 'fas fa-info-circle'
    };

    const toast = document.createElement('div');

    toast.className = `toast ${type}`;

    toast.innerHTML = `

        <i class="${icons[type]}"></i>

        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>

    `;

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {

        toast.remove();

    }, 4000);
}

function formatValue(value) {

    if (value === null || value === undefined) {
        return '-';
    }

    if (typeof value === 'number') {

        return value.toLocaleString();
    }

    return value;
}

function escapeHtml(text) {

    const div = document.createElement('div');

    div.textContent = text;

    return div.innerHTML;
}
