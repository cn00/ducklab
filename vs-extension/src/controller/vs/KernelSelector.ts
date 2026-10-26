import { PythonExtension, ResolvedEnvironment } from '@vscode/python-extension';
import * as vscode from "vscode";
import path from 'path';
import { KernelManager } from '../python/KernelManager';
import { IKernelSpec, KernelType } from '../python/IKernelSpec';
import { KernelStatus } from '../IRunningKernel';
import { getResourceId } from '../utils';


export class KernelSelector {

    private _python: PythonExtension;
    readonly kernelManager = new KernelManager();
    private kernelMap: { [nbId: string]: string; } = {};
    private entry_script: string;
    private init_timeout_ms: number;

    async init(entry_script: string = null, init_timeout_ms = 60000) {
        if (!this._python) {
            this._python = await PythonExtension.api();
            await this._python.ready;
        }
        this.listenEnvironmentChangeEvent();
        const lines = entry_script.replace(/\r\n/g, "\n").split("\n");
        const nonEmptyLines = lines.filter(line => line.trim());
        const indentation = nonEmptyLines.length
            ? Math.min(...nonEmptyLines.map(line => line.length - line.trimStart().length))
            : 0;
        this.entry_script = lines.map(line => line.slice(indentation)).join("\n");
        this.init_timeout_ms = init_timeout_ms;
    }

    private async listEnvs(): Promise<ResolvedEnvironment[]> {
        await this._python.environments.refreshEnvironments();
        const environments = await Promise.all(this._python.environments.known.map(environment =>
            this._python.environments.resolveEnvironment(environment)));
        return environments.filter((environment): environment is ResolvedEnvironment =>
            environment !== undefined && environment.executable.uri !== undefined);
    }

    async resolveKernel(notebook: vscode.NotebookDocument) {
        const nbId = getResourceId(notebook.uri);

        if (nbId in this.kernelMap) {
            const kernel = this.kernelManager.get(this.kernelMap[nbId]);
            if (kernel && kernel.status !== KernelStatus.Killed) {
                return kernel;
            }
            delete this.kernelMap[nbId];
            if (kernel) this.kernelManager.kill(kernel.id);
        }
        if (!this._python) {
            this._python = await PythonExtension.api();
            await this._python.ready;
        }
        let envPath = this._python.environments.getActiveEnvironmentPath(notebook.uri);
        let env = await this._python.environments.resolveEnvironment(envPath);
        let spec: IKernelSpec;
        if (!env) {
            spec = await this.requestKernelSelection(notebook);
        }
        else {
            spec = this.fromEnvToSpec(env);
        }
        if (!spec) throw new Error('No Python environment selected for this notebook.');
        let kernel = await this.attachKernel(notebook, spec);
        return kernel;
    }

    async selectEnvironment(notebook: vscode.NotebookDocument): Promise<void> {
        if (!this._python) {
            this._python = await PythonExtension.api();
            await this._python.ready;
        }
        const environments = await this.listEnvs();
        if (!environments.length) {
            throw new Error('No usable Python environments were found. Select an interpreter that has a Python executable.');
        }

        const activePath = this._python.environments.getActiveEnvironmentPath(notebook.uri);
        const activeEnvironment = activePath
            ? await this._python.environments.resolveEnvironment(activePath)
            : undefined;
        const items = environments.map(environment => {
            const spec = this.fromEnvToSpec(environment);
            return {
                label: spec.label,
                description: environment.id === activeEnvironment?.id ? 'Currently selected' : undefined,
                detail: spec.path,
                environment
            };
        });
        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: false,
            placeHolder: activeEnvironment
                ? `Current: ${this.fromEnvToSpec(activeEnvironment).label}`
                : 'Select Python environment for this notebook'
        });
        if (!selected) return;

        await this._python.environments.updateActiveEnvironmentPath(selected.environment, notebook.uri);
        await this.killAttachedKernel(notebook);
        vscode.window.showInformationMessage(`Ducklab will use ${selected.label} when the next cell runs.`);
    }

    public async requestKernelSelection(notebook: vscode.NotebookDocument) {
        let envs = await this.listEnvs();
        if (!envs.length) throw new Error('No usable Python environments were found. Select an interpreter that has a Python executable.');
        let kernels = envs.map(env => this.fromEnvToSpec(env));
        let selectedSpec = await this.showPickup(kernels, "Select Python Kernel");
        console.log("Selected Spec: ", selectedSpec);
        if (!selectedSpec) {
            return;
        }
        await this._python.environments.updateActiveEnvironmentPath(
            envs.find(environment => environment.id === selectedSpec.id)!,
            notebook.uri
        );
        return selectedSpec;
    }

    private async showPickup<T extends vscode.QuickPickItem>(items: T[], placeholder: string) {
        let selection = await vscode.window.showQuickPick<T>(items,
            {
                canPickMany: false,
                placeHolder: placeholder,
            });
        return selection;
    }

    public fromEnvToSpec(env: ResolvedEnvironment): IKernelSpec {
        const pythonPath = env.executable.uri?.fsPath;
        if (!pythonPath) throw new Error(`Python environment "${env.path}" has no executable.`);
        const name = env.environment?.name ?? path.basename(pythonPath);
        const version = env.version ?? { major: 0, minor: 0, micro: 0, release: undefined, sysVersion: '' };
        return {
            id: env.id,
            label: `${name} (${version.major ? `${version.major}.${version.minor}` : 'unknown version'})`,
            envType: env.environment?.type ?? 'Unknown',
            type: KernelType.IPYKERNEL,
            path: pythonPath,
            version
        };
    }

    private async attachKernel(notebook: vscode.NotebookDocument, spec: IKernelSpec) {
        const nbId = getResourceId(notebook.uri);

        let paths = Object.keys(this.kernelMap).filter(k => k === nbId);
        if (paths.length > 0) {
            this.kernelManager.kill(this.kernelMap[paths[0]]);
            console.log("Disposed kernel: ", paths[0], this.kernelMap[paths[0]]);
        }
        let kernel = await this.kernelManager.launchKernel(spec);
        this.kernelMap[nbId] = kernel.id;
        await kernel.waitReady(this.init_timeout_ms);
        console.log("Init: ", this);
        if (this.entry_script) {
            console.log("Init entry_scirpt: ", this.entry_script);
            let res = await kernel.executeSync(this.entry_script, this.init_timeout_ms);
            console.log("init response: ", res);
        }
        console.log("Kernel Ready: ", kernel.status, kernel);
        return kernel;
    }

    public async getAttachedKernel(notebook: vscode.NotebookDocument) {
        const nbId = getResourceId(notebook.uri);
        if (this.kernelMap[nbId]) {
            const kernel = this.kernelManager.get(this.kernelMap[nbId]);
            if (!kernel) return;
            return kernel;
        }
        return;
    }

    public async killAttachedKernel(notebook: vscode.NotebookDocument) {
        const nbId = getResourceId(notebook.uri);
        if (nbId in this.kernelMap) {
            this.kernelManager.kill(this.kernelMap[nbId]);
            delete this.kernelMap[nbId];
        }
        return;
    }

    private listenEnvironmentChangeEvent() {
        this._python.environments.onDidChangeActiveEnvironmentPath(async (ev) => {
            const activeNb = vscode.window.activeNotebookEditor?.notebook;
            if (!activeNb) return;
            console.log("Active env change event: ", ev, activeNb);
            if (ev.resource && activeNb.uri.fsPath !== ev.resource.uri.fsPath) {
                return;
            }
            let env = await this._python.environments.resolveEnvironment(ev.path);
            if (!env) return;
            await this.killAttachedKernel(activeNb);
        });
    }

    public dispose() {
        this.kernelManager.dispose();
    }
}
