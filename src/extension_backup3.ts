import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// --- CONFIG ---
const FAST_KERNEL_NAME = "fast_jlab_v4"; // New version
const FAST_KERNEL_DISPLAY = "Fast JLab (Instant)";

// --- STATE ---
let output: vscode.OutputChannel;
let extensionContext: vscode.ExtensionContext;
let singleHijack: vscode.Disposable | undefined;
let allHijack: vscode.Disposable | undefined;

// --- DECORATION TYPES ---
let successBgDec: vscode.TextEditorDecorationType;
let errorBgDec: vscode.TextEditorDecorationType;
let flashDec: vscode.TextEditorDecorationType;
let cmdRunningDec: vscode.TextEditorDecorationType;
let cmdSuccessDec: vscode.TextEditorDecorationType;
let cellRunningDec: vscode.TextEditorDecorationType;
let cellSuccessDec: vscode.TextEditorDecorationType;
let scratchpadDec: vscode.TextEditorDecorationType;

const cellStatusMap = new Map<string, 'success' | 'error'>();
const lastExecutionTimes = new Map<string, number>();
const activeAnimations = new Map<string, () => void>();
const scratchpadCells = new Set<string>(); 
const sourceToScratchpadMap = new Map<string, string>(); 

function log(message: string) {
    const now = new Date();
    const time = now.toISOString().split('T')[1].replace('Z', ''); 
    output.appendLine(`[${time}] ${message}`);
}

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    output = vscode.window.createOutputChannel("Jupyter Enhancements");
    output.show(true);
    log("[INFO] Jupyter Enhancements Activated (vMetadataStrip).");

    reloadDecorations();
    updateLayoutSettings(); 

    // Setup Kernel
    setTimeout(() => enforceKernelSettings(), 1000);

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('jupyterEnhancements')) {
            reloadDecorations();
            updateLayoutSettings();
            enforceKernelSettings(); 
        }
    }));

    context.subscriptions.push(vscode.window.onDidChangeActiveNotebookEditor(editor => {
        if (editor) setTimeout(() => forceFastKernelMetadata(editor), 1500);
    }));

    const pollInterval = setInterval(checkForFinishedCells, 200);
    context.subscriptions.push({ dispose: () => clearInterval(pollInterval) });

    const notebooksAny = vscode.notebooks as any;
    if (notebooksAny && typeof notebooksAny.onDidChangeNotebookCellExecutionState === 'function') {
        context.subscriptions.push(notebooksAny.onDidChangeNotebookCellExecutionState((e: any) => {
            handleExecutionStateChange(e);
        }));
    }

    registerHijacks();
    registerCommands(context);
}

function registerCommands(context: vscode.ExtensionContext) {
    const register = (id: string, handler: (args: any) => any) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };
    register('jupyter-enhancements.execute', (args) => runSequenceHandler('below', args));
    register('jupyter-enhancements.runInScratchpad', runScratchpadHandler);
    register('jupyter-enhancements.forceKernel', enforceKernelSettings);
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

// =========================================================
// --- KERNEL LOGIC (STRIPPED METADATA) ---
// =========================================================

async function enforceKernelSettings() {
    log("--- [Kernel] Enforce Start ---");

    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    const rawPath = config.get<string>('kernel.pythonPath', '').trim();

    if (!rawPath) {
        log("[Kernel] No custom path set. Skipping.");
        return;
    }

    await createFastKernelSpec(rawPath);

    // Awaken Extensions
    try {
        const pythonExt = vscode.extensions.getExtension('ms-python.python');
        const jupyterExt = vscode.extensions.getExtension('ms-toolsai.jupyter');
        if (pythonExt && !pythonExt.isActive) await pythonExt.activate();
        if (jupyterExt && !jupyterExt.isActive) await jupyterExt.activate();
    } catch (e) { log(`[Kernel] Ext Activation Error: ${e}`); }

    if (vscode.window.activeNotebookEditor) {
        setTimeout(() => forceFastKernelMetadata(vscode.window.activeNotebookEditor!), 2000);
    }

    log("--- [Kernel] Enforce End ---");
}

async function createFastKernelSpec(rawPythonPath: string) {
    try {
        // Paths
        let kernelDir = '';
        if (process.platform === 'win32') {
            kernelDir = path.join(process.env.APPDATA || '', 'jupyter', 'kernels');
        } else {
            kernelDir = path.join(os.homedir(), '.local', 'share', 'jupyter', 'kernels');
        }

        if (!fs.existsSync(kernelDir)) fs.mkdirSync(kernelDir, { recursive: true });

        const myKernelDir = path.join(kernelDir, FAST_KERNEL_NAME);
        const kernelFile = path.join(myKernelDir, 'kernel.json');

        // Clean Old
        const oldDir1 = path.join(kernelDir, 'fast_jlab_direct');
        if (fs.existsSync(oldDir1)) try { fs.rmSync(oldDir1, { recursive: true, force: true }); } catch(e){}

        // Normalize Python Path
        let pythonExe = rawPythonPath;
        if (process.platform === 'win32') {
            // Capitalize Drive Letter (Crucial for VS Code id matching)
            pythonExe = pythonExe.replace(/^[a-z]:/, (c) => c.toUpperCase());
            // Use Backslashes for ARGV (Standard Windows Path)
            pythonExe = pythonExe.replace(/\//g, '\\');
        }

        // Construct Env Vars
        let envVars: any = {};
        if (process.platform === 'win32') {
            // Use forward slashes for env var string to allow JSON stringify without escaping hell
            const envDir = path.dirname(rawPythonPath).replace(/\\/g, '/');
            
            const condaPaths = [
                envDir,
                `${envDir}/Library/mingw-w64/bin`,
                `${envDir}/Library/usr/bin`,
                `${envDir}/Library/bin`,
                `${envDir}/Scripts`,
                `${envDir}/bin`
            ];
            
            // Minimal System Paths
            const winPaths = [
                "C:/Windows/system32",
                "C:/Windows",
                "C:/Windows/System32/Wbem",
                "C:/Windows/System32/WindowsPowerShell/v1.0/"
            ];

            envVars["PATH"] = [...condaPaths, ...winPaths].join(';');
        }

        // --- THE FIX: Minimal Metadata ---
        // By removing "vscode" and "originalDisplayName" from metadata,
        // we prevent the Python extension from 'claiming' and validating this kernel.
        const kernelContent = {
            display_name: FAST_KERNEL_DISPLAY,
            language: "python", // Standard language
            argv: [
                pythonExe, 
                "-m", 
                "ipykernel_launcher", 
                "-f", 
                "{connection_file}"
            ],
            env: envVars,
            interrupt_mode: "message", // Helpful for stability
            metadata: {
                debugger: true
                // INTENTIONALLY EMPTY: No "vscode" field here!
            }
        };

        const contentString = JSON.stringify(kernelContent, null, 2);

        // Write
        if (!fs.existsSync(myKernelDir)) fs.mkdirSync(myKernelDir, { recursive: true });
        fs.writeFileSync(kernelFile, contentString);
        
        log(`[Kernel] Spec written to: ${kernelFile}`);
        log(`[Debug] JSON: \n${contentString}`);

    } catch (e) {
        log(`[Kernel] Error creating spec: ${e}`);
    }
}

async function forceFastKernelMetadata(editor: vscode.NotebookEditor) {
    if (editor.notebook.notebookType !== 'jupyter-notebook') return;
    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    if (!config.get<boolean>('kernel.optimizeStartup', true)) return;

    const metadata = editor.notebook.metadata;
    const currentName = metadata?.kernelspec?.name;

    if (currentName === FAST_KERNEL_NAME) return;

    log(`[Kernel] Switching Metadata: ${currentName} -> ${FAST_KERNEL_NAME}`);

    const newMetadata = {
        ...metadata,
        kernelspec: {
            display_name: FAST_KERNEL_DISPLAY,
            language: "python",
            name: FAST_KERNEL_NAME
        }
    };

    const edit = new vscode.WorkspaceEdit();
    edit.set(editor.notebook.uri, [
        vscode.NotebookEdit.updateNotebookMetadata(newMetadata)
    ]);

    await vscode.workspace.applyEdit(edit);
    log(`[Kernel] Auto-Switch Applied.`);
}

// =========================================================
// --- UTILS & HANDLERS ---
// =========================================================

function updateLayoutSettings() {
    const config = vscode.workspace.getConfiguration('jupyterEnhancements');
    const vscodeConfig = vscode.workspace.getConfiguration();
    
    // Compact View
    const enableCompact = config.get<boolean>('layout.enableCompactView', false);
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
        for (const [key, value] of Object.entries(compactSettings)) {
            if (vscodeConfig.get(key) !== value) {
                vscodeConfig.update(key, value, vscode.ConfigurationTarget.Global);
            }
        }
    } else {
        for (const [key, value] of Object.entries(compactSettings)) {
            if (vscodeConfig.get(key) === value) {
                vscodeConfig.update(key, undefined, vscode.ConfigurationTarget.Global);
            }
        }
    }

    // Toolbar Hide
    const hideToolbar = config.get<boolean>('layout.hideCellToolbar', false);
    const toolbarKey = "notebook.cellToolbarLocation";
    const currentToolbar = vscodeConfig.get(toolbarKey);

    if (hideToolbar) {
        if (JSON.stringify(currentToolbar) !== JSON.stringify({ "default": "hidden" })) {
            vscodeConfig.update(toolbarKey, { "default": "hidden" }, vscode.ConfigurationTarget.Global);
        }
    } else {
        if (JSON.stringify(currentToolbar) === JSON.stringify({ "default": "hidden" })) {
            vscodeConfig.update(toolbarKey, { "default": "right" }, vscode.ConfigurationTarget.Global);
        }
    }
}

function registerHijacks() {
    singleHijack?.dispose();
    allHijack?.dispose();

    singleHijack = vscode.commands.registerCommand('notebook.cell.execute', async (args) => {
        await runSingleHandler(args);
    });
    extensionContext.subscriptions.push(singleHijack);

    allHijack = vscode.commands.registerCommand('notebook.execute', async (args) => {
        await runSequenceHandler('all', args);
    });
    extensionContext.subscriptions.push(allHijack);
}

const runScratchpadHandler = async () => {
    const activeTextEditor = vscode.window.activeTextEditor;
    const notebookEditor = vscode.window.activeNotebookEditor;

    if (!notebookEditor || !activeTextEditor) {
        vscode.window.showErrorMessage("Focus a code cell first.");
        return;
    }

    const selection = activeTextEditor.selection;
    let text = activeTextEditor.document.getText(selection).trim();

    if (!text) {
        vscode.window.showInformationMessage("No code selected.");
        return;
    }

    const notebook = notebookEditor.notebook;
    const sourceCell = notebook.getCells().find(c => c.document.uri.toString() === activeTextEditor.document.uri.toString());
    
    if (!sourceCell) { log("[ERROR] Source cell not found."); return; }

    const sourceUri = sourceCell.document.uri.toString();
    
    let scratchpadCell: vscode.NotebookCell | undefined;
    const existingScratchpadUri = sourceToScratchpadMap.get(sourceUri);

    if (existingScratchpadUri) {
        scratchpadCell = notebook.getCells().find(c => c.document.uri.toString() === existingScratchpadUri);
    }

    if (scratchpadCell) {
        log(`[Scratchpad] Update cell.`);
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(0, 0, scratchpadCell.document.lineCount + 1, 0); 
        edit.replace(scratchpadCell.document.uri, fullRange, text);
        await vscode.workspace.applyEdit(edit);
    } else {
        log(`[Scratchpad] New cell.`);
        const insertIndex = sourceCell.index + 1;
        const cellData = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, text, sourceCell.document.languageId || "python");
        const edit = new vscode.WorkspaceEdit();
        const notebookEdit = vscode.NotebookEdit.insertCells(insertIndex, [cellData]);
        edit.set(notebook.uri, [notebookEdit]);
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) return;
        scratchpadCell = notebook.cellAt(insertIndex);
        sourceToScratchpadMap.set(sourceUri, scratchpadCell.document.uri.toString());
        scratchpadCells.add(scratchpadCell.document.uri.toString());
    }

    if (scratchpadCell) {
        restoreDecorationForCell(scratchpadCell);
        const sourceRange = new vscode.NotebookRange(sourceCell.index, sourceCell.index + 1);
        singleHijack?.dispose(); 

        try {
            const executionTask = vscode.commands.executeCommand('notebook.cell.execute', { 
                ranges: [{ start: scratchpadCell.index, end: scratchpadCell.index + 1 }], 
                notebookUri: notebook.uri 
            });

            notebookEditor.selections = [sourceRange];
            notebookEditor.revealRange(sourceRange, vscode.NotebookEditorRevealType.AtTop);
            
            await vscode.window.showTextDocument(sourceCell.document, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false });
            await executionTask;
        } catch (e) {
            log(`[Scratchpad] Execution failed: ${e}`);
        } finally {
            registerHijacks(); 
        }

        notebookEditor.selections = [sourceRange];
        notebookEditor.revealRange(sourceRange, vscode.NotebookEditorRevealType.AtTop);
    }
};

const runSingleHandler = async (args?: any) => {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) return;

    let cell: vscode.NotebookCell | undefined;
    if (args && args.document) { cell = args; } 
    else if (editor.selections.length > 0) { cell = editor.notebook.cellAt(editor.selections[0].start); }

    if (cell) {
        log(`[Single] Processing Cell ${cell.index}`);
        
        cellStatusMap.delete(cell.document.uri.toString());
        restoreDecorationForCell(cell);

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
        } catch (e) { log(`[ERROR] Native run failed: ${e}`); } 
        finally { registerHijacks(); }
        
        stopAnim();
        handleCellFinished(cell, cell.executionSummary?.success ?? false);

        if (nextIndex < editor.notebook.cellCount) {
            const nextRange = new vscode.NotebookRange(nextIndex, nextIndex + 1);
            editor.selections = [nextRange];
            editor.revealRange(nextRange, vscode.NotebookEditorRevealType.InCenterIfOutsideViewport);
        }
    }
};

const runSequenceHandler = async (mode: 'below' | 'above' | 'all', args?: any) => {
    log(`[Sequence] Mode: ${mode}`);
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) return;

    const notebook = editor.notebook;
    let loopStart = 0; let loopEnd = notebook.cellCount;
    let anchorIndex = editor.selections[0]?.start ?? 0;

    if (args && args.document) anchorIndex = args.index;

    if (mode === 'all') {
        loopStart = 0; loopEnd = notebook.cellCount;
        cellStatusMap.clear(); clearAllDecorations();
    } else if (mode === 'below') {
        loopStart = anchorIndex; loopEnd = notebook.cellCount;
        if (anchorIndex === 0) { cellStatusMap.clear(); clearAllDecorations(); }
    } else {
        loopStart = 0; loopEnd = anchorIndex + 1;
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

            log(`[Sequence] Running Cell ${i}`);
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

            if (!success) break;
        }
    } finally {
        registerHijacks();
    }
};

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
        }).then(undefined, (err) => { log(`[ERROR] Exec failed: ${err}`); });
    });
}

// --- VISUAL LOGIC ---

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
    if (!editor.selection.isEmpty) return;

    editor.setDecorations(successBgDec, []);
    editor.setDecorations(errorBgDec, []);
    editor.setDecorations(cmdSuccessDec, []);
    editor.setDecorations(cellSuccessDec, []);
    editor.setDecorations(scratchpadDec, []);

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

    scratchpadDec = vscode.window.createTextEditorDecorationType({
        borderStyle: config.get('scratchpad.borderStyle'),
        borderWidth: config.get('scratchpad.borderWidth'),
        borderColor: config.get('scratchpad.borderColor'),
        backgroundColor: config.get('scratchpad.backgroundColor'),
        isWholeLine: true
    });
}