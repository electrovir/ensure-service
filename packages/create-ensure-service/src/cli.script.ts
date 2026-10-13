#!/usr/bin/env node

import {log} from '@augment-vir/common';
import {ArgValueType, FlagRequirement, parseArgs} from 'cli-vir';
import {resolve} from 'node:path';
import {runInitCli} from './cli.js';
import {ConfigUpdate} from './create-config.js';

const {name, overwrite, port} = parseArgs(
    process.argv,
    {
        name: {
            description: 'Name for this service. When omitted, you are prompted for it.',
            flag: {
                valueRequirement: FlagRequirement.Required,
            },
            type: ArgValueType.String,
        },
        overwrite: {
            description:
                'Replace an existing configuration file with one containing only this service.',
            flag: {
                valueRequirement: FlagRequirement.Blocked,
            },
            type: ArgValueType.Boolean,
        },
        port: {
            description: 'Port this service listens on. When omitted, you are prompted for it.',
            flag: {
                valueRequirement: FlagRequirement.Required,
            },
            type: ArgValueType.Number,
        },
    },
    {
        binName: 'create-ensure-service',
        importMeta: import.meta,
        packageJsonPath: resolve(import.meta.dirname, '..', 'package.json'),
    },
);

const {configPath, configUpdate, didInstall, serviceName, servicePort, tailscaleKeyFilePath} =
    await runInitCli({
        serviceName: name || undefined,
        servicePort: port === false ? undefined : port,
        shouldOverwrite: overwrite,
    });

const configUpdateMessages: Record<ConfigUpdate, string> = {
    [ConfigUpdate.Created]: `Created ${configPath} with service '${serviceName}' on port ${servicePort}.`,
    [ConfigUpdate.Added]: `Added service '${serviceName}' on port ${servicePort} to ${configPath}.`,
    [ConfigUpdate.Unchanged]: `Service '${serviceName}' is already in ${configPath}.`,
};

log.success(
    [
        didInstall
            ? 'Installed ensure-service globally.'
            : 'ensure-service was already installed globally.',
        configUpdateMessages[configUpdate],
        `To use Tailscale Services, fill in ${tailscaleKeyFilePath}.`,
        'Configured ensure-service to run once per minute.',
    ].join('\n'),
);
