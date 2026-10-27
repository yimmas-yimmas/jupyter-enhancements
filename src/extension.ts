import * as vscode from 'vscode';
import { ExecutionSnapshot, classifyExecutionTransition } from './executionState';

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
const knownCellStates = new Map<string, ExecutionSnapshot>();
const activeAnimations = new Map<string, NodeJS.Timeout>();
const flashTimers = new Map<string, NodeJS.Timeout>();
const scratchpadCells = new Set<string>();
const sourceToScratchpadMap = new Map<string, string>();
const currentlyAnimatingUris = new Set<string>();

export function activate(context: vscode.ExtensionContext) {
    reloadDecorations();
    updateLayoutSettings();
    clearAllAnimations();

    for (const notebook of vscode.workspace.notebookDocuments) {
        if (notebook.notebookType === 'jupyter-notebook') initKnownStates(notebook);
    }

    context.subscriptions.push(
        vscode.workspace.onDidOpenNotebookDocument(notebook => {
            if (notebook.notebookType === 'jupyter-notebook') initKnownStates(notebook);
        }),
        vscode.workspace.onDidCloseNotebookDocument(notebook => {
            if (notebook.notebookType === 'jupyter-notebook') {
                for (const cell of notebook.getCells()) cleanupCell(cell.document.uri.toString());
            }
        }),
        vscode.workspace.onDidChangeNotebookDocument(event => {
            if (event.notebook.notebookType !== 'jupyter-notebook') return;
            for (const change of event.contentChanges) {
                for (const removed of change.removedCells) cleanupCell(removed.document.uri.toString());
                for (const added of change.addedCells) {
                    if (added.kind === vscode.NotebookCellKind.Code) seedCell(added);
                }
            }
            for (const change of event.cellChanges) {
                if (change.executionSummary !== undefined && change.cell.kind === vscode.NotebookCellKind.Code) {
                    observeCell(change.cell);
                }
            }
        }),
        vscode.window.onDidChangeActiveNotebookEditor(editor => {
            if (editor?.notebook.notebookType === 'jupyter-notebook') initKnownStates(editor.notebook);
        }),
        vscode.debug.onDidChangeActiveDebugSession(() => restoreAllVisibleDecorations()),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('jupyterEnhancements')) {
                clearFlashTimers();
                reloadDecorations();
                restoreAllVisibleDecorations();
                updateLayoutSettings();
            }
        }),
        vscode.window.onDidChangeTextEditorSelection(event => {
            if (event.textEditor.document.uri.scheme === 'vscode-notebook-cell') {
                restoreDecorationForEditor(event.textEditor);
            }
        }),
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            for (const editor of editors) {
                if (editor.document.uri.scheme !== 'vscode-notebook-cell') continue;
                const uri = editor.document.uri.toString();
                restoreDecorationForEditor(editor);
                if (currentlyAnimatingUris.has(uri)) applyRunningDecorationsToEditor(editor, true);
            }
        })
    );

    // A slower fallback covers notebook providers that don't emit every summary change.
    const pollInterval = setInterval(globalWatchdog, 500);
    context.subscriptions.push({ dispose: () => clearInterval(pollInterval) });

    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter-enhancements.runInScratchpad', cell => runScratchpadHandler(cell)),
        vscode.commands.registerCommand('jupyter-enhancements.runInScratchpadAbove', cell => runScratchpadHandler(cell, 'above')),
        vscode.commands.registerCommand('jupyter-enhancements.runInScratchpadBelow', cell => runScratchpadHandler(cell, 'below')),
        vscode.commands.registerCommand('jupyter-enhancements.execute', args => runSequenceHandler('below', args)),
        vscode.commands.registerCommand('jupyter-enhancements.runAndSelectNext', runAndSelectNextHandler),
        vscode.commands.registerCommand('jupyter-enhancements.splitCell', splitCellHandler),
        vscode.commands.registerCommand('jupyter-enhancements.mergeCells', mergeCellHandler),
        vscode.commands.registerCommand('jupyter-enhancements.clearCellOutput', clearCellOutputHandler),
        vscode.commands.registerCommand('jupyter-enhancements.toggleOutput', cell => executeNativeOnCell(cell, 'notebook.cell.toggleOutputs')),
        vscode.commands.registerCommand('jupyter-enhancements.moveCellUp', cell => executeNativeOnCell(cell, 'notebook.cell.moveUp')),
        vscode.commands.registerCommand('jupyter-enhancements.moveCellDown', cell => executeNativeOnCell(cell, 'notebook.cell.moveDown')),
        vscode.commands.registerCommand('jupyter-enhancements.copyCell', cell => executeNativeOnCell(cell, 'notebook.cell.copy')),
        vscode.commands.registerCommand('jupyter-enhancements.pasteCell', cell => executeNativeOnCell(cell, 'notebook.cell.paste')),
        vscode.commands.registerCommand('jupyter-enhancements.copyCellDown', cell => executeNativeOnCell(cell, 'notebook.cell.copyDown')),
        vscode.commands.registerCommand('jupyter-enhancements.cutCell', cell => executeNativeOnCell(cell, 'notebook.cell.cut'))
    );
}

// =========================================================
// --- STATE & WATCHDOG ---
// =========================================================
function snapshot(cell: vscode.NotebookCell): ExecutionSnapshot {
    const summary = cell.executionSummary;
    return {
        order: summary?.executionOrder ?? 0,
        start: summary?.timing?.startTime ?? 0,
        end: summary?.timing?.endTime ?? 0,
        success: summary?.success
    };
}

function seedCell(cell: vscode.NotebookCell) {
    const uri = cell.document.uri.toString();
    if (!knownCellStates.has(uri)) knownCellStates.set(uri, snapshot(cell));
}

function initKnownStates(notebook: vscode.NotebookDocument) {
    for (const cell of notebook.getCells()) {
        if (cell.kind === vscode.NotebookCellKind.Code) seedCell(cell);
    }
}

function cleanupCell(uri: string) {
    stopRunningVisuals(uri);
    const flashTimer = flashTimers.get(uri);
    if (flashTimer) clearTimeout(flashTimer);
    flashTimers.delete(uri);
    knownCellStates.delete(uri);
    cellStatusMap.delete(uri);
    scratchpadCells.delete(uri);
    sourceToScratchpadMap.delete(uri);
    for (const [source, target] of sourceToScratchpadMap) {
        if (target === uri) sourceToScratchpadMap.delete(source);
    }
}

function observeCell(cell: vscode.NotebookCell) {
    const uri = cell.document.uri.toString();
    const next = snapshot(cell);
    const previous = knownCellStates.get(uri);
    knownCellStates.set(uri, next);
    if (!previous) return; // An opened or inserted cell is not a fresh execution.

    const transition = classifyExecutionTransition(previous, next);
    if (transition === 'finished') {
        stopRunningVisuals(uri);
        if (next.success !== undefined) {
            cellStatusMap.set(uri, next.success ? 'success' : 'error');
            const recent = next.end === 0 || (Date.now() - next.end >= -2000 && Date.now() - next.end < 5000);
            if (recent) handleCellFinished(cell, next.success);
            else restoreDecorationForCell(cell);
        } else {
            cellStatusMap.delete(uri);
            restoreDecorationForCell(cell);
        }
    } else if (transition === 'started' && !vscode.debug.activeDebugSession && !currentlyAnimatingUris.has(uri)) {
        currentlyAnimatingUris.add(uri);
        startRunningVisuals(cell);
    }
}

function globalWatchdog() {
    const editor = vscode.window.activeNotebookEditor;
    if (editor?.notebook.notebookType !== 'jupyter-notebook') return;
    for (const cell of editor.notebook.getCells()) {
        if (cell.kind === vscode.NotebookCellKind.Code) observeCell(cell);
    }
}

function clearFlashTimers() {
    for (const timer of flashTimers.values()) clearTimeout(timer);
    flashTimers.clear();
}

function clearAllAnimations() {
    for (const uri of [...currentlyAnimatingUris]) stopRunningVisuals(uri);
    for (const timer of activeAnimations.values()) clearInterval(timer);
    activeAnimations.clear();
    currentlyAnimatingUris.clear();
    for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.scheme === 'vscode-notebook-cell') applyRunningDecorationsToEditor(editor, false);
    }
}

// =========================================================
// --- VISUAL ENGINE ---
// =========================================================
function startRunningVisuals(cell: vscode.NotebookCell) {
    const uri = cell.document.uri.toString();
    cellStatusMap.delete(uri);
    const flashTimer = flashTimers.get(uri);
    if (flashTimer) clearTimeout(flashTimer);
    flashTimers.delete(uri);
    removeDecoration(cell, flashDec);
    restoreDecorationForCell(cell);
    startAnimationLoopForCell(cell);
    // Do not reveal/select/force-edit cells during background execution.
}

function stopRunningVisuals(uri: string) {
    currentlyAnimatingUris.delete(uri);
    const interval = activeAnimations.get(uri);
    if (interval) clearInterval(interval);
    activeAnimations.delete(uri);
    for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === uri) applyRunningDecorationsToEditor(editor, false);
    }
}

function applyRunningDecorationsToEditor(editor: vscode.TextEditor, visible: boolean) {
    const range = new vscode.Range(0, 0, editor.document.lineCount, 0);
    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    editor.setDecorations(cmdRunningDec, visible && config.get<boolean>('innerBorder.enable', true) ? [range] : []);
    editor.setDecorations(cellRunningDec, visible && config.get<boolean>('outerBorder.enable', true) ? [range] : []);
}

function startAnimationLoopForCell(cell: vscode.NotebookCell) {
    const uri = cell.document.uri.toString();
    if (activeAnimations.has(uri)) return;

    let visible = true;
    const update = () => {
        if (!currentlyAnimatingUris.has(uri)) return;
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() === uri) applyRunningDecorationsToEditor(editor, visible);
        }
        visible = !visible;
    };
    update();
    activeAnimations.set(uri, setInterval(update, 500));
    // No fixed 10s timer: a legitimate execution can take much longer.
    // Stop only when execution completes, the cell closes, or the extension unloads.
}

function handleCellFinished(cell: vscode.NotebookCell, success: boolean) {
    const uri = cell.document.uri.toString();
    cellStatusMap.set(uri, success ? 'success' : 'error');

    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    if (success && !vscode.debug.activeDebugSession && config.get<boolean>('flash.enable', true)) {
        const previous = flashTimers.get(uri);
        if (previous) clearTimeout(previous);
        applyDecoration(cell, flashDec);
        const decorationAtStart = flashDec;
        const timer = setTimeout(() => {
            if (flashTimers.get(uri) !== timer) return;
            flashTimers.delete(uri);
            removeDecoration(cell, decorationAtStart);
        }, Math.max(0, config.get<number>('general.flashDuration', 300)));
        flashTimers.set(uri, timer);
    }

    restoreDecorationForCell(cell);
}

function ensureCellIsVisible(editor: vscode.NotebookEditor, cell: vscode.NotebookCell) {
    const isVisible = editor.visibleRanges.some(range => cell.index >= range.start && cell.index < range.end);
    if (!isVisible) editor.revealRange(new vscode.NotebookRange(cell.index, cell.index + 1), vscode.NotebookEditorRevealType.AtTop);
}

// =========================================================
// --- COMMAND HANDLERS ---
// =========================================================

const executeNativeOnCell = async (cellOrContext: any, commandId: string) => {
    if (cellOrContext && 'notebook' in cellOrContext && 'document' in cellOrContext) {
        const cell = cellOrContext as vscode.NotebookCell;
        const editor = vscode.window.activeNotebookEditor;
        // Never send a toolbar operation to a different notebook.
        if (!editor || editor.notebook.uri.toString() !== cell.notebook.uri.toString() || cell.index < 0) return;
        const onlyTarget = editor.selections.length === 1 &&
            editor.selections[0].start === cell.index && editor.selections[0].end === cell.index + 1;
        if (!onlyTarget) editor.selections = [new vscode.NotebookRange(cell.index, cell.index + 1)];
    }
    await vscode.commands.executeCommand(commandId);
};

const clearCellOutputHandler = async (cellOrContext?: vscode.NotebookCell | any) => {
    await executeNativeOnCell(cellOrContext, 'notebook.cell.clearOutputs');
};

const runAndSelectNextHandler = async (cellOrContext?: vscode.NotebookCell | any) => {
    await executeNativeOnCell(cellOrContext, 'notebook.cell.executeAndSelectBelow');
    const editor = vscode.window.activeNotebookEditor;
    if (editor && editor.selections.length > 0) {
        const activeIndex = editor.selections[0].start;
        editor.revealRange(new vscode.NotebookRange(activeIndex, activeIndex + 1), vscode.NotebookEditorRevealType.InCenter);
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
    newCell.metadata = { ...first.metadata };
    newCell.outputs = cells.flatMap(c => [...c.outputs]);
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
    
    if (!sourceCell || !textToRun || !notebookEditor ||
        sourceCell.notebook.uri.toString() !== notebookEditor.notebook.uri.toString()) return;

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

    if (scratchpadCell && scratchpadCells.has(scratchpadCell.document.uri.toString())) {
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
            if (scratchpadCell!.index < 0 || vscode.window.activeNotebookEditor?.notebook.uri.toString() !== notebook.uri.toString()) return;

            const range = new vscode.NotebookRange(scratchpadCell!.index, scratchpadCell!.index + 1);
            notebookEditor.revealRange(range, vscode.NotebookEditorRevealType.Default);
            notebookEditor.selections = [range];
            
            await vscode.commands.executeCommand('notebook.cell.execute', {
                ranges: [{ start: scratchpadCell!.index, end: scratchpadCell!.index + 1 }],
                notebookUri: notebook.uri
            });
            // Leave the user's text editor mode and selection alone.
        }, 300);
    }
};

// Await a NEW result, not the success flag retained from a previous run.
async function executeCellAndWait(cell: vscode.NotebookCell): Promise<boolean> {
    const notebook = cell.notebook;
    const previous = snapshot(cell);
    return new Promise<boolean>((resolve, reject) => {
        let settled = false;
        let timeout: NodeJS.Timeout;
        let changes: vscode.Disposable;
        let closed: vscode.Disposable;
        const finish = (result: boolean | Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            changes.dispose();
            closed.dispose();
            if (result instanceof Error) reject(result);
            else resolve(result);
        };
        changes = vscode.workspace.onDidChangeNotebookDocument(event => {
            if (event.notebook.uri.toString() !== notebook.uri.toString()) return;
            for (const change of event.cellChanges) {
                if (change.cell.document.uri.toString() !== cell.document.uri.toString() ||
                    change.executionSummary === undefined) continue;
                const next = snapshot(cell);
                if (classifyExecutionTransition(previous, next) === 'finished') {
                    finish(next.success === true);
                }
            }
        });
        closed = vscode.workspace.onDidCloseNotebookDocument(document => {
            if (document.uri.toString() === notebook.uri.toString()) finish(new Error('Notebook closed during execution.'));
        });
        timeout = setTimeout(() => finish(new Error('Cell execution did not complete within 30 minutes.')), 30 * 60 * 1000);
        void vscode.commands.executeCommand('notebook.cell.execute', {
            ranges: [{ start: cell.index, end: cell.index + 1 }],
            notebookUri: notebook.uri
        }).then(() => {
            // The command may return before execution finishes; the notebook event is authoritative.
            const next = snapshot(cell);
            if (classifyExecutionTransition(previous, next) === 'finished') finish(next.success === true);
        }, error => finish(error instanceof Error ? error : new Error(String(error))));
    });
}

const runSequenceHandler = async (mode: 'below' | 'above' | 'all', args?: any) => {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor || editor.notebook.notebookType !== 'jupyter-notebook') return;

    const notebook = editor.notebook;
    const anchorIndex = args?.index ?? editor.selections[0]?.start ?? 0;
    let start = 0, end = notebook.cellCount;
    if (mode === 'below') start = anchorIndex;
    else if (mode === 'above') end = anchorIndex + 1;

    for (let i = start; i < end; i++) {
        if (notebook.isClosed || i >= notebook.cellCount) break;
        const cell = notebook.cellAt(i);
        if (cell.kind !== vscode.NotebookCellKind.Code || !cell.document.getText().trim()) continue;
        try {
            const success = await executeCellAndWait(cell);
            if (!success) break;
        } catch (error) {
            vscode.window.showWarningMessage('Jupyter Enhancements: sequence stopped: ' + String(error));
            break;
        }
    }
};



function restoreDecorationForEditor(editor: vscode.TextEditor) {
    if (editor.document.uri.scheme !== 'vscode-notebook-cell') return;

    const uri = editor.document.uri.toString();
    const range = new vscode.Range(0, 0, editor.document.lineCount, 0);
    const status = cellStatusMap.get(uri);
    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    editor.setDecorations(scratchpadDec, scratchpadCells.has(uri) ? [range] : []);

    // Always clear stale decorations before restoring desired state.
    editor.setDecorations(successBgDec, []);
    editor.setDecorations(errorBgDec, []);
    editor.setDecorations(cmdSuccessDec, []);
    editor.setDecorations(cellSuccessDec, []);
    if (vscode.debug.activeDebugSession || !status) return;

    const canShowBackground = editor.selection.isEmpty && config.get<boolean>('background.enable', true);
    if (status === 'success') {
        if (canShowBackground) editor.setDecorations(successBgDec, [range]);
        if (config.get<boolean>('innerBorder.enable', true) && config.get<boolean>('innerBorder.persist', false)) {
            editor.setDecorations(cmdSuccessDec, [range]);
        }
        if (config.get<boolean>('outerBorder.enable', true) && config.get<boolean>('outerBorder.persist', true)) {
            editor.setDecorations(cellSuccessDec, [range]);
        }
    } else if (canShowBackground) {
        editor.setDecorations(errorBgDec, [range]);
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

    if (config.get<boolean>('kernel.optimizeStartup', false)) {
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
    clearFlashTimers();
    clearAllAnimations();
    disposeAllDecorations();
}