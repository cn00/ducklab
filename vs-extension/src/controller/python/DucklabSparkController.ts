
import * as vscode from "vscode";
import { IFieldInfo, ITabularResultSet } from '@ducklab/core';
import { IRunningKernel } from '../IRunningKernel';
import { MessageType, OutputMessage } from '../messaging';
import { IDisposable } from '@/disposable';
import { TypedEmitter } from '../TypedEmitter';
import { KernelSelector } from '../vs/KernelSelector';
import path from 'path';
import { IControllerOpts } from '../IControllerOpts';
import { expandNotebookSql } from '../notebookSqlEnvironment';
import { errorMessage, redactSecrets } from '../sqlEnvironment';
import { createPagedTableResult, TABLE_MIME_TYPE, TableQueryRegistry } from '../tableQuery';
import { executeSparkQuery } from '../kernelTableQuery';


export class DucklabSparkController implements IDisposable {

    readonly id = 'ducklab-spark';
    readonly notebookType = 'isql';
    readonly supportedLanguages = ['sql', 'markdown', 'plaintext', 'python'];
    readonly label: string = 'PySpark/SQL';
    readonly description?: string | undefined;
    readonly detail?: string | undefined;
    readonly supportsExecutionOrder = true;

    onDidChangeSelectedNotebooks: vscode.Event<{ readonly notebook: vscode.NotebookDocument; readonly selected: boolean; }>;

    public readonly opts: IControllerOpts;
    private readonly _controller: vscode.NotebookController;
    private _executionOrder = 0;
    private kSelector = new KernelSelector();
    private readonly tableQueries: TableQueryRegistry;

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

            vscode.workspace.onDidCloseNotebookDocument(nb => this.onNotebookClose(nb));


            // json stringify to escape the string
            const allowUnsignedExtensions = vscode.workspace.getConfiguration('ducklab')
                .get<boolean>('allowUnsignedExtensions', false);
            // DuckDB's Spark builder ignores config(); configure its connection at creation.
            const sparkInitialization = allowUnsignedExtensions ? `
                from duckdb.experimental.spark.context import SparkContext
                class _DucklabSparkContext(SparkContext):
                    def __init__(self):
                        self._connection = duckdb.connect(':memory:', config={'allow_unsigned_extensions': 'true'})
                        self._connection.execute("set default_null_order='nulls_first_on_asc_last_on_desc'")
                spark = SparkSession(_DucklabSparkContext())
            ` : `
                spark = SparkSession.builder.getOrCreate()
            `;
            this.kSelector.init(`
                import duckdb
                db = duckdb.connect(r'${path.join(this.opts.tempPath, this.id)}.duckdb', config={'allow_unsigned_extensions': '${allowUnsignedExtensions}'})
                db.execute('set file_search_path=${JSON.stringify(opts.workingDir)};')
                
                # import os
                # import sys
                # sys.path.append(os.path.abspath('./pyspark.py'))  # can be used to rename duckdb.experimental.spark to pyspark
                
                from duckdb.experimental.spark.sql import SparkSession
${sparkInitialization}

            `, 60000);

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

    async executeHandler(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, controller: vscode.NotebookController) {
        try {
            let kernel = await this.kSelector.resolveKernel(notebook);
            for (let cell of cells) {
                await this._doExecution(cell, kernel, notebook.uri);
            }
        }
        catch (err) {
            console.log("Failed: ", err);
        }
    }

    dispose(): void {
        this._controller.dispose();
        this.kSelector.dispose();
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

    private async _doExecution(cell: vscode.NotebookCell, kernel: IRunningKernel, notebookUri: vscode.Uri): Promise<void> {
        this.tableQueries.removeCell(notebookUri, cell.document.uri.toString());
        let failed = false;
        let secrets: string[] = [];
        let currExecution = this._controller.createNotebookCellExecution(cell);

        currExecution.executionOrder = ++this._executionOrder;
        currExecution.start(Date.now()); // Keep track of elapsed time to execute cell.
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
                    sql => executeSparkQuery(kernel, sql), this.tableQueries, notebookUri, cell.document.uri.toString(),
                    message => redactSecrets(message, secrets));
                if (tableData) {
                    await currExecution.replaceOutput([new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(JSON.stringify(tableData), TABLE_MIME_TYPE)
                    ])]);
                    currExecution.end(true, Date.now());
                    return;
                }
                resEmitter = await kernel.execute(`spark.sql(${JSON.stringify(expanded.query)})`);
            }
            resEmitter.on(async (event) => {
                if (event.msgType === MessageType.Output) {
                    const msg = (event as OutputMessage);

                    if (msg.content.contentType === "text/html") {
                        await currExecution.appendOutput(new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(msg.content.data, msg.content.contentType)
                        ]));
                    }
                    else {
                        await currExecution.appendOutputItems([
                            vscode.NotebookCellOutputItem.stdout(msg.content.data)
                        ], output);
                    }
                }
                if (event.msgType === MessageType.Error) {
                    const traceback = redactSecrets(String(event.content.traceback ?? 'Spark kernel execution failed'), secrets);
                    console.error("[Ducklab] Spark kernel execution failed:", traceback);
                    failed = true;
                    await currExecution.appendOutput(new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stderr(traceback)
                    ]));
                }
            });
            resEmitter.onDispose(code => {
                if (code !== 0) failed = true;
                console.log("Response emitter Disposed: ", cell.index);
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
