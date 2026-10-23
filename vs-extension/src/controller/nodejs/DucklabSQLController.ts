
import * as vscode from "vscode";
import { DuckdbDataSource } from './DuckdbDataSource';
import { ITabularResultSet } from '@ducklab/core';
import { IControllerOpts } from '../IControllerOpts';
import path from "path";
import { getResourceId } from '../utils';
import { expandNotebookSql } from '../notebookSqlEnvironment';
import { errorMessage, redactSecrets } from '../sqlEnvironment';

const TABLE_MIME_TYPE = 'application/vnd.ducklab.table+json';

export class DucklabSQLController {

    readonly id = 'ducklab-sql';
    readonly notebookType = 'isql';
    readonly supportedLanguages = ['sql', 'markdown', 'plaintext'];
    readonly label: string = 'SQL Only';
    readonly description?: string | undefined;
    readonly detail?: string | undefined;
    readonly supportsExecutionOrder?: boolean | undefined = true;

    public readonly opts: IControllerOpts;
    private readonly _controller: vscode.NotebookController;
    private _executionOrder = 0;
    private kernels: { [id: string]: DuckdbDataSource; } = {};

    constructor(opts: IControllerOpts) {

        this.opts = opts;

        this._controller = vscode.notebooks.createNotebookController(
            this.id,
            'isql',
            this.label
        );

        this._controller.executeHandler = this.executeHandler.bind(this);
        this._controller.supportsExecutionOrder = this.supportsExecutionOrder;
        this._controller.supportedLanguages = this.supportedLanguages;

        vscode.workspace.onDidCloseNotebookDocument(nb => this.onNotebookClose(nb));
    }

    private onNotebookClose(notebook: vscode.NotebookDocument) {
        const nbId = getResourceId(notebook.uri);
        if (nbId in this.kernels) {
            this.kernels[nbId].dispose();
            delete this.kernels[nbId];
            console.log("Disposed: ", nbId);
        }
    }

    private async showNotification(message: string) {

    }


    public async resolveKernel(notebook: vscode.NotebookDocument) {

        const nbId = getResourceId(notebook.uri);

        if (!(nbId in this.kernels)) {
            const workingDir = notebook.uri.scheme === 'file'
                ? path.dirname(notebook.uri.fsPath)
                : this.opts.workingDir;
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Initializing Kernel...",
            }, async (progress) => {
                this.kernels[nbId] = new DuckdbDataSource(nbId, {
                    dataSearchPath: workingDir,
                    dbPath: path.join(this.opts.tempPath, "ducklab", nbId + ".db")
                });
                await this.kernels[nbId].connect();
                progress.report({ message: "Loading Default Extensions..." });
                await this.kernels[nbId].loadExtensions();
            });
        }
        return this.kernels[nbId];
    }

    public getInnerController() {
        return this._controller.id;
    }

    async executeHandler(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, controller: vscode.NotebookController) {
        const kernel = await this.resolveKernel(notebook);
        for (const cell of cells) {
            this._doExecution(cell, kernel, notebook.uri);
        }
    }

    dispose(): void {
        Object.keys(this.kernels).map(k => this.kernels[k].dispose());
    }

    private async _doExecution(cell: vscode.NotebookCell, kernel: DuckdbDataSource, notebookUri: vscode.Uri): Promise<void> {
        const execution = this._controller.createNotebookCellExecution(cell);
        let secrets: string[] = [];
        execution.executionOrder = ++this._executionOrder;
        execution.start(Date.now()); // Keep track of elapsed time to execute cell.

        try {
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
            const results = await kernel.queryNative(expanded.query);
            const tableData = {
                columns: results.columns.map(({ name, type, nativeType }) => ({
                    name,
                    type,
                    nativeType: String(nativeType)
                })),
                values: results.values
            };

            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(JSON.stringify(tableData), TABLE_MIME_TYPE)
                ])
            ]);
            execution.end(true, Date.now());
        }

        catch (e) {
            const message = redactSecrets(errorMessage(e), secrets);
            console.error("[Ducklab] SQL execution failed:", message);
            execution.replaceOutput(new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.error(new Error(message))
            ]));
            execution.end(false, Date.now());
        }

    }
}
