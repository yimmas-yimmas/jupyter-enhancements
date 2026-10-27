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
*   **Compact View:** Optional tight layout with verbose timing and line numbers.
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

### 🧪 Scratchpad Settings
| Setting | Default | Description |
| :--- | :--- | :--- |
| `scratchpad.insertPosition` | `below` | Where to spawn the scratchpad (`above` or `below`). |
| `scratchpad.borderStyle` | `dashed` | Style of the scratchpad cell border. |
| `scratchpad.borderColor` | `#80808080` | Color of the scratchpad border. |

### 🖥️ Layout & Kernel
| Setting | Default | Description |
| :--- | :--- | :--- |
| `layout.enableCompactView` | `false` | Enforces verbose timing, line numbers, and tight layout. |
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