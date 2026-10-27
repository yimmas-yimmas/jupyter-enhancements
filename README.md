<div align="center">
  <img src="icon.png" alt="Jupyter Enhancements icon" width="92" />

  <h1>Jupyter Enhancements</h1>

  <p><strong>Know what's running. Move through notebooks faster. Make VS Code feel more like JupyterLab.</strong></p>

  <p>Visual execution feedback · smarter cell actions · scratchpads · compact layouts</p>

  <p>
    <a href="https://marketplace.visualstudio.com/items?itemName=yimmas.jupyter-enhancements"><img alt="Visual Studio Marketplace version" src="https://img.shields.io/visual-studio-marketplace/v/yimmas.jupyter-enhancements?label=Marketplace&amp;logo=visualstudiocode" /></a>
    <a href="https://marketplace.visualstudio.com/items?itemName=yimmas.jupyter-enhancements"><img alt="Marketplace installs" src="https://img.shields.io/visual-studio-marketplace/i/yimmas.jupyter-enhancements?label=Installs" /></a>
    <a href="https://github.com/yimmas-yimmas/jupyter-enhancements/actions/workflows/verify.yml"><img alt="Build and tests" src="https://github.com/yimmas-yimmas/jupyter-enhancements/actions/workflows/verify.yml/badge.svg?branch=main" /></a>
    <a href="https://code.visualstudio.com/"><img alt="VS Code version 1.96 or newer" src="https://img.shields.io/badge/VS_Code-%E2%89%A5_1.96-007ACC?logo=visualstudiocode&amp;logoColor=white" /></a>
  </p>

  <p>
    <a href="https://marketplace.visualstudio.com/items?itemName=yimmas.jupyter-enhancements"><strong>Install from Marketplace</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/yimmas-yimmas/jupyter-enhancements">Browse source</a>
    &nbsp;·&nbsp;
    <a href="https://github.com/yimmas-yimmas/jupyter-enhancements/issues">Report an issue</a>
  </p>
</div>

---

> **Source vs. Marketplace:** This guide documents the latest code on `main`. New features become available to Marketplace users after the extension is packaged and published as a new version.

### At a glance

| See what happens | Work faster | Use less space |
|:---|:---|:---|
| 🔵 Running-cell animation | ▶️ Run Current & Below | 📐 Balanced Compact layout |
| 🟢 Success / 🔴 failure feedback | 🧪 Run selections in scratchpads | ⏱️ Native, inline, or hidden timing |
| 🟠 Debugger breakpoint highlighting | ✂️ Cell editing & clipboard tools | ⚙️ Reversible notebook preferences |

**Made for VS Code's Jupyter notebooks (`.ipynb`).** This extension complements the [Microsoft Jupyter extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter); it is not a standalone notebook kernel.

**In this guide:** [Get started](#get-started) · [Execution indicators](#execution-indicators) · [Cell toolbar](#cell-toolbar--commands) · [Scratchpads](#scratchpads) · [Debugger](#debugger-visuals) · [Compact layout](#balanced-compact-layout) · [Execution timing](#execution-time-display) · [Settings](#settings-reference) · [FAQ](#troubleshooting--faq)

## Get started

1. Install [**Jupyter Enhancements** from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yimmas.jupyter-enhancements).
2. Make sure the **Jupyter** extension is installed and your notebook has an available Python/Jupyter kernel.
3. Open a `.ipynb` file in VS Code.
4. Run a code cell. Watch its blue indicator while it runs, followed by success/error feedback.
5. Look at the **cell toolbar** (including its overflow menu) for execution, output, editing, and scratchpad actions.

> **Try this first:** Select a few lines of Python inside a notebook code cell, then press **F11** to execute that selection in a scratchpad cell.

Use **Ctrl+Shift+P** (macOS: **Cmd+Shift+P**) and search for **Jupyter Enhancements** to discover the layout and timing commands.

## Execution indicators

No need to hunt for a tiny execution icon: notebook cells give immediate visual feedback.

| State | Indicator | Meaning |
|:---|:---|:---|
| **Running** | 🔵 Animated blue border/side indicator | The cell is executing. The animation is tied to execution state—not a fixed 10-second timeout. |
| **Success** | 🟢 Green border/background; optional short flash | The cell completed successfully. |
| **Error** | 🔴 Red background | Execution reported failure. |
| **Debugger paused** | 🟠 Amber border; optional line tint | A Jupyter **Debug Cell** session stopped at a breakpoint or pause event. |

The **inner** (code-area) and **outer** (side) indicators can be enabled separately, recolored, and configured to persist after successful execution. Backgrounds and the brief success flash are also configurable.

### Run Current & Below

Choose **Run Current & Below** from the cell toolbar or cell context menu.

- Runs the current code cell and subsequent code cells **in order**.
- Skips empty and non-code cells.
- Scrolls to an executing cell **when it moves outside the viewport**, without forcing notebook edit mode or changing your text selection.
- Stops the sequence if a cell execution reports failure.

**Output visibility:** Scrolling follows the **running code cell**, not a growing output area. A large table or plot may extend below the screen.

### Run & Select Next

Choose **Run & Select Next** to execute the current cell and move selection to the next cell. This uses VS Code's native notebook action.

## Cell toolbar & commands

The extension adds commands to the **Jupyter notebook cell toolbar**. Depending on available width and your VS Code settings, some icons may appear under **… (More Actions)**. Several commands are also available by right-clicking a cell or opening the Command Palette.

| Action | What it does |
|:---|:---|
| **Run Current & Below** | Execute this cell and following code cells sequentially. |
| **Run & Select Next** | Execute and select the next cell. |
| **Run Selection in Scratchpad (Above / Below)** | Execute selected code—or the source cell's code—in a nearby scratchpad. |
| **Toggle Output** | Collapse or expand the cell output. |
| **Clear Cell Output** | Remove the cell's existing output. |
| **Split Cell at Cursor** | Split a code cell at the caret. |
| **Merge Cells** | Merge selected cells (or the current cell with the next one). |
| **Move Cell Up / Down** | Reorder cells. |
| **Copy Cell / Cut Cell / Paste Cell** | Work with cells using notebook clipboard actions. |
| **Duplicate Cell (Copy Down)** | Create a copy below the current cell. |

These are **not** changes to Python syntax or kernel execution semantics; they are notebook/editor commands. All code cells remain editable in the normal VS Code editor.

## Scratchpads

Scratchpads are useful for checking variables, testing a short expression, or exploring data without rewriting your original code cell.

**Run a selection**

1. Click inside a notebook **code cell** and select the code to test.
2. Press **F11**, or choose **Run Selection in Scratchpad** from the editor/context menu.
3. The extension creates or updates an adjacent scratchpad cell and runs the selected code.

**Run above or below**

- Use **Run Selection in Scratchpad (Above)** or **(Below)** from the cell toolbar.
- The `jupyterEnhancements.scratchpad.insertPosition` preference sets the default insertion side when a side isn't explicitly chosen.
- Scratchpad cells have a distinctive **dashed border** by default (style, width, and color are customizable).

If you use a cell-toolbar Above/Below action without a text selection, it uses that cell's code. Scratchpads are regular notebook cells—not an isolated Python environment—so code runs against the selected kernel.

## Debugger visuals

While using Jupyter's **Debug Cell** feature, execution highlighting follows debugger events:

**🔵 Running → 🟠 Paused at breakpoint → 🔵 Continue / Step → Finished**

- When the debugger pauses, the relevant notebook cell gets an **amber border**.
- The paused line receives a subtle tint **only when the debugger reports a source location matching that notebook cell**. Source locations in external Python files aren't guessed.
- The visual indicator is cleared when debugging ends.

The implementation observes debug adapter events; it **does not** animate the exact Python statement currently executing during an ordinary cell run. Breakpoints, stepping, and kernel debug support still depend on VS Code's Jupyter/Python debugging tools.

## Balanced Compact layout

Want a denser, JupyterLab-inspired notebook without losing your cell toolbar or visual indicators?

**Enable it:** Open the Command Palette and run **Jupyter Enhancements: Enable Balanced Compact Notebook Layout**.

**Undo it:** Run **Jupyter Enhancements: Restore Previous Notebook Layout**.

Or open **Settings → Extensions → Jupyter Enhancements** and choose **Layout Profile → Balanced Compact** or **Standard**.

| Feature | Standard | Balanced Compact |
|:---|:---|:---|
| Layout | Your existing VS Code notebook settings | Native compact notebook view |
| Code typography | Your existing values | 13px font, 19px line height |
| Output typography | Your existing values | 12px font, 18px line height |
| Insert-cell toolbar | Your existing placement | Notebook toolbar |
| Cell toolbar | Preserved | **Preserved** |
| Running/debug indicators | Preserved | **Preserved** |
| Native cell status row | Your existing setting | `visibleAfterExecute` when execution-time mode is **Native** |

Balanced Compact uses **supported VS Code notebook settings**, not injected CSS. It cannot control every internal pixel of notebook cell padding or precisely reproduce JupyterLab.

**Reversible by design:** The extension saves notebook **user-level** values before changing them, remembers them across restarts, and restores settings it still owns when Standard is selected. It avoids undoing later manual edits. Workspace or folder overrides can take precedence. **Restore your preferred layout before uninstalling** if you want these user-level changes reverted.

> If you previously enabled `jupyterEnhancements.layout.enableCompactView`, that legacy setting remains recognized for compatibility. New setups should use `jupyterEnhancements.layout.profile` instead.

## Execution-time display

Choose exactly how much execution information each cell shows:

| Mode | Native status row | Inline code indicator | Ideal for |
|:---|:---:|:---:|:---|
| **Native** (default) | ✅ | — | VS Code's normal execution-time/status UI |
| **Compact** | Hidden | ✅ | Seeing status and duration **without adding a separate row** |
| **Hidden** | Hidden | — | Minimal notebook chrome (colored indicators still work) |

**Switch instantly:** **Ctrl+Shift+P** → **Jupyter Enhancements: Choose Execution Time Display** → **Native status bar**, **Compact indicator**, or **Hidden**.

You can also select `executionTime.display` in Jupyter Enhancements settings.

Compact renders an editor decoration **after the first nonempty code line**—for example, `● Running · 2.40s`, `✓ 420ms`, or `✕ 500ms`. It **does not edit source code**, place a new status row, or steal cursor focus. Long lines can push the label farther right. Some kernels do not provide usable timing timestamps; the extension shows the known state instead of fabricating a duration.

**Layout and timing are independent.** A popular combination is **Balanced Compact + Compact execution time**. Switching back to Native restores the applicable native status-bar behavior; explicit workspace or user preferences may need review if they conflict.

### Quick settings example

Open **Preferences: Open User Settings (JSON)** and add these properties to your existing settings object:

```json
{
  "jupyterEnhancements.layout.profile": "balancedCompact",
  "jupyterEnhancements.executionTime.display": "compact"
}
```

To return to native execution timing, change `compact` to `native`. To return to your original notebook layout, set `layout.profile` to `standard` (or use the restore command).

## Settings reference

Search **Jupyter Enhancements** in VS Code Settings. Keys below are shown in full so you can paste them into `settings.json`.

### Layout, execution, and debugger

| Setting | Default | Purpose |
|:---|:---|:---|
| `jupyterEnhancements.layout.profile` | `standard` | `standard` or `balancedCompact` |
| `jupyterEnhancements.executionTime.display` | `native` | `native`, `compact`, or `hidden` |
| `jupyterEnhancements.debug.enable` | `true` | Enable blue/amber debugger visuals |
| `jupyterEnhancements.debug.pausedBorderColor` | `#E5A000` | Paused-cell border |
| `jupyterEnhancements.debug.pausedLineColor` | `#E5A00033` | Matching paused-line tint |

### Running, success, and error visuals

| Setting | Default | Purpose |
|:---|:---|:---|
| `jupyterEnhancements.innerBorder.enable` | `true` | Show a border around the running code area |
| `jupyterEnhancements.innerBorder.persist` | `false` | Keep inner border after success |
| `jupyterEnhancements.innerBorder.runningColor` | `#0078FF` | Inner running color |
| `jupyterEnhancements.innerBorder.successColor` | `#006400` | Inner success color |
| `jupyterEnhancements.outerBorder.enable` | `true` | Show outer running indicator |
| `jupyterEnhancements.outerBorder.position` | `left` | `left`, `right`, `top`, or `bottom` |
| `jupyterEnhancements.outerBorder.thickness` | `6px` | Outer indicator width |
| `jupyterEnhancements.outerBorder.persist` | `true` | Keep outer indicator after success |
| `jupyterEnhancements.outerBorder.runningColor` | `#0078FF` | Outer running color |
| `jupyterEnhancements.outerBorder.successColor` | `#006400` | Outer success color |
| `jupyterEnhancements.background.enable` | `true` | Enable success/error backgrounds |
| `jupyterEnhancements.background.successColor` | `#90EE9033` | Success background |
| `jupyterEnhancements.background.errorColor` | `#FF000033` | Failure background |
| `jupyterEnhancements.flash.enable` | `true` | Brief flash on success |
| `jupyterEnhancements.flash.color` | `#FFFF0066` | Success flash color |
| `jupyterEnhancements.general.flashDuration` | `300` | Flash duration in milliseconds |

### Scratchpad

| Setting | Default | Purpose |
|:---|:---|:---|
| `jupyterEnhancements.scratchpad.insertPosition` | `below` | Default: `above` or `below` |
| `jupyterEnhancements.scratchpad.borderStyle` | `dashed` | `solid` / `dashed` / `dotted` / `double` / `groove` |
| `jupyterEnhancements.scratchpad.borderWidth` | `0.5px` | Scratchpad border width |
| `jupyterEnhancements.scratchpad.borderColor` | `#80808080` | Scratchpad border color |
| `jupyterEnhancements.scratchpad.backgroundColor` | `#FFFFFF0D` | Scratchpad cell tint |

**Advanced / legacy:** `jupyterEnhancements.kernel.optimizeStartup` is **off** by default; enabling it changes the global Python terminal-environment-activation preference. The older `layout.enableCompactView` setting is deprecated in favor of `layout.profile`. Some legacy settings remain exposed in the extension manifest for compatibility; for example, `kernel.pythonPath` and `layout.hideCellToolbar` are **not currently applied by the extension's code** and should not be relied upon.

### Keybinding

| Keys | Context | Action |
|:---|:---|:---|
| **F11** | Text editor focused inside a notebook | Run selected code in a scratchpad |

Use **Keyboard Shortcuts** in VS Code to remap the shortcut if F11 conflicts with another command on your system.

## Troubleshooting & FAQ

<details>
<summary><strong>Compact or Hidden is selected, but a separate execution-information row remains</strong></summary>

1. Open **Preferences: Open User Settings (JSON)** and check that `notebook.showCellStatusBar` is `"hidden"`, with no duplicate entries.
2. Open your workspace's `.vscode/settings.json` and check for an override of the same setting.
3. Also check whether `notebook.cellExecutionTimeVerbosity` is set to `"verbose"`—that setting controls the detail of native timing text but **does not itself hide the row**.
4. Use **Developer: Reload Window**, then reopen the notebook.

The layout manager attempts to honor user/workspace overrides, but another extension or a conflicting setting can affect the rendered notebook UI.

</details>

<details>
<summary><strong>Compact timing text is missing, or no duration appears</strong></summary>

Make sure `jupyterEnhancements.executionTime.display` is `"compact"` and run a notebook code cell. Timing depends on execution information reported by VS Code's notebook provider. If a duration isn't available, the extension won't invent one. The inline text appears after the first nonempty source line and may be off-screen horizontally when that line is long.

</details>

<details>
<summary><strong>F11 doesn't run my selection</strong></summary>

Click directly inside the editor of a **Jupyter code cell**, select nonempty code, and try again. You can also select **Run Selection in Scratchpad** from the editor context menu. F11 may be intercepted by a conflicting keybinding.

</details>

<details>
<summary><strong>Some toolbar buttons are missing</strong></summary>

Check the cell toolbar's **…** overflow menu and ensure you're working in a Jupyter `.ipynb` notebook. The visible number of buttons depends on window width and VS Code's notebook toolbar configuration.

</details>

<details>
<summary><strong>Debugger highlighting isn't showing</strong></summary>

Use Jupyter's **Debug Cell** with a working debugger-capable kernel and enable `jupyterEnhancements.debug.enable`. Amber pause indicators depend on debugger events, and exact paused-line tinting requires a source location that matches the cell.

</details>

<details>
<summary><strong>How do I restore my previous notebook appearance?</strong></summary>

Run **Jupyter Enhancements: Restore Previous Notebook Layout**, then choose **Native status bar** in **Choose Execution Time Display**. The extension restores previously saved settings it still controls and leaves manually modified values alone. Do this before uninstalling if you want to reverse profile changes.

</details>

## For contributors

The repository uses TypeScript and VS Code's stable extension API. To try the source in an **Extension Development Host**:

```bash
npm ci
npm run compile
```

Press **F5** in VS Code to open the development host. To run the fast, VS Code-independent state tests:

```bash
node --test tests/*.test.cjs
```

Key files: `src/extension.ts` (notebook commands and visuals), `src/notebookLayout.ts` (reversible VS Code preferences), `src/executionTiming.ts` (inline timing), `src/executionState.ts` / `src/debugVisualState.ts` (state transitions), and `tests/` (regressions).

For changes, issues, and suggestions, visit [GitHub Issues](https://github.com/yimmas-yimmas/jupyter-enhancements/issues).

---

<div align="center">

**A little less notebook clutter. A lot more clarity.**

[Marketplace](https://marketplace.visualstudio.com/items?itemName=yimmas.jupyter-enhancements) · [Source](https://github.com/yimmas-yimmas/jupyter-enhancements) · [Issues](https://github.com/yimmas-yimmas/jupyter-enhancements/issues)

<sub>Built for notebook workflows in VS Code · Maintained by Yimmas</sub>

</div>
