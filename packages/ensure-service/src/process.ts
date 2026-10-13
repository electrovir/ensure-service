// cspell:word pgid pgrep ppid

import {check} from '@augment-vir/assert';
import {filterMap, trimAndSplitLines, wait} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {assertValidPort} from './port.js';
import {serviceProcessLabelPrefix} from './service.js';

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

/**
 * Terminate every running instance of a service started by ensure-service, escalating to SIGKILL
 * for survivors. Each instance's whole process tree is stopped, including processes that moved into
 * process groups of their own.
 *
 * @category Internal
 * @returns The killed process group IDs.
 */
export async function killServiceProcessGroups(serviceName: string) {
    const processGroupIds = (await listServiceProcessGroups())
        .filter((serviceProcesses) => serviceProcesses.serviceName === serviceName)
        .flatMap(({processGroupIds}) => processGroupIds);

    if (!processGroupIds.length) {
        return [];
    }

    processGroupIds.forEach((processGroupId) => {
        killProcessQuietly(-processGroupId, 'SIGTERM');
    });
    await wait({
        seconds: 3,
    });
    processGroupIds.forEach((processGroupId) => {
        killProcessQuietly(-processGroupId, 'SIGKILL');
    });

    return processGroupIds;
}

/**
 * List every running service started by ensure-service, found by the label that `startService` puts
 * on each service's leading shell. Services started before that label existed are not listed.
 *
 * @category Internal
 * @returns The services, sorted by service name.
 */
export async function listServiceProcessGroups() {
    const {stdout} = await runShellCommand('ps -A -ww -o pid= -o ppid= -o pgid= -o command=');

    return parseServiceProcessGroups(stdout);
}

/**
 * Parse `ps -o pid= -o ppid= -o pgid= -o command=` output into the services
 * {@link listServiceProcessGroups} returns. Each service's process groups are its labeled shell's
 * group plus every group led by one of the shell's descendants, and its processes are every process
 * in those groups.
 *
 * @category Internal
 */
export function parseServiceProcessGroups(psOutput: string) {
    const processes = filterMap(
        trimAndSplitLines(psOutput),
        (line) => {
            const match = /^(\d+)\s+(\d+)\s+(\d+)\s(.*)$/.exec(line.trim());

            return match
                ? {
                      command: match[4] || '',
                      parentProcessId: Number(match[2]),
                      processGroupId: Number(match[3]),
                      processId: Number(match[1]),
                  }
                : undefined;
        },
        check.isDefined,
    );

    return filterMap(
        processes,
        ({command, processGroupId, processId}) => {
            const serviceName =
                processId === processGroupId ? parseServiceShellName(command) : undefined;

            if (!serviceName) {
                return undefined;
            }

            const processGroupIds = [
                processId,
                ...findDescendantProcessIds({
                    parentProcessIds: [
                        processId,
                    ],
                    processes,
                }),
            ].filter((treeProcessId) => {
                return processes.some((treeProcess) => {
                    return (
                        treeProcess.processId === treeProcessId &&
                        treeProcess.processGroupId === treeProcessId
                    );
                });
            });

            return {
                processes: processes
                    .filter((groupProcess) => processGroupIds.includes(groupProcess.processGroupId))
                    .map((groupProcess) => {
                        return {
                            command: groupProcess.command,
                            processId: groupProcess.processId,
                        };
                    }),
                processGroupIds,
                serviceName,
            };
        },
        check.isDefined,
    ).toSorted((first, second) => first.serviceName.localeCompare(second.serviceName));
}

/** Annotated because the function is recursive. */
function findDescendantProcessIds({
    parentProcessIds,
    processes,
}: Readonly<{
    parentProcessIds: ReadonlyArray<number>;
    processes: ReadonlyArray<
        Readonly<{
            parentProcessId: number;
            processId: number;
        }>
    >;
}>): number[] {
    const childProcessIds = processes
        .filter(({parentProcessId}) => parentProcessIds.includes(parentProcessId))
        .map(({processId}) => processId);

    return childProcessIds.length
        ? [
              ...childProcessIds,
              ...findDescendantProcessIds({
                  parentProcessIds: childProcessIds,
                  processes,
              }),
          ]
        : [];
}

/**
 * Read the service name from the command of the `sh` that `startService` spawns. Other processes
 * can carry the label in their arguments, such as a `pgrep -f` run from a terminal, so only that
 * exact command shape counts.
 */
function parseServiceShellName(command: string) {
    return new RegExp(String.raw`^/bin/sh -c .*\s${serviceProcessLabelPrefix}(\S+)$`).exec(
        command,
    )?.[1];
}
