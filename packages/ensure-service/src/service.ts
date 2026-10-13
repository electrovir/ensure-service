// cspell:word pgrep

import {type RequiredAndNotNull, type SelectFrom} from '@augment-vir/common';
import {convertDuration, type AtLeastOneDuration} from 'date-vir';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdir, open} from 'node:fs/promises';
import {request as httpRequest, type IncomingMessage} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {join} from 'node:path';
import {connect as tlsConnect} from 'node:tls';
import {buildUrl, parseUrl} from 'url-vir';
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
 * Check whether a server completes a TLS handshake on the given port, accepting any certificate.
 * Resolves `false` for a plain HTTP server, a closed port, or no handshake within `timeout`.
 *
 * @category Internal
 */
export async function isTlsServer({
    hostname,
    port,
    timeout,
}: Readonly<{
    hostname: string;
    port: number;
    timeout: AtLeastOneDuration;
}>) {
    return await new Promise<boolean>((resolve) => {
        const socket = tlsConnect({
            host: hostname,
            port,
            rejectUnauthorized: false,
            timeout: convertDuration(timeout, {
                milliseconds: true,
            }).milliseconds,
        });

        function finish(isTls: boolean) {
            socket.destroy();
            resolve(isTls);
        }

        socket.once('secureConnect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.once('timeout', () => finish(false));
        socket.once('close', () => finish(false));
    });
}

/**
 * Run the configured service health check. An `http:` URL is sent over HTTPS instead when its port
 * completes a TLS handshake, so an HTTPS-only service works without configuring its URL. An HTTPS
 * health check accepts any certificate, so a service using a self-signed or private-CA certificate
 * still counts as healthy. Redirects are not followed: a redirect response counts as unhealthy.
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
        const url = parseUrl(healthCheckUrl);
        const isHttps =
            url.protocol === 'https' ||
            (url.protocol === 'http' &&
                (await isTlsServer({
                    hostname: url.hostname,
                    port: Number(url.port || 80),
                    timeout: healthCheckTimeout,
                })));

        const response = await new Promise<IncomingMessage>((resolve, reject) => {
            /**
             * `node:https` is used over `fetch` because `fetch` has no per-request option to skip
             * certificate verification.
             */
            const request = (isHttps ? httpsRequest : httpRequest)(
                isHttps
                    ? buildUrl(healthCheckUrl, {
                          protocol: 'https',
                      }).href
                    : healthCheckUrl,
                {
                    rejectUnauthorized: false,
                    signal: AbortSignal.timeout(
                        convertDuration(healthCheckTimeout, {
                            milliseconds: true,
                        }).milliseconds,
                    ),
                },
            );

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
