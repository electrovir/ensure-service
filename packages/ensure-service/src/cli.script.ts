#!/usr/bin/env node

import {getObjectTypedKeys, log} from '@augment-vir/common';
import {parseArgs} from 'cli-vir';
import {loadConfig} from 'config-vir';
import {resolve} from 'node:path';
import {configShape, defaultConfigPath} from './config.js';
import {ensureServices} from './ensure.js';
import {revealFile} from './file.js';
import {createInitParams, initArgs, runInit} from './init.js';
import {listServiceProcessGroups} from './process.js';
import {runRestart} from './restart.js';

const {configPath, serviceNames, ...initArgValues} = parseArgs(
    process.argv,
    {
        configPath: {
            position: 0,
            required: true,
            description: `
                Path to a JSON, YAML, TOML, JavaScript, or TypeScript file containing the service check configuration.
                Pass 'list' instead to list the running processes of services started by ensure-service.
                Pass 'config' instead to show the default config file in your file explorer.
                Pass 'init' instead to add the current directory as a service in the default config file and run that config once per minute through a cron.
                Pass 'restart' instead to restart services from the default config file.
            `,
        },
        serviceNames: {
            position: {
                rest: true,
            },
            description: `
                With 'restart', the names of the services to restart. When omitted, asks which service to restart.
            `,
        },
        ...initArgs,
    },
    {
        binName: 'ensure-service',
        importMeta: import.meta,
        packageJsonPath: resolve(import.meta.dirname, '..', 'package.json'),
    },
);

if (configPath === 'list') {
    const processGroups = await listServiceProcessGroups();

    log.plain(
        processGroups.length
            ? processGroups
                  .flatMap(({processes, processGroupIds, serviceName}) => {
                      return [
                          `${serviceName} (process groups ${processGroupIds.join(', ')})`,
                          ...processes.map(({command, processId}) => {
                              return `    ${processId} ${command}`;
                          }),
                      ];
                  })
                  .join('\n')
            : 'No services started by ensure-service are running.',
    );
} else if (configPath === 'config') {
    await revealFile(defaultConfigPath);
} else if (configPath === 'init') {
    await runInit(createInitParams(initArgValues));
} else if (configPath === 'restart') {
    await runRestart(serviceNames);
} else {
    await ensureConfigServices(resolve(configPath));
}

async function ensureConfigServices(resolvedConfigPath: string) {
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
}
