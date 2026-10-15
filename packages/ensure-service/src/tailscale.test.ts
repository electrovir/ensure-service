// cspell:word addrs

import {assert} from '@augment-vir/assert';
import {randomString} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {chmod, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveServiceOptions} from './config.js';
import {type TailscaleOauthKey} from './tailscale-api.js';
import {createMockTailscaleHost, createRandomTailscaleAddresses} from './tailscale-api.mock.js';
import {
    createTailscaleAccessTokenGetter,
    ensureTailscaleService,
    readTailscaleOauthClient,
} from './tailscale.js';

async function withTemporaryDirectory(callback: (directoryPath: string) => Promise<void>) {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-tailscale-'));

    try {
        await callback(temporaryDirectory);
    } finally {
        await rm(temporaryDirectory, {
            force: true,
            recursive: true,
        });
    }
}

function createRandomOauthClient() {
    return {
        clientId: randomString(12),
        clientSecret: `tskey-client-${randomString(32)}`,
    };
}

async function getPermissions(filePath: string) {
    return (await stat(filePath)).mode & 0o777;
}

function createServices() {
    return {
        api: resolveServiceOptions({
            serviceName: 'api',
            serviceOptions: {
                servicePort: 4000,
                useTailscaleService: true,
            },
        }),
        web: resolveServiceOptions({
            serviceName: 'web',
            serviceOptions: {
                servicePort: 4001,
            },
        }),
        worker: resolveServiceOptions({
            serviceName: 'worker',
            serviceOptions: {
                servicePort: 4002,
                useTailscaleService: true,
            },
        }),
    };
}

describe(readTailscaleOauthClient.name, () => {
    it('creates an owner-only key file with empty values', async () => {
        await withTemporaryDirectory(async (directoryPath) => {
            const keyFilePath = join(directoryPath, 'nested', 'tailscale-key.json');

            assert.isUndefined(await readTailscaleOauthClient(keyFilePath));
            assert.deepEquals(
                [
                    JSON.parse(await readFile(keyFilePath, 'utf8')),
                    await getPermissions(keyFilePath),
                ],
                [
                    {
                        clientId: '',
                        clientSecret: '',
                    },
                    0o600,
                ],
            );
        });
    });

    it('restricts permissions on an existing key file', async () => {
        await withTemporaryDirectory(async (directoryPath) => {
            const keyFilePath = join(directoryPath, 'tailscale-key.json');
            const oauthClient = createRandomOauthClient();

            await writeFile(keyFilePath, JSON.stringify(oauthClient));
            await chmod(keyFilePath, 0o644);

            assert.deepEquals(await readTailscaleOauthClient(keyFilePath), oauthClient);
            assert.strictEquals(await getPermissions(keyFilePath), 0o600);
        });
    });
});

describe(ensureTailscaleService.name, () => {
    async function setupTailscale({
        directoryPath,
        oauthClient,
    }: Readonly<{
        directoryPath: string;
        oauthClient?: Readonly<TailscaleOauthKey> | undefined;
    }>) {
        const keyFilePath = join(directoryPath, 'tailscale-key.json');
        const mockTailscaleHost = createMockTailscaleHost();

        await writeFile(keyFilePath, JSON.stringify(oauthClient || mockTailscaleHost.oauthClient), {
            mode: 0o600,
        });

        return {
            mockTailscaleHost,
            params: {
                client: mockTailscaleHost.client,
                getAccessToken: createTailscaleAccessTokenGetter({
                    client: mockTailscaleHost.client,
                    keyFilePath,
                }),
                progressFilePath: join(directoryPath, 'tailscale-progress.json'),
                tailscaleCli: mockTailscaleHost.tailscaleCli,
            },
        };
    }

    it('checks a due service once per interval', async () => {
        await withTemporaryDirectory(async (directoryPath) => {
            const {mockTailscaleHost, params} = await setupTailscale({
                directoryPath,
            });
            const services = createServices();

            assert.deepEquals(
                [
                    await ensureTailscaleService({
                        ...params,
                        service: services.api,
                        serviceName: 'api',
                    }),
                    await ensureTailscaleService({
                        ...params,
                        service: services.api,
                        serviceName: 'api',
                    }),
                ],
                [
                    true,
                    false,
                ],
            );
            assert.isLengthExactly(mockTailscaleHost.issuedAccessTokens, 1);
        });
    });

    it('only reruns tailscale serve when the forwarding target changes', async () => {
        await withTemporaryDirectory(async (directoryPath) => {
            const {mockTailscaleHost, params} = await setupTailscale({
                directoryPath,
            });
            async function checkApi(healthCheckUrl: string) {
                await rm(params.progressFilePath, {
                    force: true,
                });
                await ensureTailscaleService({
                    ...params,
                    service: resolveServiceOptions({
                        serviceName: 'api',
                        serviceOptions: {
                            healthCheckUrl,
                            servicePort: 4000,
                            useTailscaleService: true,
                        },
                    }),
                    serviceName: 'api',
                });
            }

            await checkApi('http://localhost:4000/health');
            await checkApi('http://localhost:4000/health');
            await checkApi('https://localhost:4000/health');

            assert.deepEquals(
                mockTailscaleHost.servedServices.map((servedService) => servedService.target),
                [
                    'http://localhost:4000',
                    'https+insecure://localhost:4000',
                ],
            );
        });
    });

    it('publishes a service over HTTPS and approves this device as its host', async () => {
        await withTemporaryDirectory(async (directoryPath) => {
            const {mockTailscaleHost, params} = await setupTailscale({
                directoryPath,
            });

            await ensureTailscaleService({
                ...params,
                service: createServices().api,
                serviceName: 'api',
            });

            assert.deepEquals(
                {
                    approvedHosts: mockTailscaleHost.approvedHosts,
                    ports: mockTailscaleHost.tailscaleServices['svc:api']?.ports,
                    servedServices: mockTailscaleHost.servedServices,
                },
                {
                    approvedHosts: [
                        {
                            deviceId: mockTailscaleHost.deviceId,
                            tailscaleServiceName: 'svc:api',
                        },
                    ],
                    ports: [
                        'tcp:443',
                    ],
                    servedServices: [
                        {
                            tailscaleServiceName: 'svc:api',
                            target: 'http://localhost:4000',
                        },
                    ],
                },
            );
        });
    });

    it("keeps an existing Service's settings and serves an HTTPS service without verifying its certificate", async () => {
        await withTemporaryDirectory(async (directoryPath) => {
            const {mockTailscaleHost, params} = await setupTailscale({
                directoryPath,
            });
            const existingService = {
                addrs: createRandomTailscaleAddresses(),
                comment: randomString(),
                name: 'svc:api',
                ports: [
                    'tcp:80',
                ],
                tags: [
                    'tag:example',
                ],
            };
            mockTailscaleHost.tailscaleServices['svc:api'] = existingService;

            await ensureTailscaleService({
                ...params,
                service: resolveServiceOptions({
                    serviceName: 'api',
                    serviceOptions: {
                        healthCheckUrl: 'https://localhost:4000/health',
                        servicePort: 4000,
                        useTailscaleService: true,
                    },
                }),
                serviceName: 'api',
            });

            assert.deepEquals(
                {
                    servedServices: mockTailscaleHost.servedServices,
                    tailscaleService: mockTailscaleHost.tailscaleServices['svc:api'],
                },
                {
                    servedServices: [
                        {
                            tailscaleServiceName: 'svc:api',
                            target: 'https+insecure://localhost:4000',
                        },
                    ],
                    tailscaleService: {
                        ...existingService,
                        ports: [
                            'tcp:80',
                            'tcp:443',
                        ],
                    },
                },
            );
        });
    });

    it('shares one access token across services', async () => {
        await withTemporaryDirectory(async (directoryPath) => {
            const {mockTailscaleHost, params} = await setupTailscale({
                directoryPath,
            });
            const services = createServices();

            await Promise.all(
                (
                    [
                        'api',
                        'worker',
                    ] as const
                ).map(async (serviceName) => {
                    return await ensureTailscaleService({
                        ...params,
                        service: services[serviceName],
                        serviceName,
                    });
                }),
            );

            assert.isLengthExactly(mockTailscaleHost.issuedAccessTokens, 1);
        });
    });

    it('skips a service that does not use Tailscale', async () => {
        await withTemporaryDirectory(async (directoryPath) => {
            const {mockTailscaleHost, params} = await setupTailscale({
                directoryPath,
            });

            assert.isFalse(
                await ensureTailscaleService({
                    ...params,
                    service: createServices().web,
                    serviceName: 'web',
                }),
            );
            assert.isLengthExactly(mockTailscaleHost.issuedAccessTokens, 0);
        });
    });

    it('keeps every service in the progress file when services are checked in parallel', async () => {
        await withTemporaryDirectory(async (directoryPath) => {
            const {params} = await setupTailscale({
                directoryPath,
            });
            const services = createServices();

            await Promise.all([
                ensureTailscaleService({
                    ...params,
                    service: services.api,
                    serviceName: 'api',
                }),
                ensureTailscaleService({
                    ...params,
                    service: services.worker,
                    serviceName: 'worker',
                }),
            ]);

            assert.deepEquals(
                Object.keys(JSON.parse(await readFile(params.progressFilePath, 'utf8'))).toSorted(),
                [
                    'api',
                    'worker',
                ],
            );
        });
    });

    it('waits for the next interval after an empty key file', async () => {
        await withTemporaryDirectory(async (directoryPath) => {
            const progressFilePath = join(directoryPath, 'tailscale-progress.json');
            const mockTailscaleHost = createMockTailscaleHost();

            assert.isFalse(
                await ensureTailscaleService({
                    client: mockTailscaleHost.client,
                    getAccessToken: createTailscaleAccessTokenGetter({
                        client: mockTailscaleHost.client,
                        keyFilePath: join(directoryPath, 'tailscale-key.json'),
                    }),
                    progressFilePath,
                    service: createServices().api,
                    serviceName: 'api',
                    tailscaleCli: mockTailscaleHost.tailscaleCli,
                }),
            );
            assert.isLengthExactly(mockTailscaleHost.issuedAccessTokens, 0);
            assert.hasKey(JSON.parse(await readFile(progressFilePath, 'utf8')), 'api');
        });
    });

    it('waits for the next interval after Tailscale rejects the OAuth client', async () => {
        await withTemporaryDirectory(async (directoryPath) => {
            const {mockTailscaleHost, params} = await setupTailscale({
                directoryPath,
                oauthClient: createRandomOauthClient(),
            });

            assert.isFalse(
                await ensureTailscaleService({
                    ...params,
                    service: createServices().api,
                    serviceName: 'api',
                }),
            );
            assert.isLengthExactly(mockTailscaleHost.issuedAccessTokens, 0);
            assert.hasKey(JSON.parse(await readFile(params.progressFilePath, 'utf8')), 'api');
        });
    });
});
