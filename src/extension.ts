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

    if (vscode.window.activeNotebookEditor && vscode.window.activeNotebookEditor.notebook.notebookType === 'jupyter-notebook') {
        initKnownStates(vscode.window.activeNotebookEditor.notebook);
        lastNotebookOpenTime = Date.now();
    }
    
    context.subscriptions.push(
        vscode.workspace.onDidOpenNotebookDocument(notebook => {
            if (notebook.notebookType === 'jupyter-notebook') {
                initKnownStates(notebook);
                clearAllAnimations();
                lastNotebookOpenTime = Date.now(); 
            }
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveNotebookEditor(editor => {
            if (editor && editor.notebook.notebookType === 'jupyter-notebook') {
                initKnownStates(editor.notebook);
                lastNotebookOpenTime = Date.now(); 
                clearAllAnimations(); 
            }
        })
    );

    context.subscriptions.push(
        vscode.debug.onDidChangeActiveDebugSession(() => {
            restoreAllVisibleDecorations();
        })
    );
    
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('jupyterEnhancements')) {
                reloadDecorations();
                restoreAllVisibleDecorations();
                updateLayoutSettings();
            }
        })
    );

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

    const pollInterval = setInterval(globalWatchdog, 100);
    context.subscriptions.push({ dispose: () => clearInterval(pollInterval) });

    // --- COMMANDS ---
    
    // Scratchpad
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.runInScratchpad', (cell) => runScratchpadHandler(cell))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.runInScratchpadAbove', (cell) => runScratchpadHandler(cell, 'above'))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.runInScratchpadBelow', (cell) => runScratchpadHandler(cell, 'below'))
    );

    // Custom Execution
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.execute', (args) => runSequenceHandler('below', args))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.runAndSelectNext', runAndSelectNextHandler)
    );

    // Editing Ops
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.splitCell', splitCellHandler)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.mergeCells', mergeCellHandler)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.clearCellOutput', clearCellOutputHandler)
    );

    // Native Wrappers
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.toggleOutput', (cell) => executeNativeOnCell(cell, 'notebook.cell.toggleOutputs'))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.moveCellUp', (cell) => executeNativeOnCell(cell, 'notebook.cell.moveUp'))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.moveCellDown', (cell) => executeNativeOnCell(cell, 'notebook.cell.moveDown'))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.copyCell', (cell) => executeNativeOnCell(cell, 'notebook.cell.copy'))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.pasteCell', (cell) => executeNativeOnCell(cell, 'notebook.cell.paste'))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.copyCellDown', (cell) => executeNativeOnCell(cell, 'notebook.cell.copyDown'))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.cutCell', (cell) => executeNativeOnCell(cell, 'notebook.cell.cut'))
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

// FIX: Improved Watchdog logic to prevent premature stop
function globalWatchdog() {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor || editor.notebook.notebookType !== 'jupyter-notebook') return;

    const now = Date.now();
    const timeSinceOpen = now - lastNotebookOpenTime;
    const isSettling = timeSinceOpen < 5000; 

    for (const cell of editor.notebook.getCells()) {
        if (cell.kind !== vscode.NotebookCellKind.Code) continue;

        const uri = cell.document.uri.toString();
        const summary = cell.executionSummary;

        const currentOrder = summary?.executionOrder || 0;
        const lastOrder = knownExecutionOrders.get(uri) || 0;
        const lastEnd = lastExecutionTimes.get(uri) || 0;
        const currentEnd = summary?.timing?.endTime || 0;

        // 1. FINISHED
        // Logic: Execution time has advanced past what we previously knew.
        if (currentEnd > lastEnd) {
            lastExecutionTimes.set(uri, currentEnd);
            knownExecutionOrders.set(uri, currentOrder);
            currentlyAnimatingUris.delete(uri);
            stopRunningVisuals(uri);

            const success = summary?.success ?? false;
            // Only flash/focus if finished < 2s ago (prevents old paste triggering)
            const isRecent = (now - currentEnd) < 2000; 

            cellStatusMap.set(uri, success ? 'success' : 'error');

            if (isRecent) {
                handleCellFinished(cell, success);
                if (editor.selections[0]?.start === cell.index) {
                    setTimeout(() => refreshCellFocus(), 100);
                }
            } else {
                restoreDecorationForCell(cell);
            }
            continue;
        }

        // 2. STARTED / RESTARTED
        // Logic: The execution order increased. This means a NEW run has begun.
        if (currentOrder > lastOrder) {
            knownExecutionOrders.set(uri, currentOrder);
            
            // IMPORTANT FIX: 
            // If the cell is re-running, 'currentEnd' might still hold the timestamp from the PREVIOUS run.
            // We must update 'lastEnd' to this stale timestamp so that we don't trigger "FINISHED" immediately
            // in the next loop tick. We wait for 'currentEnd' to become GREATER than this value.
            if (currentEnd > 0) {
                lastExecutionTimes.set(uri, currentEnd);
            }

            if (vscode.debug.activeDebugSession) continue;
            if (isSettling) continue; 

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
    if (!isVisible) {
        editor.revealRange(range, vscode.NotebookEditorRevealType.AtTop);
    }
}

// =========================================================
// --- COMMAND HANDLERS ---
// =========================================================

const executeNativeOnCell = async (cellOrContext: any, commandId: string) => {
    if (cellOrContext && 'notebook' in cellOrContext) {
        const cell = cellOrContext as vscode.NotebookCell;
        const editor = vscode.window.activeNotebookEditor;
        if (editor) {
            const isSelected = editor.selections.some(s => s.start <= cell.index && s.end > cell.index);
            if (!isSelected) {
                editor.selections = [new vscode.NotebookRange(cell.index, cell.index + 1)];
            }
        }
    }
    await vscode.commands.executeCommand(commandId);
};

const clearCellOutputHandler = async (cellOrContext?: vscode.NotebookCell | any) => {
    executeNativeOnCell(cellOrContext, 'notebook.cell.clearOutputs');
};

const runAndSelectNextHandler = async (cellOrContext?: vscode.NotebookCell | any) => {
    await executeNativeOnCell(cellOrContext, 'notebook.cell.executeAndSelectBelow');
    const editor = vscode.window.activeNotebookEditor;
    if (editor && editor.selections.length > 0) {
        const activeIndex = editor.selections[0].start;
        const range = new vscode.NotebookRange(activeIndex, activeIndex + 1);
        editor.revealRange(range, vscode.NotebookEditorRevealType.InCenter);
    }
};

const mergeCellHandler = async () => {
    const notebookEditor = vscode.window.activeNotebookEditor;
    if (!notebookEditor) return;
    const selection = notebookEditor.selections[0];
    if (!selection) return;

    let start = selection.start;
    let end = selection.end;
    const notebook = notebookEditor.notebook;

    if (end - start === 1) {
        if (start + 1 < notebook.cellCount) {
            end = start + 2;
        } else {
            return; 
        }
    }

    const cells = [];
    for (let i = start; i < end; i++) cells.push(notebook.cellAt(i));
    
    const text = cells.map(c => c.document.getText()).join('\n');
    const first = cells[0];
    
    const newCell = new vscode.NotebookCellData(first.kind, text, first.document.languageId);
    const edit = new vscode.WorkspaceEdit();
    const range = new vscode.NotebookRange(start, end);
    edit.set(notebook.uri, [vscode.NotebookEdit.replaceCells(range, [newCell])]);
    await vscode.workspace.applyEdit(edit);
};

const splitCellHandler = async () => {
    const editor = vscode.window.activeTextEditor;
    const notebookEditor = vscode.window.activeNotebookEditor;

    if (!editor && !notebookEditor) {
        vscode.window.showInformationMessage("Please click inside a cell to split it.");
        return;
    }

    await vscode.commands.executeCommand('notebook.cell.split');
};

const runScratchpadHandler = async (contextCell?: any, overridePosition?: 'above' | 'below') => {
    let sourceCell: vscode.NotebookCell | undefined;
    let textToRun = "";

    if (contextCell && 'notebook' in contextCell) {
        sourceCell = contextCell;
    }

    const editor = vscode.window.activeTextEditor;
    const notebookEditor = vscode.window.activeNotebookEditor;
    
    if (editor) {
        const isMatchesSource = !sourceCell || editor.document.uri.toString() === sourceCell.document.uri.toString();
        if (isMatchesSource) {
            const selText = editor.document.getText(editor.selection).trim();
            if (selText) {
                textToRun = selText;
                if (!sourceCell && notebookEditor) {
                     sourceCell = notebookEditor.notebook.getCells().find(c => c.document.uri.toString() === editor.document.uri.toString());
                }
            }
        }
    }

    if (!textToRun && sourceCell) {
        textToRun = sourceCell.document.getText().trim();
    }
    
    if (!sourceCell || !textToRun || !notebookEditor) return;

    const notebook = notebookEditor.notebook;
    const sourceUri = sourceCell.document.uri.toString();
    const existingUri = sourceToScratchpadMap.get(sourceUri);
    let scratchpadCell: vscode.NotebookCell | undefined;

    let insertPosition = overridePosition;
    if (!insertPosition) {
         const config = vscode.workspace.getConfiguration('jupyterEnhancements');
         insertPosition = config.get<string>('scratchpad.insertPosition', 'below') as 'above' | 'below';
    }

    if (existingUri) {
        scratchpadCell = notebook.getCells().find(c => c.document.uri.toString() === existingUri);
    }

    if (scratchpadCell) {
        const diff = scratchpadCell.index - sourceCell.index;
        const isCorrectPosition = (insertPosition === 'above' && diff === -1) || 
                                  (insertPosition === 'below' && diff === 1);
        
        if (!isCorrectPosition) {
            scratchpadCell = undefined; 
        }
    }

    if (scratchpadCell) {
        const edit = new vscode.WorkspaceEdit();
        const lastLine = scratchpadCell.document.lineAt(scratchpadCell.document.lineCount - 1);
        const fullRange = new vscode.Range(new vscode.Position(0, 0), lastLine.range.end);
        edit.replace(scratchpadCell.document.uri, fullRange, textToRun);
        await vscode.workspace.applyEdit(edit);
    } else {
        const insertIndex = insertPosition === 'above' ? sourceCell.index : sourceCell.index + 1;

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
            if (!notebookEditor) return;

            const range = new vscode.NotebookRange(scratchpadCell!.index, scratchpadCell!.index + 1);
            notebookEditor.revealRange(range, vscode.NotebookEditorRevealType.Default);
            notebookEditor.selections = [range];
            
            await vscode.commands.executeCommand('notebook.cell.execute', {
                ranges: [{ start: scratchpadCell!.index, end: scratchpadCell!.index + 1 }],
                notebookUri: notebook.uri
            });
            await refreshCellFocus();
        }, 300);
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

function restoreDecorationForEditor(editor: vscode.TextEditor) {
    if (editor.document.uri.scheme !== 'vscode-notebook-cell') return;

    const uri = editor.document.uri.toString();
    const range = new vscode.Range(0, 0, editor.document.lineCount, 0);

    editor.setDecorations(scratchpadDec, scratchpadCells.has(uri) ? [range] : []);

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