jest.mock('vscode', () => ({}), { virtual: true });
jest.mock('@vscode/python-extension', () => ({
    PythonExtension: { api: jest.fn() }
}));
jest.mock('../src/controller/python/KernelManager', () => ({
    KernelManager: jest.fn()
}));

import * as vscode from 'vscode';
import { PythonExtension } from '@vscode/python-extension';
import { KernelManager } from '../src/controller/python/KernelManager';
import { KernelSelector } from '../src/controller/vs/KernelSelector';

describe('kernel initialization script indentation', () => {
    test.each(['\n', '\r\n'])('preserves nested Python indentation with %j newlines', async newline => {
        const kernel = {
            id: 'kernel-1',
            waitReady: jest.fn(),
            executeSync: jest.fn(),
        };
        jest.mocked(KernelManager).mockImplementation(() => ({
            launchKernel: jest.fn(async () => kernel),
            dispose: jest.fn(),
        } as unknown as KernelManager));
        jest.mocked(PythonExtension.api).mockResolvedValue({
            ready: Promise.resolve(),
            environments: {
                onDidChangeActiveEnvironmentPath: jest.fn(),
                getActiveEnvironmentPath: jest.fn(),
                resolveEnvironment: jest.fn(async () => ({
                    id: 'env-1', path: '/python',
                    environment: { name: 'test', type: 'VirtualEnvironment' },
                    version: { major: 3, minor: 12 }
                }))
            }
        } as unknown as PythonExtension);
        const selector = new KernelSelector();
        try {
            await selector.init([
                '',
                '    class Context:',
                '        def __init__(self):',
                '            self.enabled = True',
                '    context = Context()',
                ''
            ].join(newline));
            await selector.resolveKernel({
                uri: { fsPath: '/workspace/test.isql' }
            } as vscode.NotebookDocument);

            expect(kernel.executeSync).toHaveBeenCalledWith(
                '\nclass Context:\n    def __init__(self):\n        self.enabled = True\ncontext = Context()\n',
                60000);
        } finally {
            selector.dispose();
        }
    });
});
