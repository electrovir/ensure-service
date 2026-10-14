import {assert} from '@augment-vir/assert';
import {awaitedBlockingMap} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readJsonWithShape} from 'object-shape-tester';
import {configShape} from './config.js';
import {ConfigUpdate, createEnsureServiceConfig, createServiceName} from './create-config.js';

async function withTemporaryConfig(
    callback: (
        paths: Readonly<{
            configPath: string;
            temporaryDirectory: string;
        }>,
    ) => Promise<void>,
) {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));

    try {
        await callback({
            configPath: join(temporaryDirectory, 'config.json'),
            temporaryDirectory,
        });
    } finally {
        await rm(temporaryDirectory, {
            force: true,
            recursive: true,
        });
    }
}

function useDefaultName({defaultName}: Readonly<{defaultName: string}>) {
    return defaultName;
}

function omitServiceOptions() {
    return {};
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
                    getServiceOptions: omitServiceOptions,
                    getServiceName: useDefaultName,
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
                    'my-api': {
                        servicePort: 3000,
                        startServiceCwd: cwd,
                    },
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
                        api: {
                            servicePort: 4000,
                            startServiceCwd: apiCwd,
                        },
                    },
                    unrelated: true,
                }),
            );

            assert.deepEquals(
                await createEnsureServiceConfig({
                    configPath,
                    getServiceOptions: omitServiceOptions,
                    getServiceName: useDefaultName,
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
                    api: {
                        servicePort: 4000,
                        startServiceCwd: apiCwd,
                    },
                    web: {
                        servicePort: 4001,
                        startServiceCwd: webCwd,
                    },
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
                getServiceOptions: omitServiceOptions,
                getServiceName: useDefaultName,
                getServicePort: useDefaultPort,
                cwd,
            });
            const contentsBefore = await readFile(configPath, 'utf8');

            assert.deepEquals(
                await createEnsureServiceConfig({
                    configPath,
                    getServiceOptions() {
                        throw new Error('An existing service should not ask for options.');
                    },
                    getServiceName() {
                        throw new Error('An existing service should not ask for a name.');
                    },
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

    it('uses the chosen service name', async () => {
        await withTemporaryConfig(async ({configPath, temporaryDirectory}) => {
            const cwd = join(temporaryDirectory, 'api');

            assert.deepEquals(
                await createEnsureServiceConfig({
                    configPath,
                    getServiceOptions: omitServiceOptions,
                    getServiceName() {
                        return 'backend';
                    },
                    getServicePort: useDefaultPort,
                    cwd,
                }),
                {
                    configUpdate: ConfigUpdate.Created,
                    serviceName: 'backend',
                    servicePort: 3000,
                },
            );
            assert.deepEquals(await readJson(configPath), {
                services: {
                    backend: {
                        servicePort: 3000,
                        startServiceCwd: cwd,
                    },
                },
            });
        });
    });

    it('writes the chosen service options', async () => {
        await withTemporaryConfig(async ({configPath, temporaryDirectory}) => {
            const cwd = join(temporaryDirectory, 'api');
            const startServiceCwd = join(temporaryDirectory, 'other');

            await createEnsureServiceConfig({
                configPath,
                getServiceOptions() {
                    return {
                        healthCheckUrl: 'https://127.0.0.1:3000/health',
                        serviceStartCommand: 'npm run dev',
                        serviceStartTimeout: {
                            seconds: 30,
                        },
                        startServiceCwd,
                        useTailscaleService: true,
                    };
                },
                getServiceName: useDefaultName,
                getServicePort: useDefaultPort,
                cwd,
            });

            assert.deepEquals(await readJson(configPath), {
                services: {
                    api: {
                        healthCheckUrl: 'https://127.0.0.1:3000/health',
                        servicePort: 3000,
                        serviceStartCommand: 'npm run dev',
                        serviceStartTimeout: {
                            seconds: 30,
                        },
                        startServiceCwd,
                        useTailscaleService: true,
                    },
                },
            });
        });
    });

    it('tells getServiceOptions whether the config sets useTailscaleService', async () => {
        await withTemporaryConfig(async ({configPath, temporaryDirectory}) => {
            const writtenSettings = await awaitedBlockingMap(
                [
                    undefined,
                    false,
                ],
                async (useTailscaleService) => {
                    await writeFile(
                        configPath,
                        JSON.stringify({
                            services: {},
                            useTailscaleService,
                        }),
                    );
                    await createEnsureServiceConfig({
                        configPath,
                        getServiceOptions({isTailscaleSetByConfig}) {
                            return {
                                useTailscaleService: isTailscaleSetByConfig,
                            };
                        },
                        getServiceName: useDefaultName,
                        getServicePort: useDefaultPort,
                        cwd: join(temporaryDirectory, 'api'),
                    });

                    return (await readJsonWithShape(configPath, configShape)).services.api
                        ?.useTailscaleService;
                },
            );

            assert.deepEquals(writtenSettings, [
                false,
                true,
            ]);
        });
    });

    it('rejects an invalid chosen service name', async () => {
        await withTemporaryConfig(async ({configPath, temporaryDirectory}) => {
            await assert.throws(
                createEnsureServiceConfig({
                    configPath,
                    getServiceOptions: omitServiceOptions,
                    getServiceName() {
                        return 'Not Valid';
                    },
                    getServicePort: useDefaultPort,
                    cwd: join(temporaryDirectory, 'api'),
                }),
            );
        });
    });

    it('rejects a service name already used by another directory', async () => {
        await withTemporaryConfig(async ({configPath, temporaryDirectory}) => {
            await createEnsureServiceConfig({
                configPath,
                getServiceOptions: omitServiceOptions,
                getServiceName: useDefaultName,
                getServicePort: useDefaultPort,
                cwd: join(temporaryDirectory, 'first', 'api'),
            });

            await assert.throws(
                createEnsureServiceConfig({
                    configPath,
                    getServiceOptions: omitServiceOptions,
                    getServiceName: useDefaultName,
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
                getServiceOptions: omitServiceOptions,
                getServiceName: useDefaultName,
                getServicePort: useDefaultPort,
                cwd: join(temporaryDirectory, 'api'),
            });

            await assert.throws(
                createEnsureServiceConfig({
                    configPath,
                    cwd: join(temporaryDirectory, 'web'),
                    getServiceOptions: omitServiceOptions,
                    getServiceName: useDefaultName,
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
                    getServiceOptions: omitServiceOptions,
                    getServiceName: useDefaultName,
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
                    api: {
                        servicePort: 3000,
                        startServiceCwd: cwd,
                    },
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
                getServiceOptions: omitServiceOptions,
                getServiceName: useDefaultName,
                getServicePort: useDefaultPort,
                cwd,
                shouldOverwrite: true,
            });

            assert.deepEquals(await readJson(configPath), {
                services: {
                    api: {
                        servicePort: 3000,
                        startServiceCwd: cwd,
                    },
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
