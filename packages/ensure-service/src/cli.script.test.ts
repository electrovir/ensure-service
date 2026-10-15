import {assert} from '@augment-vir/assert';
import {ensureArray, selectFrom, shellQuote} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {describe, it} from '@augment-vir/test';
import {once} from 'node:events';
import {access, mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {type ServiceOptions} from './config.js';

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
        healthCheckTimeout: {
            seconds: 1,
        },
        healthCheckUrl: `http://127.0.0.1:${port}/`,
        logDirPath,
        lockFilePath,
        servicePort: port,
        serviceStartCommand: process.execPath,
        startServiceCwd: process.cwd(),
    } satisfies ServiceOptions;
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

async function runEnsureServiceCli(
    cliArgs: string | ReadonlyArray<string>,
    env: NodeJS.ProcessEnv = process.env,
) {
    return runShellCommand(
        [
            'tsx',
            shellQuote(join(import.meta.dirname, 'cli.script.ts')),
            ...ensureArray(cliArgs).map((cliArg) => shellQuote(cliArg)),
        ].join(' '),
        {
            env,
        },
    );
}

/** Points the default config path into `homePath`. */
async function writeDefaultConfig(homePath: string, config: unknown) {
    const configDirPath = join(homePath, '.config', 'ensure-service');

    await mkdir(configDirPath, {
        recursive: true,
    });
    await writeFile(join(configDirPath, 'config.json'), JSON.stringify(config));
}

describe('cli.script.ts', () => {
    it('loads service options from a config with unrelated properties', async () => {
        const server = createServer((_request, response) => {
            response.end();
        });
        const port = await listenOnAvailablePort(server);
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const configPath = join(temporaryDirectory, 'ensure-service.config.json');

        await writeFile(
            configPath,
            JSON.stringify({
                services: {
                    'test-service': {
                        ...createCheckServerOptions({
                            logDirPath: join(temporaryDirectory, 'logs'),
                            lockFilePath: join(temporaryDirectory, 'ensure.lock'),
                            port,
                        }),
                        healthTimeout: {
                            seconds: 1,
                        },
                    },
                },
                unrelated: true,
            }),
        );

        try {
            assert.deepEquals(
                selectFrom(await runEnsureServiceCli(configPath), {
                    error: true,
                    exitCode: true,
                    exitSignal: true,
                }),
                {
                    error: undefined,
                    exitCode: 0,
                    exitSignal: undefined,
                },
            );
        } finally {
            await closeServer(server);
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('rejects a config with an invalid service name', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const configPath = join(temporaryDirectory, 'ensure-service.config.json');

        await writeFile(
            configPath,
            JSON.stringify({
                services: {
                    Invalid_Name: {
                        servicePort: 3000,
                    },
                },
            }),
        );

        try {
            assert.isDefined((await runEnsureServiceCli(configPath)).error);
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('exits with an error when a service fails', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const configPath = join(temporaryDirectory, 'ensure-service.config.json');

        await writeFile(
            configPath,
            JSON.stringify({
                services: {
                    'test-service': createCheckServerOptions({
                        logDirPath: join(temporaryDirectory, 'logs'),
                        lockFilePath: join(temporaryDirectory, 'ensure.lock'),
                        port: 0,
                    }),
                },
            }),
        );

        try {
            const {error, stderr} = await runEnsureServiceCli(configPath);

            assert.isDefined(error);
            assert.isTrue(stderr.includes('Failed to ensure services: test-service.'));
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('restarts the named services from the default config', async () => {
        const server = createServer();
        const port = await listenOnAvailablePort(server);
        /** Nothing may listen on the port, or the restart would kill this test's own process. */
        await closeServer(server);
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const logDirPath = join(temporaryDirectory, 'logs');

        await writeDefaultConfig(temporaryDirectory, {
            services: {
                'test-service': createCheckServerOptions({
                    logDirPath,
                    lockFilePath: join(temporaryDirectory, 'ensure.lock'),
                    port,
                }),
            },
        });

        try {
            const {error, stdout} = await runEnsureServiceCli(
                [
                    'restart',
                    'test-service',
                ],
                {
                    ...process.env,
                    HOME: temporaryDirectory,
                },
            );

            assert.isUndefined(error);
            assert.isTrue(stdout.includes("Restarted 'test-service'."));
            assert.isLengthExactly(await readdir(logDirPath), 1);
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('rejects restarting a service that is not in the default config', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const logDirPath = join(temporaryDirectory, 'logs');

        await writeDefaultConfig(temporaryDirectory, {
            services: {
                'test-service': createCheckServerOptions({
                    logDirPath,
                    lockFilePath: join(temporaryDirectory, 'ensure.lock'),
                    port: 3000,
                }),
            },
        });

        try {
            const {error, stderr} = await runEnsureServiceCli(
                [
                    'restart',
                    'test-service',
                    'missing-service',
                ],
                {
                    ...process.env,
                    HOME: temporaryDirectory,
                },
            );

            assert.isDefined(error);
            assert.isTrue(stderr.includes("No service named 'missing-service'"));
            await assert.throws(access(logDirPath));
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });
});
