jest.mock('vscode', () => ({}), { virtual: true });

import { createPagedTableResult, normalizeTableQuery, TableQueryRegistry, TableRequest } from '../src/controller/tableQuery';

describe('server-side table query', () => {
    test('normalizes DuckDB FROM shorthand while preserving leading comments', () => {
        expect(normalizeTableQuery('-- sample\nFROM account;')).toBe('-- sample\nSELECT * FROM account');
        expect(normalizeTableQuery('WITH selected AS (SELECT 1 AS id) SELECT id FROM selected;'))
            .toBe('WITH selected AS (SELECT 1 AS id) SELECT id FROM selected');
    });

    test('loads only the requested page and reuses the filtered row count', async () => {
        const columns = [
            { name: 'id', type: 'number', nativeType: 'INTEGER' },
            { name: 'name', type: 'string', nativeType: 'VARCHAR' }
        ];
        const calls: string[] = [];
        const runQuery = jest.fn(async (sql: string) => {
            calls.push(sql);
            if (sql.includes('__ducklab_probe')) return { columns, values: [] };
            if (sql.includes('AS total_rows')) return { columns: [], values: [{ total_rows: 85226 }] };
            if (sql.includes('__ducklab_bounds')) return {
                columns: [],
                values: [{ lo0: 0, hi0: 85225, ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`h0_${index}`, index === 0 ? 85226 : 0])) }]
            };
            if (sql.includes('AS n0')) return { columns: [], values: [{ n0: 85226, lo0: 0, hi0: 85225, n1: 85226 }] };
            if (sql.includes('AS non_null')) return { columns: [], values: [{ non_null: 85226 }] };
            const offset = Number(sql.match(/OFFSET (\d+)/)?.[1] ?? 0);
            const limit = Number(sql.match(/LIMIT (\d+)/)?.[1] ?? 0);
            return {
                columns,
                values: Array.from({ length: Math.min(limit, Math.max(0, 85226 - offset)) }, (_, index) => ({ id: offset + index, name: `row-${offset + index}` }))
            };
        });
        const queries = new Map<string, (request: TableRequest) => Promise<any>>();
        const registry = {
            register: jest.fn((id: string, _uri: unknown, _cell: string, fetch: (request: TableRequest) => Promise<any>) => queries.set(id, fetch)),
        } as unknown as TableQueryRegistry;
        const uri = { toString: () => 'file:///workspace/table.md' } as any;

        const initial = await createPagedTableResult('SELECT id, name FROM items', runQuery, registry, uri, 'cell-3');

        expect(initial?.totalRows).toBe(85226);
        expect(initial?.values).toHaveLength(10);
        expect(initial?.values[0].id).toBe(0);
        expect(initial?.stats).toBeUndefined();

        const fetch = queries.get(initial!.queryId)!;
        const page3 = await fetch({
            kind: 'ducklab.table.request', requestId: 'page-3', queryId: initial!.queryId,
            operation: 'page', page: 2, pageSize: 10,
            filters: { search: '', text: {}, values: {} }, includeStats: true
        });
        expect(page3.totalRows).toBe(85226);
        expect(page3.values).toHaveLength(10);
        expect(page3.values[0].id).toBe(20);
        expect(page3.stats?.id?.bins).toHaveLength(10);
        expect(calls.filter(sql => sql.includes('AS total_rows'))).toHaveLength(1);
        expect(calls.some(sql => sql.includes('LIMIT 10 OFFSET 20'))).toBe(true);
        expect(calls.every(sql => !/^SELECT \* FROM items\s*$/i.test(sql.trim()))).toBe(true);
    });

    test('pushes search, text filters, value filters, and sort into SQL', () => {
        const { buildTablePageSql } = require('../src/controller/tableQuery');
        const query = buildTablePageSql('SELECT id, name FROM items', [
            { name: 'id', type: 'number' }, { name: 'name', type: 'string' }
        ], {
            kind: 'ducklab.table.request', requestId: 'r', queryId: 'q', operation: 'page', page: 1, pageSize: 25,
            filters: { search: 'alice', text: { name: 'a' }, values: { id: ['7'] } },
            sortColumn: 'id', sortAscending: false
        });
        expect(query.page).toContain('LIMIT 25 OFFSET 25');
        expect(query.page).toContain('ORDER BY "id" DESC NULLS LAST');
        expect(query.page).toContain('contains(lower(coalesce(CAST("name" AS VARCHAR), \'NULL\')), \'alice\')');
        expect(query.page).toContain('coalesce(CAST("id" AS VARCHAR), \'NULL\') IN (\'7\')');
        expect(query.count).toContain('count(*) AS total_rows');
    });
});
