<div align="center">

# ⚡ Jupyter Enhancements ⚡

**Supercharge your VS Code Jupyter Notebooks with visual feedback, smart execution controls, and a power-user toolbar.**

[![Version](https://img.shields.io/visual-studio-marketplace/v/yimmas.jupyter-enhancements)](https://marketplace.visualstudio.com/items?itemName=yimmas.jupyter-enhancements)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/yimmas.jupyter-enhancements)](https://marketplace.visualstudio.com/items?itemName=yimmas.jupyter-enhancements)
[![License](https://img.shields.io/github/license/yimmas-yimmas/jupyter-enhancements)](https://github.com/yimmas-yimmas/jupyter-enhancements)

</div>

---

## 🚀 Overview

**Jupyter Enhancements** transforms the standard Jupyter experience in VS Code. It adds immediate visual cues (flashes, borders, backgrounds) so you know exactly which cell is running, which failed, and which succeeded.

It also introduces a **"Power Toolbar"** floating over your cells, giving you one-click access to splitting, merging, scratchpads, and clipboard operations that are usually hidden in sub-menus.

## ✨ Key Features

### 1. 🎨 Visual Feedback System
Never guess the state of your cells again.
*   **Running:** A distinct **Blue Border** (customizable thickness and position) appears while code executes.
*   **Success:** A brief **Yellow Flash** and a persistent **Green Border/Background** confirms execution.
*   **Error:** A **Red Background** immediately highlights failed cells.
*   **Debug Cell:** A pulsing **Blue Border** follows the debugged notebook cell until a breakpoint; an **Amber Border** marks a paused debugger. Continue or Step resumes blue. If the debugger identifies a matching notebook-cell source, the paused line receives a subtle amber tint.

### 2. 🛠️ The "Power Toolbar"
A floating menu appears on the active cell with essential tools sorted for speed:
*   ▶️ **Run & Select Next:** Execute and immediately move to the next cell.
*   ✂️ **Split & Merge:** Split a cell at the cursor or merge with the one below instantly.
*   🗑️ **Clear Output:** Instantly wipe the output of the current cell.
*   🧪 **Scratchpad:** Run the selected text in a new temporary cell (Above or Below) without breaking your flow.
*   👁️ **Toggle Output:** Collapse/Expand cell output.
*   ⬆️⬇️ **Move & Copy:** Move cells up/down, copy, paste, or duplicate with one click.

### 3. 🧪 Smart Scratchpad
Need to debug a variable without adding a mess to your notebook?
*   Highlight code -> Press `F11` (or use the toolbar).
*   It executes in a temporary "Scratchpad" cell with a dashed border.
*   Perfect for quick data inspection.

### 4. ⚡ Performance & Layout
*   **Balanced Compact Layout:** JupyterLab-inspired notebook density using native VS Code settings; keeps all cell toolbar actions and colored running/debugging effects, and restores previous user settings when turned off.
*   **Optimized Startup:** Skips unnecessary terminal activation steps for faster kernel loading on Windows/Conda.

---

## ⚙️ Configuration & Settings

You can customize almost every aspect of this extension in **File > Preferences > Settings** (search for `Jupyter Enhancements`).

### 🎨 Visual Customization
| Setting | Default | Description |
| :--- | :--- | :--- |
| `flash.enable` | `true` | Enable the flash effect on success. |
| `flash.color` | `#FFFF0066` | Color of the success flash. |
| `flashDuration` | `300` | How long the flash lasts (ms). |
| `background.enable` | `true` | Enable background tints for Success/Error. |
| `outerBorder.enable` | `true` | Enable the thick indicator bar on the side. |
| `outerBorder.position`| `left` | Position of the bar (left, right, top, bottom). |
| `outerBorder.persist` | `true` | Keep the green bar visible after success. |

### 🐞 Jupyter Debugger Settings
| Setting | Default | Description |
| :--- | :--- | :--- |
| `debug.enable` | `true` | Show blue running and amber paused visuals for Jupyter **Debug Cell** sessions. |
| `debug.pausedBorderColor` | `#E5A000` | Border color while the debugger is stopped. |
| `debug.pausedLineColor` | `#E5A00033` | Subtle tint for a paused line **only when the source maps to that notebook cell**. |

These debug visuals depend on Jupyter's Debug Adapter Protocol events. They don't step through arbitrary Python statements during normal notebook execution; output visibility and ordinary editor selection are unchanged.

### 🧪 Scratchpad Settings
| Setting | Default | Description |
| :--- | :--- | :--- |
| `scratchpad.insertPosition` | `below` | Where to spawn the scratchpad (`above` or `below`). |
| `scratchpad.borderStyle` | `dashed` | Style of the scratchpad cell border. |
| `scratchpad.borderColor` | `#80808080` | Color of the scratchpad border. |

### ⏱️ Execution-time display (optional)

Use **Settings → Jupyter Enhancements: Execution Time Display** or Command Palette:
**Jupyter Enhancements: Choose Execution Time Display**.

| Display | Behavior |
| :--- | :--- |
| **Native** (default) | Keep the normal VS Code cell status bar, including execution timing. Balanced Compact uses `visibleAfterExecute` as before. |
| **Compact** | Hide the extra status-bar row; append a subtle execution status and duration at the end of the **first nonempty code line**. Running durations update about every 500 ms; completed durations use Jupyter execution timestamps where available. |
| **Hidden** | Hide the native cell status bar and all inline timing text. Existing running/success/error/debug borders remain active. |

**Compact** uses a native VS Code text-editor decoration, not source-code edits, toolbar changes, CSS injection or an extra row. Very long code lines may place the indicator farther to the right (the VS Code API doesn't guarantee positioning at the cell's top-right edge). Execution timing may be unavailable for some kernels; the indicator will show the cell's reported state without inventing an elapsed time.

The extension remembers the previous user-global `notebook.showCellStatusBar` value. Switching back to Native restores the user's original status-bar preference when Standard layout is selected, or uses Balanced Compact's normal `visibleAfterExecute` behavior while Balanced Compact remains active. Manually changed settings are not overwritten. Workspace-specific status-bar settings can override user settings.

### 📐 Balanced Compact — Reversible notebook layout

1. In VS Code 1.142.0 open **Settings** and search for `Jupyter Enhancements: Layout Profile`, then select **Balanced Compact**.
2. Alternatively, use Command Palette: **Jupyter Enhancements: Enable Balanced Compact Notebook Layout**.
3. To undo, select **Standard** or run **Jupyter Enhancements: Restore Previous Notebook Layout**.

The profile changes the following user notebook preferences when execution-time display is set to **Native** (the default):

| Notebook setting | Balanced Compact |
| :--- | :--- |
| `notebook.compactView` | `true` |
| `notebook.insertToolbarLocation` | `notebookToolbar` |
| `notebook.showCellStatusBar` | `visibleAfterExecute` |
| `notebook.editorOptionsCustomizations.editor.fontSize` | `13` |
| `notebook.editorOptionsCustomizations.editor.lineHeight` | `19` |
| `notebook.output.fontSize` | `12` |
| `notebook.output.lineHeight` | `18` |

The restore action remembers existing **user** notebook preferences, removes previously absent overrides, and preserves unrelated editor customizations and later manual edits. The snapshot is retained across VS Code restarts. Enable the profile intentionally; it changes **user-global** notebook settings for all VS Code notebooks (unless a workspace overrides them). Use **Restore Previous Notebook Layout before uninstalling** if you want to revert the settings.

This is the tightest layout reliably exposed by standard VS Code notebook APIs; exact cell-container padding and JupyterLab spacing are not configurable without unsupported UI/CSS injection. Cell title toolbars, Run/Copy/Paste actions, selection behavior, execution animations and debugger decorations are not changed.

### 🖥️ Layout & Kernel
| Setting | Default | Description |
| :--- | :--- | :--- |
| `layout.profile` | `standard` | Choose `balancedCompact` for tighter notebooks, or `standard` to restore previous preferences. |
| `executionTime.display` | `native` | `native` / `compact` / `hidden`; status-bar preferences are reversible. |
| `layout.enableCompactView` | `false` | Deprecated alias for Balanced Compact if `layout.profile` is not explicitly set. |
| `layout.hideCellToolbar` | `false` | Hides the default floating toolbar if you prefer a clean look. |
| `kernel.optimizeStartup` | `true` | Speeds up startup on Windows/Conda environments. |

---

## 🎨 Default Color Reference

If you want to revert your customizations to the original vibrant theme, here are the default hex codes:

**Status Colors:**
*   **Success Background:** `#90EE9033` (Light Green, Transparent)
*   **Error Background:** `#FF000033` (Red, Transparent)
*   **Success Flash:** `#FFFF0066` (Yellow, Semi-transparent)

**Borders (Indicators):**
*   **Running Color:** `#0078FF` (Vibrant Blue)
*   **Success Color:** `#006400` (Dark Green)
*   **Scratchpad Border:** `#80808080` (Grey, Semi-transparent)

---

## ⌨️ Commands & Keybindings

| Command | Keybinding | Action |
| :--- | :--- | :--- |
| `Run Selection in Scratchpad` | `F11` | Runs selected text in a new temp cell. |
| `Run Current & Below` | - | Runs the active cell and all cells below it. |
| `Run & Select Next` | - | Standard Jupyter execution behavior. |
| `Split Cell at Cursor` | - | Splits the cell at your cursor position. |
| `Merge Cells` | - | Merges current cell with the one below. |

---

## 📥 Installation

1.  Open **VS Code**.
2.  Go to the **Extensions** view (`Ctrl+Shift+X`).
3.  Search for **"Jupyter Enhancements"**.
4.  Click **Install**.
5.  Open any `.ipynb` file to see the new toolbar and effects!
6. Optional but Recommended : Ctrl + Shift + P +  >Developer:Relaod Window 

---

**Enjoy a faster, more visual Jupyter experience!**  
*Maintained by Yimmas*