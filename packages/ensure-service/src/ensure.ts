import {mergeDefinedProperties} from '@augment-vir/common';
import {rm} from 'node:fs/promises';
import {defaultConfig, type ConfigOptions} from './config.js';
import {acquireLock, isFileNewerThan} from './file.js';
import {assertValidPort} from './port.js';
import {killPortHolderProcesses} from './process.js';
import {runHealthCheck, startService} from './service.js';

/**
 * Options accepted by {@link ensureService}.
 *
 * @category Internal
 */
export type {ConfigOptions} from './config.js';

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
export async function ensureService(options: Readonly<ConfigOptions>) {
    const {
        healthCheckTimeout,
        healthCheckUrl,
        lockFilePath,
        logDirPath,
        serviceStartCommand,
        serviceStartTimeout,
        servicePort,
        startServiceCwd,
    } = mergeDefinedProperties(defaultConfig, options);

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
