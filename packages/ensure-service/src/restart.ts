import {assertWrap} from '@augment-vir/assert';
import {awaitedForEach, getObjectTypedKeys, log} from '@augment-vir/common';
import {select} from '@inquirer/prompts';
import {loadConfig} from 'config-vir';
import {rm} from 'node:fs/promises';
import {configShape, defaultConfigPath, resolveConfigServices} from './config.js';
import {restartService} from './ensure.js';
import {acquireLock} from './file.js';

/**
 * Restart each named service from the default config, whether or not it is healthy. When no names
 * are given, asks which single service to restart.
 *
 * @category Main
 * @throws Error before restarting anything if a name is not in the config.
 * @throws Error if a service is being checked by another ensure-service run at the same time.
 */
export async function runRestart(serviceNames: ReadonlyArray<string>) {
    const services = resolveConfigServices(
        await loadConfig({
            configPath: defaultConfigPath,
            configShape,
        }),
    );
    const configServiceNames = getObjectTypedKeys(services);

    const missingServiceNames = serviceNames.filter(
        (serviceName) => !configServiceNames.includes(serviceName),
    );

    if (missingServiceNames.length) {
        throw new Error(
            `No service named '${missingServiceNames.join("', '")}' in ${defaultConfigPath}.`,
        );
    } else if (!configServiceNames.length) {
        throw new Error(`No services are configured in ${defaultConfigPath}.`);
    }

    const selectedServiceNames = serviceNames.length
        ? serviceNames
        : [
              await select({
                  message: 'Service to restart:',
                  choices: configServiceNames,
              }),
          ];

    await awaitedForEach(selectedServiceNames, async (serviceName) => {
        const service = assertWrap.isDefined(services[serviceName]);

        if (!(await acquireLock(service.lockFilePath, service.serviceStartTimeout))) {
            throw new Error(
                `Service '${serviceName}' is being checked by another ensure-service run. Try again shortly.`,
            );
        }

        try {
            const {logPath} = await restartService({
                ...service,
                serviceName,
            });

            log.success(`Restarted '${serviceName}'. Logs: ${logPath}`);
        } finally {
            await rm(service.lockFilePath, {
                force: true,
            });
        }
    });
}
