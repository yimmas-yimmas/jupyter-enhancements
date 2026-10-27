/** Debug Adapter Protocol transitions for Jupyter Debug Cell visuals. */
export type DebugVisualPhase = 'running' | 'paused' | 'ended';
export interface DebugVisualMessage {
    direction: 'request' | 'adapter';
    type?: string;
    event?: string;
    command?: string;
}

export function nextDebugVisualPhase(
    previous: DebugVisualPhase,
    message: DebugVisualMessage
): DebugVisualPhase {
    if (previous === 'ended') return 'ended';
    if (message.direction === 'adapter' && message.type === 'event') {
        if (message.event === 'stopped') return 'paused';
        if (message.event === 'continued') return 'running';
        if (message.event === 'exited' || message.event === 'terminated') return 'ended';
    }
    // Some notebook adapters don't send a continued event before a step.
    if (message.direction === 'request' && message.type === 'request' &&
        ['continue', 'next', 'stepIn', 'stepOut', 'reverseContinue'].includes(message.command ?? '')) {
        return 'running';
    }
    return previous;
}
