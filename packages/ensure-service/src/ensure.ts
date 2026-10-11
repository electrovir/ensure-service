import {
    ensureError,
    extractDuplicates,
    getObjectTypedEntries,
    mapObjectValues,
} from '@augment-vir/common';
import {rm} from 'node:fs/promises';
import {
    resolveServiceOptions,
    type EnsureServiceConfig,
    type Service,
    type ServiceOptions,
} from './config.js';
import {acquireLock, isFileNewerThan} from './file.js';
import {assertValidPort} from './port.js';
import {killPortHolderProcesses} from './process.js';
import {runHealthCheck, startService} from './service.js';

/**
 * Outcome of a service-health check.
 *
 * @category Internal
 */
export enum CheckServerAction {
    Skipped = 'skipped',
    Healthy = 'healthy',
    Restarted = 'restarted',
}

/**
 * Reason a service-health check did not attempt a restart.
 *
 * @category Internal
 */
export enum CheckServerSkipReason {
    Locked = 'locked',
    Booting = 'booting',
}

/**
 * Result returned by {@link ensureService}.
 *
 * @category Internal
 */
export type CheckServerResult =
    | {
          action: CheckServerAction.Skipped;
          reason: CheckServerSkipReason;
      }
    | {
          action: CheckServerAction.Healthy;
      }
    | {
          action: CheckServerAction.Restarted;
          logPath: string;
          killedProcessIds: number[];
      };

/**
 * Check that the server responds on its root path and restart it if it does not.
 *
 * @category Main
 */
export async function ensureService({
    serviceName,
    serviceOptions,
}: Readonly<{
    serviceName: string;
    serviceOptions: Readonly<ServiceOptions>;
}>) {
    const {
        healthCheckTimeout,
        healthCheckUrl,
        lockFilePath,
        logDirPath,
        serviceStartCommand,
        serviceStartTimeout,
        servicePort,
        startServiceCwd,
    } = resolveServiceOptions({
        serviceName,
        serviceOptions,
    });

    assertValidPort(servicePort);

    const hasLock = await acquireLock(lockFilePath, serviceStartTimeout);

    if (!hasLock) {
        return {
            action: CheckServerAction.Skipped,
            reason: CheckServerSkipReason.Locked,
        };
    }

    try {
        if (
            await runHealthCheck({
                healthCheckTimeout,
                healthCheckUrl,
            })
        ) {
            return {
                action: CheckServerAction.Healthy,
            };
        } else if (await isFileNewerThan(logDirPath, serviceStartTimeout)) {
            return {
                action: CheckServerAction.Skipped,
                reason: CheckServerSkipReason.Booting,
            };
        }

        const killedProcessIds = await killPortHolderProcesses(servicePort);
        const logPath = await startService({
            logDirPath,
            serviceStartCommand,
            startServiceCwd,
        });

        return {
            action: CheckServerAction.Restarted,
            killedProcessIds,
            logPath,
        };
    } finally {
        await rm(lockFilePath, {
            force: true,
        });
    }
}

/**
 * Run {@link ensureService} for every service in the config, in parallel. A service that throws does
 * not stop the others: its error is returned as its result instead.
 *
 * @category Main
 * @throws Error before checking any service if two services share a port, lock file, or log
 *   directory.
 */
export async function ensureServices({services}: Readonly<EnsureServiceConfig>) {
    assertNoSharedServiceResources(
        getObjectTypedEntries(services).map(
            ([
                serviceName,
                serviceOptions,
            ]) => {
                return resolveServiceOptions({
                    serviceName,
                    serviceOptions,
                });
            },
        ),
    );

    return await mapObjectValues(services, async (serviceName, serviceOptions) => {
        try {
            return await ensureService({
                serviceName,
                serviceOptions,
            });
        } catch (error) {
            return ensureError(error);
        }
    });
}

function assertNoSharedServiceResources(resolvedServices: ReadonlyArray<Readonly<Service>>) {
    (
        [
            'servicePort',
            'lockFilePath',
            'logDirPath',
        ] as const satisfies (keyof Service)[]
    ).forEach((key) => {
        const {duplicates} = extractDuplicates(
            resolvedServices.map((resolvedService) => resolvedService[key]),
        );

        if (duplicates.length) {
            throw new Error(
                `Multiple services cannot share the same ${key}: ${duplicates.join(', ')}.`,
            );
        }
    });
}
