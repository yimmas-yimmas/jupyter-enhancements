/** Compact execution timing text for notebook-cell editor decorations. */
import { ExecutionSnapshot } from './executionState';

export type CellTimingPhase = 'running' | 'paused' | 'finished';

export interface CompactTiming {
    text: string;
    tooltip: string;
}

export function formatExecutionDuration(milliseconds: number): string | undefined {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return undefined;
    if (milliseconds < 1000) return Math.round(milliseconds) + 'ms';
    if (milliseconds < 60_000) {
        return (milliseconds / 1000).toFixed(milliseconds < 10_000 ? 2 : 1) + 's';
    }
    const minutes = Math.floor(milliseconds / 60_000);
    const seconds = Math.floor(milliseconds % 60_000 / 1000);
    return minutes + 'm ' + seconds + 's';
}

/** Never present stale or negative timestamps as a valid execution duration. */
export function compactTiming(
    summary: ExecutionSnapshot,
    phase: CellTimingPhase,
    now: number
): CompactTiming | undefined {
    const startValid = Number.isFinite(summary.start) && summary.start > 0;
    const endValid = Number.isFinite(summary.end) && summary.end >= summary.start;
    const hasElapsed = phase === 'finished' ?
        startValid && endValid : startValid && now >= summary.start;
    const milliseconds = hasElapsed ?
        (phase === 'finished' ? summary.end - summary.start : now - summary.start) : undefined;
    const duration = milliseconds === undefined ? undefined :
        formatExecutionDuration(milliseconds);

    if (phase === 'running') {
        return {
            text: '● Running' + (duration ? ' · ' + duration : ''),
            tooltip: 'Cell execution in progress' + (duration ? ' — elapsed ' + duration : '')
        };
    }
    if (phase === 'paused') {
        return {
            text: 'Ⅱ Paused' + (duration ? ' · ' + duration : ''),
            tooltip: 'Debugger paused' + (duration ? ' — elapsed ' + duration : '')
        };
    }
    if (summary.success === undefined && !duration) return undefined;
    const symbol = summary.success === true ? '✓' : summary.success === false ? '✕' : '•';
    const status = summary.success === true ? 'Succeeded' : summary.success === false ? 'Failed' : 'Executed';
    return {
        text: symbol + (duration ? ' ' + duration : ' ' + status),
        tooltip: 'Cell execution ' + status.toLowerCase() +
            (duration ? ' — duration ' + duration : ' — duration unavailable')
    };
}
