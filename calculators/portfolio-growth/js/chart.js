/**
 * Chart Management
 * Handles Chart.js initialization and updates
 */

const ChartManager = {
  chart: null,
  canvas: null,

  /**
   * Get theme colors
   */
  getThemeColors() {
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);
    return {
      text: computedStyle.getPropertyValue('--text').trim() || '#eef2f7',
      muted: computedStyle.getPropertyValue('--muted').trim() || 'rgba(238,242,247,.72)',
      border: computedStyle.getPropertyValue('--border').trim() || 'rgba(238,242,247,.14)'
    };
  },

  /**
   * Initialize Chart.js
   */
  init(canvasElement) {
    if (this.chart) {
      this.chart.destroy();
    }

    this.canvas = canvasElement;
    const themeColors = this.getThemeColors();
    const ctx = canvasElement.getContext('2d');
    
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: []
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: themeColors.text,
              font: {
                size: 12
              },
              usePointStyle: true,
              padding: 12
            }
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: themeColors.text,
            bodyColor: themeColors.text,
            borderColor: themeColors.border,
            borderWidth: 1
          }
        },
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: 'Date',
              color: themeColors.text
            },
            ticks: {
              color: themeColors.muted,
              maxRotation: 45,
              minRotation: 0
            },
            grid: {
              color: themeColors.border
            }
          },
          y: {
            display: true,
            title: {
              display: true,
              text: 'Indexed Growth (Start = 1.0)',
              color: themeColors.text
            },
            ticks: {
              color: themeColors.muted
            },
            grid: {
              color: themeColors.border
            },
            type: 'linear',
            beginAtZero: false
          }
        }
      }
    });
  },

  /**
   * Update chart with data
   */
  update(labels, datasets) {
    if (!this.chart) return;

    const themeColors = this.getThemeColors();
    
    // Update theme colors
    this.chart.options.plugins.legend.labels.color = themeColors.text;
    this.chart.options.plugins.tooltip.titleColor = themeColors.text;
    this.chart.options.plugins.tooltip.bodyColor = themeColors.text;
    this.chart.options.plugins.tooltip.borderColor = themeColors.border;
    this.chart.options.scales.x.title.color = themeColors.text;
    this.chart.options.scales.x.ticks.color = themeColors.muted;
    this.chart.options.scales.x.grid.color = themeColors.border;
    this.chart.options.scales.y.title.color = themeColors.text;
    this.chart.options.scales.y.ticks.color = themeColors.muted;
    this.chart.options.scales.y.grid.color = themeColors.border;

    // Calculate y-axis range with 10% headroom
    let maxValue = 0;
    for (const dataset of datasets) {
      if (dataset.data && dataset.data.length > 0) {
        const datasetMax = Math.max(...dataset.data.filter(v => isFinite(v)));
        maxValue = Math.max(maxValue, datasetMax);
      }
    }
    
    if (maxValue > 0) {
      this.chart.options.scales.y.max = maxValue * 1.1;
    }

    this.chart.data.labels = labels;
    this.chart.data.datasets = datasets;
    this.chart.update();
  }
};
