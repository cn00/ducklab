import * as vscode from 'vscode';
import path from 'path';
import { expandSqlText, parseDotEnv, sqlEnvironmentVariableNames } from './sqlEnvironment';
import type { ExpandedSql } from './sqlEnvironment';

function notebookEnvUri(notebookUri: vscode.Uri): vscode.Uri | null {
    if (notebookUri.scheme === 'untitled' || !notebookUri.path) return null;
    return notebookUri.with({
        path: path.posix.join(path.posix.dirname(notebookUri.path), '.env'),
        query: '',
        fragment: ''
    });
}

export async function expandNotebookSql(sql: string, notebookUri: vscode.Uri): Promise<ExpandedSql> {
    if (!sqlEnvironmentVariableNames(sql).length) return { query: sql, secrets: [] };

    let fileEnvironment: Record<string, string> = Object.create(null);
    const envUri = notebookEnvUri(notebookUri);
    if (envUri) {
        try {
            const contents = await vscode.workspace.fs.readFile(envUri);
            fileEnvironment = parseDotEnv(Buffer.from(contents).toString('utf8'));
        } catch (error) {
            if ((error as { code?: string })?.code !== 'FileNotFound') {
                throw new Error('Unable to read the .env file next to this notebook.');
            }
        }
    }

    return expandSqlText(sql, { ...process.env, ...fileEnvironment });
}
