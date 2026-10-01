/**
 * Configurable Supabase JS v2 Client Mock
 * Replicates table querying, filters, ordering, limits, and telemetry.
 */

function createSupabaseMock(config = {}) {
    const queryHistory = [];
    const tables = {
        metas: config.metas ? [...config.metas] : [],
        comidas: config.comidas ? [...config.comidas] : []
    };

    let forceError = config.forceError || null;

    class QueryBuilder {
        constructor(tableName) {
            this.tableName = tableName;
            this.selectedColumns = '*';
            this.filters = [];
            this.sortCol = null;
            this.ascending = true;
            this.limitVal = null;
        }

        select(cols = '*') {
            this.selectedColumns = cols;
            return this;
        }

        eq(column, value) {
            this.filters.push({ type: 'eq', column, value });
            return this;
        }

        gte(column, value) {
            this.filters.push({ type: 'gte', column, value });
            return this;
        }

        order(column, options = {}) {
            this.sortCol = column;
            this.ascending = options.ascending !== false;
            return this;
        }

        limit(n) {
            this.limitVal = n;
            return this;
        }

        async _execute() {
            queryHistory.push({
                table: this.tableName,
                select: this.selectedColumns,
                filters: [...this.filters],
                sort: this.sortCol,
                ascending: this.ascending,
                limit: this.limitVal
            });

            if (forceError) {
                return { data: null, error: forceError };
            }

            let rows = [...(tables[this.tableName] || [])];

            // Apply filters
            for (const f of this.filters) {
                if (f.type === 'eq') {
                    rows = rows.filter(r => r[f.column] == f.value);
                } else if (f.type === 'gte') {
                    rows = rows.filter(r => String(r[f.column]) >= String(f.value));
                }
            }

            // Apply sorting
            if (this.sortCol) {
                const col = this.sortCol;
                const asc = this.ascending;
                rows.sort((a, b) => {
                    if (a[col] < b[col]) return asc ? -1 : 1;
                    if (a[col] > b[col]) return asc ? 1 : -1;
                    return 0;
                });
            }

            // Apply limit
            if (typeof this.limitVal === 'number') {
                rows = rows.slice(0, this.limitVal);
            }

            return { data: rows, error: null };
        }

        then(resolve, reject) {
            return this._execute().then(resolve, reject);
        }
    }

    const client = {
        from: (table) => new QueryBuilder(table),
        table: (table) => new QueryBuilder(table)
    };

    return {
        client,
        clientFactory: {
            createClient: () => client
        },
        queryHistory,
        setTableData(table, rows) {
            tables[table] = [...rows];
        },
        getTableData(table) {
            return tables[table];
        },
        setForceError(err) {
            forceError = err;
        }
    };
}

module.exports = {
    createSupabaseMock
};
