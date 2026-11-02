/**
 * Pure execution-summary state transitions. Works with the stable VS Code notebook
 * APIs (including 1.142.0) and can be unit tested without a running editor.
 */
export interface ExecutionSnapshot {
    order: number;
    start: number;
    end: number;
    success: boolean | undefined;
}

export type ExecutionTransition = 'started' | 'finished' | 'none';

export function classifyExecutionTransition(
    previous: ExecutionSnapshot,
    next: ExecutionSnapshot
): ExecutionTransition {
    // Jupyter may retain an old completion timestamp while a NEW run starts.
    // A changed end time always wins; it means this run has finished.
    if (next.end > 0 && next.end !== previous.end) return 'finished';

    // Some kernels supply success without timing. Require a new run identity.
    if (previous.success === undefined && next.success !== undefined &&
        (next.start !== previous.start || next.order !== previous.order)) return 'finished';

    if (next.start > 0 && next.start !== previous.start) return 'started';
    // Jupyter's NotebookCellExecution may start without publishing a startTime.
    // In that case a changed execution order is our only public cell-local
    // start signal. Kernel idle/busy status (observed separately) stops an
    // animation even when no completion summary is sent (e.g. ipywidgets).
    if (next.order > 0 && next.order !== previous.order && next.end === previous.end) return 'started';
    return 'none';
}
