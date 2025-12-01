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
const activeAnimations = new Map<string, () => void>();

// Scratchpad State
const scratchpadCells = new Set<string>(); 
const sourceToScratchpadMap = new Map<string, string>(); 

let output: vscode.OutputChannel;
let extensionContext: vscode.ExtensionContext;

// --- HIJACK DISPOSABLES ---
let singleHijack: vscode.Disposable | undefined;
let allHijack: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    output = vscode.window.createOutputChannel("Jupyter Enhancements");
    output.show(true);
    output.appendLine("[INFO] Jupyter Enhancements Activated.");

    reloadDecorations();
    updateLayoutSettings(); // Apply layout settings on startup

    // 1. Settings Listener
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('jupyterEnhancements')) {
            output.appendLine("[DEBUG] Settings changed. Reloading decorations & layout.");
            reloadDecorations();
            restoreAllVisibleDecorations();
            updateLayoutSettings(); // Check if layout toggles changed
        }
    }));

    // 2. Scroll Listener
    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(editors => {
        for (const editor of editors) restoreDecorationForEditor(editor);
    }));

    // 3. Poller
    const pollInterval = setInterval(checkForFinishedCells, 200);
    context.subscriptions.push({ dispose: () => clearInterval(pollInterval) });

    // 4. Global Event Listener
    const notebooksAny = vscode.notebooks as any;
    if (notebooksAny && typeof notebooksAny.onDidChangeNotebookCellExecutionState === 'function') {
        context.subscriptions.push(notebooksAny.onDidChangeNotebookCellExecutionState((e: any) => {
            handleExecutionStateChange(e);
        }));
    }

    // 5. Register Hijacks
    registerHijacks();

    // 6. Register Permanent Commands
    const register = (id: string, handler: (args: any) => any) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
        output.appendLine(`[DEBUG] Registered Permanent: ${id}`);
    };

    // Main Run Command
    register('jupyter-enhancements.execute', (args) => runSequenceHandler('below', args));
    
    // Scratchpad Command
    register('jupyter-enhancements.runInScratchpad', runScratchpadHandler);

    // Native & Jupyter Hijacks
    register('notebook.cell.executeCellAndBelow', (args) => runSequenceHandler('below', args));
    register('notebook.cell.executeCellsAbove', (args) => runSequenceHandler('above', args));
    register('jupyter.runCellAndAllBelow', (args) => runSequenceHandler('below', args));
    register('jupyter.runPrecedentCells', (args) => runSequenceHandler('above', args));
    register('jupyter.runDependentCells', (args) => runSequenceHandler('below', args));
}

export function deactivate() {
    disposeAllDecorations();
    activeAnimations.forEach(stop => stop());
}

// --- LAYOUT SETTINGS HANDLER ---
function updateLayoutSettings() {
    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    const vscodeConfig = vscode.workspace.getConfiguration();

    // 1. Compact View Toggle
    const enableCompact = config.get<boolean>('layout.enableCompactView', false);
    
    // We only update if the setting is specifically requested to avoid overriding user preference aggressively
    // But since this is a "Toggle", we enforce state.
    
    const compactSettings = {
        "notebook.cellExecutionTimeVerbosity": "verbose",
        "notebook.consolidatedRunButton": true,
        "notebook.lineNumbers": "on",
        "notebook.output.lineHeight": 15,
        "notebook.output.minimalErrorRendering": true,
        "notebook.showCellStatusBar": "visibleAfterExecute",
        "notebook.variablesView": true,
        "notebook.insertToolbarLocation": "notebookToolbar"
    };

    if (enableCompact) {
        // Apply Compact Settings
        for (const [key, value] of Object.entries(compactSettings)) {
            if (vscodeConfig.get(key) !== value) {
                vscodeConfig.update(key, value, vscode.ConfigurationTarget.Global);
                output.appendLine(`[Layout] Applied ${key}: ${value}`);
            }
        }
    } else {
        // Optional: Revert to default (undefined) if we want to be nice when untoggled
        // We check if it matches our 'compact' value, if so, reset it.
        // This prevents resetting a user's *other* custom value.
        for (const [key, value] of Object.entries(compactSettings)) {
            if (vscodeConfig.get(key) === value) {
                // If it looks like we set it, unset it (revert to default)
                vscodeConfig.update(key, undefined, vscode.ConfigurationTarget.Global);
            }
        }
    }

    // 2. Hide Cell Toolbar Toggle
    const hideToolbar = config.get<boolean>('layout.hideCellToolbar', false);
    const toolbarKey = "notebook.cellToolbarLocation";
    const currentToolbar = vscodeConfig.get(toolbarKey);

    if (hideToolbar) {
        // Target: { "default": "hidden" }
        // We compare broadly to avoid constant writing
        if (JSON.stringify(currentToolbar) !== JSON.stringify({ "default": "hidden" })) {
            vscodeConfig.update(toolbarKey, { "default": "hidden" }, vscode.ConfigurationTarget.Global);
            output.appendLine(`[Layout] Cell Toolbar Hidden`);
        }
    } else {
        // Target: "right" (Default) or { "default": "right" }
        // If it is currently hidden, restore to right.
        if (JSON.stringify(currentToolbar) === JSON.stringify({ "default": "hidden" })) {
            vscodeConfig.update(toolbarKey, { "default": "right" }, vscode.ConfigurationTarget.Global);
            output.appendLine(`[Layout] Cell Toolbar Restored to Right`);
        }
    }
}

// --- HIJACK SETUP ---
function registerHijacks() {
    singleHijack?.dispose();
    allHijack?.dispose();

    // Hook Run Single
    singleHijack = vscode.commands.registerCommand('notebook.cell.execute', async (args) => {
        output.appendLine("[DEBUG] >> Hijack: Run Single");
        await runSingleHandler(args);
    });
    extensionContext.subscriptions.push(singleHijack);

    // Hook Run All
    allHijack = vscode.commands.registerCommand('notebook.execute', async (args) => {
        output.appendLine("[DEBUG] >> Hijack: Run All");
        await runSequenceHandler('all', args);
    });
    extensionContext.subscriptions.push(allHijack);
}

// --- SCRATCHPAD HANDLER ---
const runScratchpadHandler = async () => {
    const activeTextEditor = vscode.window.activeTextEditor;
    const notebookEditor = vscode.window.activeNotebookEditor;

    if (!notebookEditor || !activeTextEditor) {
        vscode.window.showErrorMessage("Please focus a code cell in a notebook first.");
        return;
    }

    // 1. Get Selected Text
    const selection = activeTextEditor.selection;
    let text = activeTextEditor.document.getText(selection).trim();

    if (!text) {
        vscode.window.showInformationMessage("No code selected to run in Scratchpad.");
        return;
    }

    // 2. Identify Source Cell
    const notebook = notebookEditor.notebook;
    const sourceCell = notebook.getCells().find(c => c.document.uri.toString() === activeTextEditor.document.uri.toString());
    
    if (!sourceCell) {
        output.appendLine("[ERROR] Could not find source cell for active editor.");
        return;
    }

    const sourceUri = sourceCell.document.uri.toString();
    output.appendLine(`[Scratchpad] Source Cell Index: ${sourceCell.index}`);

    // 3. Check for Existing Scratchpad
    let scratchpadCell: vscode.NotebookCell | undefined;
    const existingScratchpadUri = sourceToScratchpadMap.get(sourceUri);

    if (existingScratchpadUri) {
        // Verify it still exists in the notebook
        scratchpadCell = notebook.getCells().find(c => c.document.uri.toString() === existingScratchpadUri);
    }

    if (scratchpadCell) {
        // --- CASE A: UPDATE EXISTING ---
        output.appendLine(`[Scratchpad] Updating existing cell at index ${scratchpadCell.index}`);
        
        // Replace Content
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(0, 0, scratchpadCell.document.lineCount + 1, 0); // Covers all text
        edit.replace(scratchpadCell.document.uri, fullRange, text);
        await vscode.workspace.applyEdit(edit);

    } else {
        // --- CASE B: CREATE NEW ---
        output.appendLine(`[Scratchpad] Creating NEW cell.`);
        
        const insertIndex = sourceCell.index + 1;
        const cellData = new vscode.NotebookCellData(
            vscode.NotebookCellKind.Code,
            text,
            sourceCell.document.languageId || "python"
        );
        
        const edit = new vscode.WorkspaceEdit();
        const notebookEdit = vscode.NotebookEdit.insertCells(insertIndex, [cellData]);
        edit.set(notebook.uri, [notebookEdit]);
        
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) return;

        // Find the new cell (it is now at insertIndex)
        scratchpadCell = notebook.cellAt(insertIndex);
        
        // Track it
        sourceToScratchpadMap.set(sourceUri, scratchpadCell.document.uri.toString());
        scratchpadCells.add(scratchpadCell.document.uri.toString());
    }

    // 4. Visuals & Execution
    if (scratchpadCell) {
        // Apply Dashed Border
        restoreDecorationForCell(scratchpadCell);

        // Focus the scratchpad
        const range = new vscode.NotebookRange(scratchpadCell.index, scratchpadCell.index + 1);
        notebookEditor.revealRange(range, vscode.NotebookEditorRevealType.Default);
        notebookEditor.selections = [range];

        // Execute
        await vscode.commands.executeCommand('notebook.cell.execute', { 
            ranges: [{ start: scratchpadCell.index, end: scratchpadCell.index + 1 }], 
            notebookUri: notebook.uri 
        });
    }
};

// --- RUN SINGLE HANDLER ---
const runSingleHandler = async (args?: any) => {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) return;

    let cell: vscode.NotebookCell | undefined;
    if (args && args.document) {
        cell = args; 
    } else if (editor.selections.length > 0) {
        cell = editor.notebook.cellAt(editor.selections[0].start);
    }

    if (cell) {
        output.appendLine(`[Single] Processing Cell ${cell.index}`);
        
        cellStatusMap.delete(cell.document.uri.toString());
        restoreDecorationForCell(cell);

        // Clear Next Cell Color
        const nextIndex = cell.index + 1;
        if (nextIndex < editor.notebook.cellCount) {
            const nextCell = editor.notebook.cellAt(nextIndex);
            cellStatusMap.delete(nextCell.document.uri.toString());
            restoreDecorationForCell(nextCell);
        }

        const stopAnim = startAnimationLoopForCell(cell);

        singleHijack?.dispose(); 
        try {
            await vscode.commands.executeCommand('notebook.cell.execute', { 
                ranges: [{ start: cell.index, end: cell.index + 1 }], 
                notebookUri: cell.notebook.uri 
            });
        } catch (e) {
            output.appendLine(`[ERROR] Native run failed: ${e}`);
        } finally {
            registerHijacks(); 
        }

        stopAnim();
        handleCellFinished(cell, cell.executionSummary?.success ?? false);

        if (nextIndex < editor.notebook.cellCount) {
            const nextRange = new vscode.NotebookRange(nextIndex, nextIndex + 1);
            editor.selections = [nextRange];
            editor.revealRange(nextRange, vscode.NotebookEditorRevealType.InCenterIfOutsideViewport);
        }
    }
};

// --- RUN SEQUENCE HANDLER ---
const runSequenceHandler = async (mode: 'below' | 'above' | 'all', args?: any) => {
    output.appendLine(`[Sequence] Mode: ${mode}`);
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) {
        output.appendLine("[ERROR] No active editor.");
        return;
    }

    const notebook = editor.notebook;
    let loopStart = 0; 
    let loopEnd = notebook.cellCount;
    let anchorIndex = editor.selections[0]?.start ?? 0;

    if (args && args.document) anchorIndex = args.index;

    if (mode === 'all') {
        loopStart = 0;
        loopEnd = notebook.cellCount;
        cellStatusMap.clear();
        clearAllDecorations();
    } else if (mode === 'below') {
        loopStart = anchorIndex;
        loopEnd = notebook.cellCount;
        if (anchorIndex === 0) { 
            cellStatusMap.clear(); 
            clearAllDecorations(); 
        }
    } else {
        loopStart = 0;
        loopEnd = anchorIndex + 1;
    }

    for (let i = loopStart; i < loopEnd; i++) {
        const c = notebook.cellAt(i);
        if (c.kind === vscode.NotebookCellKind.Code) {
            cellStatusMap.delete(c.document.uri.toString());
            restoreDecorationForCell(c);
        }
    }

    singleHijack?.dispose();

    try {
        for (let i = loopStart; i < loopEnd; i++) {
            const cell = notebook.cellAt(i);
            if (cell.kind !== vscode.NotebookCellKind.Code || !cell.document.getText().trim()) continue;

            output.appendLine(`[Sequence] Running Cell ${i}`);

            cellStatusMap.delete(cell.document.uri.toString());
            restoreDecorationForCell(cell);

            const range = new vscode.NotebookRange(i, i + 1);
            editor.selections = [range];
            editor.revealRange(range, vscode.NotebookEditorRevealType.InCenterIfOutsideViewport);

            await new Promise(r => setTimeout(r, 100));

            const stopAnim = startAnimationLoopForCell(cell);
            await executeCellAndWaitNative(cell);
            stopAnim();
            
            const success = cell.executionSummary?.success ?? false;
            handleCellFinished(cell, success);

            if (!success) {
                output.appendLine(`[Sequence] Cell ${i} Failed. Stopping.`);
                break;
            }
        }
    } finally {
        registerHijacks();
    }
};

// --- CORE HELPERS ---

async function executeCellAndWaitNative(cell: vscode.NotebookCell): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const poller = setInterval(() => {
            if (cell.executionSummary?.success !== undefined) {
                clearInterval(poller);
                resolve(cell.executionSummary.success);
            }
        }, 100);

        vscode.commands.executeCommand('notebook.cell.execute', {
            ranges: [{ start: cell.index, end: cell.index + 1 }],
            notebookUri: cell.notebook.uri
        }).then(undefined, (err) => { output.appendLine(`[ERROR] Exec failed: ${err}`); });
    });
}

function startAnimationLoopForCell(cell: vscode.NotebookCell): () => void {
    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    const enableInner = config.get<boolean>('innerBorder.enable', true);
    const enableOuter = config.get<boolean>('outerBorder.enable', true);

    if (!enableInner && !enableOuter) return () => {};

    let visible = true;
    const toggle = () => {
        const editors = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === cell.document.uri.toString());
        for (const editor of editors) {
            const range = new vscode.Range(0, 0, editor.document.lineCount, 0);
            if (enableInner) editor.setDecorations(cmdRunningDec, visible ? [range] : []);
            if (enableOuter) editor.setDecorations(cellRunningDec, visible ? [range] : []);
        }
        visible = !visible;
    };
    toggle(); 
    const timer = setInterval(toggle, 500);
    return () => { clearInterval(timer); removeDecoration(cell, cmdRunningDec); removeDecoration(cell, cellRunningDec); };
}

// --- VISUAL LOGIC ---

function handleExecutionStateChange(e: any) {
    const cell = e.cell;
    if (e.state === 3) { 
        if (!activeAnimations.has(cell.document.uri.toString())) {
            const stop = startAnimationLoopForCell(cell);
            activeAnimations.set(cell.document.uri.toString(), stop);
        }
    } else if (e.state === 1) { 
        if (activeAnimations.has(cell.document.uri.toString())) {
            activeAnimations.get(cell.document.uri.toString())!();
            activeAnimations.delete(cell.document.uri.toString());
        }
        handleCellFinished(cell, cell.executionSummary?.success ?? false);
    }
}

function handleCellFinished(cell: vscode.NotebookCell, success: boolean) {
    const uri = cell.document.uri.toString();
    cellStatusMap.set(uri, success ? 'success' : 'error');
    if (cell.executionSummary?.timing?.endTime) lastExecutionTimes.set(uri, cell.executionSummary.timing.endTime);

    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    if (success && config.get('flash.enable')) {
        applyDecoration(cell, flashDec);
        setTimeout(() => removeDecoration(cell, flashDec), config.get('general.flashDuration', 300));
    }
    restoreDecorationForCell(cell);
}

function checkForFinishedCells() {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) return;
    for (const cell of editor.notebook.getCells()) {
        if (cell.kind !== vscode.NotebookCellKind.Code) continue;
        const summary = cell.executionSummary;
        if (summary && summary.timing?.endTime) {
            const uri = cell.document.uri.toString();
            const lastTime = lastExecutionTimes.get(uri) ?? 0;
            if (summary.timing.endTime > lastTime) {
                handleCellFinished(cell, summary.success ?? false);
            }
        }
    }
}

// --- DECORATION UTILS ---
function restoreDecorationForEditor(editor: vscode.TextEditor) {
    if (editor.document.uri.scheme !== 'vscode-notebook-cell') return;
    
    editor.setDecorations(successBgDec, []);
    editor.setDecorations(errorBgDec, []);
    editor.setDecorations(cmdSuccessDec, []);
    editor.setDecorations(cellSuccessDec, []);
    editor.setDecorations(scratchpadDec, []);

    // Apply Scratchpad Decoration
    if (scratchpadCells.has(editor.document.uri.toString())) {
        const fullRange = new vscode.Range(0, 0, editor.document.lineCount, 0);
        editor.setDecorations(scratchpadDec, [fullRange]);
    }

    const status = cellStatusMap.get(editor.document.uri.toString());
    if (!status) return; 

    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    const range = new vscode.Range(0, 0, editor.document.lineCount, 0);
    
    if (status === 'success') {
        if (config.get('background.enable')) editor.setDecorations(successBgDec, [range]);
        if (config.get('innerBorder.persist')) editor.setDecorations(cmdSuccessDec, [range]);
        if (config.get('outerBorder.persist')) editor.setDecorations(cellSuccessDec, [range]);
    } else {
        if (config.get('background.enable')) editor.setDecorations(errorBgDec, [range]);
    }
}
function restoreDecorationForCell(cell: vscode.NotebookCell) {
    const editors = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === cell.document.uri.toString());
    for (const editor of editors) restoreDecorationForEditor(editor);
}
function restoreAllVisibleDecorations() {
    for (const editor of vscode.window.visibleTextEditors) restoreDecorationForEditor(editor);
}
function applyDecoration(cell: vscode.NotebookCell, dec: vscode.TextEditorDecorationType) {
    const editors = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === cell.document.uri.toString());
    for (const editor of editors) { const range = new vscode.Range(0, 0, editor.document.lineCount, 0); editor.setDecorations(dec, [range]); }
}
function removeDecoration(cell: vscode.NotebookCell, dec: vscode.TextEditorDecorationType) {
    const editors = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === cell.document.uri.toString());
    for (const editor of editors) editor.setDecorations(dec, []);
}
function clearAllDecorations() {
    const editors = vscode.window.visibleTextEditors;
    for (const editor of editors) {
        if (editor.document.uri.scheme === 'vscode-notebook-cell') {
            editor.setDecorations(successBgDec, []); editor.setDecorations(errorBgDec, []); editor.setDecorations(flashDec, []);
            editor.setDecorations(cmdRunningDec, []); editor.setDecorations(cmdSuccessDec, []); editor.setDecorations(cellRunningDec, []); editor.setDecorations(cellSuccessDec, []);
        }
    }
}
function disposeAllDecorations() {
    successBgDec?.dispose(); errorBgDec?.dispose(); flashDec?.dispose(); cmdRunningDec?.dispose(); cmdSuccessDec?.dispose(); cellRunningDec?.dispose(); cellSuccessDec?.dispose(); scratchpadDec?.dispose();
}
function reloadDecorations() {
    disposeAllDecorations();
    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    
    successBgDec = vscode.window.createTextEditorDecorationType({ backgroundColor: config.get('background.successColor'), isWholeLine: true });
    errorBgDec = vscode.window.createTextEditorDecorationType({ backgroundColor: config.get('background.errorColor'), isWholeLine: true });
    flashDec = vscode.window.createTextEditorDecorationType({ backgroundColor: config.get('flash.color'), isWholeLine: true });
    
    cmdRunningDec = vscode.window.createTextEditorDecorationType({ borderWidth: '1px', borderStyle: 'solid', borderColor: config.get('innerBorder.runningColor'), isWholeLine: true });
    cmdSuccessDec = vscode.window.createTextEditorDecorationType({ borderWidth: '1px', borderStyle: 'solid', borderColor: config.get('innerBorder.successColor'), isWholeLine: true });
    
    cellRunningDec = vscode.window.createTextEditorDecorationType({ borderWidth: '0 0 0 6px', borderStyle: 'solid', borderColor: config.get('outerBorder.runningColor'), isWholeLine: true });
    cellSuccessDec = vscode.window.createTextEditorDecorationType({ borderWidth: '0 0 0 6px', borderStyle: 'solid', borderColor: config.get('outerBorder.successColor'), isWholeLine: true });

    // Scratchpad Decoration
    scratchpadDec = vscode.window.createTextEditorDecorationType({
        borderStyle: config.get('scratchpad.borderStyle'),
        borderWidth: config.get('scratchpad.borderWidth'),
        borderColor: config.get('scratchpad.borderColor'),
        backgroundColor: config.get('scratchpad.backgroundColor'),
        isWholeLine: true
    });
}