#!/usr/bin/env node

import {getObjectTypedKeys} from '@augment-vir/common';
import {parseArgs} from 'cli-vir';
import {loadConfig} from 'config-vir';
import {resolve} from 'node:path';
import {configShape} from './config.js';
import {ensureServices} from './ensure.js';

const {configPath} = parseArgs(
    process.argv,
    {
        configPath: {
            position: 0,
            required: true,
            description:
                'Path to a JSON, YAML, TOML, JavaScript, or TypeScript file containing the service check configuration.',
        },
    },
    {
        binName: 'ensure-service',
        importMeta: import.meta,
    },
);

const resolvedConfigPath = resolve(configPath);
const config = await loadConfig({
    configPath: resolvedConfigPath,
    configShape,
});

const results = await ensureServices(config);
const failedServiceNames = getObjectTypedKeys(results).filter(
    (serviceName) => results[serviceName] instanceof Error,
);

if (failedServiceNames.length) {
    throw new AggregateError(
        failedServiceNames.map((serviceName) => results[serviceName]),
        `Failed to ensure services: ${failedServiceNames.join(', ')}.`,
    );
}
