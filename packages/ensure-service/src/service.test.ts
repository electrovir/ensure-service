// cspell:word keyout pgrep

import {assert, waitUntil} from '@augment-vir/assert';
import {randomString, shellQuote} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {describe, it} from '@augment-vir/test';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {createServiceProcessLabel, runHealthCheck, startService} from './service.js';

async function listenOnAvailablePort(server: Server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const serverAddress = server.address();

    assert.isDefined(serverAddress);
    assert.isNotString(serverAddress);

    return serverAddress.port;
}

async function closeServer(server: Server) {
    server.close();
    await once(server, 'close');
}

describe(runHealthCheck.name, () => {
    it('returns false for a malformed URL', async () => {
        assert.isFalse(
            await runHealthCheck({
                healthCheckTimeout: {
                    seconds: 1,
                },
                healthCheckUrl: 'localhost:3000/health',
            }),
        );
    });

    it('returns true for a successful response', async () => {
        const server = createServer((_request, response) => {
            response.end();
        });
        const port = await listenOnAvailablePort(server);

        try {
            assert.isTrue(
                await runHealthCheck({
                    healthCheckTimeout: {
                        seconds: 1,
                    },
                    healthCheckUrl: `http://127.0.0.1:${port}/health`,
                }),
            );
        } finally {
            await closeServer(server);
        }
    });

    it('returns false for an unsuccessful response', async () => {
        const server = createServer((_request, response) => {
            response.statusCode = 503;
            response.end();
        });
        const port = await listenOnAvailablePort(server);

        try {
            assert.isFalse(
                await runHealthCheck({
                    healthCheckTimeout: {
                        seconds: 1,
                    },
                    healthCheckUrl: `http://127.0.0.1:${port}/health`,
                }),
            );
        } finally {
            await closeServer(server);
        }
    });

    it('accepts a self-signed HTTPS certificate, including for an http URL', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const keyPath = join(temporaryDirectory, 'key.pem');
        const certPath = join(temporaryDirectory, 'cert.pem');

        try {
            await runShellCommand(
                [
                    'openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost',
                    `-keyout ${shellQuote(keyPath)}`,
                    `-out ${shellQuote(certPath)}`,
                ].join(' '),
                {
                    rejectOnError: true,
                },
            );
            const server = createHttpsServer(
                {
                    cert: await readFile(certPath),
                    key: await readFile(keyPath),
                },
                (_request, response) => {
                    response.end();
                },
            );
            const port = await listenOnAvailablePort(server);

            try {
                assert.deepEquals(
                    await Promise.all(
                        [
                            'https',
                            'http',
                        ].map(async (protocol) => {
                            return await runHealthCheck({
                                healthCheckTimeout: {
                                    seconds: 1,
                                },
                                healthCheckUrl: `${protocol}://127.0.0.1:${port}/health`,
                            });
                        }),
                    ),
                    [
                        true,
                        true,
                    ],
                );
            } finally {
                await closeServer(server);
            }
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('returns false when the health-check server is unavailable', async () => {
        const server = createServer();
        const port = await listenOnAvailablePort(server);
        await closeServer(server);

        assert.isFalse(
            await runHealthCheck({
                healthCheckTimeout: {
                    seconds: 1,
                },
                healthCheckUrl: `http://127.0.0.1:${port}/health`,
            }),
        );
    });
});

describe(startService.name, () => {
    it('starts a shell command and captures its output in a log file', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const logDirPath = join(temporaryDirectory, 'logs');

        try {
            const logPath = await startService({
                logDirPath,
                serviceName: 'test',
                serviceStartCommand: [
                    shellQuote(process.execPath),
                    '--eval',
                    shellQuote("process.stdout.write('service started');"),
                ].join(' '),
                startServiceCwd: temporaryDirectory,
            });

            assert.strictEquals(dirname(logPath), logDirPath);
            await waitUntil.isTrue(
                async () => (await readFile(logPath, 'utf8')).includes('service started'),
                {
                    interval: {
                        milliseconds: 10,
                    },
                    timeout: {
                        seconds: 1,
                    },
                },
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('labels the process group with the service name', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const serviceName = `test-${randomString(8)}`;

        try {
            await startService({
                logDirPath: join(temporaryDirectory, 'logs'),
                serviceName,
                serviceStartCommand: [
                    shellQuote(process.execPath),
                    '--eval',
                    shellQuote('setTimeout(() => {}, 10_000);'),
                ].join(' '),
                startServiceCwd: temporaryDirectory,
            });

            const labeledShellIds = (
                await runShellCommand(
                    `pgrep -f ${shellQuote(createServiceProcessLabel(serviceName))}`,
                )
            ).stdout
                .trim()
                .split('\n');

            assert.isLengthExactly(labeledShellIds, 1);

            const groupProcessIds = (await runShellCommand(`pgrep -g ${labeledShellIds[0]}`)).stdout
                .trim()
                .split('\n');

            /** The labeled shell and the node process it started. */
            assert.isLengthExactly(groupProcessIds, 2);

            process.kill(-Number(labeledShellIds[0]));
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });
});
