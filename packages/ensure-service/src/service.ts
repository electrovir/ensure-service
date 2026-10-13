// cspell:word pgrep

import {type RequiredAndNotNull, type SelectFrom} from '@augment-vir/common';
import {convertDuration, type AtLeastOneDuration} from 'date-vir';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdir, open} from 'node:fs/promises';
import {request as httpRequest, type IncomingMessage} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {join} from 'node:path';
import {type ServiceOptions} from './config.js';

/**
 * Create the label that {@link startService} puts on a service's shell command line. Pass it to
 * `pgrep -f` to find the shell, whose process group holds everything the service started.
 *
 * @category Internal
 * @example
 *
 * ```ts
 * createServiceProcessLabel('api'); // 'ensure-service:api'
 * ```
 */
export function createServiceProcessLabel(serviceName: string) {
    return serviceProcessLabelPrefix + serviceName;
}

/**
 * The part of {@link createServiceProcessLabel}'s label that every service shares.
 *
 * @category Internal
 */
export const serviceProcessLabelPrefix = 'ensure-service:';

/**
 * Spawn the start command detached in its own process group, with stdout and stderr going to a
 * timestamped log file. The group's leader is a shell labeled with
 * {@link createServiceProcessLabel}.
 *
 * @category Internal
 */
export async function startService({
    logDirPath,
    serviceName,
    serviceStartCommand,
    startServiceCwd,
}: Readonly<
    SelectFrom<
        RequiredAndNotNull<ServiceOptions>,
        {
            logDirPath: true;
            serviceStartCommand: true;
            startServiceCwd: true;
        }
    > & {
        serviceName: string;
    }
>) {
    await mkdir(logDirPath, {
        recursive: true,
    });

    const logPath = join(logDirPath, `service-${Date.now()}.log`);
    const handle = await open(logPath, 'a');

    try {
        /**
         * The label is the shell's `$0`, which the command ignores but `ps` shows. The trailing
         * `exit` stops `sh` from replacing itself with a lone simple command, which would drop the
         * label.
         */
        const childProcess = spawn(
            '/bin/sh',
            [
                '-c',
                [
                    serviceStartCommand,
                    'exit $?',
                ].join('\n'),
                createServiceProcessLabel(serviceName),
            ],
            {
                cwd: startServiceCwd,
                detached: true,
                stdio: [
                    'ignore',
                    handle.fd,
                    handle.fd,
                ],
            },
        );

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
 * Run the configured service health check. An HTTPS health check accepts any certificate, so a
 * service using a self-signed or private-CA certificate still counts as healthy. Redirects are not
 * followed: a redirect response counts as unhealthy.
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
        const response = await new Promise<IncomingMessage>((resolve, reject) => {
            /**
             * `node:https` is used over `fetch` because `fetch` has no per-request option to skip
             * certificate verification. Created inside the executor so the synchronous throw for a
             * malformed URL becomes a rejection.
             */
            const request = (
                healthCheckUrl.toLowerCase().startsWith('https:') ? httpsRequest : httpRequest
            )(healthCheckUrl, {
                rejectUnauthorized: false,
                signal: AbortSignal.timeout(
                    convertDuration(healthCheckTimeout, {
                        milliseconds: true,
                    }).milliseconds,
                ),
            });

            request.once('response', resolve);
            request.once('error', reject);
            request.end();
        });
        /** Destroying the response also closes its socket. */
        response.destroy();

        return (
            response.statusCode != undefined &&
            response.statusCode >= 200 &&
            response.statusCode < 300
        );
    } catch {
        return false;
    }
}
