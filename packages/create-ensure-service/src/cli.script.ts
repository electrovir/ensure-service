#!/usr/bin/env node

import {log} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {parseArgs} from 'cli-vir';
import {initArgs, runInit} from 'ensure-service';
import {resolve} from 'node:path';

const {name, overwrite, port} = parseArgs(process.argv, initArgs, {
    binName: 'create-ensure-service',
    importMeta: import.meta,
    packageJsonPath: resolve(import.meta.dirname, '..', 'package.json'),
});

if ((await runShellCommand('npm ls --global --depth=0 ensure-service')).exitCode) {
    await runShellCommand('npm install --global ensure-service', {
        hookUpToConsole: true,
        rejectOnError: true,
    });
    log.info('Installed ensure-service globally.');
} else {
    log.info('ensure-service was already installed globally.');
}

await runInit({
    serviceName: name || undefined,
    servicePort: port === false ? undefined : port,
    shouldOverwrite: overwrite,
});
