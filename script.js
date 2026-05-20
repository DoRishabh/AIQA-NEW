// State management
const state = {
    charts: [],
    schema: null,
    isLoading: false
};

// Chart color palette
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

// DOM Elements
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

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    checkConnection();
    loadSchema();
});

// Event Listeners
function initializeEventListeners() {
    // Run query button
    elements.runQueryBtn.addEventListener('click', () => executeQuery());
    
    // Enter key to run query
    elements.queryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') executeQuery();
    });
    
    // Sample queries in sidebar
    document.querySelectorAll('.sample-query-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            elements.queryInput.value = btn.dataset.query;
            executeQuery();
        });
    });
    
    // Quick queries in empty state
    document.querySelectorAll('.quick-query').forEach(btn => {
        btn.addEventListener('click', () => {
            elements.queryInput.value = btn.dataset.query;
            executeQuery();
        });
    });
    
    // Navigation buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const view = btn.dataset.view;
            if (view === 'dashboard') {
                elements.dashboardView.classList.remove('hidden');
                elements.schemaView.classList.add('hidden');
            } else if (view === 'schema') {
                elements.dashboardView.classList.add('hidden');
                elements.schemaView.classList.remove('hidden');
            }
        });
    });
    
    // Clear dashboard
    elements.clearDashboard.addEventListener('click', clearDashboard);
    
    // Export dashboard
    elements.exportDashboard.addEventListener('click', exportDashboard);
}

// Check Snowflake connection
async function checkConnection() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();
        
        if (data.success) {
            elements.connectionStatus.classList.add('connected');
            elements.connectionStatus.classList.remove('disconnected');
            elements.connectionStatus.innerHTML = `
                <i class="fas fa-circle"></i>
                <span>Connected to ${data.database}</span>
            `;
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        elements.connectionStatus.classList.add('disconnected');
        elements.connectionStatus.classList.remove('connected');
        elements.connectionStatus.innerHTML = `
            <i class="fas fa-circle"></i>
            <span>Connection failed</span>
        `;
        showToast('Connection Error', error.message, 'error');
    }
}

// Load database schema
async function loadSchema() {
    try {
        const response = await fetch('/api/schema');
        const data = await response.json();
        
        if (data.success) {
            state.schema = data.schema;
            renderSchema(data.schema);
        }
    } catch (error) {
        console.error('Failed to load schema:', error);
    }
}

// Render schema explorer
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

// Execute query
async function executeQuery() {
    const query = elements.queryInput.value.trim();
    
    if (!query) {
        showToast('Empty Query', 'Please enter a question or query', 'error');
        return;
    }
    
    setLoading(true);
    
    try {
        const response = await fetch('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        
        const data = await response.json();
        
        if (data.success) {
            hideEmptyState();
            addChartCard(data);
            showToast('Query Successful', 'Visualization created', 'success');
        } else {
            throw new Error(data.error || 'Query failed');
        }
    } catch (error) {
        console.error('Query error:', error);
        showToast('Query Failed', error.message, 'error');
    } finally {
        setLoading(false);
    }
}

// Add chart card to dashboard
function addChartCard(data) {
    const cardId = `chart-${Date.now()}`;
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.id = cardId;
    
    const chartType = data.chartType || 'bar';
    const config = data.chartConfig || {};
    
    card.innerHTML = `
        <div class="chart-card-header">
            <div class="chart-card-title">
                <h3>${config.title || 'Query Result'}</h3>
                <p>${config.description || ''}</p>
            </div>
            <div class="chart-card-actions">
                <button onclick="toggleSql('${cardId}')" title="View SQL">
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
        <div class="chart-card-body">
            ${renderChartContent(cardId, chartType, data.data, config)}
        </div>
        <div class="sql-preview" id="sql-${cardId}" style="display: none;">
            ${escapeHtml(data.sql)}
        </div>
    `;
    
    elements.dashboardGrid.insertBefore(card, elements.dashboardGrid.firstChild);
    
    // Initialize chart if needed
    if (['bar', 'line', 'pie', 'doughnut', 'area', 'scatter'].includes(chartType)) {
        initializeChart(cardId, chartType, data.data, config);
    }
    
    // Store chart info for refresh
    state.charts.push({
        id: cardId,
        query: elements.queryInput.value,
        type: chartType,
        config: config
    });
}

// Render chart content based on type
function renderChartContent(cardId, chartType, data, config) {
    if (chartType === 'metric') {
        return renderMetric(data, config);
    } else if (chartType === 'table') {
        return renderTable(data);
    } else {
        return `<canvas id="canvas-${cardId}"></canvas>`;
    }
}

// Render metric display
function renderMetric(data, config) {
    if (!data || data.length === 0) return '<p>No data</p>';
    
    const row = data[0];
    const keys = Object.keys(row);
    
    if (keys.length === 1) {
        const value = formatValue(row[keys[0]]);
        return `
            <div class="metric-display">
                <div class="metric-value">${value}</div>
                <div class="metric-label">${keys[0]}</div>
            </div>
        `;
    }
    
    // Multiple metrics
    return `
        <div style="display: flex; gap: 40px; flex-wrap: wrap; justify-content: center;">
            ${keys.map(key => `
                <div class="metric-display">
                    <div class="metric-value">${formatValue(row[key])}</div>
                    <div class="metric-label">${key}</div>
                </div>
            `).join('')}
        </div>
    `;
}

// Render data table
function renderTable(data) {
    if (!data || data.length === 0) return '<p>No data</p>';
    
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
                    ${data.slice(0, 100).map(row => `
                        <tr>
                            ${columns.map(col => `<td>${formatValue(row[col])}</td>`).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// Initialize Chart.js chart
function initializeChart(cardId, chartType, data, config) {
    const canvas = document.getElementById(`canvas-${cardId}`);
    if (!canvas || !data || data.length === 0) return;
    
    const ctx = canvas.getContext('2d');
    
    // Determine label and value fields
    const keys = Object.keys(data[0]);
    const labelField = config.labelField || config.xAxis || keys[0];
    const valueField = config.valueField || config.yAxis || keys[1] || keys[0];
    
    const labels = data.map(row => row[labelField]);
    const values = data.map(row => parseFloat(row[valueField]) || 0);
    
    let chartConfig = {
        type: chartType === 'area' ? 'line' : chartType,
        data: {
            labels: labels,
            datasets: [{
                label: valueField,
                data: values,
                backgroundColor: chartType === 'pie' || chartType === 'doughnut' 
                    ? chartColors.gradient 
                    : chartColors.gradient[0],
                borderColor: chartType === 'line' || chartType === 'area' 
                    ? chartColors.primary[0] 
                    : 'transparent',
                borderWidth: chartType === 'line' || chartType === 'area' ? 3 : 0,
                fill: chartType === 'area',
                tension: 0.4,
                pointBackgroundColor: chartColors.primary[0],
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: chartType === 'pie' || chartType === 'doughnut',
                    position: 'bottom',
                    labels: {
                        color: '#94a3b8',
                        padding: 20,
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#f8fafc',
                    bodyColor: '#94a3b8',
                    borderColor: '#334155',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: chartType === 'pie' || chartType === 'doughnut' ? {} : {
                x: {
                    grid: { color: '#334155', drawBorder: false },
                    ticks: { color: '#94a3b8', font: { size: 11 } }
                },
                y: {
                    grid: { color: '#334155', drawBorder: false },
                    ticks: { color: '#94a3b8', font: { size: 11 } },
                    beginAtZero: true
                }
            }
        }
    };
    
    new Chart(ctx, chartConfig);
}

// Format values for display
function formatValue(value) {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'number') {
        if (Math.abs(value) >= 1000000) {
            return (value / 1000000).toFixed(1) + 'M';
        } else if (Math.abs(value) >= 1000) {
            return (value / 1000).toFixed(1) + 'K';
        }
        return value.toLocaleString();
    }
    return value;
}

// Toggle SQL preview
function toggleSql(cardId) {
    const sqlPreview = document.getElementById(`sql-${cardId}`);
    sqlPreview.style.display = sqlPreview.style.display === 'none' ? 'block' : 'none';
}

// Remove chart
function removeChart(cardId) {
    const card = document.getElementById(cardId);
    if (card) {
        card.remove();
        state.charts = state.charts.filter(c => c.id !== cardId);
        
        if (state.charts.length === 0) {
            showEmptyState();
        }
    }
}

// Refresh chart
async function refreshChart(cardId) {
    const chartInfo = state.charts.find(c => c.id === cardId);
    if (chartInfo) {
        elements.queryInput.value = chartInfo.query;
        removeChart(cardId);
        await executeQuery();
    }
}

// Clear dashboard
function clearDashboard() {
    state.charts.forEach(chart => {
        const card = document.getElementById(chart.id);
        if (card) card.remove();
    });
    state.charts = [];
    showEmptyState();
    showToast('Dashboard Cleared', 'All visualizations removed', 'info');
}

// Export dashboard
function exportDashboard() {
    const dashboardData = {
        exportDate: new Date().toISOString(),
        charts: state.charts.map(c => ({
            query: c.query,
            type: c.type,
            config: c.config
        }))
    };
    
    const blob = new Blob([JSON.stringify(dashboardData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Export Complete', 'Dashboard exported successfully', 'success');
}

// Show/hide empty state
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

// Loading state
function setLoading(loading) {
    state.isLoading = loading;
    elements.loadingOverlay.classList.toggle('hidden', !loading);
    elements.runQueryBtn.disabled = loading;
}

// Toast notifications
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
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Utility: Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
