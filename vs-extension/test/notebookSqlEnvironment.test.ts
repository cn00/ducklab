jest.mock('vscode', () => ({
    workspace: { fs: { readFile: jest.fn() } }
}), { virtual: true });

import * as vscode from 'vscode';
import { expandNotebookSql } from '../src/controller/notebookSqlEnvironment';

const readFile = vscode.workspace.fs.readFile as jest.Mock;

function notebookUri(filePath = '/workspace/notebooks/report.isql'): vscode.Uri {
    const uri = {
        scheme: 'file',
        path: filePath,
        with(this: object, changes: object) {
            return { ...this, ...changes };
        }
    };
    return uri as vscode.Uri;
}

describe('notebook SQL environment loading', () => {
    const originalHost = process.env.PGHOST;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.PGHOST = 'process-host';
    });

    afterAll(() => {
        if (originalHost === undefined) delete process.env.PGHOST;
        else process.env.PGHOST = originalHost;
    });

    test('reads the sibling .env and lets it override process variables', async () => {
        readFile.mockResolvedValue(Buffer.from('PGHOST=file-host\nPGDATABASE=analytics'));

        const result = await expandNotebookSql('ATTACH $PGHOST/${PGDATABASE}', notebookUri());

        expect(result.query).toBe('ATTACH file-host/analytics');
        expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/workspace/notebooks/.env' }));
    });

    test('falls back to process variables when the sibling .env is missing', async () => {
        readFile.mockRejectedValue({ code: 'FileNotFound' });

        const result = await expandNotebookSql('ATTACH $PGHOST', notebookUri());

        expect(result.query).toBe('ATTACH process-host');
    });

    test('re-reads the sibling .env for each SQL execution', async () => {
        readFile
            .mockResolvedValueOnce(Buffer.from('PGHOST=first-host'))
            .mockResolvedValueOnce(Buffer.from('PGHOST=second-host'));

        const first = await expandNotebookSql('ATTACH $PGHOST', notebookUri());
        const second = await expandNotebookSql('ATTACH $PGHOST', notebookUri());

        expect(first.query).toBe('ATTACH first-host');
        expect(second.query).toBe('ATTACH second-host');
        expect(readFile).toHaveBeenCalledTimes(2);
    });

    test('does not read .env when SQL has no variables', async () => {
        const result = await expandNotebookSql('SELECT 1', notebookUri());

        expect(result.query).toBe('SELECT 1');
        expect(readFile).not.toHaveBeenCalled();
    });
});
