import * as vscode from 'vscode';

export const TABLE_MIME_TYPE = 'application/vnd.ducklab.table+json';
export const TABLE_RENDERER_ID = 'ducklab.tableRenderer';

export interface TableColumn {
    name: string;
    type?: string;
    nativeType?: string;
}

export interface TableFilters {
    search: string;
    text: Record<string, string>;
    values: Record<string, string[]>;
}

export interface TableRequest {
    kind: 'ducklab.table.request';
    requestId: string;
    queryId: string;
    operation: 'page' | 'distinct';
    page?: number;
    pageSize?: number;
    filters?: TableFilters;
    sortColumn?: string;
    sortAscending?: boolean;
    column?: string;
    valueSearch?: string;
    includeStats?: boolean;
}

export interface TableResponse {
    kind: 'ducklab.table.response';
    requestId: string;
    queryId: string;
    ok: boolean;
    data?: Partial<ServerTableData> & { distinctValues?: string[]; hasMoreDistinct?: boolean };
    error?: string;
}

export interface ServerTableData {
    queryId: string;
    columns: TableColumn[];
    values: Record<string, unknown>[];
    totalRows: number;
    page: number;
    pageSize: number;
    stats?: Record<string, { nonNull: number; min?: number; max?: number; bins?: number[] }>;
}

type QueryEntry = {
    notebookUri: string;
    cellId: string;
    fetch: (request: TableRequest) => Promise<Partial<ServerTableData> & { distinctValues?: string[]; hasMoreDistinct?: boolean }>;
};

export class TableQueryRegistry implements vscode.Disposable {
    private readonly entries = new Map<string, QueryEntry>();
    private readonly messaging: vscode.NotebookRendererMessaging;
    private readonly disposable: vscode.Disposable;
    private readonly closeListener: vscode.Disposable;

    constructor() {
        this.messaging = vscode.notebooks.createRendererMessaging(TABLE_RENDERER_ID);
        this.disposable = this.messaging.onDidReceiveMessage(async event => {
            const request = event.message as TableRequest;
            if (!request || request.kind !== 'ducklab.table.request' || typeof request.queryId !== 'string') return;
            const entry = this.entries.get(request.queryId);
            if (!entry || entry.notebookUri !== event.editor.notebook.uri.toString()) {
                await this.messaging.postMessage({
                    kind: 'ducklab.table.response', requestId: request.requestId, queryId: request.queryId,
                    ok: false, error: 'This query result is no longer available. Rerun the cell to refresh it.'
                } satisfies TableResponse, event.editor);
                return;
            }
            try {
                const data = await entry.fetch(request);
                // A cell can be rerun while a page request is still executing in
                // the kernel. Do not let that obsolete request repopulate output.
                if (this.entries.get(request.queryId) !== entry) {
                    await this.messaging.postMessage({
                        kind: 'ducklab.table.response', requestId: request.requestId, queryId: request.queryId,
                        ok: false, error: 'This query result is no longer available. Rerun the cell to refresh it.'
                    } satisfies TableResponse, event.editor);
                    return;
                }
                await this.messaging.postMessage({
                    kind: 'ducklab.table.response', requestId: request.requestId, queryId: request.queryId,
                    ok: true, data
                } satisfies TableResponse, event.editor);
            } catch (error) {
                await this.messaging.postMessage({
                    kind: 'ducklab.table.response', requestId: request.requestId, queryId: request.queryId,
                    ok: false, error: error instanceof Error ? error.message : String(error)
                } satisfies TableResponse, event.editor);
            }
        });
        this.closeListener = vscode.workspace.onDidCloseNotebookDocument(notebook => this.removeNotebook(notebook.uri));
    }

    register(queryId: string, notebookUri: vscode.Uri, cellId: string,
        fetch: QueryEntry['fetch']): void {
        this.removeCell(notebookUri, cellId);
        this.entries.set(queryId, { notebookUri: notebookUri.toString(), cellId, fetch });
    }

    removeCell(notebookUri: vscode.Uri, cellId: string): void {
        for (const [id, entry] of this.entries) {
            if (entry.notebookUri === notebookUri.toString() && entry.cellId === cellId) this.entries.delete(id);
        }
    }

    private removeNotebook(notebookUri: vscode.Uri): void {
        for (const [id, entry] of this.entries) {
            if (entry.notebookUri === notebookUri.toString()) this.entries.delete(id);
        }
    }

    dispose(): void {
        this.disposable.dispose();
        this.closeListener.dispose();
        this.entries.clear();
    }
}

export function quoteSqlIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
}

export function quoteSqlString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

export function buildTablePredicate(columns: TableColumn[], filters?: TableFilters, sourceAlias?: string): string {
    if (!filters) return '';
    const columnRef = (name: string) => sourceAlias
        ? `${quoteSqlIdentifier(sourceAlias)}.${quoteSqlIdentifier(name)}`
        : quoteSqlIdentifier(name);
    const predicates: string[] = [];
    const search = filters.search.trim();
    if (search) {
        const needle = quoteSqlString(search.toLocaleLowerCase());
        predicates.push(`(${columns.map(column => `contains(lower(coalesce(CAST(${columnRef(column.name)} AS VARCHAR), 'NULL')), ${needle})`).join(' OR ')})`);
    }
    for (const [name, query] of Object.entries(filters.text)) {
        if (!query) continue;
        predicates.push(`contains(lower(coalesce(CAST(${columnRef(name)} AS VARCHAR), 'NULL')), ${quoteSqlString(query.toLocaleLowerCase())})`);
    }
    for (const [name, values] of Object.entries(filters.values)) {
        if (!values.length) predicates.push('FALSE');
        else predicates.push(`coalesce(CAST(${columnRef(name)} AS VARCHAR), 'NULL') IN (${values.map(quoteSqlString).join(', ')})`);
    }
    return predicates.length ? ` WHERE ${predicates.join(' AND ')}` : '';
}

export function buildTablePageSql(query: string, columns: TableColumn[], request: TableRequest): { page: string; count: string } {
    const source = `(${query.trim().replace(/;\s*$/, '')}) AS __ducklab_source`;
    const predicate = buildTablePredicate(columns, request.filters);
    const order = request.sortColumn && columns.some(column => column.name === request.sortColumn)
        ? ` ORDER BY ${quoteSqlIdentifier(request.sortColumn)} ${request.sortAscending === false ? 'DESC' : 'ASC'} NULLS LAST`
        : '';
    const pageSize = Math.max(1, Math.min(100, Math.trunc(request.pageSize ?? 10)));
    const page = Math.max(0, Math.trunc(request.page ?? 0));
    return {
        page: `SELECT * FROM ${source}${predicate}${order} LIMIT ${pageSize} OFFSET ${page * pageSize}`,
        count: `SELECT count(*) AS total_rows FROM ${source}${predicate}`
    };
}

export function normalizeTableQuery(query: string): string {
    const fromOnly = /^(\s*(?:(?:--[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/\s*))*)FROM\b/i;
    return query.trim().replace(fromOnly, '$1SELECT * FROM').replace(/;\s*$/, '');
}

async function collectExploreStats(query: string, columns: TableColumn[], filters: TableFilters | undefined,
    runQuery: (sql: string) => Promise<{ columns: TableColumn[]; values: Record<string, unknown>[] }>,
    dialect: 'duckdb' | 'spark'): Promise<NonNullable<ServerTableData['stats']>> {
    const source = `(${normalizeTableQuery(query)}) AS __ducklab_source`;
    const where = buildTablePredicate(columns, filters);
    const stats: NonNullable<ServerTableData['stats']> = {};
    const histograms: Array<{ column: TableColumn; index: number; expression: string; temporal: boolean }> = [];
    const aggregateFields: string[] = [];
    for (const [index, column] of columns.entries()) {
        const identifier = quoteSqlIdentifier(column.name);
        const nativeType = column.nativeType ?? column.type ?? '';
        const temporal = /(?:DATE|TIME|TIMESTAMP)/i.test(nativeType) || /^(?:date|datetime)/i.test(column.type ?? '');
        const numeric = !temporal && (column.type === 'number' || /(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|FLOAT|DOUBLE|DECIMAL|NUMERIC)/i.test(nativeType));
        aggregateFields.push(`count(${identifier}) AS n${index}`);
        if (!numeric && !temporal) continue;
        let expression = `CAST(${identifier} AS DOUBLE)`;
        if (temporal) {
            const epoch = dialect === 'spark' ? 'unix_timestamp' : 'epoch';
            expression = /^DATE\b/i.test(nativeType)
                ? `${epoch}(CAST(${identifier} AS TIMESTAMP))`
                : /^TIME\b/i.test(nativeType)
                    ? `${epoch}(CAST(CURRENT_DATE + ${identifier} AS TIMESTAMP))`
                    : `${epoch}(${identifier})`;
        }
        aggregateFields.push(`min(${expression}) AS lo${index}`, `max(${expression}) AS hi${index}`);
        histograms.push({ column, index, expression, temporal });
    }
    const aggregate = await runQuery(`SELECT ${aggregateFields.join(', ')} FROM ${source}${where}`);
    const bounds = aggregate.values[0] ?? {};
    for (const [index, column] of columns.entries()) {
        const histogram = histograms.find(item => item.index === index);
        const scale = histogram?.temporal ? 1000 : 1;
        stats[column.name] = {
            nonNull: Number(bounds[`n${index}`] ?? 0),
            min: histogram && bounds[`lo${index}`] != null ? Number(bounds[`lo${index}`]) * scale : undefined,
            max: histogram && bounds[`hi${index}`] != null ? Number(bounds[`hi${index}`]) * scale : undefined
        };
    }
    if (!histograms.length) return stats;

    const boundFields = histograms.flatMap(({ index }) => [`min(${histograms.find(item => item.index === index)!.expression}) AS lo${index}`, `max(${histograms.find(item => item.index === index)!.expression}) AS hi${index}`]);
    const qualifiedWhere = buildTablePredicate(columns, filters, '__ducklab_source');
    const binFields = histograms.flatMap(({ column, index, expression }) => {
        const identifier = `__ducklab_source.${quoteSqlIdentifier(column.name)}`;
        const qualifiedExpression = expression.replaceAll(quoteSqlIdentifier(column.name), identifier);
        return Array.from({ length: 10 }, (_, bin) => `count(*) FILTER (WHERE ${identifier} IS NOT NULL AND CASE WHEN b.hi${index} = b.lo${index} THEN 0 WHEN ${qualifiedExpression} >= b.hi${index} THEN 9 ELSE greatest(0, least(9, CAST(floor(((${qualifiedExpression} - b.lo${index}) / (b.hi${index} - b.lo${index})) * 10) AS INTEGER))) END = ${bin}) AS h${index}_${bin}`);
    });
    const histogramSql = `WITH __ducklab_bounds AS (SELECT ${boundFields.join(', ')} FROM ${source}${where}) SELECT ${histograms.map(({ index }) => `b.lo${index}, b.hi${index}`).join(', ')}, ${binFields.join(', ')} FROM ${source} CROSS JOIN __ducklab_bounds b${qualifiedWhere} GROUP BY ${histograms.map(({ index }) => `b.lo${index}, b.hi${index}`).join(', ')}`;
    const histogramResult = await runQuery(histogramSql);
    const histogramRow = histogramResult.values[0] ?? {};
    for (const { column, index } of histograms) {
        stats[column.name].bins = Array.from({ length: 10 }, (_, bin) => Number(histogramRow[`h${index}_${bin}`] ?? 0));
    }
    return stats;
}

export async function createPagedTableResult(query: string,
    runQuery: (sql: string) => Promise<{ columns: TableColumn[]; values: Record<string, unknown>[] }>,
    registry: TableQueryRegistry, notebookUri: vscode.Uri, cellId: string,
    redact: (message: string) => string = message => message,
    dialect: 'duckdb' | 'spark' = 'duckdb'): Promise<ServerTableData | null> {
    const normalized = normalizeTableQuery(query);
    let probe: { columns: TableColumn[]; values: Record<string, unknown>[] };
    try {
        probe = await runQuery(`SELECT * FROM (${normalized}) AS __ducklab_probe LIMIT 0`);
    } catch {
        return null;
    }
    if (!probe.columns.length) return null;
    const queryId = crypto.randomUUID();
    const countCache = new Map<string, number>();
    const statsCache = new Map<string, NonNullable<ServerTableData['stats']>>();
    const fetch = async (request: TableRequest) => {
        if (request.operation === 'distinct') {
            const column = probe.columns.find(item => item.name === request.column);
            if (!column) throw new Error('Unknown table column.');
            const filters = request.filters ? { ...request.filters, values: { ...request.filters.values } } : undefined;
            if (filters) delete filters.values[column.name];
            const where = buildTablePredicate(probe.columns, filters);
            const search = (request.valueSearch ?? '').trim();
            const searchSql = search
                ? `contains(lower(coalesce(CAST(${quoteSqlIdentifier(column.name)} AS VARCHAR), 'NULL')), ${quoteSqlString(search.toLocaleLowerCase())})`
                : 'TRUE';
            const sql = `SELECT DISTINCT coalesce(CAST(${quoteSqlIdentifier(column.name)} AS VARCHAR), 'NULL') AS value FROM (${normalized}) AS __ducklab_source${where}${where ? ' AND' : ' WHERE'} ${searchSql} ORDER BY value LIMIT 201`;
            const result = await runQuery(sql);
            const values = result.values.map(row => String(row.value));
            return { distinctValues: values.slice(0, 200), hasMoreDistinct: values.length > 200 };
        }
        const sql = buildTablePageSql(normalized, probe.columns, request);
        const statsKey = JSON.stringify(request.filters ?? { search: '', text: {}, values: {} });
        let totalRows = countCache.get(statsKey);
        if (totalRows === undefined) {
            const countResult = await runQuery(sql.count);
            totalRows = Number(countResult.values[0]?.total_rows ?? 0);
            countCache.set(statsKey, totalRows);
        }
        const pageResult = await runQuery(sql.page);
        if (request.includeStats && !statsCache.has(statsKey)) {
            statsCache.set(statsKey, await collectExploreStats(normalized, probe.columns, request.filters, runQuery, dialect));
        }
        const page = Math.max(0, Math.trunc(request.page ?? 0));
        const pageSize = Math.max(1, Math.min(100, Math.trunc(request.pageSize ?? 10)));
        return {
            columns: probe.columns,
            values: pageResult.values.map((row, index) => ({ ...row, _index: page * pageSize + index })),
            totalRows,
            page,
            pageSize,
            stats: request.includeStats ? statsCache.get(statsKey) : undefined
        };
    };
    const initial = await fetch({
        kind: 'ducklab.table.request', requestId: crypto.randomUUID(), queryId,
        operation: 'page', page: 0, pageSize: 10,
        filters: { search: '', text: {}, values: {} }, includeStats: false
    });
    registry.register(queryId, notebookUri, cellId, async request => {
        try { return await fetch(request); }
        catch (error) { throw new Error(redact(error instanceof Error ? error.message : String(error))); }
    });
    return { queryId, ...initial } as ServerTableData;
}
