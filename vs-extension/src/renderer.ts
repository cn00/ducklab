import type { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';

type Column = { name: string; type?: string; nativeType?: string };
type TableData = { columns: Column[]; values: Record<string, unknown>[] };

const styles = `
.ducklab-table { color: var(--vscode-foreground); font: 12px var(--vscode-font-family); border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; }
.ducklab-toolbar { display:flex; gap:8px; align-items:center; padding:8px; border-bottom:1px solid var(--vscode-panel-border); flex-wrap:wrap; }
.ducklab-toolbar input[type=search] { flex:1; min-width:180px; padding:6px 8px; color:var(--vscode-input-foreground); background:var(--vscode-input-background); border:1px solid var(--vscode-input-border); border-radius:4px; }
.ducklab-toolbar button,.ducklab-toolbar select { padding:5px 8px; color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:0; border-radius:4px; cursor:pointer; }
.ducklab-menu { position:relative; } .ducklab-menu[open] { z-index:1; }
.ducklab-menu summary { cursor:pointer; padding:5px 8px; } .ducklab-menu-content { position:absolute; right:0; max-height:260px; overflow:auto; min-width:220px; padding:8px; background:var(--vscode-menu-background); border:1px solid var(--vscode-menu-border); box-shadow:0 4px 14px #0005; }
.ducklab-menu-content label { display:flex; gap:6px; padding:4px; white-space:nowrap; }
.ducklab-stats { display:flex; gap:12px; padding:8px; overflow:auto; border-bottom:1px solid var(--vscode-panel-border); }
.ducklab-stat { min-width:150px; padding:6px; background:var(--vscode-editorWidget-background); border-radius:4px; }
.ducklab-stat strong,.ducklab-stat span { display:block; } .ducklab-stat span { opacity:.75; margin-top:4px; }
.ducklab-hist { height:36px; display:flex; align-items:flex-end; gap:2px; margin-top:6px; } .ducklab-hist i { flex:1; min-width:3px; background:var(--vscode-charts-green); }
.ducklab-scroll { overflow:auto; max-height:480px; } .ducklab-grid { border-collapse:collapse; width:100%; }
.ducklab-grid th,.ducklab-grid td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--vscode-panel-border); white-space:nowrap; }
.ducklab-grid th { position:sticky; top:0; background:var(--vscode-editor-background); cursor:pointer; }
.ducklab-grid tbody tr:hover { background:var(--vscode-list-hoverBackground); }
.ducklab-footer { display:flex; gap:8px; align-items:center; padding:8px; opacity:.8; } .ducklab-footer .spacer { flex:1; }
`;

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function create<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function renderTable(data: TableData, root: HTMLElement, signal: AbortSignal): void {
    const visible = new Set(data.columns.map(column => column.name));
    const state = { query: '', page: 0, pageSize: 10, sortColumn: '', sortAscending: true, explore: false };
    const search = create('input');
    search.type = 'search';
    search.placeholder = 'Search all rows…';
    search.setAttribute('aria-label', 'Search table');

    const style = create('style');
    style.textContent = styles;
    const shell = create('section', 'ducklab-table');
    const toolbar = create('div', 'ducklab-toolbar');
    const columnsMenu = create('details', 'ducklab-menu');
    const summary = create('summary', '', 'Columns');
    const menu = create('div', 'ducklab-menu-content');
    columnsMenu.append(summary, menu);
    for (const column of data.columns) {
        const label = create('label');
        const checkbox = create('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) visible.add(column.name);
            else visible.delete(column.name);
            draw();
        }, { signal });
        label.append(checkbox, document.createTextNode(column.name));
        menu.append(label);
    }
    document.addEventListener('click', event => {
        if (!columnsMenu.contains(event.target as Node)) columnsMenu.open = false;
    }, { signal });
    const explore = create('button', '', 'Explore');
    explore.type = 'button';
    explore.addEventListener('click', () => { state.explore = !state.explore; draw(); }, { signal });
    const exportButton = create('button', '', 'Export CSV');
    exportButton.type = 'button';
    const toolbarSpacer = create('span');
    toolbarSpacer.style.flex = '1';
    toolbar.append(search, toolbarSpacer, columnsMenu, explore, exportButton);
    const stats = create('div', 'ducklab-stats');
    const scroll = create('div', 'ducklab-scroll');
    const grid = create('table', 'ducklab-grid');
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
    footer.append(status, footerSpacer, pageSize, previous, next);
    scroll.append(grid);
    shell.append(toolbar, stats, scroll, footer);
    root.replaceChildren(style, shell);

    search.addEventListener('input', () => { state.query = search.value.toLocaleLowerCase(); state.page = 0; draw(); }, { signal });
    previous.addEventListener('click', () => { state.page = Math.max(0, state.page - 1); draw(); }, { signal });
    next.addEventListener('click', () => { state.page++; draw(); }, { signal });
    pageSize.addEventListener('change', () => { state.pageSize = Number(pageSize.value); state.page = 0; draw(); }, { signal });
    exportButton.addEventListener('click', () => {
        const columns = data.columns.filter(column => visible.has(column.name));
        const csv = [columns.map(column => JSON.stringify(column.name)).join(','), ...filteredRows().map(row => columns.map(column => JSON.stringify(formatValue(row[column.name]))).join(','))].join('\r\n');
        const link = create('a');
        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        link.download = 'ducklab-result.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 0);
    }, { signal });

    function filteredRows(): Record<string, unknown>[] {
        let rows = data.values.filter(row => !state.query || data.columns.some(column => formatValue(row[column.name]).toLocaleLowerCase().includes(state.query)));
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

    function draw(): void {
        const rows = filteredRows();
        const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
        state.page = Math.min(state.page, pages - 1);
        const columns = data.columns.filter(column => visible.has(column.name));
        grid.replaceChildren();
        const head = create('thead');
        const headRow = create('tr');
        for (const column of columns) {
            const th = create('th', '', `${column.name}${state.sortColumn === column.name ? (state.sortAscending ? ' ▲' : ' ▼') : ''}`);
            th.addEventListener('click', () => {
                if (state.sortColumn === column.name) state.sortAscending = !state.sortAscending;
                else { state.sortColumn = column.name; state.sortAscending = true; }
                draw();
            }, { signal });
            headRow.append(th);
        }
        head.append(headRow);
        const body = create('tbody');
        const start = state.page * state.pageSize;
        for (const row of rows.slice(start, start + state.pageSize)) {
            const tr = create('tr');
            for (const column of columns) tr.append(create('td', '', formatValue(row[column.name])));
            body.append(tr);
        }
        grid.append(head, body);
        status.textContent = `${rows.length.toLocaleString()} rows, ${columns.length} visible of ${data.columns.length} columns · Page ${state.page + 1} of ${pages}`;
        previous.disabled = state.page === 0;
        next.disabled = state.page >= pages - 1;
        if (state.explore) {
            stats.replaceChildren();
            stats.hidden = false;
            for (const column of columns) {
                const isNumeric = column.type === 'number' || /(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|FLOAT|DOUBLE|DECIMAL)/i.test(column.nativeType ?? '');
                const numbers = isNumeric
                    ? rows.map(row => row[column.name]).filter(value => value !== null && value !== undefined && value !== '').map(Number).filter(Number.isFinite)
                    : [];
                const card = create('div', 'ducklab-stat');
                card.append(create('strong', '', column.name));
                if (numbers.length) {
                    let min = Number.POSITIVE_INFINITY;
                    let max = Number.NEGATIVE_INFINITY;
                    for (const number of numbers) {
                        if (number < min) min = number;
                        if (number > max) max = number;
                    }
                    const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
                    card.append(create('span', '', `min ${min} · mean ${mean.toPrecision(4)} · max ${max} · n ${numbers.length}`));
                    const bins = Array.from({ length: 8 }, () => 0);
                    for (const number of numbers) {
                        const index = max === min ? 0 : Math.min(bins.length - 1, Math.floor(((number - min) / (max - min)) * bins.length));
                        bins[index]++;
                    }
                    const histogram = create('div', 'ducklab-hist');
                    const peak = Math.max(...bins);
                    for (const count of bins) {
                        const bar = create('i');
                        bar.style.height = `${Math.max(2, (count / peak) * 36)}px`;
                        histogram.append(bar);
                    }
                    card.append(histogram);
                } else {
                    const nonNull = rows.filter(row => row[column.name] !== null && row[column.name] !== undefined).length;
                    card.append(create('span', '', `${nonNull} non-null · ${rows.length - nonNull} null`));
                }
                stats.append(card);
            }
        } else {
            stats.hidden = true;
            stats.replaceChildren();
        }
    }
    draw();
}

export const activate: ActivationFunction<unknown> = (_context: RendererContext<unknown>) => ({
    renderOutputItem(outputItem: OutputItem, element: HTMLElement, signal: AbortSignal) {
        try {
            const data = outputItem.json() as TableData;
            if (!Array.isArray(data.columns) || !Array.isArray(data.values)) throw new Error('Invalid table output payload');
            renderTable(data, element, signal);
        } catch (error) {
            element.textContent = `Ducklab table renderer error: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
});
