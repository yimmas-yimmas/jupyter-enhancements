import * as vscode from 'vscode';

// --- DECORATION TYPES ---
let successBgDec: vscode.TextEditorDecorationType;
let errorBgDec: vscode.TextEditorDecorationType;
let flashDec: vscode.TextEditorDecorationType;
let cmdRunningDec: vscode.TextEditorDecorationType;
let cmdSuccessDec: vscode.TextEditorDecorationType;
let cellRunningDec: vscode.TextEditorDecorationType;
let cellSuccessDec: vscode.TextEditorDecorationType;
let scratchpadDec: vscode.TextEditorDecorationType;

// --- STATE ---
const cellStatusMap = new Map<string, 'success' | 'error'>();
const lastExecutionTimes = new Map<string, number>();
const knownExecutionOrders = new Map<string, number>();
const activeAnimations = new Map<string, NodeJS.Timeout>();
const scratchpadCells = new Set<string>(); 
const sourceToScratchpadMap = new Map<string, string>(); 
const currentlyAnimatingUris = new Set<string>();

export function activate(context: vscode.ExtensionContext) {
    reloadDecorations();
    updateLayoutSettings(); 
    initKnownStates();

    // 1. Settings Listener
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('jupyterEnhancements')) {
            reloadDecorations();
            restoreAllVisibleDecorations();
            updateLayoutSettings(); 
        }
    }));

    // 2. Selection Listener
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
        if (e.textEditor.document.uri.scheme === 'vscode-notebook-cell') {
            restoreDecorationForEditor(e.textEditor);
        }
    }));

    // 3. Visibility Listener
    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(editors => {
        for (const editor of editors) {
            const uri = editor.document.uri.toString();
            restoreDecorationForEditor(editor);
            if (currentlyAnimatingUris.has(uri)) {
                applyRunningDecorationsToEditor(editor, true);
            }
        }
    }));

    // 4. Watchdog
    const pollInterval = setInterval(globalWatchdog, 100);
    context.subscriptions.push({ dispose: () => clearInterval(pollInterval) });

    // 5. Commands
    context.subscriptions.push(vscode.commands.registerCommand('jupyter-enhancements.runInScratchpad', runScratchpadHandler));
    context.subscriptions.push(vscode.commands.registerCommand('jupyter-enhancements.execute', (args) => runSequenceHandler('below', args)));
}

// =========================================================
// --- HELPER: SMART SCROLL (The Logic You Requested) ---
// =========================================================

function ensureCellIsVisible(editor: vscode.NotebookEditor, cell: vscode.NotebookCell) {
    // Check if the cell is currently inside any of the visible ranges
    const isVisible = editor.visibleRanges.some(range => 
        cell.index >= range.start && cell.index < range.end
    );

    const range = new vscode.NotebookRange(cell.index, cell.index + 1);
    
    // Always select the cell so the blue focus border follows execution
    editor.selections = [range];

    if (!isVisible) {
        // If OFF SCREEN: Scroll it to the top
        editor.revealRange(range, vscode.NotebookEditorRevealType.AtTop);
    } 
    // If VISIBLE: Do nothing. The screen stays exactly where it is.
}

// =========================================================
// --- THE GLOBAL WATCHDOG ---
// =========================================================

function initKnownStates() {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) return;
    for (const cell of editor.notebook.getCells()) {
        const uri = cell.document.uri.toString();
        const summary = cell.executionSummary;
        if (summary?.executionOrder) knownExecutionOrders.set(uri, summary.executionOrder);
        if (summary?.timing?.endTime) lastExecutionTimes.set(uri, summary.timing.endTime);
    }
}

function globalWatchdog() {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) return;

    for (const cell of editor.notebook.getCells()) {
        if (cell.kind !== vscode.NotebookCellKind.Code) continue;

        const uri = cell.document.uri.toString();
        const summary = cell.executionSummary;
        
        const currentOrder = summary?.executionOrder || 0;
        const lastOrder = knownExecutionOrders.get(uri) || 0;
        const lastEnd = lastExecutionTimes.get(uri) || 0;
        const currentEnd = summary?.timing?.endTime || 0;

        if (currentOrder > 0 && currentOrder < lastOrder) {
            knownExecutionOrders.set(uri, 0);
            lastExecutionTimes.set(uri, 0);
            continue; 
        }

        // FINISHED
        if (currentEnd > lastEnd) {
            lastExecutionTimes.set(uri, currentEnd);
            knownExecutionOrders.set(uri, currentOrder);
            
            if (!currentlyAnimatingUris.has(uri)) {
                startRunningVisuals(cell);
                setTimeout(() => finalizeCell(cell, uri, summary?.success ?? false), 200);
            } else {
                finalizeCell(cell, uri, summary?.success ?? false);
            }
            continue;
        }

        // STARTED
        if (currentOrder > lastOrder && !summary?.timing?.endTime) {
            if (!currentlyAnimatingUris.has(uri)) {
                knownExecutionOrders.set(uri, currentOrder);
                currentlyAnimatingUris.add(uri);
                startRunningVisuals(cell);
            }
        }
    }
}

function finalizeCell(cell: vscode.NotebookCell, uri: string, success: boolean) {
    currentlyAnimatingUris.delete(uri);
    stopRunningVisuals(uri);
    handleCellFinished(cell, success);
    
    const editor = vscode.window.activeNotebookEditor;
    if (editor && editor.selections[0]?.start === cell.index) {
        setTimeout(() => refreshCellFocus(), 100);
    }
}

async function refreshCellFocus() {
    await vscode.commands.executeCommand('notebook.cell.quitEdit');
    await vscode.commands.executeCommand('notebook.cell.edit');
}

// =========================================================
// --- VISUAL ENGINE ---
// =========================================================

function startRunningVisuals(cell: vscode.NotebookCell) {
    const uri = cell.document.uri.toString();
    cellStatusMap.delete(uri);
    restoreDecorationForCell(cell);
    startAnimationLoopForCell(cell);

    // --- FIX: Use Smart Scroll for Native Runs (Run All Button) ---
    const editor = vscode.window.activeNotebookEditor;
    if (editor) {
        ensureCellIsVisible(editor, cell);
    }

    const nextIndex = cell.index + 1;
    if (nextIndex < cell.notebook.cellCount) {
        const nextCell = cell.notebook.cellAt(nextIndex);
        cellStatusMap.delete(nextCell.document.uri.toString());
        restoreDecorationForCell(nextCell);
    }
}

function stopRunningVisuals(uri: string) {
    if (activeAnimations.has(uri)) {
        clearInterval(activeAnimations.get(uri)!);
        activeAnimations.delete(uri);
    }
    vscode.window.visibleTextEditors
        .filter(e => e.document.uri.toString() === uri)
        .forEach(e => applyRunningDecorationsToEditor(e, false));
}

function applyRunningDecorationsToEditor(editor: vscode.TextEditor, visible: boolean) {
    const range = new vscode.Range(0, 0, editor.document.lineCount, 0);
    editor.setDecorations(cmdRunningDec, visible ? [range] : []);
    editor.setDecorations(cellRunningDec, visible ? [range] : []);
}

function startAnimationLoopForCell(cell: vscode.NotebookCell) {
    const uri = cell.document.uri.toString();
    if (activeAnimations.has(uri)) return;

    let visible = true;
    const update = () => {
        const editors = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === uri);
        editors.forEach(editor => applyRunningDecorationsToEditor(editor, visible));
        visible = !visible;
    };
    update(); 
    activeAnimations.set(uri, setInterval(update, 500));
}

function handleCellFinished(cell: vscode.NotebookCell, success: boolean) {
    const uri = cell.document.uri.toString();
    cellStatusMap.set(uri, success ? 'success' : 'error');
    
    if (success && vscode.workspace.getConfiguration('jupyterEnhancements').get('flash.enable')) {
        applyDecoration(cell, flashDec);
        setTimeout(() => removeDecoration(cell, flashDec), 300);
    }
    restoreDecorationForCell(cell);
}

// =========================================================
// --- COMMAND HANDLERS ---
// =========================================================

const runScratchpadHandler = async () => {
    const activeTextEditor = vscode.window.activeTextEditor;
    const notebookEditor = vscode.window.activeNotebookEditor;
    if (!notebookEditor || !activeTextEditor) return;

    const textToRun = activeTextEditor.document.getText(activeTextEditor.selection).trim();
    if (!textToRun) return;

    const activePos = activeTextEditor.selection.active;
    activeTextEditor.selection = new vscode.Selection(activePos, activePos);
    await vscode.commands.executeCommand('notebook.cell.quitEdit');

    const notebook = notebookEditor.notebook;
    const sourceCell = notebook.getCells().find(c => c.document.uri.toString() === activeTextEditor.document.uri.toString());
    if (!sourceCell) return;

    let scratchpadCell: vscode.NotebookCell | undefined;
    const sourceUri = sourceCell.document.uri.toString();
    const existingUri = sourceToScratchpadMap.get(sourceUri);
    if (existingUri) scratchpadCell = notebook.getCells().find(c => c.document.uri.toString() === existingUri);

    if (scratchpadCell) {
        const edit = new vscode.WorkspaceEdit();
        const lastLine = scratchpadCell.document.lineAt(scratchpadCell.document.lineCount - 1);
        const fullRange = new vscode.Range(new vscode.Position(0,0), lastLine.range.end);
        edit.replace(scratchpadCell.document.uri, fullRange, textToRun);
        await vscode.workspace.applyEdit(edit);
    } else {
        const insertIndex = sourceCell.index + 1;
        const cellData = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, textToRun, sourceCell.document.languageId || "python");
        const edit = new vscode.WorkspaceEdit();
        edit.set(notebook.uri, [vscode.NotebookEdit.insertCells(insertIndex, [cellData])]);
        await vscode.workspace.applyEdit(edit);
        scratchpadCell = notebook.cellAt(insertIndex);
        sourceToScratchpadMap.set(sourceUri, scratchpadCell.document.uri.toString());
        scratchpadCells.add(scratchpadCell.document.uri.toString());
    }

    if (scratchpadCell) {
        setTimeout(async () => {
            const range = new vscode.NotebookRange(scratchpadCell!.index, scratchpadCell!.index + 1);
            
            // Execute background, no visual selection change needed here
            await vscode.commands.executeCommand('notebook.cell.execute', {
                ranges: [{ start: scratchpadCell!.index, end: scratchpadCell!.index + 1 }],
                notebookUri: notebook.uri
            });
            await refreshCellFocus();
        }, 150);
    }
};

const runSequenceHandler = async (mode: 'below' | 'above' | 'all', args?: any) => {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) return;
    const notebook = editor.notebook;
    const anchorIndex = args?.index ?? editor.selections[0]?.start ?? 0;

    let start = 0, end = notebook.cellCount;
    if (mode === 'below') start = anchorIndex;
    else if (mode === 'above') end = anchorIndex + 1;

    for (let i = start; i < end; i++) {
        const cell = notebook.cellAt(i);
        if (cell.kind !== vscode.NotebookCellKind.Code || !cell.document.getText().trim()) continue;

        // --- FIX: Use Smart Scroll for Sequence Runs ---
        ensureCellIsVisible(editor, cell);
        
        // Wait for UI to settle
        await new Promise(r => setTimeout(r, 50));

        await vscode.commands.executeCommand('notebook.cell.execute', {
            ranges: [{ start: i, end: i + 1 }],
            notebookUri: notebook.uri
        });

        await new Promise<void>((resolve) => {
            const poller = setInterval(() => {
                if (cell.executionSummary?.success !== undefined) {
                    clearInterval(poller);
                    resolve();
                }
            }, 100);
        });
        if (cell.executionSummary?.success === false) break;
    }
};

// =========================================================
// --- DECORATION UTILS ---
// =========================================================

function restoreDecorationForEditor(editor: vscode.TextEditor) {
    if (editor.document.uri.scheme !== 'vscode-notebook-cell') return;
    const uri = editor.document.uri.toString();
    const range = new vscode.Range(0, 0, editor.document.lineCount, 0);

    editor.setDecorations(scratchpadDec, scratchpadCells.has(uri) ? [range] : []);
    
    const isSelecting = !editor.selection.isEmpty;
    const status = cellStatusMap.get(uri);
    
    if (!status || isSelecting) {
        editor.setDecorations(successBgDec, []);
        editor.setDecorations(errorBgDec, []);
        return;
    }

    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    if (status === 'success') {
        if (config.get('background.enable')) editor.setDecorations(successBgDec, [range]);
        if (config.get('innerBorder.persist')) editor.setDecorations(cmdSuccessDec, [range]);
        if (config.get('outerBorder.persist')) editor.setDecorations(cellSuccessDec, [range]);
    } else {
        if (config.get('background.enable')) editor.setDecorations(errorBgDec, [range]);
    }
}

function updateLayoutSettings() {
    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    const vscodeConfig = vscode.workspace.getConfiguration();

    // 1. Fix "notebook.gotoNextCellOnExecute" error by removing it (Not valid)
    
    // 2. Fix "python-envs" Workspace Error
    if (config.get<boolean>('kernel.optimizeStartup', true)) {
        try {
            const pythonConfig = vscode.workspace.getConfiguration('python-envs');
            if (pythonConfig.get('terminal.autoActivationType') !== 'none') {
                pythonConfig.update('terminal.autoActivationType', 'none', vscode.ConfigurationTarget.Global);
            }
        } catch (e) { }
    }

    const enableCompact = config.get<boolean>('layout.enableCompactView', false);
    if (enableCompact) {
        const settings = {
            "notebook.cellExecutionTimeVerbosity": "verbose",
            "notebook.consolidatedRunButton": true,
            "notebook.lineNumbers": "on",
            "notebook.showCellStatusBar": "visibleAfterExecute"
        };
        for (const [key, value] of Object.entries(settings)) {
            try {
                vscodeConfig.update(key, value, vscode.ConfigurationTarget.Global);
            } catch (e) { }
        }
    }
}

function reloadDecorations() {
    disposeAllDecorations();
    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    const position = config.get<string>('outerBorder.position', 'left');
    const thickness = config.get<string>('outerBorder.thickness', '6px');
    
    let outerWidth = `0 0 0 ${thickness}`;
    if (position === 'right') outerWidth = `0 ${thickness} 0 0`;
    if (position === 'top')    outerWidth = `${thickness} 0 0 0`;
    if (position === 'bottom') outerWidth = `0 0 ${thickness} 0`;

    const baseOpt = (color: any) => ({
        backgroundColor: color,
        isWholeLine: true,
        rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
    });

    successBgDec = vscode.window.createTextEditorDecorationType(baseOpt(config.get('background.successColor')));
    errorBgDec = vscode.window.createTextEditorDecorationType(baseOpt(config.get('background.errorColor')));
    flashDec = vscode.window.createTextEditorDecorationType(baseOpt(config.get('flash.color')));
    
    cmdRunningDec = vscode.window.createTextEditorDecorationType({ borderWidth: '1px', borderStyle: 'solid', borderColor: config.get('innerBorder.runningColor'), isWholeLine: true });
    cmdSuccessDec = vscode.window.createTextEditorDecorationType({ borderWidth: '1px', borderStyle: 'solid', borderColor: config.get('innerBorder.successColor'), isWholeLine: true });
    cellRunningDec = vscode.window.createTextEditorDecorationType({ borderWidth: outerWidth, borderStyle: 'solid', borderColor: config.get('outerBorder.runningColor'), isWholeLine: true });
    cellSuccessDec = vscode.window.createTextEditorDecorationType({ borderWidth: outerWidth, borderStyle: 'solid', borderColor: config.get('outerBorder.successColor'), isWholeLine: true });
    
    scratchpadDec = vscode.window.createTextEditorDecorationType({
        borderStyle: 'dashed',
        borderWidth: '1px 0px 1px 6px', 
        borderColor: config.get('scratchpad.borderColor'),
        backgroundColor: config.get('scratchpad.backgroundColor'),
        isWholeLine: true
    });
}

function restoreDecorationForCell(cell: vscode.NotebookCell) {
    vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === cell.document.uri.toString()).forEach(restoreDecorationForEditor);
}
function restoreAllVisibleDecorations() {
    vscode.window.visibleTextEditors.forEach(restoreDecorationForEditor);
}
function applyDecoration(cell: vscode.NotebookCell, dec: vscode.TextEditorDecorationType) {
    vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === cell.document.uri.toString()).forEach(e => e.setDecorations(dec, [new vscode.Range(0, 0, e.document.lineCount, 0)]));
}
function removeDecoration(cell: vscode.NotebookCell, dec: vscode.TextEditorDecorationType) {
    vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === cell.document.uri.toString()).forEach(e => e.setDecorations(dec, []));
}
function disposeAllDecorations() {
    [successBgDec, errorBgDec, flashDec, cmdRunningDec, cmdSuccessDec, cellRunningDec, cellSuccessDec, scratchpadDec].forEach(d => d?.dispose());
}

export function deactivate() {
    disposeAllDecorations();
    activeAnimations.forEach(interval => clearInterval(interval));
}