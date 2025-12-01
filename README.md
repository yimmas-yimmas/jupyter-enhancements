# Jupyter Enhancements for VS Code

Supercharge your Jupyter Notebook experience in VS Code with advanced visual cues, smart execution controls, and a dedicated scratchpad.

**Jupyter Enhancements** fixes the lack of visual feedback in standard notebooks by adding clear success/failure backgrounds, running animations, and better focus management.

## 🚀 Key Features

### 1. Visual Execution Feedback
Never wonder "Did that cell run?" again.
*   **Running Animation:** A Blue border flashes around the cell while code is executing.
*   **Success Flash:** A subtle animation flashes upon completion.
*   **Persistent Status:** 
    *   ✅ **Green Background:** Cell executed successfully.
    *   ❌ **Red Background:** Cell failed.
    *   *(Colors are fully configurable in settings)*

### 2. Smart "Run" Controls
We've upgraded the standard execution flow to be smoother:
*   **Run Current & Below:** Runs the current cell and all subsequent cells, stopping immediately if an error occurs.
*   **Run Single:** Automatically advances focus to the next cell after execution.
*   **Smart Focus:** Ensures the editor always scrolls to the cell currently being executed during batch runs.

### 3. 📝 The Scratchpad
Test code snippets without messing up your notebook structure.
*   **Highlight** any code in your notebook.
*   Press **`F11`** (Default).
*   The extension creates a **temporary scratchpad cell** below, runs your snippet, and marks it with a dashed border.
*   *Perfect for checking variable shapes, quick prints, or debugging logic.*

### 4. Layout & UI Tweaks
Toggle "Compact Mode" to maximize screen real estate.
*   **Compact View:** Toggles line numbers, verbose timing, smaller output font, and consolidated buttons.
*   **Hide Toolbar:** Option to hide the floating cell toolbar for a cleaner look.

---

## ⚙️ Configuration

You can customize almost every aspect of this extension in **Settings** (`Ctrl+,`) under `Jupyter Enhancements`.

| Setting | Default | Description |
| :--- | :--- | :--- |
| `jupyterEnhancements.flash.enable` | `true` | Enable the completion flash effect. |
| `jupyterEnhancements.background.enable` | `true` | Enable persistent Green/Red status backgrounds. |
| `jupyterEnhancements.innerBorder.enable` | `true` | Show a blue border around the code while running. |
| `jupyterEnhancements.scratchpad.borderStyle` | `dashed` | Visual style for scratchpad cells. |
| `jupyterEnhancements.layout.enableCompactView` | `false` | Toggle tight layout settings. |

*(All colors for success, error, borders, and flashes are fully customizable in settings).*

## ⌨️ Shortcuts

*   **`F11`**: Run selected text in Scratchpad.
    *   *To change this: Open Keyboard Shortcuts (`Ctrl+K Ctrl+S`) and search for `jupyter-enhancements.runInScratchpad`.*

---

## 🔧 Requirements

*   VS Code `1.96.0` or higher.
*   The Microsoft **Jupyter** extension installed.

---

## 🤝 Contributing & Issues

Found a bug? Have a feature request? Please report it on our [GitHub Repository](https://github.com/yimmas/jupyter-enhancements).

**Enjoy your enhanced notebook experience!**