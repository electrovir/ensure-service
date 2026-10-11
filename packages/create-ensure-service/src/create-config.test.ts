import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
    ConfigUpdate,
    createEnsureServiceConfig,
    createServiceName,
    createServiceOptions,
    defaultConfigFileName,
} from './create-config.js';

async function withTemporaryConfig(
    callback: (
        paths: Readonly<{
            configPath: string;
            temporaryDirectory: string;
        }>,
    ) => Promise<void>,
) {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'create-ensure-service-'));

    try {
        await callback({
            configPath: join(temporaryDirectory, defaultConfigFileName),
            temporaryDirectory,
        });
    } finally {
        await rm(temporaryDirectory, {
            force: true,
            recursive: true,
        });
    }
}

function useDefaultPort({defaultPort}: Readonly<{defaultPort: number}>) {
    return defaultPort;
}

async function readJson(path: string): Promise<unknown> {
    return JSON.parse(await readFile(path, 'utf8'));
}

describe(createEnsureServiceConfig.name, () => {
    it('creates a config containing the current service', async () => {
        await withTemporaryConfig(async ({configPath, temporaryDirectory}) => {
            const cwd = join(temporaryDirectory, 'My_Api');

            assert.deepEquals(
                await createEnsureServiceConfig({
                    configPath,
                    getServicePort: useDefaultPort,
                    cwd,
                }),
                {
                    configUpdate: ConfigUpdate.Created,
                    serviceName: 'my-api',
                    servicePort: 3000,
                },
            );
            assert.deepEquals(await readJson(configPath), {
                services: {
                    'my-api': createServiceOptions({
                        cwd,
                        servicePort: 3000,
                    }),
                },
            });
        });
    });

    it('adds services from other directories on the next free port', async () => {
        await withTemporaryConfig(async ({configPath, temporaryDirectory}) => {
            const apiCwd = join(temporaryDirectory, 'api');
            const webCwd = join(temporaryDirectory, 'web');

            await writeFile(
                configPath,
                JSON.stringify({
                    services: {
                        api: createServiceOptions({
                            cwd: apiCwd,
                            servicePort: 4000,
                        }),
                    },
                    unrelated: true,
                }),
            );

            assert.deepEquals(
                await createEnsureServiceConfig({
                    configPath,
                    getServicePort: useDefaultPort,
                    cwd: webCwd,
                }),
                {
                    configUpdate: ConfigUpdate.Added,
                    serviceName: 'web',
                    servicePort: 4001,
                },
            );
            assert.deepEquals(await readJson(configPath), {
                services: {
                    api: createServiceOptions({
                        cwd: apiCwd,
                        servicePort: 4000,
                    }),
                    web: createServiceOptions({
                        cwd: webCwd,
                        servicePort: 4001,
                    }),
                },
                unrelated: true,
            });
        });
    });

    it('leaves the config unchanged when rerun from the same directory', async () => {
        await withTemporaryConfig(async ({configPath, temporaryDirectory}) => {
            const cwd = join(temporaryDirectory, 'api');

            await createEnsureServiceConfig({
                configPath,
                getServicePort: useDefaultPort,
                cwd,
            });
            const contentsBefore = await readFile(configPath, 'utf8');

            assert.deepEquals(
                await createEnsureServiceConfig({
                    configPath,
                    getServicePort() {
                        throw new Error('An existing service should not ask for a port.');
                    },
                    cwd,
                }),
                {
                    configUpdate: ConfigUpdate.Unchanged,
                    serviceName: 'api',
                    servicePort: 3000,
                },
            );
            assert.strictEquals(await readFile(configPath, 'utf8'), contentsBefore);
        });
    });

    it('rejects a service name already used by another directory', async () => {
        await withTemporaryConfig(async ({configPath, temporaryDirectory}) => {
            await createEnsureServiceConfig({
                configPath,
                getServicePort: useDefaultPort,
                cwd: join(temporaryDirectory, 'first', 'api'),
            });

            await assert.throws(
                createEnsureServiceConfig({
                    configPath,
                    getServicePort: useDefaultPort,
                    cwd: join(temporaryDirectory, 'second', 'api'),
                }),
                {
                    matchMessage: "Service 'api' already exists",
                },
            );
        });
    });

    it('rejects a requested port that another service uses', async () => {
        await withTemporaryConfig(async ({configPath, temporaryDirectory}) => {
            await createEnsureServiceConfig({
                configPath,
                getServicePort: useDefaultPort,
                cwd: join(temporaryDirectory, 'api'),
            });

            await assert.throws(
                createEnsureServiceConfig({
                    configPath,
                    cwd: join(temporaryDirectory, 'web'),
                    getServicePort() {
                        return 3000;
                    },
                }),
                {
                    matchMessage: 'Port 3000 is already used',
                },
            );
        });
    });

    it('replaces an existing config that does not match the config shape', async () => {
        await withTemporaryConfig(async ({configPath, temporaryDirectory}) => {
            const cwd = join(temporaryDirectory, 'api');

            await writeFile(
                configPath,
                JSON.stringify({
                    servicePort: 4000,
                }),
            );

            assert.deepEquals(
                await createEnsureServiceConfig({
                    configPath,
                    getServicePort: useDefaultPort,
                    cwd,
                }),
                {
                    configUpdate: ConfigUpdate.Created,
                    serviceName: 'api',
                    servicePort: 3000,
                },
            );
            assert.deepEquals(await readJson(configPath), {
                services: {
                    api: createServiceOptions({
                        cwd,
                        servicePort: 3000,
                    }),
                },
            });
        });
    });

    it('replaces an existing configuration when permitted', async () => {
        await withTemporaryConfig(async ({configPath, temporaryDirectory}) => {
            const cwd = join(temporaryDirectory, 'api');

            await writeFile(configPath, 'existing configuration');
            await createEnsureServiceConfig({
                configPath,
                getServicePort: useDefaultPort,
                cwd,
                shouldOverwrite: true,
            });

            assert.deepEquals(await readJson(configPath), {
                services: {
                    api: createServiceOptions({
                        cwd,
                        servicePort: 3000,
                    }),
                },
            });
        });
    });
});

describe(createServiceName.name, () => {
    it('converts directory names into DNS labels', () => {
        assert.deepEquals(
            [
                '/home/example/My_Service',
                '/home/example/--api.v2--',
                `/home/example/${'a'.repeat(62)}_b`,
                '/home/example/___',
            ].map((directoryPath) => createServiceName(directoryPath)),
            [
                'my-service',
                'api-v2',
                'a'.repeat(62),
                'service',
            ],
        );
    });
});
