import { IRunningKernel } from './IRunningKernel';
import { MessageType } from './messaging';
import { TableColumn } from './tableQuery';

const RESULT_MARKER = '__DUCKLAB_TABLE_JSON__';
export const PANDAS_DATAFRAME_MIME_TYPE = 'application/vnd.ducklab.pandas-dataframe+json';

export function indentPython(code: string, indentation: number): string {
    const prefix = ' '.repeat(indentation);
    return code.split('\n').map(line => line ? `${prefix}${line}` : line).join('\n');
}

export function pandasDataFrameFormatterCode(enabled: boolean): string {
    if (!enabled) return '';
    return `
try:
    import pandas as _ducklab_pandas
    def _ducklab_format_pandas_dataframe(_ducklab_dataframe):
        try:
            import uuid as _ducklab_uuid
            _ducklab_table_name = "__ducklab_dataframe_" + _ducklab_uuid.uuid4().hex
            db.register(_ducklab_table_name, _ducklab_dataframe)
            return {"tableName": _ducklab_table_name}
        except Exception:
            return None
    if not getattr(_ducklab_pandas.DataFrame, '_ducklab_interactive_formatter_installed', False):
        _ducklab_original_mimebundle = getattr(_ducklab_pandas.DataFrame, '_repr_mimebundle_', None)
        def _ducklab_dataframe_mimebundle(_ducklab_dataframe, include=None, exclude=None):
            _ducklab_payload = _ducklab_format_pandas_dataframe(_ducklab_dataframe)
            if _ducklab_payload is not None:
                return {'${PANDAS_DATAFRAME_MIME_TYPE}': _ducklab_payload}
            if _ducklab_original_mimebundle is not None:
                try:
                    return _ducklab_original_mimebundle(_ducklab_dataframe, include=include, exclude=exclude)
                except TypeError:
                    return _ducklab_original_mimebundle(_ducklab_dataframe)
            return None
        _ducklab_pandas.DataFrame._repr_mimebundle_ = _ducklab_dataframe_mimebundle
        _ducklab_pandas.DataFrame._ducklab_interactive_formatter_installed = True
    print('__DUCKLAB_PANDAS_FORMATTER__: registered MIME bundle hook')
except Exception as _ducklab_formatter_error:
    print('__DUCKLAB_PANDAS_FORMATTER__: failed: ' + repr(_ducklab_formatter_error))
`;
}

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
