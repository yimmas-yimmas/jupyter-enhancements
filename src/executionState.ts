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
    // An execution-order update alone is not evidence that a code cell is
    // executing. Interactive widget callbacks can alter notebook bookkeeping
    // without creating a corresponding cell completion event. Animating here
    // could otherwise leave the cell flashing indefinitely.
    // Require a changed execution start timestamp for a new running state.
    return 'none';
}
