import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {checkValidShape} from 'object-shape-tester';
import {configShape, resolveServiceOptions, serviceNameShape} from './config.js';

describe('configShape', () => {
    it('accepts multiple services with partial options', () => {
        assert.isTrue(
            checkValidShape(
                {
                    services: {
                        api: {
                            servicePort: 4000,
                        },
                        'web-app-2': {
                            servicePort: 4001,
                            serviceStartCommand: 'npm run serve',
                        },
                    },
                },
                configShape,
            ),
        );
    });

    it('rejects invalid service options', () => {
        assert.deepEquals(
            [
                checkValidShape(
                    {
                        services: {
                            api: {
                                servicePort: 4000,
                                healthCheckTimeout: 'one second',
                            },
                        },
                    },
                    configShape,
                ),
                checkValidShape(
                    {
                        services: {
                            api: {},
                        },
                    },
                    configShape,
                ),
                checkValidShape(
                    {
                        servicePort: 4000,
                    },
                    configShape,
                ),
            ],
            [
                false,
                false,
                false,
            ],
        );
    });
});

describe('serviceNameShape', () => {
    it('accepts DNS labels', () => {
        assert.deepEquals(
            [
                'a',
                'api',
                'web-app-2',
                '2fa',
                'a'.repeat(63),
            ].map((serviceName) => checkValidShape(serviceName, serviceNameShape)),
            [
                true,
                true,
                true,
                true,
                true,
            ],
        );
    });

    it('rejects names that are not DNS labels', () => {
        assert.deepEquals(
            [
                '',
                'Api',
                'web_app',
                '-api',
                'api-',
                'api.internal',
                '../api',
                'a'.repeat(64),
            ].map((serviceName) => checkValidShape(serviceName, serviceNameShape)),
            [
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                false,
            ],
        );
    });
});

describe(resolveServiceOptions.name, () => {
    it('derives defaults from the service name and port', () => {
        const resolvedOptions = resolveServiceOptions({
            serviceName: 'api',
            serviceOptions: {
                servicePort: 4000,
            },
        });

        assert.deepEquals(
            [
                resolvedOptions.healthCheckUrl,
                resolvedOptions.lockFilePath.endsWith('/ensure-service/api/lock'),
                resolvedOptions.logDirPath.endsWith('/ensure-service/api/logs'),
            ],
            [
                'http://127.0.0.1:4000/health',
                true,
                true,
            ],
        );
    });

    it('rejects an invalid service name', () => {
        assert.throws(() => {
            resolveServiceOptions({
                serviceName: '../api',
                serviceOptions: {
                    servicePort: 4000,
                },
            });
        });
    });
});
