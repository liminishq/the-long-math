/* ============================================================
   Portfolio Growth Calculator — Chart Component
   ============================================================
   
   Vanilla JS Canvas-based line chart for portfolio paths.
   Supports multiple series with toggle visibility.
   ============================================================ */

// ============================================================
// Chart configuration
// ============================================================
const CHART_CONFIG = {
  padding: { top: 20, right: 20, bottom: 40, left: 60 },
  colors: {
    cash: '#888888',
    tBill: '#4A90E2',
    bond: '#50C878',
    gic: '#FFB84D',
    equities: '#D9B46A',
    activeFund: '#E85D75'
  },
  lineWidth: 2
};

// ============================================================
// Chart class
// ============================================================
class PortfolioChart {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = { ...CHART_CONFIG, ...options };
    this.data = null;
    this.visibleSeries = new Set(['equities', 'activeFund', 'tBill', 'cash', 'gic', 'bond']);
    this.resize();
    
    // Handle window resize
    window.addEventListener('resize', () => this.resize());
  }
  
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.draw();
  }
  
  setData(data) {
    this.data = data;
    this.draw();
  }
  
  toggleSeries(seriesName) {
    if (this.visibleSeries.has(seriesName)) {
      this.visibleSeries.delete(seriesName);
    } else {
      this.visibleSeries.add(seriesName);
    }
    this.draw();
  }
  
  setVisibleSeries(series) {
    this.visibleSeries = new Set(series);
    this.draw();
  }
  
  draw() {
    if (!this.data) return;
    
    const ctx = this.ctx;
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    const p = this.options.padding;
    
    const chartWidth = width - p.left - p.right;
    const chartHeight = height - p.top - p.bottom;
    
    // Clear
    ctx.clearRect(0, 0, width, height);
    
    // Collect all paths (only from available series)
    const paths = [];
    if (this.data.cash && this.data.cash.ok && this.visibleSeries.has('cash')) {
      paths.push({ name: 'cash', path: this.data.cash.path, color: this.options.colors.cash });
    }
    if (this.data.tBill && this.data.tBill.ok && this.visibleSeries.has('tBill')) {
      paths.push({ name: 'tBill', path: this.data.tBill.path, color: this.options.colors.tBill });
    }
    if (this.data.bond && this.data.bond.ok && this.visibleSeries.has('bond')) {
      paths.push({ name: 'bond', path: this.data.bond.path, color: this.options.colors.bond });
    }
    if (this.data.gic && this.data.gic.ok && this.visibleSeries.has('gic')) {
      paths.push({ name: 'gic', path: this.data.gic.path, color: this.options.colors.gic });
    }
    if (this.data.equities && this.data.equities.ok && this.visibleSeries.has('equities')) {
      paths.push({ name: 'equities', path: this.data.equities.path, color: this.options.colors.equities });
    }
    if (this.data.activeFund && this.data.activeFund.ok && this.visibleSeries.has('activeFund')) {
      paths.push({ name: 'activeFund', path: this.data.activeFund.path, color: this.options.colors.activeFund });
    }
    
    if (paths.length === 0) {
      // Show message if no data to plot
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || 'rgba(238,242,247,0.72)';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Not enough data to plot', width / 2, height / 2);
      return;
    }
    
    // Find min/max values (only finite values)
    let minValue = Infinity;
    let maxValue = -Infinity;
    
    paths.forEach(({ path }) => {
      path.forEach(({ value, valueReal }) => {
        const v = valueReal != null ? valueReal : value;
        if (v != null && Number.isFinite(v)) {
          if (v < minValue) minValue = v;
          if (v > maxValue) maxValue = v;
        }
      });
    });
    
    // Safety check: if no valid values found, don't draw
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue === Infinity || maxValue === -Infinity) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || 'rgba(238,242,247,0.72)';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Not enough data to plot', width / 2, height / 2);
      return;
    }
    
    // Add padding
    const range = maxValue - minValue;
    minValue -= range * 0.05;
    maxValue += range * 0.05;
    
    // Value scale
    const valueScale = (v) => {
      return chartHeight - ((v - minValue) / (maxValue - minValue)) * chartHeight;
    };
    
    // Time scale
    const timeScale = (index, total) => {
      return (index / (total - 1)) * chartWidth;
    };
    
    // Draw grid lines
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border') || 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    
    // Horizontal grid lines (value)
    for (let i = 0; i <= 5; i++) {
      const y = p.top + (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(p.left, y);
      ctx.lineTo(p.left + chartWidth, y);
      ctx.stroke();
    }
    
    // Vertical grid lines (time)
    for (let i = 0; i <= 5; i++) {
      const x = p.left + (chartWidth / 5) * i;
      ctx.beginPath();
      ctx.moveTo(x, p.top);
      ctx.lineTo(x, p.top + chartHeight);
      ctx.stroke();
    }
    
    // Draw axes
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text') || '#eef2f7';
    ctx.lineWidth = 2;
    
    // X-axis
    ctx.beginPath();
    ctx.moveTo(p.left, p.top + chartHeight);
    ctx.lineTo(p.left + chartWidth, p.top + chartHeight);
    ctx.stroke();
    
    // Y-axis
    ctx.beginPath();
    ctx.moveTo(p.left, p.top);
    ctx.lineTo(p.left, p.top + chartHeight);
    ctx.stroke();
    
    // Draw labels
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || 'rgba(238,242,247,0.72)';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    
    // Y-axis labels
    for (let i = 0; i <= 5; i++) {
      const value = minValue + (maxValue - minValue) * (1 - i / 5);
      const y = p.top + (chartHeight / 5) * i;
      const label = formatCurrency(value);
      ctx.fillText(label, p.left - 8, y);
    }
    
    // X-axis labels (first, middle, last)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const samplePath = paths[0].path;
    if (samplePath.length > 0) {
      const firstMonth = samplePath[0].month;
      const lastMonth = samplePath[samplePath.length - 1].month;
      const midIndex = Math.floor(samplePath.length / 2);
      const midMonth = samplePath[midIndex]?.month || firstMonth;
      
      ctx.fillText(formatMonth(firstMonth), p.left, p.top + chartHeight + 12);
      ctx.fillText(formatMonth(midMonth), p.left + chartWidth / 2, p.top + chartHeight + 12);
      ctx.fillText(formatMonth(lastMonth), p.left + chartWidth, p.top + chartHeight + 12);
    }
    
    // Draw lines
    paths.forEach(({ path, color }) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = this.options.lineWidth;
      ctx.beginPath();
      
      path.forEach((point, idx) => {
        const value = point.valueReal != null ? point.valueReal : point.value;
        
        // Skip non-finite values
        if (value == null || !Number.isFinite(value)) {
          return;
        }
        
        const x = p.left + timeScale(idx, path.length);
        const y = p.top + valueScale(value);
        
        if (idx === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      ctx.stroke();
    });
  }
}

// ============================================================
// Helper: Format currency
// ============================================================
function formatCurrency(value) {
  if (value >= 1000000) {
    return '$' + (value / 1000000).toFixed(2) + 'M';
  } else if (value >= 1000) {
    return '$' + (value / 1000).toFixed(1) + 'k';
  } else {
    return '$' + value.toFixed(0);
  }
}

// ============================================================
// Helper: Format month (YYYY-MM → "YYYY MMM")
// ============================================================
function formatMonth(monthKey) {
  const [year, month] = monthKey.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return monthNames[parseInt(month) - 1] + ' ' + year;
}

// ============================================================
// Export
// ============================================================
window.PortfolioChart = PortfolioChart;
