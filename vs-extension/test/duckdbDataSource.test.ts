import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DuckdbDataSource } from '../src/controller/nodejs/DuckdbDataSource';
import { DuckDBInstance } from '@duckdb/node-api';

describe('DuckDB database initialization', () => {
    let tempPath: string;
    let sources: DuckdbDataSource[];

    beforeEach(async () => {
        tempPath = await mkdtemp(join(tmpdir(), 'ducklab-test-'));
        sources = [];
    });

    afterEach(async () => {
        for (const source of sources) source.dispose();
        await rm(tempPath, { recursive: true, force: true });
    });

    function createSource(dbPath: string, allowUnsignedExtensions?: boolean, databaseName?: string) {
        const source = new DuckdbDataSource('test', {
            dbPath, dataSearchPath: tempPath,
            ...(allowUnsignedExtensions === undefined ? {} : { allowUnsignedExtensions }),
            ...(databaseName === undefined ? {} : { databaseName })
        });
        sources.push(source);
        return source;
    }

    test('creates missing database parent directories before running SQL', async () => {
        const dbPath = join(tempPath, 'missing', 'ducklab', 'notebook.md.db');
        const source = createSource(dbPath);

        const result = await source.queryNative('SELECT 42 AS answer');

        expect(result.values).toEqual([{ _index: 0, answer: 42 }]);
        expect((await stat(dbPath)).isFile()).toBe(true);
    });

    test('preserves an existing database when reconnecting', async () => {
        const dbPath = join(tempPath, 'notebook.md.db');
        const source = createSource(dbPath);
        await source.queryNative('CREATE TABLE saved AS SELECT 42 AS answer');
        source.dispose();
        sources.pop();

        const reopened = createSource(dbPath);
        const result = await reopened.queryNative('SELECT * FROM saved');

        expect(result.values).toEqual([{ _index: 0, answer: 42 }]);
    });

    test('continues to support in-memory databases', async () => {
        const source = createSource(':memory:');

        const result = await source.queryNative('SELECT 42 AS answer');

        expect(result.values).toEqual([{ _index: 0, answer: 42 }]);
    });

    test.each([undefined, false, true])('sets the unsigned extensions startup option to %s', async enabled => {
        const source = createSource(':memory:', enabled);
        const result = await source.queryNative(
            "SELECT current_setting('allow_unsigned_extensions') AS enabled");

        expect(result.values).toEqual([{ _index: 0, enabled: enabled ?? false }]);
    });

    test('reports a parent path blocked by a file without overwriting it', async () => {
        const parentPath = join(tempPath, 'blocked');
        await writeFile(parentPath, 'keep');
        const source = createSource(join(parentPath, 'notebook.md.db'));

        await expect(source.connect()).rejects.toThrow();
        expect(await readFile(parentPath, 'utf8')).toBe('keep');
    });

    test.each(['ducklab', 'analytics', 'select'])('uses %s as the default catalog', async databaseName => {
        const source = createSource(join(tempPath, 'long_notebook_name.db'), false, databaseName);
        const result = await source.queryNative('SELECT current_database() AS name');
        expect(result.values).toEqual([{ _index: 0, name: databaseName }]);
        await source.queryNative('CREATE TABLE saved AS SELECT 42 AS answer');
        const tables = await source.queryNative(
            "SELECT table_catalog FROM information_schema.tables WHERE table_name = 'saved'");
        expect(tables.values).toEqual([{ _index: 0, table_catalog: databaseName }]);
    });

    test('opens data from a legacy database under the new alias and persists new writes to the same file', async () => {
        const dbPath = join(tempPath, "legacy'notebook.db");
        const instance = await DuckDBInstance.create(dbPath);
        const connection = await instance.connect();
        await connection.run('CREATE TABLE saved AS SELECT 42 AS answer');
        connection.closeSync();
        instance.closeSync();

        const source = createSource(dbPath);
        expect((await source.queryNative('SELECT * FROM ducklab.saved')).values)
            .toEqual([{ _index: 0, answer: 42 }]);
        await source.queryNative('INSERT INTO saved VALUES (43)');
        source.dispose();
        sources.pop();

        const reopened = createSource(dbPath, false, 'analytics');
        expect((await reopened.queryNative('SELECT * FROM analytics.saved ORDER BY answer')).values)
            .toEqual([{ _index: 0, answer: 42 }, { _index: 1, answer: 43 }]);
    });

    test('keeps separate notebook databases isolated despite identical aliases', async () => {
        const first = createSource(join(tempPath, 'first.db'));
        const second = createSource(join(tempPath, 'second.db'));
        await first.queryNative('CREATE TABLE saved AS SELECT 42 AS answer');
        await expect(second.queryNative('SELECT * FROM saved')).rejects.toThrow();
    });

    test.each(['', 'memory', 'SYSTEM', 'Temp', 'bad-name', 'bad"; SELECT 1; --'])
    ('rejects invalid or reserved database names: %j', async name => {
        const source = createSource(':memory:', false, name);
        await expect(source.connect()).rejects.toThrow('Invalid ducklab.databaseName');
    });
});
