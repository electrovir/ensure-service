import {check} from '@augment-vir/assert';
import {filterMap, trimAndSplitLines, wait} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {assertValidPort} from './port.js';

/**
 * Terminate anything bound to the port, escalating to SIGKILL for survivors.
 *
 * @category Internal
 */
export async function killPortHolderProcesses(port: number) {
    assertValidPort(port);

    const processIds = await listPortProcessIds(port);

    if (!processIds.length) {
        return [];
    }

    processIds.forEach((processId) => {
        killProcessQuietly(processId, 'SIGTERM');
    });
    /** Give the processes time to terminate before killing it forcefully. */
    await wait({
        seconds: 3,
    });
    /** Force kill all processes (no-op if they're already dead). */
    (await listPortProcessIds(port)).forEach((processId) => {
        killProcessQuietly(processId, 'SIGKILL');
    });

    return processIds;
}

async function listPortProcessIds(port: number) {
    const {stdout} = await runShellCommand(`lsof -t -i:${port}`);

    return filterMap(
        trimAndSplitLines(stdout),
        (rawProcessId) => {
            const processId = Number(rawProcessId);

            if (check.isInteger(processId) && processId > 0) {
                return processId;
            } else {
                return undefined;
            }
        },
        check.isDefined,
    );
}

function killProcessQuietly(processId: number, signal: NodeJS.Signals) {
    try {
        process.kill(processId, signal);
    } catch {
        /** The process may have exited after its PID was discovered. */
    }
}
