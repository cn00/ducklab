import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DuckdbDataSource } from '../src/controller/nodejs/DuckdbDataSource';

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

    function createSource(dbPath: string, allowUnsignedExtensions?: boolean) {
        const source = new DuckdbDataSource('test', {
            dbPath, dataSearchPath: tempPath,
            ...(allowUnsignedExtensions === undefined ? {} : { allowUnsignedExtensions })
        });
        sources.push(source);
        return source;
    }

    test('creates missing database parent directories before running SQL', async () => {
        const dbPath = join(tempPath, 'missing', 'ducklab', 'notebook.isql.db');
        const source = createSource(dbPath);

        const result = await source.queryNative('SELECT 42 AS answer');

        expect(result.values).toEqual([{ _index: 0, answer: 42 }]);
        expect((await stat(dbPath)).isFile()).toBe(true);
    });

    test('preserves an existing database when reconnecting', async () => {
        const dbPath = join(tempPath, 'notebook.isql.db');
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
        const source = createSource(join(parentPath, 'notebook.isql.db'));

        await expect(source.connect()).rejects.toThrow();
        expect(await readFile(parentPath, 'utf8')).toBe('keep');
    });
});
