jest.mock('vscode', () => ({
    notebooks: {
        createNotebookController: jest.fn(() => ({
            onDidChangeSelectedNotebooks: jest.fn(),
            dispose: jest.fn()
        }))
    },
    workspace: {
        getConfiguration: jest.fn(() => ({ get: jest.fn((_name, fallback) => fallback) })),
        onDidCloseNotebookDocument: jest.fn()
    }
}), { virtual: true });

jest.mock('../src/controller/vs/KernelSelector', () => ({
    KernelSelector: jest.fn(() => ({ init: jest.fn(), dispose: jest.fn() }))
}));

import * as vscode from 'vscode';
import { DucklabPythonController } from '../src/controller/python/DucklabPythonController';
import { DucklabSparkController } from '../src/controller/python/DucklabSparkController';
import { KernelSelector } from '../src/controller/vs/KernelSelector';
import { spawnSync } from 'child_process';

describe('Python kernel unsigned extensions configuration', () => {
    beforeEach(() => jest.clearAllMocks());

    test.each([true, false])('configures Python and Spark connections with unsigned extensions %s', enabled => {
        jest.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: jest.fn(() => enabled)
        } as vscode.WorkspaceConfiguration);
        for (const Controller of [DucklabPythonController, DucklabSparkController]) {
            const controller = new Controller({ tempPath: '/tmp', workingDir: '/workspace' }, undefined);
            try {
                const selector = jest.mocked(KernelSelector).mock.results.at(-1)!.value;
                const script: string = selector.init.mock.calls[0][0];
                expect(script).toContain(`config={'allow_unsigned_extensions': '${enabled}'}`);
                if (Controller === DucklabSparkController) {
                    expect(script.includes('class _DucklabSparkContext')).toBe(enabled);
                    expect(script.includes('spark = SparkSession.builder.getOrCreate()')).toBe(!enabled);
                }
                const syntax = spawnSync('python3', ['-c',
                    'import ast, sys, textwrap; ast.parse(textwrap.dedent(sys.stdin.read()))'
                ], { input: script, encoding: 'utf8' });
                expect(syntax.error).toBeUndefined();
                expect(syntax.stderr).toBe('');
                expect(syntax.status).toBe(0);
            } finally {
                controller.dispose();
            }
        }
    });
});
