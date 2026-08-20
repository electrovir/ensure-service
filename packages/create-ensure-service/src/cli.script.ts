#!/usr/bin/env node

import {log} from '@augment-vir/common';
import {ArgValueType, FlagRequirement, parseArgs} from 'cli-vir';
import {runInitCli} from './cli.js';

const {overwrite} = parseArgs(
    process.argv,
    {
        overwrite: {
            description: 'Overwrite an existing configuration file.',
            flag: {
                valueRequirement: FlagRequirement.Blocked,
            },
            type: ArgValueType.Boolean,
        },
    },
    {
        binName: 'create-ensure-service',
        importMeta: import.meta,
    },
);

const {configPath} = await runInitCli({
    shouldOverwrite: overwrite,
});

log.success(
    [
        'Installed ensure-service globally.',
        `Ensured configuration at ${configPath}.`,
        'Configured ensure-service to run once per minute.',
    ].join('\n'),
);
