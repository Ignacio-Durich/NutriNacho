/**
 * Chart.js v4 + chartjs-plugin-annotation v3 Mock
 * Captures chart configurations, dataset styling, annotations, and callbacks.
 */

function createChartMock() {
    const instances = [];

    class MockChart {
        constructor(ctx, config) {
            this.ctx = ctx;
            this.config = JSON.parse(JSON.stringify(config || {}));
            // Preserve non-JSON properties like callback functions
            if (config && config.options && config.options.plugins && config.options.plugins.tooltip) {
                this.tooltipCallbacks = config.options.plugins.tooltip.callbacks;
            }
            this.destroyed = false;
            this.updated = false;
            instances.push(this);
        }

        get data() {
            return this.config.data || { labels: [], datasets: [] };
        }

        get options() {
            return this.config.options || {};
        }

        destroy() {
            this.destroyed = true;
        }

        update() {
            this.updated = true;
        }
    }

    return {
        Chart: MockChart,
        instances,
        findChartByCanvasId(id) {
            return instances.find(c => {
                if (!c.ctx) return false;
                if (typeof c.ctx === 'string') return c.ctx === id;
                return c.ctx.id === id || (c.ctx.canvas && c.ctx.canvas.id === id);
            });
        },
        clearInstances() {
            instances.length = 0;
        }
    };
}

module.exports = {
    createChartMock
};
