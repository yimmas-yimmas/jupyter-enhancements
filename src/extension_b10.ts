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

// Track notebook open time to ignore false detections on load
let lastNotebookOpenTime = 0;

export function activate(context: vscode.ExtensionContext) {
    reloadDecorations();
    updateLayoutSettings();
    clearAllAnimations();

    // Initialize timer for the currently active notebook on startup
    if (vscode.window.activeNotebookEditor && vscode.window.activeNotebookEditor.notebook.notebookType === 'jupyter-notebook') {
        initKnownStates(vscode.window.activeNotebookEditor.notebook);
        lastNotebookOpenTime = Date.now();
    }
    
    // Immediate clear + state init on any notebook open
    context.subscriptions.push(
        vscode.workspace.onDidOpenNotebookDocument(notebook => {
            if (notebook.notebookType === 'jupyter-notebook') {
                initKnownStates(notebook);
                clearAllAnimations();
                lastNotebookOpenTime = Date.now(); 
            }
        })
    );

    // --- FIX: Listen for TAB SWITCHES (Active Editor Change) ---
    // This prevents the "travelling" / blue flashing when switching back to an open notebook
    context.subscriptions.push(
        vscode.window.onDidChangeActiveNotebookEditor(editor => {
            if (editor && editor.notebook.notebookType === 'jupyter-notebook') {
                // 1. Re-learn the state of this notebook immediately
                initKnownStates(editor.notebook);
                // 2. Reset the "settling" timer so Watchdog ignores immediate state mismatches
                lastNotebookOpenTime = Date.now(); 
                // 3. Clear any leftover animations from the previous tab
                clearAllAnimations(); 
            }
        })
    );
    // -----------------------------------------------------------

    // Listen for debug session changes to update decorations immediately
    context.subscriptions.push(
        vscode.debug.onDidChangeActiveDebugSession(() => {
            restoreAllVisibleDecorations();
        })
    );
    
    // Settings
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('jupyterEnhancements')) {
                reloadDecorations();
                restoreAllVisibleDecorations();
                updateLayoutSettings();
            }
        })
    );

    // Selection & visibility
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            if (e.textEditor.document.uri.scheme === 'vscode-notebook-cell') {
                restoreDecorationForEditor(e.textEditor);
            }
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            for (const editor of editors) {
                if (editor.document.uri.scheme === 'vscode-notebook-cell') {
                    const uri = editor.document.uri.toString();
                    restoreDecorationForEditor(editor);
                    if (currentlyAnimatingUris.has(uri)) {
                        applyRunningDecorationsToEditor(editor, true);
                    }
                }
            }
        })
    );

    // Watchdog
    const pollInterval = setInterval(globalWatchdog, 100);
    context.subscriptions.push({ dispose: () => clearInterval(pollInterval) });

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.runInScratchpad', runScratchpadHandler)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.execute', (args) => runSequenceHandler('below', args))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.splitCell', splitCellHandler)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.mergeCells', mergeCellHandler)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.clearCellOutput', clearCellOutputHandler)
    );
}

// =========================================================
// --- STATE & WATCHDOG ---
// =========================================================
function initKnownStates(notebook?: vscode.NotebookDocument) {
    const nb = notebook || vscode.window.activeNotebookEditor?.notebook;
    if (!nb) return;

    knownExecutionOrders.clear();
    lastExecutionTimes.clear();

    for (const cell of nb.getCells()) {
        if (cell.kind !== vscode.NotebookCellKind.Code) continue;
        const uri = cell.document.uri.toString();
        const summary = cell.executionSummary;
        if (summary?.executionOrder !== undefined) knownExecutionOrders.set(uri, summary.executionOrder);
        if (summary?.timing?.endTime !== undefined) lastExecutionTimes.set(uri, summary.timing.endTime);
    }
}

function globalWatchdog() {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor || editor.notebook.notebookType !== 'jupyter-notebook') return;

    const now = Date.now();
    const timeSinceOpen = now - lastNotebookOpenTime;

    // Ignore detections within 5s for better responsiveness on load (and tab switch)
    const isSettling = timeSinceOpen < 5000; 

    for (const cell of editor.notebook.getCells()) {
        if (cell.kind !== vscode.NotebookCellKind.Code) continue;

        const uri = cell.document.uri.toString();
        const summary = cell.executionSummary;

        const currentOrder = summary?.executionOrder || 0;
        const lastOrder = knownExecutionOrders.get(uri) || 0;
        const lastEnd = lastExecutionTimes.get(uri) || 0;
        const currentEnd = summary?.timing?.endTime || 0;

        // Kernel restart
        if (currentOrder > 0 && currentOrder < lastOrder) {
            knownExecutionOrders.set(uri, 0);
            lastExecutionTimes.set(uri, 0);
            currentlyAnimatingUris.delete(uri);
            stopRunningVisuals(uri);
            continue;
        }

        // FINISHED
        if (currentEnd > lastEnd) {
            lastExecutionTimes.set(uri, currentEnd);
            knownExecutionOrders.set(uri, currentOrder);
            currentlyAnimatingUris.delete(uri);
            stopRunningVisuals(uri);
            const success = summary?.success ?? false;
            handleCellFinished(cell, success);
            if (editor.selections[0]?.start === cell.index) {
                setTimeout(() => refreshCellFocus(), 100);
            }
            continue;
        }

        // STARTED
        if (currentOrder > lastOrder && currentEnd === 0) {
            
            // Sync state
            knownExecutionOrders.set(uri, currentOrder); 

            // If debugging, update state but SKIP animation
            if (vscode.debug.activeDebugSession) {
                continue;
            }

            // Silently sync state during settling period (prevents flashing on tab switch)
            if (isSettling) {
                continue; 
            }

            if (!currentlyAnimatingUris.has(uri)) {
                currentlyAnimatingUris.add(uri);
                startRunningVisuals(cell);
            }
        }
    }
}

function clearAllAnimations() {
    currentlyAnimatingUris.clear();
    activeAnimations.forEach(interval => clearInterval(interval));
    activeAnimations.clear();

    vscode.window.visibleTextEditors.forEach(editor => {
        if (editor.document.uri.scheme === 'vscode-notebook-cell') {
            editor.setDecorations(cmdRunningDec, []);
            editor.setDecorations(cellRunningDec, []);
        }
    });
}

// =========================================================
// --- VISUAL ENGINE ---
// =========================================================
function startRunningVisuals(cell: vscode.NotebookCell) {
    const uri = cell.document.uri.toString();
    cellStatusMap.delete(uri);
    restoreDecorationForCell(cell);
    startAnimationLoopForCell(cell);

    const editor = vscode.window.activeNotebookEditor;
    if (editor) ensureCellIsVisible(editor, cell);

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

    const interval = setInterval(update, 500);
    activeAnimations.set(uri, interval);

    // 10s safety timeout
    setTimeout(() => {
        if (activeAnimations.has(uri)) {
            clearInterval(interval);
            activeAnimations.delete(uri);
            currentlyAnimatingUris.delete(uri);
            stopRunningVisuals(uri);
            restoreDecorationForCell(cell);
        }
    }, 10000);
}

function handleCellFinished(cell: vscode.NotebookCell, success: boolean) {
    const uri = cell.document.uri.toString();
    cellStatusMap.set(uri, success ? 'success' : 'error');

    const isDebugging = !!vscode.debug.activeDebugSession;
    const shouldFlash = success && 
                        !isDebugging && 
                        vscode.workspace.getConfiguration('jupyterEnhancements').get<boolean>('flash.enable');
    
    if (shouldFlash) {
        applyDecoration(cell, flashDec);
        setTimeout(() => removeDecoration(cell, flashDec),
            vscode.workspace.getConfiguration('jupyterEnhancements').get<number>('general.flashDuration', 300));
    }

    restoreDecorationForCell(cell);
}

async function refreshCellFocus() {
    await vscode.commands.executeCommand('notebook.cell.quitEdit');
    await vscode.commands.executeCommand('notebook.cell.edit');
}

function ensureCellIsVisible(editor: vscode.NotebookEditor, cell: vscode.NotebookCell) {
    const isVisible = editor.visibleRanges.some(range => cell.index >= range.start && cell.index < range.end);
    const range = new vscode.NotebookRange(cell.index, cell.index + 1);
    editor.selections = [range];
    if (!isVisible) {
        editor.revealRange(range, vscode.NotebookEditorRevealType.AtTop);
    }
}

// =========================================================
// --- COMMAND HANDLERS ---
// =========================================================
const clearCellOutputHandler = async (cellOrContext?: vscode.NotebookCell | any) => {
    // If triggered from toolbar, context is the cell.
    if (cellOrContext && 'notebook' in cellOrContext) {
        const cell = cellOrContext as vscode.NotebookCell;
        const editor = vscode.window.activeNotebookEditor;

        if (editor) {
            // Determine if the clicked cell is already selected
            const isSelected = editor.selections.some(s => s.start <= cell.index && s.end > cell.index);

            // If it's not selected, we must select it for the native command to target it
            if (!isSelected) {
                editor.selections = [new vscode.NotebookRange(cell.index, cell.index + 1)];
            }
        }
    }

    // Execute native command (acts on current selection)
    await vscode.commands.executeCommand('notebook.cell.clearOutputs');
};

const mergeCellHandler = async () => {
    const notebookEditor = vscode.window.activeNotebookEditor;
    if (!notebookEditor) return;

    const notebook = notebookEditor.notebook;
    const selection = notebookEditor.selections[0];
    
    if (!selection) return;

    let start = selection.start;
    let end = selection.end;

    // Logic: If 1 cell selected, merge with the one below.
    if (end - start === 1) {
        if (start + 1 < notebook.cellCount) {
            end = start + 2;
        } else {
            return; // Cannot merge last cell with anything
        }
    }

    // Merge logic
    const cells = [];
    for (let i = start; i < end; i++) {
        cells.push(notebook.cellAt(i));
    }
    
    // Combine text with newlines
    const text = cells.map(c => c.document.getText()).join('\n');
    const first = cells[0];
    
    // Create new cell
    const newCell = new vscode.NotebookCellData(first.kind, text, first.document.languageId);
    
    // Replace the range of cells with the single new cell
    const edit = new vscode.WorkspaceEdit();
    const range = new vscode.NotebookRange(start, end);
    edit.set(notebook.uri, [vscode.NotebookEdit.replaceCells(range, [newCell])]);
    await vscode.workspace.applyEdit(edit);
};

const splitCellHandler = async () => {
    const editor = vscode.window.activeTextEditor;
    const notebookEditor = vscode.window.activeNotebookEditor;

    // Ensure we are inside a notebook cell
    if (!editor || !notebookEditor || editor.document.uri.scheme !== 'vscode-notebook-cell') {
        vscode.window.showInformationMessage("Cursor must be inside a cell to split it.");
        return;
    }

    const notebook = notebookEditor.notebook;
    const cell = notebook.getCells().find(c => c.document.uri.toString() === editor.document.uri.toString());
    
    if (!cell) return;

    const cursorPosition = editor.selection.active;
    const document = editor.document;
    
    const lastLine = document.lineAt(document.lineCount - 1);
    const endOfDoc = lastLine.range.end;
    
    const rangeBefore = new vscode.Range(new vscode.Position(0, 0), cursorPosition);
    const rangeAfter = new vscode.Range(cursorPosition, endOfDoc);

    const textBefore = document.getText(rangeBefore);
    const textAfter = document.getText(rangeAfter);

    const edit = new vscode.WorkspaceEdit();

    // 1. Replace current cell content with top half
    edit.replace(cell.document.uri, new vscode.Range(new vscode.Position(0, 0), endOfDoc), textBefore);

    // 2. Insert new cell below with bottom half
    const newCellData = new vscode.NotebookCellData(cell.kind, textAfter, cell.document.languageId);
    const insertIndex = cell.index + 1;
    edit.set(notebook.uri, [
        vscode.NotebookEdit.insertCells(insertIndex, [newCellData])
    ]);

    await vscode.workspace.applyEdit(edit);

    if (insertIndex < notebook.cellCount) {
        setTimeout(() => {
            const range = new vscode.NotebookRange(insertIndex, insertIndex + 1);
            notebookEditor.revealRange(range);
            notebookEditor.selections = [range];
        }, 50);
    }
};

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

    if (existingUri) {
        scratchpadCell = notebook.getCells().find(c => c.document.uri.toString() === existingUri);
    }

    if (scratchpadCell) {
        const edit = new vscode.WorkspaceEdit();
        const lastLine = scratchpadCell.document.lineAt(scratchpadCell.document.lineCount - 1);
        const fullRange = new vscode.Range(new vscode.Position(0, 0), lastLine.range.end);
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

        ensureCellIsVisible(editor, cell);
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

    // If debugging, clean up decorations to keep the UI clean
    if (vscode.debug.activeDebugSession) {
        editor.setDecorations(successBgDec, []);
        editor.setDecorations(errorBgDec, []);
        editor.setDecorations(cmdSuccessDec, []);
        editor.setDecorations(cellSuccessDec, []);
        return;
    }

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

function restoreDecorationForCell(cell: vscode.NotebookCell) {
    vscode.window.visibleTextEditors
        .filter(e => e.document.uri.toString() === cell.document.uri.toString())
        .forEach(restoreDecorationForEditor);
}

function restoreAllVisibleDecorations() {
    vscode.window.visibleTextEditors.forEach(restoreDecorationForEditor);
}

function applyDecoration(cell: vscode.NotebookCell, dec: vscode.TextEditorDecorationType) {
    vscode.window.visibleTextEditors
        .filter(e => e.document.uri.toString() === cell.document.uri.toString())
        .forEach(e => e.setDecorations(dec, [new vscode.Range(0, 0, e.document.lineCount, 0)]));
}

function removeDecoration(cell: vscode.NotebookCell, dec: vscode.TextEditorDecorationType) {
    vscode.window.visibleTextEditors
        .filter(e => e.document.uri.toString() === cell.document.uri.toString())
        .forEach(e => e.setDecorations(dec, []));
}

function reloadDecorations() {
    disposeAllDecorations();

    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    const position = config.get<string>('outerBorder.position', 'left');
    const thickness = config.get<string>('outerBorder.thickness', '6px');

    let outerWidth = `0 0 0 ${thickness}`;
    if (position === 'right') outerWidth = `0 ${thickness} 0 0`;
    if (position === 'top') outerWidth = `${thickness} 0 0 0`;
    if (position === 'bottom') outerWidth = `0 0 ${thickness} 0`;

    const baseOpt = (color: string) => ({
        backgroundColor: color,
        isWholeLine: true,
        rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
    });

    successBgDec = vscode.window.createTextEditorDecorationType(baseOpt(config.get('background.successColor')!));
    errorBgDec = vscode.window.createTextEditorDecorationType(baseOpt(config.get('background.errorColor')!));
    flashDec = vscode.window.createTextEditorDecorationType(baseOpt(config.get('flash.color')!));

    cmdRunningDec = vscode.window.createTextEditorDecorationType({
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: config.get('innerBorder.runningColor'),
        isWholeLine: true
    });
    cmdSuccessDec = vscode.window.createTextEditorDecorationType({
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: config.get('innerBorder.successColor'),
        isWholeLine: true
    });
    cellRunningDec = vscode.window.createTextEditorDecorationType({
        borderWidth: outerWidth,
        borderStyle: 'solid',
        borderColor: config.get('outerBorder.runningColor'),
        isWholeLine: true
    });
    cellSuccessDec = vscode.window.createTextEditorDecorationType({
        borderWidth: outerWidth,
        borderStyle: 'solid',
        borderColor: config.get('outerBorder.successColor'),
        isWholeLine: true
    });

    scratchpadDec = vscode.window.createTextEditorDecorationType({
        borderStyle: config.get('scratchpad.borderStyle', 'dashed'),
        borderWidth: `${config.get('scratchpad.borderWidth', '0.5px')} 0px ${config.get('scratchpad.borderWidth', '0.5px')} 6px`,
        borderColor: config.get('scratchpad.borderColor'),
        backgroundColor: config.get('scratchpad.backgroundColor'),
        isWholeLine: true
    });
}

function disposeAllDecorations() {
    [successBgDec, errorBgDec, flashDec, cmdRunningDec, cmdSuccessDec, cellRunningDec, cellSuccessDec, scratchpadDec]
        .forEach(d => d?.dispose());
}

function updateLayoutSettings() {
    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    const vscodeConfig = vscode.workspace.getConfiguration();

    if (config.get<boolean>('kernel.optimizeStartup', true)) {
        try {
            const pythonConfig = vscode.workspace.getConfiguration('python');
            pythonConfig.update('terminal.activateEnvironment', false, vscode.ConfigurationTarget.Global);
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

export function deactivate() {
    disposeAllDecorations();
    activeAnimations.forEach(interval => clearInterval(interval));
    clearAllAnimations();
}