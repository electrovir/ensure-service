import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {shellQuote} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {once} from 'node:events';
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {type ConfigOptions} from './config.js';
import {CheckServerAction, CheckServerSkipReason, ensureService} from './index.js';

function createCheckServerOptions({
    logDirPath,
    lockFilePath,
    port,
}: Readonly<{
    logDirPath: string;
    lockFilePath: string;
    port: number;
}>) {
    return {
        healthCheckUrl: `http://127.0.0.1:${port}/`,
        logDirPath,
        lockFilePath,
        servicePort: port,
        serviceStartCommand: process.execPath,
        startServiceCwd: process.cwd(),
    } satisfies ConfigOptions;
}

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

describe(ensureService.name, () => {
    it('returns healthy without starting another process', async () => {
        const server = createServer((_request, response) => {
            response.end();
        });
        const port = await listenOnAvailablePort(server);
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));

        try {
            assert.deepEquals(
                await ensureService(
                    createCheckServerOptions({
                        logDirPath: join(temporaryDirectory, 'logs'),
                        lockFilePath: join(temporaryDirectory, 'ensure.lock'),
                        port,
                    }),
                ),
                {
                    action: CheckServerAction.Healthy,
                },
            );
            await assert.throws(access(join(temporaryDirectory, 'ensure.lock')));
        } finally {
            await closeServer(server);
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('skips a check while another process holds the lock', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const lockFilePath = join(temporaryDirectory, 'ensure.lock');

        await writeFile(lockFilePath, 'another check is running');

        try {
            assert.deepEquals(
                await ensureService(
                    createCheckServerOptions({
                        logDirPath: join(temporaryDirectory, 'logs'),
                        lockFilePath,
                        port: 3000,
                    }),
                ),
                {
                    action: CheckServerAction.Skipped,
                    reason: CheckServerSkipReason.Locked,
                },
            );
            await assert.doesNotThrow(access(lockFilePath));
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('skips a restart while the log directory is recent', async () => {
        const server = createServer();
        const port = await listenOnAvailablePort(server);
        await closeServer(server);
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const logDirPath = join(temporaryDirectory, 'logs');

        await mkdir(logDirPath);

        try {
            assert.deepEquals(
                await ensureService(
                    createCheckServerOptions({
                        logDirPath,
                        lockFilePath: join(temporaryDirectory, 'ensure.lock'),
                        port,
                    }),
                ),
                {
                    action: CheckServerAction.Skipped,
                    reason: CheckServerSkipReason.Booting,
                },
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('restarts an unhealthy service and writes its output to a log', async () => {
        const server = createServer();
        const port = await listenOnAvailablePort(server);
        await closeServer(server);
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));

        try {
            const result = await ensureService({
                ...createCheckServerOptions({
                    logDirPath: join(temporaryDirectory, 'logs'),
                    lockFilePath: join(temporaryDirectory, 'ensure.lock'),
                    port,
                }),
                serviceStartCommand: [
                    shellQuote(process.execPath),
                    '--eval',
                    shellQuote("process.stdout.write('service started');"),
                ].join(' '),
            });

            const logPath = assertWrap.isDefined(
                result.logPath,
                'Expected the unhealthy service to restart.',
            );

            assert.deepEquals(
                {
                    action: result.action,
                    killedProcessIds: result.killedProcessIds,
                },
                {
                    action: CheckServerAction.Restarted,
                    killedProcessIds: [],
                },
            );
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

    it('rejects an invalid service port before acquiring a lock', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const lockFilePath = join(temporaryDirectory, 'ensure.lock');

        try {
            await assert.throws(
                ensureService({
                    ...createCheckServerOptions({
                        logDirPath: join(temporaryDirectory, 'logs'),
                        lockFilePath,
                        port: 3000,
                    }),
                    servicePort: 0,
                }),
                {
                    matchMessage: 'valid port',
                },
            );
            await assert.throws(access(lockFilePath));
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });
});
