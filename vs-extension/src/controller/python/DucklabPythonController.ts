
import * as vscode from "vscode";
import { IFieldInfo, ITabularResultSet } from '@ducklab/core';
import { IRunningKernel } from '../IRunningKernel';
import { MessageType, OutputMessage } from '../messaging';
import { IDisposable } from '@/disposable';
import { TypedEmitter } from '../TypedEmitter';
import { KernelSelector } from '../vs/KernelSelector';
import path from 'path';
import { IControllerOpts } from '../IControllerOpts';
import { getResourceId } from '../utils';
import { expandNotebookSql } from '../notebookSqlEnvironment';
import { errorMessage, redactSecrets } from '../sqlEnvironment';
import { createPagedTableResult, quoteSqlIdentifier, TABLE_MIME_TYPE, TableQueryRegistry } from '../tableQuery';
import { executePythonQuery, indentPython, pandasDataFrameFormatterCode, PANDAS_DATAFRAME_MIME_TYPE, registeredPandasDataFrameName } from '../kernelTableQuery';


export class DucklabPythonController implements IDisposable {

    readonly id = 'ducklab';
    readonly notebookType = 'ducklab-markdown';
    readonly supportedLanguages = ['sql', 'markdown', 'plaintext', 'python'];
    readonly label: string = 'Python/SQL';
    readonly description?: string | undefined;
    readonly detail?: string | undefined;
    readonly supportsExecutionOrder = true;

    onDidChangeSelectedNotebooks: vscode.Event<{ readonly notebook: vscode.NotebookDocument; readonly selected: boolean; }>;

    public readonly opts: IControllerOpts;
    private readonly _controller: vscode.NotebookController;
    private _executionOrder = 0;
    private kSelector = new KernelSelector();
    private readonly tableQueries: TableQueryRegistry;
    private readonly output = vscode.window.createOutputChannel('Ducklab');

    constructor(opts: IControllerOpts, tableQueries: TableQueryRegistry) {

        this.opts = opts;
        this.tableQueries = tableQueries;

        try {
            this._controller = vscode.notebooks.createNotebookController(this.id,
                this.notebookType,
                this.label);

            this._controller.interruptHandler = this.interruptHandler.bind(this);
            this._controller.executeHandler = this.executeHandler.bind(this);
            this._controller.supportsExecutionOrder = this.supportsExecutionOrder;
            this._controller.supportedLanguages = this.supportedLanguages;

            this._controller.onDidChangeSelectedNotebooks(({ notebook, selected }) => {
                if (selected) void this.warmKernel(notebook);
            });

            vscode.workspace.onDidCloseNotebookDocument(nb => this.onNotebookClose(nb));

            // json stringify to escape the string
            const allowUnsignedExtensions = vscode.workspace.getConfiguration('ducklab')
                .get<boolean>('allowUnsignedExtensions', false);
            const renderPandasDataframes = vscode.workspace.getConfiguration('ducklab')
                .get<boolean>('renderPandasDataframes', true);
            void this.kSelector.init(`
                import duckdb
                db = duckdb.connect(r'${path.join(opts.tempPath, this.id)}.duckdb', config={'allow_unsigned_extensions': '${allowUnsignedExtensions}'})
                print('__DUCKLAB_DB__: initialized')
${indentPython(pandasDataFrameFormatterCode(renderPandasDataframes), 16)}
            `, 60000).catch(error => {
                this.output.appendLine(`[Python/SQL] Python extension initialization failed: ${errorMessage(error)}`);
            });
            this.kSelector.initializationOutput.on(message => {
                this.output.appendLine(`[Python/SQL] Kernel initialization: ${message.trim()}`);
            });
        }
        catch (e) {
            console.log(e);
        }
    }

    private onNotebookClose(notebook: vscode.NotebookDocument) {
        this.kSelector.killAttachedKernel(notebook);
        console.log("Disposed: ", notebook.uri.fsPath);
    }

    async interruptHandler(notebook) {
        console.log("Interrupting: ", notebook.uri);

        let kernel = await this.kSelector.getAttachedKernel(notebook);
        if (!kernel) return;
        await kernel.interrupt();
    }

    async selectPythonEnvironment(notebook: vscode.NotebookDocument): Promise<void> {
        await this.kSelector.selectEnvironment(notebook);
    }

    private async warmKernel(notebook: vscode.NotebookDocument): Promise<void> {
        try {
            this.output.appendLine(`[Python/SQL] Preparing kernel for ${notebook.uri.toString()}`);
            await this.kSelector.resolveKernel(notebook);
            this.output.appendLine('[Python/SQL] Kernel is ready.');
        } catch (error) {
            this.output.appendLine(`[Python/SQL] Kernel preparation failed: ${errorMessage(error)}`);
        }
    }

    async executeHandler(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, controller: vscode.NotebookController) {
        const executions = new Map<vscode.NotebookCell, vscode.NotebookCellExecution>();
        for (const cell of cells) {
            const execution = this._controller.createNotebookCellExecution(cell);
            execution.executionOrder = ++this._executionOrder;
            execution.start(Date.now());
            await execution.clearOutput();
            await execution.replaceOutput([new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.stdout('Starting Python/SQL kernel…\r\n')
            ])]);
            executions.set(cell, execution);
        }
        try {
            this.output.appendLine(`[Python/SQL] Resolving kernel for ${notebook.uri.toString()}`);
            let kernel = await this.kSelector.resolveKernel(notebook);
            await this.configureWorkingDirectory(kernel, notebook);
            for (let cell of cells) {
                await this._doExecution(cell, kernel, notebook.uri, executions.get(cell));
            }
        }
        catch (err) {
            await this.reportKernelStartFailure(cells, err, executions);
        }
    }

    private async configureWorkingDirectory(kernel: IRunningKernel, notebook: vscode.NotebookDocument): Promise<void> {
        const workingDir = notebook.uri.scheme === 'file'
            ? path.dirname(notebook.uri.fsPath)
            : this.opts.workingDir;
        const escapedWorkingDir = JSON.stringify(workingDir);
        const databasePath = JSON.stringify(path.join(this.opts.tempPath, this.id) + '.duckdb');
        const allowUnsignedExtensions = vscode.workspace.getConfiguration('ducklab')
            .get<boolean>('allowUnsignedExtensions', false);
        const responses = await kernel.executeSync(`import os\nimport duckdb\nif 'db' not in globals():\n    db = duckdb.connect(${databasePath}, config={'allow_unsigned_extensions': '${allowUnsignedExtensions}'})\n    print('__DUCKLAB_DB__: recovered')\nos.chdir(${escapedWorkingDir})\ndb.execute('set file_search_path=' + repr(${escapedWorkingDir}))`, 60000);
        for (const response of responses) {
            if (response.msgType === MessageType.Output && String(response.content.data).includes('__DUCKLAB_DB__: recovered')) {
                this.output.appendLine('[Python/SQL] Recreated missing global db connection.');
            }
        }
    }

    private async reportKernelStartFailure(cells: vscode.NotebookCell[], error: unknown,
        executions = new Map<vscode.NotebookCell, vscode.NotebookCellExecution>()): Promise<void> {
        const message = `Failed to start the Python/SQL kernel: ${errorMessage(error)}`;
        console.error("[Ducklab]", message);
        this.output.appendLine(`[Python/SQL] ${message}`);
        await Promise.all(cells.map(async cell => {
            const execution = executions.get(cell) ?? this._controller.createNotebookCellExecution(cell);
            if (!executions.has(cell)) {
                execution.executionOrder = ++this._executionOrder;
                execution.start(Date.now());
                await execution.clearOutput();
            }
            await execution.replaceOutput([new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.stderr(`${message}\r\n`)
            ])]);
            execution.end(false, Date.now());
        }));
    }

    dispose(): void {
        this._controller.dispose();
        this.kSelector.dispose();
        this.output.dispose();
    }

    private getRow(cols: IFieldInfo[], obj: any) {
        let row = "";
        for (let k of cols) {
            row += `<td>${obj[k.name]}</td>`;
        }
        return `<tr>${row}</tr>`;
    }

    private getEllipsesRow(results: ITabularResultSet) {
        let row = {};
        for (let col of results.columns) {
            row[col.name] = "...";
        }
        return row;
    }

    private renderTable(results: ITabularResultSet): string {
        let values = results.values;
        if (results.values.length > 50) {
            values = results.values.slice(0, 5);
            values.push(this.getEllipsesRow(results));
            values = values.concat(results.values.slice(results.values.length - 5));
        }
        let text = `<table class="ducklab-table">
        <thead><tr>${results.columns.map(c => '<th>' + c.name + '</th>').join("\n")}</tr></thead>
        <tbody>${values.map(row => this.getRow(results.columns, row)).join("\n")}</tbody>
        </table>
        <style>
        // .ducklab-table thead, .ducklab-table tbody {
        //     display: block;
        // }
        // .ducklab-table tbody {
        //     height: 100px;
        //     overflow: auto;
        // }
        </style>
        `;
        return text;
    }

    private async _doExecution(cell: vscode.NotebookCell, kernel: IRunningKernel, notebookUri: vscode.Uri,
        existingExecution?: vscode.NotebookCellExecution): Promise<void> {
        this.tableQueries.removeCell(notebookUri, cell.document.uri.toString());
        let failed = false;
        let secrets: string[] = [];
        let pandasDataFrameTableName: string | undefined;
        const currExecution = existingExecution ?? this._controller.createNotebookCellExecution(cell);

        if (!existingExecution) {
            currExecution.executionOrder = ++this._executionOrder;
            currExecution.start(Date.now()); // Keep track of elapsed time to execute cell.
        }
        await currExecution.clearOutput();
        let output = new vscode.NotebookCellOutput([]);
        await currExecution.replaceOutput(output);

        try {
            let resEmitter: TypedEmitter<any> = null;
            if (cell.document.languageId.toLowerCase() === "python") {
                resEmitter = await kernel.execute(cell.document.getText());
            }
            if (cell.document.languageId.toLowerCase() === "sql") {
                let cellText = cell.document.getText();
                const rx = /^[%]view ([a-zA-Z0-9_]+)/;
                const match = cellText.split('\n')[0].match(rx);
                if (match) {
                    const tblName = match[1];
                    const queryText = cellText.split('\n').slice(1).join('\n');
                    cellText = `CREATE OR REPLACE VIEW "${tblName}" AS (${queryText})\n; SELECT * FROM "${tblName}"`;
                }
                const expanded = await expandNotebookSql(cellText, notebookUri);
                secrets = expanded.secrets;
                console.debug("[Ducklab] Running SQL cell");
                const tableData = await createPagedTableResult(expanded.query,
                    sql => executePythonQuery(kernel, sql), this.tableQueries, notebookUri, cell.document.uri.toString(),
                    message => redactSecrets(message, secrets));
                if (tableData) {
                    await currExecution.replaceOutput([new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(JSON.stringify(tableData), TABLE_MIME_TYPE)
                    ])]);
                    currExecution.end(true, Date.now());
                    return;
                }
                resEmitter = await kernel.execute(`db.query(${JSON.stringify(expanded.query)})`);
            }
            resEmitter.on(async (event) => {
                if (event.msgType === MessageType.Output) {
                    const msg = (event as OutputMessage);
                    this.output.appendLine(`[Python/SQL] Display MIME: ${msg.content.contentType}; available: ${(msg.content.mimeTypes ?? []).join(', ')}`);

                    if (msg.content.contentType === PANDAS_DATAFRAME_MIME_TYPE) {
                        const tableName = registeredPandasDataFrameName(msg.content.data);
                        this.output.appendLine(`[Python/SQL] Pandas dataframe MIME ${tableName ? `received for ${tableName}` : 'had an invalid payload'}.`);
                        if (tableName) {
                            // The outer cell is still executing. Running the table
                            // probe now would nest an execute request in IOPub output.
                            pandasDataFrameTableName = tableName;
                            return;
                        }
                    }
                    if (msg.content.contentType === "text/html") {
                        this.output.appendLine('[Python/SQL] Received HTML output instead of the Pandas dataframe MIME.');
                        await currExecution.appendOutput(new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(String(msg.content.data), msg.content.contentType)
                        ]));
                    }
                    else {
                        await currExecution.appendOutputItems([
                            vscode.NotebookCellOutputItem.stdout(String(msg.content.data))
                        ], output);
                    }
                }
                if (event.msgType === MessageType.Error) {
                    const traceback = redactSecrets(String(event.content.traceback ?? 'Python kernel execution failed'), secrets);
                    console.error("[Ducklab] Python kernel execution failed:", traceback);
                    failed = true;
                    await currExecution.appendOutput(new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stderr(traceback)
                    ]));
                }
            });
            resEmitter.onDispose(async code => {
                if (code !== 0) failed = true;
                console.log("Response emitter Disposed: ", cell.index);
                // Let the IOPub idle message finish dispatching before issuing a
                // follow-up request on the same kernel connection.
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                if (!failed && pandasDataFrameTableName) {
                    try {
                        this.output.appendLine('[Python/SQL] Probing Pandas dataframe for the interactive table.');
                        const tableData = await createPagedTableResult(`SELECT * FROM ${quoteSqlIdentifier(pandasDataFrameTableName)}`,
                            sql => executePythonQuery(kernel, sql), this.tableQueries, notebookUri, cell.document.uri.toString(),
                            message => redactSecrets(message, secrets));
                        if (!tableData) throw new Error('Pandas dataframe table probe returned no columns.');
                        this.output.appendLine('[Python/SQL] Rendered Pandas dataframe with the Ducklab interactive table.');
                        await currExecution.replaceOutput([new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(JSON.stringify(tableData), TABLE_MIME_TYPE)
                        ])]);
                    } catch (error) {
                        failed = true;
                        const message = redactSecrets(errorMessage(error), secrets);
                        this.output.appendLine(`[Python/SQL] Could not render Pandas dataframe: ${message}`);
                        await currExecution.replaceOutput([new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.stderr(`Could not render Pandas dataframe: ${message}\r\n`)
                        ])]);
                    }
                }
                currExecution.end(!failed, Date.now());
            });
        }

        catch (e) {
            const message = redactSecrets(errorMessage(e), secrets);
            console.error("[Ducklab] Cell execution failed:", message);
            await currExecution.replaceOutput(new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.error(new Error(message))
            ]));
            currExecution.end(false, Date.now());
        }
    }
}
