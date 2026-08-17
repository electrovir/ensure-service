#!/usr/bin/env node

import {parseArgs} from 'cli-vir';
import {loadConfig} from 'config-vir';
import {resolve} from 'node:path';
import {configOptionsShape} from './config.js';
import {ensureService} from './ensure.js';

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
    configShape: configOptionsShape,
});

await ensureService(config);
