import * as vscode from 'vscode';
import {
    CONTROLLED_KEYS, LayoutSnapshot, isLayoutSnapshot,
    planBalancedLayout, planRestoreLayout
} from './layoutProfileState';

const BACKUP_KEY = 'jupyterEnhancements.layout.balancedCompact.originalUserSettings.v1';

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
        const existing = this.context.globalState.get<unknown>(BACKUP_KEY);
        const backup = isLayoutSnapshot(existing) ? existing : undefined;
        if (this.wantsBalanced()) {
            if (backup) return; // Already managed: never override later manual edits.
            const plan = planBalancedLayout(this.globalValues());
            // Store original user values before applying so an interrupted
            // extension-host session can still restore the old settings.
            await this.context.globalState.update(BACKUP_KEY, plan.snapshot);
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
                vscode.window.showWarningMessage('Balanced Compact could not apply: ' + failed.join('; '));
            }
        } else if (backup) {
            const plan = planRestoreLayout(backup, this.globalValues());
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
            if (!failed.length) {
                await this.context.globalState.update(BACKUP_KEY, undefined);
            } else {
                vscode.window.showWarningMessage('Some notebook settings could not be restored: ' + failed.join('; '));
            }
            if (plan.skipped.length) {
                vscode.window.showInformationMessage(
                    'Some notebook settings were changed manually and were left unchanged: ' +
                    plan.skipped.join(', ')
                );
            }
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
