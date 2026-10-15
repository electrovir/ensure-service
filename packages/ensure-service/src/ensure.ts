import {
    ensureError,
    extractDuplicates,
    getObjectTypedValues,
    mapObjectValues,
    type SelectFrom,
} from '@augment-vir/common';
import {rm} from 'node:fs/promises';
import {
    resolveConfigServices,
    resolveServiceOptions,
    type EnsureServiceConfig,
    type Service,
    type ServiceOptions,
} from './config.js';
import {acquireLock, isFileNewerThan} from './file.js';
import {assertValidPort} from './port.js';
import {killPortHolderProcesses, killServiceProcessGroups} from './process.js';
import {runHealthCheck, startService} from './service.js';
import {createTailscaleAccessTokenGetter, ensureTailscaleService} from './tailscale.js';

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
          /** Process groups of the service's previous instances. */
          killedProcessGroupIds: number[];
          /** Processes that were still bound to the service's port. */
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

        const {killedProcessGroupIds, killedProcessIds, logPath} = await restartService({
            logDirPath,
            serviceName,
            servicePort,
            serviceStartCommand,
            startServiceCwd,
        });

        return {
            action: CheckServerAction.Restarted,
            killedProcessGroupIds,
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
 * Stop every process from the service's previous starts and every process bound to its port, then
 * start it again. Unlike {@link ensureService}, this skips the health check and does not take the
 * service's lock.
 *
 * @category Internal
 */
export async function restartService({
    logDirPath,
    serviceName,
    servicePort,
    serviceStartCommand,
    startServiceCwd,
}: Readonly<
    SelectFrom<
        Service,
        {
            logDirPath: true;
            servicePort: true;
            serviceStartCommand: true;
            startServiceCwd: true;
        }
    > & {
        serviceName: string;
    }
>) {
    const killedProcessGroupIds = await killServiceProcessGroups(serviceName);
    /** Also covers a service started some other way, such as by hand in a terminal. */
    const killedProcessIds = await killPortHolderProcesses(servicePort);
    const logPath = await startService({
        logDirPath,
        serviceName,
        serviceStartCommand,
        startServiceCwd,
    });

    return {
        killedProcessGroupIds,
        killedProcessIds,
        logPath,
    };
}

/**
 * Run {@link ensureService} for every service in the config, in parallel. A service that throws does
 * not stop the others: its error is returned as its result instead. Tailscale setup only runs for
 * services that passed their health check, so a service that was just started gets its Tailscale
 * setup on a later run.
 *
 * @category Main
 * @throws Error before checking any service if two services share a port, lock file, or log
 *   directory.
 */
export async function ensureServices(config: Readonly<EnsureServiceConfig>) {
    const services = resolveConfigServices(config);

    assertNoSharedServiceResources(getObjectTypedValues(services));

    const getTailscaleAccessToken = createTailscaleAccessTokenGetter();

    return await mapObjectValues(services, async (serviceName, service) => {
        try {
            const result = await ensureService({
                serviceName,
                serviceOptions: service,
            });

            /**
             * Tailscale setup probes the service's port to choose between HTTP and HTTPS
             * forwarding. A service that is still booting is not listening yet, so the probe would
             * pick HTTP even for an HTTPS-only service.
             */
            if (result.action === CheckServerAction.Healthy) {
                await ensureTailscaleService({
                    getAccessToken: getTailscaleAccessToken,
                    service,
                    serviceName,
                });
            }

            return result;
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
