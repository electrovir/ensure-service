import {log, shellQuote} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEnsureServiceCrontab} from './cron.js';

/**
 * Add the managed ensure-service command and shell environment to the user's crontab.
 *
 * @category Internal
 */
export async function installEnsureServiceCron({
    configPath,
    homePath,
}: Readonly<{
    configPath: string;
    homePath: string;
}>) {
    const crontabOutput = await runShellCommand('crontab -l');

    if (crontabOutput.error && !crontabOutput.stderr.includes('no crontab')) {
        log.error('Unable to read the current crontab.');
        return;
    }

    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'create-ensure-service-'));
    const crontabFilePath = join(temporaryDirectory, 'crontab');

    try {
        await writeFile(
            crontabFilePath,
            createEnsureServiceCrontab({
                configPath,
                currentCrontab: crontabOutput.error ? '' : crontabOutput.stdout,
                homePath,
            }),
        );
        await runShellCommand(
            [
                'crontab',
                shellQuote(crontabFilePath),
            ].join(' '),
            {
                hookUpToConsole: true,
                rejectOnError: true,
            },
        );
    } finally {
        await rm(temporaryDirectory, {
            force: true,
            recursive: true,
        });
    }
}
