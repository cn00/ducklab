import { IRunningKernel } from './IRunningKernel';
import { MessageType } from './messaging';
import { TableColumn } from './tableQuery';

const RESULT_MARKER = '__DUCKLAB_TABLE_JSON__';
export const PANDAS_DATAFRAME_MIME_TYPE = 'application/vnd.ducklab.pandas-dataframe+json';

export function registeredPandasDataFrameName(data: unknown): string | undefined {
    const payload = typeof data === 'string'
        ? (() => { try { return JSON.parse(data); } catch { return undefined; } })()
        : data;
    const tableName = (payload as { tableName?: unknown } | undefined)?.tableName;
    return typeof tableName === 'string' && /^__ducklab_dataframe_[0-9a-f]{32}$/i.test(tableName)
        ? tableName
        : undefined;
}

export interface KernelTableResult {
    columns: TableColumn[];
    values: Record<string, unknown>[];
}

export async function executeKernelJson(kernel: IRunningKernel, code: string): Promise<any> {
    const emitter = await kernel.execute(code);
    return await new Promise((resolve, reject) => {
        let output = '';
        emitter.on(event => {
            if (event.msgType === MessageType.Error) {
                const error = event.content as { traceback?: string; evalue?: string };
                reject(new Error(error.traceback ?? error.evalue ?? 'Kernel query failed'));
                return;
            }
            if (event.msgType === MessageType.Output && event.content.contentType === 'text/plain') {
                output += String(event.content.data);
                const markerIndex = output.indexOf(RESULT_MARKER);
                if (markerIndex >= 0) {
                    const json = output.slice(markerIndex + RESULT_MARKER.length).trim();
                    try { resolve(JSON.parse(json)); }
                    catch (error) { reject(error); }
                }
            }
        });
        emitter.onDispose(code => {
            if (code !== 0) reject(new Error('Kernel query failed.'));
            else if (!output.includes(RESULT_MARKER)) reject(new Error('Kernel returned no table result.'));
        });
    });
}

function inferredType(nativeType: string): string {
    if (/BOOL/i.test(nativeType)) return 'boolean';
    if (/(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|FLOAT|DOUBLE|DECIMAL|NUMERIC)/i.test(nativeType)) return 'number';
    if (/^DATE$/i.test(nativeType)) return 'date';
    if (/(?:TIME|TIMESTAMP)/i.test(nativeType)) return /WITH TIME ZONE|TZ/i.test(nativeType) ? 'datetime_tz' : 'datetime';
    return 'string';
}

export async function executePythonQuery(kernel: IRunningKernel, query: string): Promise<KernelTableResult> {
    const literal = JSON.stringify(query);
    const code = `import json as _ducklab_json\n_c = db.execute(${literal})\n_names = [d[0] for d in (_c.description or [])]\n_types = [str(d[1]) for d in (_c.description or [])]\n_rows = _c.fetchmany(100)\n_payload = {"columns": [{"name": n, "nativeType": t, "type": ""} for n, t in zip(_names, _types)], "values": [dict(zip(_names, r)) for r in _rows]}\nprint(${JSON.stringify(RESULT_MARKER)} + _ducklab_json.dumps(_payload, default=str))`;
    const result = await executeKernelJson(kernel, code) as KernelTableResult;
    result.columns = result.columns.map(column => ({ ...column, type: inferredType(column.nativeType ?? '') }));
    return result;
}

export async function executeSparkQuery(kernel: IRunningKernel, query: string): Promise<KernelTableResult> {
    const literal = JSON.stringify(query);
    const code = `import json as _ducklab_json\n_df = spark.sql(${literal})\n_names = _df.columns\n_types = [str(f.dataType) for f in _df.schema.fields]\n_rows = [r.asDict(recursive=True) for r in _df.collect()]\n_payload = {"columns": [{"name": n, "nativeType": t, "type": ""} for n, t in zip(_names, _types)], "values": _rows}\nprint(${JSON.stringify(RESULT_MARKER)} + _ducklab_json.dumps(_payload, default=str))`;
    const result = await executeKernelJson(kernel, code) as KernelTableResult;
    result.columns = result.columns.map(column => ({ ...column, type: inferredType(column.nativeType ?? '') }));
    return result;
}
