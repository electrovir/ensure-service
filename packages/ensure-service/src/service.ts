import {type RequiredAndNotNull, type SelectFrom} from '@augment-vir/common';
import {convertDuration, type AtLeastOneDuration} from 'date-vir';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdir, open} from 'node:fs/promises';
import {join} from 'node:path';
import {type ConfigOptions} from './config.js';

/**
 * Spawn the start command detached, with stdout and stderr going to a timestamped log file.
 *
 * @category Internal
 */
export async function startService({
    logDirPath,
    serviceStartCommand,
    startServiceCwd,
}: Readonly<
    SelectFrom<
        RequiredAndNotNull<ConfigOptions>,
        {
            logDirPath: true;
            serviceStartCommand: true;
            startServiceCwd: true;
        }
    >
>) {
    await mkdir(logDirPath, {
        recursive: true,
    });

    const logPath = join(logDirPath, `service-${Date.now()}.log`);
    const handle = await open(logPath, 'a');

    try {
        const childProcess = spawn(serviceStartCommand, {
            cwd: startServiceCwd,
            detached: true,
            shell: true,
            stdio: [
                'ignore',
                handle.fd,
                handle.fd,
            ],
        });

        await waitForServerSpawn(childProcess);
        childProcess.unref();
    } finally {
        await handle.close();
    }

    return logPath;
}

function waitForServerSpawn(childProcess: ChildProcess) {
    return new Promise<void>((resolve, reject) => {
        childProcess.once('error', reject);
        childProcess.once('spawn', resolve);
    });
}

/**
 * Run the configured service health check.
 *
 * @category Internal
 */
export async function runHealthCheck({
    healthCheckTimeout,
    healthCheckUrl,
}: Readonly<{
    healthCheckUrl: string;
    healthCheckTimeout: AtLeastOneDuration;
}>) {
    try {
        const response = await fetch(healthCheckUrl, {
            signal: AbortSignal.timeout(
                convertDuration(healthCheckTimeout, {
                    milliseconds: true,
                }).milliseconds,
            ),
        });

        return response.ok;
    } catch {
        return false;
    }
}
