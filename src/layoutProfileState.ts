/**
 * Pure reversible notebook-layout planning. Deliberately independent of
 * vscode so plan/restore/conflict behavior can be unit tested with Node.
 *
 * Only user-global notebook settings are managed. We preserve settings that
 * weren't changed by us and preserve user edits made while our profile ran.
 */

export interface SettingUpdate {
    key: string;
    value: unknown;
}

export type LayoutBackupEntry =
    | { kind: 'scalar'; key: string; hadPrevious: boolean; previous?: unknown; applied: unknown }
    | {
        kind: 'editorOptions';
        key: 'notebook.editorOptionsCustomizations';
        hadPrevious: boolean;
        previous: Record<string, { hadPrevious: boolean; value?: unknown }>;
        applied: Record<string, unknown>;
    };

export interface LayoutSnapshot {
    version: 1;
    entries: LayoutBackupEntry[];
}

export const BALANCED_SCALARS: ReadonlyArray<SettingUpdate> = [
    { key: 'notebook.compactView', value: true },
    { key: 'notebook.insertToolbarLocation', value: 'notebookToolbar' },
    { key: 'notebook.showCellStatusBar', value: 'visibleAfterExecute' },
    { key: 'notebook.output.fontSize', value: 12 },
    { key: 'notebook.output.lineHeight', value: 18 }
];

// Existing cell/title toolbars, run buttons, decorations and line numbering
// deliberately remain unchanged so user's toolbar stays accessible.
export const BALANCED_EDITOR_OPTIONS: Readonly<Record<string, unknown>> = {
    'editor.fontSize': 13,
    'editor.lineHeight': 19
};

export const CONTROLLED_KEYS = [
    ...BALANCED_SCALARS.map(setting => setting.key),
    'notebook.editorOptionsCustomizations'
];

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ?
        value as Record<string, unknown> : {};
}

function same(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function planBalancedLayout(
    userValues: Readonly<Record<string, unknown>>
): { snapshot: LayoutSnapshot; updates: SettingUpdate[] } {
    const entries: LayoutBackupEntry[] = [];
    const updates: SettingUpdate[] = [];

    for (const setting of BALANCED_SCALARS) {
        const original = userValues[setting.key];
        if (same(original, setting.value)) continue;
        entries.push({
            kind: 'scalar', key: setting.key, hadPrevious: original !== undefined,
            previous: original, applied: setting.value
        });
        updates.push({ key: setting.key, value: setting.value });
    }

    const key = 'notebook.editorOptionsCustomizations' as const;
    const raw = userValues[key];
    const original = record(raw);
    const changed: Record<string, unknown> = {};
    const previous: Record<string, { hadPrevious: boolean; value?: unknown }> = {};

    for (const [name, target] of Object.entries(BALANCED_EDITOR_OPTIONS)) {
        if (same(original[name], target)) continue;
        previous[name] = {
            hadPrevious: Object.prototype.hasOwnProperty.call(original, name),
            value: original[name]
        };
        changed[name] = target;
    }

    if (Object.keys(changed).length) {
        entries.push({ kind: 'editorOptions', key, hadPrevious: raw !== undefined, previous, applied: changed });
        updates.push({ key, value: { ...original, ...changed } });
    }
    return { snapshot: { version: 1, entries }, updates };
}

export function planRestoreLayout(
    snapshot: LayoutSnapshot,
    currentUserValues: Readonly<Record<string, unknown>>
): { updates: SettingUpdate[]; skipped: string[] } {
    const updates: SettingUpdate[] = [];
    const skipped: string[] = [];
    for (const entry of snapshot.entries) {
        const current = currentUserValues[entry.key];
        if (entry.kind === 'scalar') {
            if (same(current, entry.applied)) {
                updates.push({ key: entry.key, value: entry.hadPrevious ? entry.previous : undefined });
            } else {
                skipped.push(entry.key);
            }
            continue;
        }

        const options = { ...record(current) };
        let changed = false;
        for (const [name, value] of Object.entries(entry.applied)) {
            if (!same(options[name], value)) {
                skipped.push(entry.key + '.' + name);
                continue;
            }
            const old = entry.previous[name];
            if (old.hadPrevious) options[name] = old.value;
            else delete options[name];
            changed = true;
        }
        if (changed) {
            updates.push({
                key: entry.key,
                value: Object.keys(options).length === 0 && !entry.hadPrevious ? undefined : options
            });
        }
    }
    return { updates, skipped };
}

export function isLayoutSnapshot(value: unknown): value is LayoutSnapshot {
    return value !== null && typeof value === 'object' &&
        (value as LayoutSnapshot).version === 1 &&
        Array.isArray((value as LayoutSnapshot).entries);
}
