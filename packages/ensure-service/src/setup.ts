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
 * @returns Whether the crontab was changed. It is left alone when it already matches.
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
        return false;
    }

    const currentCrontab = crontabOutput.error ? '' : crontabOutput.stdout;
    const newCrontab = createEnsureServiceCrontab({
        configPath,
        currentCrontab,
        homePath,
    });

    if (newCrontab.trim() === currentCrontab.trim()) {
        return false;
    }

    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
    const crontabFilePath = join(temporaryDirectory, 'crontab');

    try {
        await writeFile(crontabFilePath, newCrontab);
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

    return true;
}
