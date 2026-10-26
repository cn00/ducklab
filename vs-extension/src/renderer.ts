import type { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';

type Column = { name: string; type?: string; nativeType?: string };
type TableStats = { nonNull: number; min?: number; max?: number; bins?: number[] };
type TableData = { queryId?: string; columns: Column[]; values: Record<string, unknown>[]; totalRows?: number; page?: number; pageSize?: number; stats?: Record<string, TableStats> };
type TableRequest = { kind: 'ducklab.table.request'; requestId: string; queryId: string; operation: 'page' | 'distinct'; page?: number; pageSize?: number; filters?: { search: string; text: Record<string, string>; values: Record<string, string[]> }; sortColumn?: string; sortAscending?: boolean; column?: string; valueSearch?: string; includeStats?: boolean };
type TableResponse = { kind: 'ducklab.table.response'; requestId: string; queryId: string; ok: boolean; data?: Partial<TableData> & { distinctValues?: string[]; hasMoreDistinct?: boolean }; error?: string };
const ROW_NUMBER_WIDTH = 54;

const styles = `
.ducklab-table { color: var(--vscode-foreground); font: 12px var(--vscode-font-family); border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: visible; }
.ducklab-toolbar { display:grid; grid-template-columns:minmax(0,1fr); gap:8px; align-items:center; padding:8px 8px 8px ${ROW_NUMBER_WIDTH + 1}px; border-bottom:1px solid var(--vscode-panel-border); }
.ducklab-toolbar-search { min-width:0; }
.ducklab-toolbar input[type=search] { box-sizing:border-box; width:100%; min-width:0; padding:6px 8px; color:var(--vscode-input-foreground); background:var(--vscode-input-background); border:1px solid var(--vscode-input-border); border-radius:4px; }
.ducklab-toolbar button,.ducklab-toolbar select { padding:5px 8px; color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:0; border-radius:4px; cursor:pointer; }
.ducklab-menu { position:relative; } .ducklab-menu[open] { z-index:1; }
.ducklab-menu summary { cursor:pointer; padding:5px 8px; } .ducklab-menu-content { position:absolute; right:0; max-height:260px; overflow:auto; min-width:220px; padding:8px; background:var(--vscode-menu-background); border:1px solid var(--vscode-menu-border); box-shadow:0 4px 14px #0005; }
.ducklab-column-picker[open] { z-index:10002; }
.ducklab-column-picker > summary { display:flex; width:100%; height:100%; box-sizing:border-box; align-items:center; justify-content:flex-end; padding:0; list-style:none; }
.ducklab-column-picker > summary::-webkit-details-marker { display:none; }
.ducklab-column-picker .ducklab-menu-content { position:fixed; z-index:10002; right:auto; }
.ducklab-menu-content label { display:flex; gap:6px; padding:4px; white-space:nowrap; }
.ducklab-column-name,.ducklab-column-type { display:block; }
.ducklab-column-type,.ducklab-column-count { display:block; opacity:.75; margin-top:4px; font-weight:normal; }
.ducklab-column-name { display:inline-block; cursor:pointer; }
.ducklab-column-name.ducklab-filtered-column { color:var(--vscode-textLink-foreground); }
.ducklab-column-actions { position:absolute; top:2px; right:4px; z-index:2; }
.ducklab-column-actions > summary { list-style:none; cursor:pointer; padding:0 3px; color:var(--vscode-textLink-foreground); }
.ducklab-column-actions > summary::-webkit-details-marker { display:none; }
.ducklab-column-actions-panel { position:fixed; z-index:10000; box-sizing:border-box; min-width:190px; max-height:calc(100vh - 16px); overflow:auto; padding:4px; background:var(--vscode-menu-background); color:var(--vscode-menu-foreground); border:1px solid var(--vscode-menu-border); border-radius:4px; box-shadow:0 4px 14px #0005; font-weight:normal; }
.ducklab-column-actions-panel button,.ducklab-column-actions-panel summary { display:block; width:100%; box-sizing:border-box; padding:6px 8px; border:0; background:transparent; color:inherit; text-align:left; white-space:nowrap; cursor:pointer; }
.ducklab-column-actions-panel button:hover,.ducklab-column-actions-panel summary:hover { background:var(--vscode-list-hoverBackground); }
.ducklab-column-actions-panel input[type=search] { width:100%; box-sizing:border-box; padding:5px; color:var(--vscode-input-foreground); background:var(--vscode-input-background); border:1px solid var(--vscode-input-border); }
.ducklab-column-action-separator { margin:3px 0; border-top:1px solid var(--vscode-menu-separatorBackground); }
.ducklab-filter-values { max-height:180px; overflow:auto; padding:2px 6px; }
.ducklab-filter-block > details > div { margin:2px 0 4px 10px; padding:4px 0 4px 8px; border-left:1px solid var(--vscode-menu-separatorBackground); }
.ducklab-column-actions-panel label { display:flex; gap:6px; align-items:center; padding:4px 2px; white-space:nowrap; }
.ducklab-format-menu > div { margin:2px 0 2px 10px; padding-left:8px; border-left:1px solid var(--vscode-menu-separatorBackground); }
.ducklab-grid th .ducklab-hist { min-width:72px; }
.ducklab-hist { height:36px; display:flex; align-items:flex-end; gap:2px; margin-top:6px; } .ducklab-hist i { flex:1; min-width:3px; background:var(--vscode-charts-green); }
.ducklab-hist-range { display:flex; justify-content:space-between; gap:8px; opacity:.7; font-size:10px; }
.ducklab-scroll { overflow:auto; max-height:480px; } .ducklab-grid { border-collapse:collapse; width:100%; }
.ducklab-grid th,.ducklab-grid td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--vscode-panel-border); white-space:nowrap; }
.ducklab-grid th { position:sticky; top:0; vertical-align:top; background:var(--vscode-editor-background); cursor:pointer; }
.ducklab-grid th.ducklab-menu-open { z-index:10001; }
.ducklab-grid .ducklab-frozen { position:sticky; z-index:2; background:var(--vscode-editor-background); }
.ducklab-grid th.ducklab-frozen { z-index:5; }
.ducklab-grid .ducklab-row-number { box-sizing:border-box; width:${ROW_NUMBER_WIDTH}px; min-width:${ROW_NUMBER_WIDTH}px; max-width:${ROW_NUMBER_WIDTH}px; text-align:right; color:var(--vscode-descriptionForeground); background:var(--vscode-editor-background); }
.ducklab-grid th.ducklab-row-number { position:sticky; left:0; z-index:6; }
.ducklab-grid th.ducklab-row-number .ducklab-explore-toggle { position:absolute; top:4px; left:0; z-index:7; }
.ducklab-grid td.ducklab-row-number { position:sticky; left:0; z-index:3; border-right:1px solid var(--vscode-panel-border); }
.ducklab-grid .ducklab-wrap { white-space:normal; max-width:240px; overflow-wrap:anywhere; }
.ducklab-grid tbody tr:hover { background:var(--vscode-list-hoverBackground); }
.ducklab-grid tbody tr:hover .ducklab-row-number { background:var(--vscode-list-hoverBackground); }
.ducklab-grid td.ducklab-selected { background:var(--vscode-editor-selectionBackground, var(--vscode-list-activeSelectionBackground)); color:var(--vscode-editor-selectionForeground, var(--vscode-foreground)); }
.ducklab-explore-toggle { justify-self:start; width:20px; height:24px; padding:0!important; border:0; outline:none; box-shadow:none; appearance:none; color:#000!important; background:transparent!important; }
.ducklab-explore-toggle:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:1px; }
.ducklab-explore-toggle::before { display:block; width:0; height:0; margin:auto; content:''; }
.ducklab-explore-toggle[aria-expanded="false"]::before { border-top:4px solid transparent; border-bottom:4px solid transparent; border-left:6px solid #000; }
.ducklab-explore-toggle[aria-expanded="true"]::before { border-right:4px solid transparent; border-left:4px solid transparent; border-top:6px solid #000; }
.ducklab-footer { display:flex; gap:8px; align-items:center; padding:8px; color:var(--vscode-descriptionForeground); } .ducklab-footer .spacer { flex:1; }
.ducklab-footer-actions { position:relative; }
.ducklab-footer-actions > summary { list-style:none; cursor:pointer; padding:2px 6px; border-radius:3px; font-size:18px; line-height:1; }
.ducklab-footer-actions > summary::-webkit-details-marker { display:none; }
.ducklab-footer-actions > summary:hover { background:var(--vscode-list-hoverBackground); }
.ducklab-footer-actions-panel { position:fixed; z-index:10003; min-width:140px; padding:4px; background:var(--vscode-editorWidget-background, var(--vscode-editor-background)); color:var(--vscode-editorWidget-foreground, var(--vscode-foreground)); border:1px solid var(--vscode-menu-border); border-radius:4px; box-shadow:0 4px 14px #0005; }
.ducklab-footer-actions-panel button { display:block; width:100%; box-sizing:border-box; padding:6px 8px; border:0; background:transparent; color:inherit; text-align:left; white-space:nowrap; cursor:pointer; }
.ducklab-footer-actions-panel button:hover { background:var(--vscode-list-hoverBackground); }
`;

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function temporalValue(value: unknown, nativeType: string): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
    const text = String(value).trim();
    if (/^TIME\b/i.test(nativeType) || /^\d{1,2}:\d{2}/.test(text)) {
        const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(AM|PM)?$/i.exec(text);
        if (!match) return null;
        let hours = Number(match[1]);
        const minutes = Number(match[2]);
        const seconds = Number(match[3] ?? 0);
        const milliseconds = Number(`0.${match[4] ?? '0'}`) * 1000;
        if (match[5]) hours = (hours % 12) + (match[5].toUpperCase() === 'PM' ? 12 : 0);
        if (hours > 23 || minutes > 59 || seconds > 59) return null;
        return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
    }
    const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
        ? `${text.replace(' ', 'T')}Z`
        : text;
    const timestamp = Date.parse(normalized);
    return Number.isNaN(timestamp) ? null : timestamp;
}

function formatDataType(column: Column): string {
    const type = (column.nativeType ?? '').trim().toUpperCase().replace(/\s*\(.*$/, '');
    const aliases: Record<string, string> = {
        TINYINT: 'int8', SMALLINT: 'int16', INTEGER: 'int32', BIGINT: 'int64', HUGEINT: 'int128',
        UTINYINT: 'uint8', USMALLINT: 'uint16', UINTEGER: 'uint32', UBIGINT: 'uint64', UHUGEINT: 'uint128',
        FLOAT: 'float32', DOUBLE: 'float64', REAL: 'float32', BOOLEAN: 'bool', BOOL: 'bool',
        VARCHAR: 'string', TEXT: 'string', DATE: 'date', TIME: 'time', TIMESTAMP: 'datetime'
    };
    if (aliases[type]) return aliases[type];
    if (type.startsWith('TIMESTAMP WITH TIME ZONE')) return 'datetime_tz';
    return column.nativeType?.toLowerCase() || column.type || 'unknown';
}

function formatNumericBoundary(value: number): string {
    const rounded = Number(value.toPrecision(6));
    return rounded.toLocaleString(undefined, { maximumSignificantDigits: 6 });
}

function formatTemporalBoundary(value: number, nativeType: string): string {
    if (/^TIME\b/i.test(nativeType)) {
        const millisecondsInDay = 24 * 60 * 60 * 1000;
        const normalized = ((Math.round(value) % millisecondsInDay) + millisecondsInDay) % millisecondsInDay;
        return new Date(normalized).toISOString().slice(11, 23).replace(/\.000$/, '');
    }
    const iso = new Date(value).toISOString();
    if (/^DATE\b/i.test(nativeType)) return iso.slice(0, 10);
    return iso.replace('T', ' ').replace(/\.000Z$/, 'Z');
}

function makeHistogram(bins: number[], columnName: string, min: number, max: number, formatBoundary: (value: number) => string): HTMLDivElement {
    const histogram = create('div', 'ducklab-hist');
    const peak = Math.max(...bins);
    bins.forEach((count, index) => {
        const bar = create('i');
        bar.style.height = `${Math.max(2, (count / peak) * 36)}px`;
        const range = max === min
            ? `${formatBoundary(min)} - ${formatBoundary(max)}`
            : `${formatBoundary(min + ((max - min) * index / bins.length))} - ${formatBoundary(index === bins.length - 1 ? max : min + ((max - min) * (index + 1) / bins.length))}`;
        bar.title = `${columnName} ${range}\nCount ${count}`;
        bar.setAttribute('aria-label', `${columnName} ${range}, count ${count}`);
        bar.style.cursor = 'help';
        histogram.append(bar);
    });
    return histogram;
}

function appendColumnExplore(header: HTMLTableCellElement, column: Column, rows: Record<string, unknown>[], stats?: TableStats, statsPending = false): void {
    const nativeType = column.nativeType ?? '';
    const isNumeric = column.type === 'number' || /(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|FLOAT|DOUBLE|DECIMAL)/i.test(nativeType);
    const isTemporal = /(?:DATE|TIME|TIMESTAMP)/i.test(nativeType) || /^(?:date|datetime|datetime_tz)$/i.test(column.type ?? '');
    const numbers = isNumeric && !stats
        ? rows.map(row => row[column.name]).filter(value => value !== null && value !== undefined && value !== '').map(Number).filter(Number.isFinite)
        : [];
    const temporalValues = isTemporal && !stats
        ? rows.map(row => temporalValue(row[column.name], nativeType)).filter((value): value is number => value !== null)
        : [];

    header.append(create('span', 'ducklab-column-type', formatDataType(column)));
    if (statsPending) {
        header.append(create('span', 'ducklab-column-count', 'Calculating…'));
    } else if (stats && stats.nonNull === 0) {
        header.append(create('span', 'ducklab-column-count', '0 non-null'));
    } else if (stats?.bins && stats.min !== undefined && stats.max !== undefined && (isNumeric || isTemporal)) {
        header.append(makeHistogram(stats.bins, column.name, stats.min, stats.max,
            isTemporal ? value => formatTemporalBoundary(value, nativeType) : formatNumericBoundary));
        const range = create('div', 'ducklab-hist-range');
        const formatBoundary = isTemporal ? (value: number) => formatTemporalBoundary(value, nativeType) : formatNumericBoundary;
        range.append(create('span', '', formatBoundary(stats.min)), create('span', '', formatBoundary(stats.max)));
        header.append(range);
    } else if (stats) {
        header.append(create('span', 'ducklab-column-count', `${stats.nonNull.toLocaleString()} non-null`));
    } else if (numbers.length) {
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const value of numbers) {
            if (value < min) min = value;
            if (value > max) max = value;
        }
        const bins = Array.from({ length: 10 }, () => 0);
        for (const value of numbers) {
            const index = max === min ? 0 : Math.min(bins.length - 1, Math.floor(((value - min) / (max - min)) * bins.length));
            bins[index]++;
        }
        header.append(makeHistogram(bins, column.name, min, max, formatNumericBoundary));
        const range = create('div', 'ducklab-hist-range');
        range.append(create('span', '', formatNumericBoundary(min)), create('span', '', formatNumericBoundary(max)));
        header.append(range);
    } else if (temporalValues.length) {
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const value of temporalValues) {
            if (value < min) min = value;
            if (value > max) max = value;
        }
        const bins = Array.from({ length: 10 }, () => 0);
        for (const value of temporalValues) {
            const index = max === min ? 0 : Math.min(bins.length - 1, Math.floor(((value - min) / (max - min)) * bins.length));
            bins[index]++;
        }
        const formatBoundary = (value: number) => formatTemporalBoundary(value, nativeType);
        header.append(makeHistogram(bins, column.name, min, max, formatBoundary));
        const range = create('div', 'ducklab-hist-range');
        range.append(create('span', '', formatBoundary(min)), create('span', '', formatBoundary(max)));
        header.append(range);
    } else {
        const nonNull = rows.filter(row => row[column.name] !== null && row[column.name] !== undefined).length;
        header.append(create('span', 'ducklab-column-count', `${nonNull} non-null`));
    }
}

function formatCellValue(value: unknown, format: string | undefined): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value !== 'number' || !Number.isFinite(value) || !format || format === 'auto') return formatValue(value);
    switch (format) {
        case 'percent': return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 }).format(value);
        case 'scientific': return value.toExponential(2);
        case 'engineering': {
            if (value === 0) return '0';
            const exponent = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
            const scaled = value / (10 ** exponent);
            return `${Number(scaled.toPrecision(4))}e${exponent}`;
        }
        case 'integer': return Math.round(value).toLocaleString();
        default: return formatValue(value);
    }
}

async function copyText(value: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(value);
    } catch {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.append(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }
}

function create<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function renderTable(data: TableData, root: HTMLElement, signal: AbortSignal, context: RendererContext<unknown>, onMessage: (listener: (message: TableResponse) => void) => () => void): void {
    const visible = new Set(data.columns.map(column => column.name));
    const state = { query: '', page: 0, pageSize: 10, sortColumn: '', sortAscending: true, explore: true };
    let totalRows = data.totalRows ?? data.values.length;
    let currentStats = data.stats;
    let requestNumber = 0;
    let loadError = '';
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    const columnTextFilters = new Map<string, string>();
    const columnValueFilters = new Map<string, Set<string>>();
    const columnFormats = new Map<string, string>();
    const wrappedColumns = new Set<string>();
    const distinctValueCache = new Map<string, string[]>();
    const columnCheckboxes = new Map<string, HTMLInputElement>();
    let frozenColumn: { name: string; side: 'left' | 'right' } | null = null;
    let selection: { startRow: number; endRow: number; startColumn: number; endColumn: number } | null = null;
    let draggingSelection = false;
    const search = create('input');
    search.type = 'search';
    search.placeholder = 'Search all rows…';
    search.setAttribute('aria-label', 'Search table');

    const style = create('style');
    style.textContent = styles;
    const shell = create('section', 'ducklab-table');
    const toolbar = create('div', 'ducklab-toolbar');
    const footerActions = create('details', 'ducklab-footer-actions');
    const footerActionsSummary = create('summary', '', '⋯');
    footerActionsSummary.setAttribute('aria-label', 'More table actions');
    const footerActionsPanel = create('div', 'ducklab-footer-actions-panel');
    footerActions.append(footerActionsSummary, footerActionsPanel);
    const columnsMenu = create('details', 'ducklab-menu ducklab-column-picker');
    const summary = create('summary', '', '#');
    summary.setAttribute('aria-label', 'Choose visible columns');
    const menu = create('div', 'ducklab-menu-content');
    columnsMenu.append(summary, menu);
    columnsMenu.addEventListener('toggle', () => {
        if (!columnsMenu.open) return;
        root.querySelectorAll<HTMLDetailsElement>('.ducklab-column-actions[open]').forEach(actions => { actions.open = false; });
        requestAnimationFrame(positionColumnsMenu);
    }, { signal });
    function positionColumnsMenu(): void {
        const rect = summary.getBoundingClientRect();
        const menuWidth = menu.offsetWidth || 220;
        const menuHeight = menu.offsetHeight || 260;
        const top = rect.bottom + menuHeight <= window.innerHeight - 8
            ? rect.bottom
            : Math.max(8, rect.top - menuHeight);
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
    }
    window.addEventListener('scroll', () => { if (columnsMenu.open) positionColumnsMenu(); }, { capture: true, passive: true, signal });
    window.addEventListener('resize', () => { if (columnsMenu.open) positionColumnsMenu(); }, { signal });
    for (const column of data.columns) {
        const label = create('label');
        const checkbox = create('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        columnCheckboxes.set(column.name, checkbox);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) visible.add(column.name);
            else visible.delete(column.name);
            draw();
        }, { signal });
        label.append(checkbox, document.createTextNode(column.name));
        menu.append(label);
    }
    document.addEventListener('click', event => {
        const target = event.target as Node;
        if (!columnsMenu.contains(target)) columnsMenu.open = false;
        if (!footerActions.contains(target)) footerActions.open = false;
        root.querySelectorAll<HTMLDetailsElement>('.ducklab-column-actions[open]').forEach(actions => {
            if (!actions.contains(target)) actions.open = false;
        });
    }, { signal });
    const explore = create('button', 'ducklab-explore-toggle');
    explore.type = 'button';
    explore.setAttribute('aria-expanded', String(state.explore));
    explore.setAttribute('aria-label', state.explore ? 'Collapse Explore statistics' : 'Expand Explore statistics');
    explore.title = state.explore ? 'Collapse Explore statistics' : 'Expand Explore statistics';
    explore.addEventListener('click', () => {
        state.explore = !state.explore;
        explore.setAttribute('aria-expanded', String(state.explore));
        explore.setAttribute('aria-label', state.explore ? 'Collapse Explore statistics' : 'Expand Explore statistics');
        explore.title = state.explore ? 'Collapse Explore statistics' : 'Expand Explore statistics';
        if (data.queryId) void refresh(); else draw();
    }, { signal });
    const exportButton = create('button', '', 'Export CSV');
    exportButton.type = 'button';
    footerActionsPanel.append(exportButton);
    const toolbarSearch = create('div', 'ducklab-toolbar-search');
    toolbarSearch.append(search);
    toolbar.append(toolbarSearch);
    const scroll = create('div', 'ducklab-scroll');
    const grid = create('table', 'ducklab-grid');
    grid.tabIndex = 0;
    grid.setAttribute('aria-label', 'Result table. Drag to select cells, then press Ctrl+C or Command+C to copy.');
    const footer = create('div', 'ducklab-footer');
    const status = create('span');
    const previous = create('button', '', 'Previous');
    previous.type = 'button';
    const next = create('button', '', 'Next');
    next.type = 'button';
    const pageSize = create('select');
    for (const size of [10, 25, 50, 100]) {
        const option = create('option', '', `${size} / page`);
        option.value = String(size);
        pageSize.append(option);
    }
    const footerSpacer = create('span', 'spacer');
    footer.append(status, footerSpacer, pageSize, previous, next, footerActions);
    footerActions.addEventListener('click', event => event.stopPropagation(), { signal });
    footerActions.addEventListener('toggle', () => {
        if (!footerActions.open) return;
        columnsMenu.open = false;
        root.querySelectorAll<HTMLDetailsElement>('.ducklab-column-actions[open]').forEach(actions => { actions.open = false; });
        requestAnimationFrame(() => {
            const rect = footerActionsSummary.getBoundingClientRect();
            const panelWidth = footerActionsPanel.offsetWidth || 140;
            const panelHeight = footerActionsPanel.offsetHeight || 40;
            const top = rect.top >= panelHeight + 8 ? rect.top - panelHeight - 4 : Math.min(window.innerHeight - panelHeight - 8, rect.bottom + 4);
            const left = Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8));
            footerActionsPanel.style.top = `${top}px`;
            footerActionsPanel.style.left = `${left}px`;
        });
    }, { signal });
    scroll.append(grid);
    shell.append(toolbar, scroll, footer);
    root.replaceChildren(style, shell);

    grid.addEventListener('pointerdown', event => {
        const cell = (event.target as Element).closest<HTMLTableCellElement>('td[data-row][data-column]');
        if (!cell || event.button !== 0) return;
        event.preventDefault();
        grid.focus({ preventScroll: true });
        const row = Number(cell.dataset.row);
        const column = Number(cell.dataset.column);
        selection = { startRow: row, endRow: row, startColumn: column, endColumn: column };
        draggingSelection = true;
        updateSelection();
    }, { signal });
    grid.addEventListener('pointerover', event => {
        if (!draggingSelection || !selection) return;
        const cell = (event.target as Element).closest<HTMLTableCellElement>('td[data-row][data-column]');
        if (!cell) return;
        selection.endRow = Number(cell.dataset.row);
        selection.endColumn = Number(cell.dataset.column);
        updateSelection();
    }, { signal });
    document.addEventListener('pointerup', () => { draggingSelection = false; }, { signal });
    document.addEventListener('copy', event => {
        if (!selection || (document.activeElement !== grid && !grid.contains(document.activeElement))) return;
        const currentRows = data.queryId ? filteredRows() : filteredRows().slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);
        const currentColumns = data.columns.filter(column => visible.has(column.name));
        const firstRow = Math.min(selection.startRow, selection.endRow);
        const lastRow = Math.max(selection.startRow, selection.endRow);
        const firstColumn = Math.min(selection.startColumn, selection.endColumn);
        const lastColumn = Math.max(selection.startColumn, selection.endColumn);
        const selectedColumns = currentColumns.slice(firstColumn, lastColumn + 1);
        const selectedValues = currentRows.slice(firstRow, lastRow + 1).map(row =>
            currentColumns.slice(firstColumn, lastColumn + 1)
                .map(column => formatValue(row[column.name]).replace(/[\t\r\n]+/g, ' '))
                .join('\t')
        );
        const isSingleCell = firstRow === lastRow && firstColumn === lastColumn;
        const copied = (isSingleCell
            ? selectedValues
            : [selectedColumns.map(column => column.name.replace(/[\t\r\n]+/g, ' ')).join('\t'), ...selectedValues]
        ).join('\r\n');
        if (event.clipboardData) event.clipboardData.setData('text/plain', copied);
        else void copyText(copied);
        event.preventDefault();
    }, { capture: true, signal });
    grid.addEventListener('blur', () => {
        selection = null;
        updateSelection();
    }, { signal });

    search.addEventListener('input', () => {
        state.query = search.value;
        state.page = 0;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { void refresh(); }, data.queryId ? 250 : 0);
    }, { signal });
    previous.addEventListener('click', () => { state.page = Math.max(0, state.page - 1); void refresh(); }, { signal });
    next.addEventListener('click', () => { state.page++; void refresh(); }, { signal });
    pageSize.addEventListener('change', () => { state.pageSize = Number(pageSize.value); state.page = 0; void refresh(); }, { signal });
    exportButton.addEventListener('click', () => {
        footerActions.open = false;
        const columns = data.columns.filter(column => visible.has(column.name));
        void (async () => {
            const csvParts = [columns.map(column => JSON.stringify(column.name)).join(',') + '\r\n'];
            if (data.queryId) {
                const pageCount = Math.ceil(totalRows / 100);
                for (let page = 0; page < pageCount; page++) {
                    const response = await sendRequest({ operation: 'page', page, pageSize: 100, filters: filtersForRequest(),
                        sortColumn: state.sortColumn || undefined, sortAscending: state.sortAscending, includeStats: false });
                    if (!response?.ok || !response.data) { loadError = response?.error ?? 'CSV export failed.'; draw(); return; }
                    csvParts.push(...(response.data.values ?? []).map(row => columns.map(column => JSON.stringify(formatValue(row[column.name]))).join(',') + '\r\n'));
                }
            } else {
                csvParts.push(...filteredRows().map(row => columns.map(column => JSON.stringify(formatValue(row[column.name]))).join(',') + '\r\n'));
            }
            const link = create('a');
            link.href = URL.createObjectURL(new Blob(csvParts, { type: 'text/csv;charset=utf-8' }));
            link.download = 'ducklab-result.csv';
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 0);
        })();
    }, { signal });

    function createColumnActions(column: Column): HTMLDetailsElement {
        const actions = create('details', 'ducklab-column-actions');
        const summary = create('summary', '', '⋯');
        summary.setAttribute('aria-label', `Actions for ${column.name}`);
        const panel = create('div', 'ducklab-column-actions-panel');
        actions.append(summary, panel);
        actions.addEventListener('click', event => event.stopPropagation(), { signal });
        actions.addEventListener('pointerdown', event => event.stopPropagation(), { signal });
        actions.addEventListener('toggle', () => {
            const headerCell = actions.closest('th');
            headerCell?.classList.toggle('ducklab-menu-open', actions.open);
            if (!actions.open) return;
            columnsMenu.open = false;
            root.querySelectorAll<HTMLDetailsElement>('.ducklab-column-actions[open]').forEach(other => {
                if (other !== actions) other.open = false;
            });
            const bounds = summary.getBoundingClientRect();
            const shellBounds = shell.getBoundingClientRect();
            const panelWidth = Math.max(190, panel.getBoundingClientRect().width);
            const availableAbove = Math.max(0, bounds.bottom - shellBounds.top - 8);
            const availableBelow = Math.max(0, shellBounds.bottom - bounds.top - 8);
            panel.style.maxHeight = `${Math.max(availableAbove, availableBelow)}px`;
            const panelHeight = panel.getBoundingClientRect().height;
            const openUp = panelHeight > availableBelow && availableAbove > availableBelow;
            panel.style.maxHeight = `${openUp ? availableAbove : availableBelow}px`;
            const fittedHeight = panel.getBoundingClientRect().height;
            const preferredTop = openUp ? bounds.bottom - fittedHeight : bounds.top;
            panel.style.left = `${Math.max(8, Math.min(bounds.right + 6, window.innerWidth - panelWidth - 8))}px`;
            panel.style.top = `${Math.max(shellBounds.top + 8, Math.min(preferredTop, shellBounds.bottom - fittedHeight - 8))}px`;
        }, { signal });

        const addAction = (label: string, callback: () => void) => {
            const button = create('button', '', label);
            button.type = 'button';
            button.addEventListener('click', event => {
                event.stopPropagation();
                callback();
                actions.open = false;
            }, { signal });
            panel.append(button);
            return button;
        };
        const separator = () => {
            const element = create('div', 'ducklab-column-action-separator');
            panel.append(element);
            return element;
        };

        addAction('Asc', () => { state.sortColumn = column.name; state.sortAscending = true; state.page = 0; void refresh(); });
        addAction('Desc', () => { state.sortColumn = column.name; state.sortAscending = false; state.page = 0; void refresh(); });
        addAction('Copy column name', () => { void copyText(column.name); });
        const freezeSeparator = separator();
        addAction(frozenColumn?.name === column.name && frozenColumn.side === 'left' ? 'Unfreeze left' : 'Freeze left', () => {
            frozenColumn = frozenColumn?.name === column.name && frozenColumn.side === 'left' ? null : { name: column.name, side: 'left' };
            draw();
        });
        addAction(frozenColumn?.name === column.name && frozenColumn.side === 'right' ? 'Unfreeze right' : 'Freeze right', () => {
            frozenColumn = frozenColumn?.name === column.name && frozenColumn.side === 'right' ? null : { name: column.name, side: 'right' };
            draw();
        });
        addAction(wrappedColumns.has(column.name) ? 'Unwrap text' : 'Wrap text', () => {
            if (wrappedColumns.has(column.name)) wrappedColumns.delete(column.name);
            else wrappedColumns.add(column.name);
            draw();
        });

        const formatMenu = create('details', 'ducklab-format-menu');
        formatMenu.append(create('summary', '', 'Format'));
        const formats = create('div');
        for (const [label, value] of [['Auto', 'auto'], ['Percent', 'percent'], ['Scientific', 'scientific'], ['Engineering', 'engineering'], ['Integer', 'integer']]) {
            const button = create('button', '', `${columnFormats.get(column.name) === value ? '✓ ' : ''}${label}`);
            button.type = 'button';
            button.addEventListener('click', event => {
                event.stopPropagation();
                if (value === 'auto') columnFormats.delete(column.name);
                else columnFormats.set(column.name, value);
                draw();
            }, { signal });
            formats.append(button);
        }
        formatMenu.append(formats);
        panel.append(formatMenu);

        addAction(visible.has(column.name) ? 'Hide column' : 'Show column', () => {
            if (visible.has(column.name)) {
                visible.delete(column.name);
                const checkbox = columnCheckboxes.get(column.name);
                if (checkbox) checkbox.checked = false;
            } else {
                visible.add(column.name);
                const checkbox = columnCheckboxes.get(column.name);
                if (checkbox) checkbox.checked = true;
            }
            draw();
        });

        const filtersSeparator = separator();
        const filterMenu = create('details');
        filterMenu.append(create('summary', '', 'Filter'));
        const filterPanel = create('div');
        const filterInput = create('input');
        filterInput.type = 'search';
        filterInput.placeholder = `Filter ${column.name}…`;
        filterInput.value = columnTextFilters.get(column.name) ?? '';
        const applyFilter = create('button', '', 'Apply filter');
        applyFilter.type = 'button';
        applyFilter.addEventListener('click', event => {
            event.stopPropagation();
            const query = filterInput.value.trim();
            if (query) columnTextFilters.set(column.name, query);
            else columnTextFilters.delete(column.name);
            state.page = 0;
            void refresh();
        }, { signal });
        filterPanel.append(filterInput, applyFilter);
        filterMenu.append(filterPanel);
        const filterBlock = create('div', 'ducklab-filter-block');
        filterBlock.append(filterMenu);

        const valuesMenu = create('details');
        valuesMenu.append(create('summary', '', 'Filter by values'));
        const valuesPanel = create('div');
        const valueSearch = create('input');
        valueSearch.type = 'search';
        valueSearch.placeholder = 'Search values…';
        const valuesList = create('div', 'ducklab-filter-values');
        const valueStatus = create('span', 'ducklab-column-count');
        const valueActions = create('div');
        const selectAll = create('button', '', 'Select all');
        const clearAll = create('button', '', 'Clear');
        selectAll.type = clearAll.type = 'button';
        valueActions.append(selectAll, clearAll);
        valuesPanel.append(valueSearch, valueStatus, valuesList, valueActions);
        valuesMenu.append(valuesPanel);
        let allValues: string[] = [];
        let pendingValues = new Set<string>();
        let hasMoreValues = false;
        let valueSearchVersion = 0;
        const renderValues = () => {
            selectAll.textContent = hasMoreValues ? 'Select all shown' : 'Select all';
            const matching = allValues.filter(value => value.toLocaleLowerCase().includes(valueSearch.value.toLocaleLowerCase()));
            valuesList.replaceChildren();
            for (const value of matching.slice(0, 200)) {
                const label = create('label');
                const checkbox = create('input');
                checkbox.type = 'checkbox';
                checkbox.checked = pendingValues.has(value);
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) pendingValues.add(value);
                    else pendingValues.delete(value);
                    valueStatus.textContent = `${pendingValues.size} of ${allValues.length} values selected`;
                }, { signal });
                label.append(checkbox, document.createTextNode(value));
                valuesList.append(label);
            }
            valueStatus.textContent = `${pendingValues.size} selected from ${allValues.length} values${hasMoreValues ? ' · more values exist; search to narrow' : ''}${matching.length > 200 ? ` · showing 200 of ${matching.length}` : ''}`;
        };
        valuesMenu.addEventListener('toggle', () => {
            if (!valuesMenu.open) return;
            if (data.queryId) {
                const version = ++valueSearchVersion;
                void sendRequest({ operation: 'distinct', column: column.name, valueSearch: valueSearch.value, filters: filtersForRequest() }).then(response => {
                    if (version !== valueSearchVersion) return;
                    if (response?.ok && response.data?.distinctValues) {
                        allValues = response.data.distinctValues;
                        hasMoreValues = response.data.hasMoreDistinct ?? false;
                        pendingValues = new Set(columnValueFilters.get(column.name) ?? (hasMoreValues ? [] : allValues));
                        renderValues();
                    } else if (response?.error) valueStatus.textContent = response.error;
                });
            } else if (!distinctValueCache.has(column.name)) {
                distinctValueCache.set(column.name, [...new Set(data.values.map(row => formatValue(row[column.name])))].sort((a, b) => a.localeCompare(b)));
                allValues = distinctValueCache.get(column.name) ?? [];
                hasMoreValues = false;
            }
            pendingValues = new Set(columnValueFilters.get(column.name) ?? allValues);
            renderValues();
        }, { signal });
        valueSearch.addEventListener('input', () => {
            if (!data.queryId) { renderValues(); return; }
            const version = ++valueSearchVersion;
            void sendRequest({ operation: 'distinct', column: column.name, valueSearch: valueSearch.value, filters: filtersForRequest() }).then(response => {
                if (version !== valueSearchVersion) return;
                if (response?.ok && response.data?.distinctValues) { allValues = response.data.distinctValues; hasMoreValues = response.data.hasMoreDistinct ?? false; renderValues(); }
            });
        }, { signal });
        selectAll.addEventListener('click', event => {
            event.stopPropagation();
            pendingValues = new Set(allValues);
            renderValues();
        }, { signal });
        clearAll.addEventListener('click', event => {
            event.stopPropagation();
            pendingValues.clear();
            renderValues();
        }, { signal });
        const applyValues = create('button', '', 'Apply value filter');
        applyValues.type = 'button';
        applyValues.addEventListener('click', event => {
            event.stopPropagation();
            if (pendingValues.size === allValues.length && !hasMoreValues) columnValueFilters.delete(column.name);
            else columnValueFilters.set(column.name, new Set(pendingValues));
            state.page = 0;
            void refresh();
        }, { signal });
        valueActions.append(applyValues);
        filterBlock.append(valuesMenu);

        const clearFilters = addAction('Clear filters', () => {
            columnTextFilters.delete(column.name);
            columnValueFilters.delete(column.name);
            state.page = 0;
            void refresh();
        });
        filterBlock.append(clearFilters);
        panel.insertBefore(filterBlock, freezeSeparator);
        filtersSeparator.remove();
        return actions;
    }

    function filtersForRequest() {
        return {
            search: state.query,
            text: Object.fromEntries(columnTextFilters),
            values: Object.fromEntries([...columnValueFilters].map(([name, values]) => [name, [...values]]))
        };
    }

    const pending = new Map<string, (response: TableResponse) => void>();
    const removeMessageListener = onMessage(response => {
        const resolve = pending.get(response.requestId);
        if (!resolve) return;
        pending.delete(response.requestId);
        resolve(response);
    });
    signal.addEventListener('abort', () => {
        removeMessageListener();
        pending.clear();
    }, { once: true });

    function sendRequest(request: Omit<TableRequest, 'kind' | 'requestId' | 'queryId'>): Promise<TableResponse | null> {
        if (!data.queryId || !context.postMessage) return Promise.resolve(null);
        const requestId = `${Date.now()}-${++requestNumber}`;
        return new Promise(resolve => {
            const timer = setTimeout(() => { pending.delete(requestId); resolve(null); }, 30000);
            pending.set(requestId, response => { clearTimeout(timer); resolve(response); });
            context.postMessage!({ kind: 'ducklab.table.request', requestId, queryId: data.queryId, ...request } satisfies TableRequest);
        });
    }

    let refreshVersion = 0;
    async function refresh(): Promise<void> {
        if (!data.queryId) { draw(); return; }
        const version = ++refreshVersion;
        const response = await sendRequest({ operation: 'page', page: state.page, pageSize: state.pageSize,
            filters: filtersForRequest(), sortColumn: state.sortColumn || undefined, sortAscending: state.sortAscending, includeStats: state.explore });
        if (version !== refreshVersion) return;
        if (!response?.ok || !response.data) {
            loadError = response?.error ?? 'Could not load this page.';
            draw();
            return;
        }
        loadError = '';
        data.values = response.data.values ?? [];
        totalRows = response.data.totalRows ?? 0;
        currentStats = response.data.stats;
        state.page = response.data.page ?? state.page;
        draw();
    }

    function filteredRows(): Record<string, unknown>[] {
        if (data.queryId) return data.values;
        let rows = data.values.filter(row => {
            if (state.query && !data.columns.some(column => formatValue(row[column.name]).toLocaleLowerCase().includes(state.query.toLocaleLowerCase()))) return false;
            for (const [columnName, query] of columnTextFilters) {
                if (!formatValue(row[columnName]).toLocaleLowerCase().includes(query.toLocaleLowerCase())) return false;
            }
            for (const [columnName, values] of columnValueFilters) {
                if (!values.has(formatValue(row[columnName]))) return false;
            }
            return true;
        });
        if (state.sortColumn) {
            const key = state.sortColumn;
            const direction = state.sortAscending ? 1 : -1;
            rows = [...rows].sort((a, b) => {
                const av = a[key] as any;
                const bv = b[key] as any;
                if (av == null) return bv == null ? 0 : 1;
                if (bv == null) return -1;
                return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))) * direction;
            });
        }
        return rows;
    }

    function updateSelection(): void {
        const selectedRowStart = selection ? Math.min(selection.startRow, selection.endRow) : -1;
        const selectedRowEnd = selection ? Math.max(selection.startRow, selection.endRow) : -1;
        const selectedColumnStart = selection ? Math.min(selection.startColumn, selection.endColumn) : -1;
        const selectedColumnEnd = selection ? Math.max(selection.startColumn, selection.endColumn) : -1;
        grid.querySelectorAll<HTMLTableCellElement>('td[data-row][data-column]').forEach(cell => {
            const row = Number(cell.dataset.row);
            const column = Number(cell.dataset.column);
            cell.classList.toggle('ducklab-selected', row >= selectedRowStart && row <= selectedRowEnd && column >= selectedColumnStart && column <= selectedColumnEnd);
        });
    }

    function draw(): void {
        selection = null;
        const rows = filteredRows();
        const pages = Math.max(1, Math.ceil((data.queryId ? totalRows : rows.length) / state.pageSize));
        state.page = Math.min(state.page, pages - 1);
        const columns = data.columns.filter(column => visible.has(column.name));
        grid.replaceChildren();
        const head = create('thead');
        const headRow = create('tr');
        const rowNumberHeader = create('th', 'ducklab-row-number', '#');
        rowNumberHeader.setAttribute('aria-label', 'Row number');
        rowNumberHeader.replaceChildren(explore, columnsMenu);
        headRow.append(rowNumberHeader);
        for (const column of columns) {
            const th = create('th');
            if (wrappedColumns.has(column.name)) th.classList.add('ducklab-wrap');
            const columnName = create('span', 'ducklab-column-name', `${column.name}${state.sortColumn === column.name ? (state.sortAscending ? ' ▲' : ' ▼') : ''}`);
            if (columnTextFilters.has(column.name) || columnValueFilters.has(column.name)) columnName.classList.add('ducklab-filtered-column');
            columnName.addEventListener('click', event => {
                event.stopPropagation();
                if (state.sortColumn === column.name) state.sortAscending = !state.sortAscending;
                else { state.sortColumn = column.name; state.sortAscending = true; }
                state.page = 0;
                void refresh();
            }, { signal });
            th.append(columnName);
            if (state.explore) appendColumnExplore(th, column, rows, currentStats?.[column.name], Boolean(data.queryId && !currentStats));
            th.append(createColumnActions(column));
            headRow.append(th);
        }
        head.append(headRow);
        const body = create('tbody');
        const start = state.page * state.pageSize;
        for (const [rowIndex, row] of (data.queryId ? rows : rows.slice(start, start + state.pageSize)).entries()) {
            const tr = create('tr');
            tr.append(create('td', 'ducklab-row-number', String(start + rowIndex + 1)));
            for (const [columnIndex, column] of columns.entries()) {
                const td = create('td', wrappedColumns.has(column.name) ? 'ducklab-wrap' : '', formatCellValue(row[column.name], columnFormats.get(column.name)));
                td.dataset.row = String(rowIndex);
                td.dataset.column = String(columnIndex);
                tr.append(td);
            }
            body.append(tr);
        }
        grid.append(head, body);
        applyFreeze(columns);
        status.textContent = `${loadError || `${(data.queryId ? totalRows : rows.length).toLocaleString()} rows, ${columns.length} visible of ${data.columns.length} columns`} · Page ${state.page + 1} of ${pages}`;
        previous.disabled = state.page === 0;
        next.disabled = state.page >= pages - 1;
    }

    function applyFreeze(columns: Column[]): void {
        if (!frozenColumn) return;
        const frozenIndex = columns.findIndex(column => column.name === frozenColumn?.name);
        if (frozenIndex < 0) return;
        const tableRows = Array.from(grid.rows);
        const applyAt = (index: number, offset: number) => {
            for (const [rowIndex, row] of tableRows.entries()) {
                const cell = row.cells[index] as HTMLTableCellElement | undefined;
                if (!cell) continue;
                cell.classList.add('ducklab-frozen');
                if (frozenColumn?.side === 'left') cell.style.left = `${offset}px`;
                else cell.style.right = `${offset}px`;
                if (rowIndex === 0) cell.style.zIndex = '5';
            }
        };
        applyAt(frozenIndex + 1, frozenColumn.side === 'left' ? ROW_NUMBER_WIDTH : 0);
    }
    draw();
    if (data.queryId && state.explore) void refresh();
}

export const activate: ActivationFunction<unknown> = (context: RendererContext<unknown>) => {
    const listeners: Array<(message: TableResponse) => void> = [];
    context.onDidReceiveMessage?.(message => {
        const response = message as TableResponse;
        if (response?.kind === 'ducklab.table.response') listeners.forEach(listener => listener(response));
    });
    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement, signal: AbortSignal) {
            try {
                const data = outputItem.json() as TableData;
                if (!Array.isArray(data.columns) || !Array.isArray(data.values)) throw new Error('Invalid table output payload');
                renderTable(data, element, signal, context, listener => {
                    listeners.push(listener);
                    return () => {
                        const index = listeners.indexOf(listener);
                        if (index >= 0) listeners.splice(index, 1);
                    };
                });
            } catch (error) {
                element.textContent = `Ducklab table renderer error: ${error instanceof Error ? error.message : String(error)}`;
            }
        }
    };
};
