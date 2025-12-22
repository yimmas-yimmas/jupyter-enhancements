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

## 🎨 Color Customization

You can fully customize the colors in your user `settings.json`. Copy and paste the snippet below:

```json
{
  "jupyterEnhancements.background.successColor": "#90EE9033",
  "jupyterEnhancements.background.errorColor": "#FF000033",
  "jupyterEnhancements.flash.color": "#FFFF0066",
  "jupyterEnhancements.innerBorder.runningColor": "#0078FF",
  "jupyterEnhancements.outerBorder.runningColor": "#0078FF",
  "jupyterEnhancements.innerBorder.successColor": "#006400",
  "jupyterEnhancements.outerBorder.successColor": "#006400"
}