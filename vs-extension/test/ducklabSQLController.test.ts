jest.mock('vscode', () => ({
    notebooks: {
        createNotebookController: jest.fn(() => ({})),
        createRendererMessaging: jest.fn(() => ({
            onDidReceiveMessage: jest.fn(() => ({ dispose: jest.fn() }))
        }))
    },
    workspace: {
        getConfiguration: jest.fn(() => ({ get: jest.fn((_name, fallback) => fallback) })),
        onDidCloseNotebookDocument: jest.fn(() => ({ dispose: jest.fn() }))
    },
    window: {
        withProgress: jest.fn(async (_options, task) => task({ report: jest.fn() }))
    },
    ProgressLocation: { Notification: 15 }
}), { virtual: true });

jest.mock('os', () => ({
    ...jest.requireActual('os'),
    homedir: jest.fn(() => '/mock-home')
}));

jest.mock('../src/controller/nodejs/DuckdbDataSource');

import * as vscode from 'vscode';
import { join, dirname } from 'path';
import { URI } from 'vscode-uri';
import { DuckdbDataSource } from '../src/controller/nodejs/DuckdbDataSource';
import { DucklabSQLController } from '../src/controller/nodejs/DucklabSQLController';
import { TableQueryRegistry } from '../src/controller/tableQuery';
import { getResourceId } from '../src/controller/utils';

describe('SQL Only database location', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test.each([
        URI.file('/workspace/notebooks/report.isql'),
        URI.parse('untitled:Untitled-1')
    ])('stores the database under the home directory for %s', async uri => {
        const registry = new TableQueryRegistry();
        const controller = new DucklabSQLController({
            tempPath: '/system-temp',
            workingDir: '/workspace'
        }, registry);
        const notebook = { uri } as vscode.NotebookDocument;

        try {
            const kernel = await controller.resolveKernel(notebook);

            expect(DuckdbDataSource).toHaveBeenCalledWith(getResourceId(uri), {
                databaseName: 'ducklab',
                allowUnsignedExtensions: false,
                dbPath: join('/mock-home', '.ducklab', getResourceId(uri) + '.db'),
                dataSearchPath: uri.scheme === 'file' ? dirname(uri.fsPath) : '/workspace'
            });
            expect(kernel.connect).toHaveBeenCalledTimes(1);
            expect(kernel.loadExtensions).toHaveBeenCalledTimes(1);
            expect(await controller.resolveKernel(notebook)).toBe(kernel);
            expect(DuckdbDataSource).toHaveBeenCalledTimes(1);
        } finally {
            controller.dispose();
            registry.dispose();
        }
    });

    test.each([true, false])('passes the unsigned extensions setting: %s', async enabled => {
        const get = jest.fn((name, fallback) => name === 'allowUnsignedExtensions' ? enabled : fallback);
        jest.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get } as vscode.WorkspaceConfiguration);
        const registry = new TableQueryRegistry();
        const controller = new DucklabSQLController({ tempPath: '/system-temp', workingDir: '/workspace' }, registry);
        try {
            await controller.resolveKernel({ uri: URI.file('/workspace/unsigned.isql') } as vscode.NotebookDocument);
            expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('ducklab');
            expect(get).toHaveBeenCalledWith('allowUnsignedExtensions', false);
            expect(DuckdbDataSource).toHaveBeenCalledWith(expect.any(String),
                expect.objectContaining({ allowUnsignedExtensions: enabled }));
        } finally {
            controller.dispose();
            registry.dispose();
            jest.mocked(vscode.workspace.getConfiguration).mockImplementation(() => ({
                get: jest.fn((_name, fallback) => fallback)
            } as vscode.WorkspaceConfiguration));
        }
    });

    test('reads the database name from notebook-scoped settings without changing its file path', async () => {
        jest.mocked(vscode.workspace.getConfiguration).mockImplementation(() => ({
            get: jest.fn((name, fallback) => name === 'databaseName' ? 'analytics' : fallback)
        } as vscode.WorkspaceConfiguration));
        const registry = new TableQueryRegistry();
        const controller = new DucklabSQLController({ tempPath: '/system-temp', workingDir: '/workspace' }, registry);
        const uri = URI.file('/workspace/report.isql');
        try {
            await controller.resolveKernel({ uri } as vscode.NotebookDocument);
            expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('ducklab', uri);
            expect(DuckdbDataSource).toHaveBeenCalledWith(getResourceId(uri),
                expect.objectContaining({
                    databaseName: 'analytics',
                    dbPath: join('/mock-home', '.ducklab', getResourceId(uri) + '.db')
                }));
        } finally {
            controller.dispose();
            registry.dispose();
        }
    });
});
