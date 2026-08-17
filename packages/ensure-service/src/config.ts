import {type RequiredAndNotNull} from '@augment-vir/common';
import {atLeastOneDurationShape} from 'date-vir';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {defineShape, nullableShape} from 'object-shape-tester';

/**
 * Shape definition for the CLI config.
 *
 * @category Internal
 * @default `defaultConfig`
 */
export const configOptionsShape = defineShape({
    /** How long to wait for the health check to resolve. */
    healthCheckTimeout: nullableShape(atLeastOneDurationShape()),
    /** The URL to send the health check request to. */
    healthCheckUrl: nullableShape(''),
    /** Directory that service log files are written into. */
    logDirPath: nullableShape(''),
    /** Path to the lock file preventing overlapping runs. */
    lockFilePath: nullableShape(''),
    /** Command used to start the server if it's not healthy. */
    serviceStartCommand: nullableShape(''),
    /** How long to wait for the service to startup. */
    serviceStartTimeout: nullableShape(atLeastOneDurationShape()),
    /**
     * The port that the service should be running on. If the service health check fails, all
     * processes listening to this port are killed (to restart the server and make it healthy).
     */
    servicePort: nullableShape(-1),
    /** The directory to run `startCommand` from. */
    startServiceCwd: nullableShape(''),
});

/**
 * Config options for this package.
 *
 * @category Internal
 * @default `defaultConfig`
 */
export type ConfigOptions = typeof configOptionsShape.runtimeType;

/**
 * Default directory for the service's lock file and logs.
 *
 * @category Internal
 */
export const defaultEnsureLogConfigPath = join(homedir(), '.config', 'ensure-service');

/**
 * Default options used when configuration fields are omitted.
 *
 * @category Internal
 */
export const defaultConfig: RequiredAndNotNull<ConfigOptions> = {
    healthCheckTimeout: {
        seconds: 10,
    },
    healthCheckUrl: 'http://127.0.0.1:3000/health',
    lockFilePath: join(defaultEnsureLogConfigPath, 'lock'),
    logDirPath: join(defaultEnsureLogConfigPath, 'logs'),
    serviceStartCommand: 'npm start',
    serviceStartTimeout: {
        minutes: 5,
    },
    servicePort: 3000,
    startServiceCwd: process.cwd(),
};
