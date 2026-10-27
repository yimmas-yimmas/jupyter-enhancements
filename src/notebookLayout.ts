import * as vscode from 'vscode';
import {
    CONTROLLED_KEYS, LayoutSnapshot, isLayoutSnapshot,
    ExecutionTimeDisplay, planNotebookPreferences
} from './layoutProfileState';

const BACKUP_KEY = 'jupyterEnhancements.layout.balancedCompact.originalUserSettings.v1';
const SCOPED_STATUS_KEY = 'jupyterEnhancements.executionTime.originalScopedStatusBar.v1';

type StatusScope = 'workspace' | 'folder';
interface ScopedStatusBackup {
    scope: StatusScope;
    folderUri?: string;
    hadPrevious: boolean;
    previous?: string;
    applied: 'hidden';
}


/**
 * Users opt in to a VS Code-wide (user-global) layout through layout.profile.
 * Restore only settings our extension applied and which weren't subsequently
 * changed by the user. Backups persist across extension-host restarts.
 */
export class NotebookLayoutProfileManager {
    private pending: Promise<void> = Promise.resolve();

    constructor(private readonly context: vscode.ExtensionContext) {}

    enqueue(): Promise<void> {
        this.pending = this.pending.then(() => this.synchronize()).catch(error => {
            vscode.window.showErrorMessage('Jupyter Enhancements layout: ' + String(error));
        });
        return this.pending;
    }

    private wantsBalanced(): boolean {
        const cfg = vscode.workspace.getConfiguration('jupyterEnhancements');
        const inspected = cfg.inspect<string>('layout.profile');
        const explicitlySet = inspected?.globalValue !== undefined ||
            inspected?.workspaceValue !== undefined ||
            inspected?.workspaceFolderValue !== undefined;
        if (explicitlySet) return cfg.get<string>('layout.profile', 'standard') === 'balancedCompact';

        // Backwards compatibility: the old compact boolean now applies the
        // reversible profile, not the previous irreversible global overrides.
        return cfg.get<boolean>('layout.enableCompactView', false);
    }

    private globalValues(): Record<string, unknown> {
        const config = vscode.workspace.getConfiguration();
        const values: Record<string, unknown> = {};
        for (const key of CONTROLLED_KEYS) {
            values[key] = config.inspect<unknown>(key)?.globalValue;
        }
        return values;
    }

    private workspaceOverrides(): string[] {
        const config = vscode.workspace.getConfiguration();
        return CONTROLLED_KEYS.filter(key => {
            const inspection = config.inspect<unknown>(key);
            return inspection?.workspaceValue !== undefined ||
                inspection?.workspaceFolderValue !== undefined;
        });
    }

    private async synchronize(): Promise<void> {
        const currentSnapshot = this.context.globalState.get<unknown>(BACKUP_KEY);
        const snapshot = isLayoutSnapshot(currentSnapshot) ? currentSnapshot : undefined;
        const display = vscode.workspace.getConfiguration('jupyterEnhancements')
            .get<ExecutionTimeDisplay>('executionTime.display', 'native');
        const plan = planNotebookPreferences(
            snapshot, this.globalValues(), this.wantsBalanced(), display
        );

        // Save the prior user settings and managed targets before VS Code updates.
        // This is important when the extension host restarts during application.
        if (plan.snapshot.entries.length) {
            await this.context.globalState.update(BACKUP_KEY, plan.snapshot);
        }

        const failed: string[] = [];
        for (const update of plan.updates) {
            try {
                await vscode.workspace.getConfiguration().update(
                    update.key, update.value, vscode.ConfigurationTarget.Global
                );
            } catch (error) {
                failed.push(update.key + ': ' + String(error));
            }
        }

        if (failed.length) {
            vscode.window.showWarningMessage(
                'Notebook layout / execution-time setting update failed: ' + failed.join('; ')
            );
        } else if (!plan.snapshot.entries.length && snapshot) {
            await this.context.globalState.update(BACKUP_KEY, undefined);
        }
        if (plan.skipped.length) {
            vscode.window.showInformationMessage(
                'Notebook preferences changed manually were preserved: ' + plan.skipped.join(', ')
            );
        }
        await this.synchronizeScopedCellStatus(display);
    }

    /**
     * Workspace/folder notebook overrides win over a user-global hidden status
     * bar. Back them up separately and only change an existing override, never
     * create an unnecessary workspace setting. Restore it on Native.
     */
    private async synchronizeScopedCellStatus(display: ExecutionTimeDisplay): Promise<void> {
        const editorUri = vscode.window.activeNotebookEditor?.notebook.uri;
        const notebookSettings = vscode.workspace.getConfiguration('notebook', editorUri);
        const inspection = notebookSettings.inspect<string>('showCellStatusBar');
        const scope: StatusScope | undefined = inspection?.workspaceFolderValue !== undefined ?
            'folder' : inspection?.workspaceValue !== undefined ? 'workspace' : undefined;
        const backups = this.context.globalState.get<ScopedStatusBackup[]>(SCOPED_STATUS_KEY, []);
        const nextBackups = [...backups];
        const keyFor = (b: ScopedStatusBackup) => b.scope + ':' + (b.folderUri ?? '');
        const folderUri = scope === 'folder' ? editorUri?.toString() : undefined;
        const activeKey = scope ? keyFor({ scope, folderUri, hadPrevious: false, applied: 'hidden' }) : undefined;

        if (display !== 'native' && scope) {
            const matching = nextBackups.find(item => keyFor(item) === activeKey);
            const scopedValue = scope === 'folder' ?
                inspection?.workspaceFolderValue : inspection?.workspaceValue;
            if (!matching && scopedValue !== 'hidden') {
                const record: ScopedStatusBackup = {
                    scope, folderUri, hadPrevious: scopedValue !== undefined,
                    previous: scopedValue, applied: 'hidden'
                };
                nextBackups.push(record);
                await this.context.globalState.update(SCOPED_STATUS_KEY, nextBackups);
                const target = scope === 'folder' ?
                    vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace;
                try {
                    await notebookSettings.update('showCellStatusBar', 'hidden', target);
                } catch (error) {
                    vscode.window.showWarningMessage(
                        'Could not hide the workspace notebook status bar: ' + String(error)
                    );
                }
            }
        } else if (display === 'native' && nextBackups.length) {
            const remaining: ScopedStatusBackup[] = [];
            for (const record of nextBackups) {
                const resource = record.folderUri ? vscode.Uri.parse(record.folderUri) : undefined;
                const config = vscode.workspace.getConfiguration('notebook', resource);
                const inspect = config.inspect<string>('showCellStatusBar');
                const actual = record.scope === 'folder' ?
                    inspect?.workspaceFolderValue : inspect?.workspaceValue;
                if (actual !== record.applied) continue; // Manual changes take precedence.
                const target = record.scope === 'folder' ?
                    vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace;
                try {
                    await config.update('showCellStatusBar',
                        record.hadPrevious ? record.previous : undefined, target);
                } catch (error) {
                    remaining.push(record);
                    vscode.window.showWarningMessage(
                        'Could not restore workspace notebook status bar: ' + String(error)
                    );
                }
            }
            await this.context.globalState.update(SCOPED_STATUS_KEY, remaining);
            return;
        }
    }

    async selectExecutionDisplay(mode: ExecutionTimeDisplay): Promise<void> {
        const resource = vscode.window.activeNotebookEditor?.notebook.uri;
        const settings = vscode.workspace.getConfiguration('jupyterEnhancements', resource);
        const inspection = settings.inspect<ExecutionTimeDisplay>('executionTime.display');
        const target = inspection?.workspaceFolderValue !== undefined ?
            vscode.ConfigurationTarget.WorkspaceFolder :
            inspection?.workspaceValue !== undefined ?
                vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;

        // Respect the scope where the user actually configured this extension.
        // The old picker only updated Global, which was silently shadowed.
        await settings.update('executionTime.display', mode, target);
        await this.enqueue();

        const effective = vscode.workspace.getConfiguration('jupyterEnhancements', resource)
            .get<ExecutionTimeDisplay>('executionTime.display', 'native');
        const statusSetting = vscode.workspace.getConfiguration('notebook', resource)
            .get<string>('showCellStatusBar', 'visible');
        if (effective !== mode) {
            vscode.window.showWarningMessage(
                'Execution-time mode is overridden by another setting scope. Open Settings and check Execution Time Display.'
            );
        } else if (mode !== 'native' && statusSetting !== 'hidden') {
            vscode.window.showWarningMessage(
                'Compact/Hidden selected, but VS Code still reports notebook.showCellStatusBar = ' +
                statusSetting + '. Check notebook settings overrides in your workspace.'
            );
        } else {
            const message = mode === 'native' ? 'Native cell execution status bar enabled.' :
                mode === 'compact' ? 'Compact inline timing enabled; native status bar hidden.' :
                'Cell execution timing text hidden.';
            vscode.window.showInformationMessage(message);
        }
    }

    async select(profile: 'standard' | 'balancedCompact'): Promise<void> {
        const settings = vscode.workspace.getConfiguration('jupyterEnhancements');
        const inspected = settings.inspect<string>('layout.profile');
        // When a workspace has an explicit profile override, change it there.
        // Otherwise, user-global is intentional and avoids editing .vscode/settings.json.
        const target = inspected?.workspaceValue !== undefined ?
            vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        await settings.update('layout.profile', profile, target);
        await this.enqueue();
        if (profile === 'balancedCompact') {
            const overrides = this.workspaceOverrides();
            if (overrides.length) {
                vscode.window.showWarningMessage(
                    'Balanced Compact is enabled, but workspace settings override some values: ' +
                    overrides.join(', ')
                );
            } else {
                vscode.window.showInformationMessage('Balanced Compact notebook layout enabled.');
            }
        } else {
            vscode.window.showInformationMessage(
                'Notebook layout restored. Manually edited settings were preserved.'
            );
        }
    }
}
