import {
    mapObjectValues,
    mergeDefinedProperties,
    type RequiredAndNotNull,
} from '@augment-vir/common';
import {Type} from '@sinclair/typebox';
import {atLeastOneDurationShape} from 'date-vir';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {assertValidShape, defineShape, nullableShape, recordShape} from 'object-shape-tester';

/**
 * Shape for a service name: a single DNS label (lowercase letters, digits, and inner hyphens, at
 * most 63 characters) so it can be used as a URL subdomain and as a directory name.
 *
 * @category Internal
 */
export const serviceNameShape = defineShape(
    Type.String({
        pattern: '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$',
    }),
);

/**
 * Shape definition for a single service's options.
 *
 * @category Internal
 */
export const serviceOptionsShape = defineShape({
    /**
     * How long to wait for the health check to resolve.
     *
     * @default {seconds: 10}
     */
    healthCheckTimeout: nullableShape(atLeastOneDurationShape()),
    /**
     * The URL to send the health check request to.
     *
     * @default `http://127.0.0.1:${servicePort}/health`
     */
    healthCheckUrl: nullableShape(''),
    /**
     * Directory that service log files are written into.
     *
     * @default `~/.config/ensure-service/${serviceName}/logs`
     */
    logDirPath: nullableShape(''),
    /**
     * Path to the lock file preventing overlapping runs.
     *
     * @default `~/.config/ensure-service/${serviceName}/lock`
     */
    lockFilePath: nullableShape(''),
    /**
     * Command used to start the server if it's not healthy.
     *
     * @default 'npm start'
     */
    serviceStartCommand: nullableShape(''),
    /**
     * How long to wait for the service to startup.
     *
     * @default {minutes: 5}
     */
    serviceStartTimeout: nullableShape(atLeastOneDurationShape()),
    /**
     * The port that the service should be running on. If the service health check fails, all
     * processes listening to this port are killed (to restart the server and make it healthy).
     * Required: no two services may share a port.
     */
    servicePort: -1,
    /**
     * The directory to run `startCommand` from.
     *
     * @default process.cwd()
     */
    startServiceCwd: nullableShape(''),
    /**
     * Run this service as a Tailscale service. Overrides the config's top-level
     * `useTailscaleService`.
     *
     * @default the config's top-level `useTailscaleService`
     */
    useTailscaleService: nullableShape(false),
});

/**
 * Options for a single service.
 *
 * @category Internal
 */
export type ServiceOptions = typeof serviceOptionsShape.runtimeType;

/**
 * Shape definition for the CLI config file.
 *
 * @category Internal
 */
export const configShape = defineShape({
    /** All services to check, keyed by their service name. */
    services: recordShape({
        keys: serviceNameShape,
        values: serviceOptionsShape,
    }),
    /**
     * Run every service as a Tailscale service, unless a service sets its own
     * `useTailscaleService`.
     *
     * @default false
     */
    useTailscaleService: nullableShape(false),
});

/**
 * The full config file contents for this package.
 *
 * @category Internal
 */
export type EnsureServiceConfig = typeof configShape.runtimeType;

/**
 * Default directory for each service's lock file and logs.
 *
 * @category Internal
 */
export const defaultEnsureLogConfigPath = join(homedir(), '.config', 'ensure-service');

/**
 * Path of the config file that `ensure-service init` writes and `ensure-service config` opens.
 *
 * @category Internal
 */
export const defaultConfigPath = join(defaultEnsureLogConfigPath, 'config.json');

/**
 * A finalized service, by attaching all defaults to missing properties in `ServiceOptions`.
 *
 * @category Internal
 */
export type Service = RequiredAndNotNull<ServiceOptions>;

/**
 * Fill in defaults for every omitted service option. The default lock file and log directory are
 * unique to each service name.
 *
 * @category Internal
 */
export function resolveServiceOptions({
    serviceName,
    serviceOptions,
}: Readonly<{
    serviceName: string;
    serviceOptions: Readonly<ServiceOptions>;
}>): Service {
    assertValidShape(serviceName, serviceNameShape);

    return mergeDefinedProperties<Service>(
        {
            healthCheckTimeout: {
                seconds: 10,
            },
            healthCheckUrl: `http://127.0.0.1:${serviceOptions.servicePort}/health`,
            lockFilePath: join(defaultEnsureLogConfigPath, serviceName, 'lock'),
            logDirPath: join(defaultEnsureLogConfigPath, serviceName, 'logs'),
            serviceStartCommand: 'npm start',
            serviceStartTimeout: {
                minutes: 5,
            },
            servicePort: serviceOptions.servicePort,
            startServiceCwd: process.cwd(),
            useTailscaleService: false,
        },
        serviceOptions,
    );
}

/**
 * Resolve every service in the config with {@link resolveServiceOptions}, applying the config's
 * top-level `useTailscaleService` to services that do not set their own.
 *
 * @category Internal
 */
export function resolveConfigServices({
    services,
    useTailscaleService,
}: Readonly<EnsureServiceConfig>) {
    return mapObjectValues(services, (serviceName, serviceOptions) => {
        return resolveServiceOptions({
            serviceName,
            serviceOptions: {
                ...serviceOptions,
                useTailscaleService: serviceOptions.useTailscaleService ?? useTailscaleService,
            },
        });
    });
}
