import {getObjectTypedValues, type MaybePromise, wrapInTry} from '@augment-vir/common';
import {writeJsonFile} from '@augment-vir/node';
import {assertValidPort, configShape, type ServiceOptions} from 'ensure-service';
import {basename} from 'node:path';
import {readJsonWithShape} from 'object-shape-tester';

/**
 * Default file name written by this initializer.
 *
 * @category Internal
 */
export const defaultConfigFileName = 'config.json';

/**
 * How {@link createEnsureServiceConfig} changed the config file.
 *
 * @category Internal
 */
export enum ConfigUpdate {
    /**
     * A new config file was written containing only the current service. This replaces any existing
     * file that is not a valid config.
     */
    Created = 'created',
    /** The current service was added to an existing config file. */
    Added = 'added',
    /** The current service was already in the config file. */
    Unchanged = 'unchanged',
}

/**
 * Convert a directory path into a valid service name using its last path segment.
 *
 * @category Internal
 * @example
 *
 * ```ts
 * createServiceName('/home/example/My_Service'); // 'my-service'
 * ```
 */
export function createServiceName(directoryPath: string) {
    return (
        basename(directoryPath)
            .toLowerCase()
            .replaceAll(/[^a-z0-9]+/g, '-')
            .slice(0, 63)
            .replace(/^-/, '')
            .replace(/-$/, '') || 'service'
    );
}

/**
 * Create the starter options for the service being initialized.
 *
 * @category Internal
 */
export function createServiceOptions({
    cwd,
    servicePort,
}: Readonly<{
    cwd: string;
    servicePort: number;
}>) {
    return {
        healthCheckTimeout: {
            seconds: 10,
        },
        servicePort,
        serviceStartCommand: 'npm run start',
        startServiceCwd: cwd,
    } satisfies ServiceOptions;
}

/**
 * Add a service for `cwd` to the config file. The file is replaced with a new config if it does not
 * exist, is not a valid config, or if replacement is permitted. Running this again from the same
 * directory leaves the config unchanged without calling `getServicePort`.
 *
 * @category Internal
 * @throws Error if another directory already uses the same service name or if `getServicePort`
 *   returns a port that is invalid or already in use.
 */
export async function createEnsureServiceConfig({
    configPath,
    cwd,
    getServicePort,
    shouldOverwrite,
}: Readonly<{
    configPath: string;
    cwd: string;
    /**
     * Chooses the new service's port. `defaultPort` is one more than the highest port in the
     * config, or 3000 if there are none.
     */
    getServicePort: (
        params: Readonly<{
            defaultPort: number;
            usedPorts: ReadonlyArray<number>;
        }>,
    ) => MaybePromise<number>;
    shouldOverwrite?: boolean | undefined;
}>) {
    const serviceName = createServiceName(cwd);
    const existingConfig = shouldOverwrite
        ? undefined
        : await wrapInTry(() => readJsonWithShape(configPath, configShape), {
              fallbackValue: undefined,
          });
    const existingService = existingConfig?.services[serviceName];

    if (existingService) {
        if (existingService.startServiceCwd === cwd) {
            return {
                configUpdate: ConfigUpdate.Unchanged,
                serviceName,
                servicePort: existingService.servicePort,
            };
        }

        throw new Error(
            `Service '${serviceName}' already exists in '${configPath}' for a different directory. Rename one of them in the config.`,
        );
    }

    const usedPorts = existingConfig
        ? getObjectTypedValues(existingConfig.services).map((service) => service.servicePort)
        : [];
    const servicePort = await getServicePort({
        defaultPort: usedPorts.length ? Math.max(...usedPorts) + 1 : 3000,
        usedPorts,
    });

    assertValidPort(servicePort);

    if (usedPorts.includes(servicePort)) {
        throw new Error(`Port ${servicePort} is already used by a service in '${configPath}'.`);
    }

    await writeJsonFile(
        configPath,
        {
            ...existingConfig,
            services: {
                ...existingConfig?.services,
                [serviceName]: createServiceOptions({
                    cwd,
                    servicePort,
                }),
            },
        },
        {
            includeTrailingNewLine: true,
        },
    );

    return {
        configUpdate: existingConfig ? ConfigUpdate.Added : ConfigUpdate.Created,
        serviceName,
        servicePort,
    };
}
