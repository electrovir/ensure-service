import {shellQuote} from '@augment-vir/common';

/**
 * Create the idempotent crontab content that runs ensure-service once per minute.
 *
 * @category Internal
 */
export function createEnsureServiceCrontab({
    configPath,
    currentCrontab,
    homePath,
}: Readonly<{
    configPath: string;
    currentCrontab: string;
    homePath: string;
}>) {
    const environmentLines = [
        'SHELL=/bin/bash',
        `HOME=${homePath}`,
        'BASH_ENV=$HOME/.bashrc',
    ];
    const cronLine = `* * * * * ensure-service ${shellQuote(configPath)}`;
    const currentLines = currentCrontab.trim() ? currentCrontab.trim().split('\n') : [];
    const retainedLines = currentLines.filter((line) => {
        return !environmentLines.includes(line) && !line.startsWith('* * * * * ensure-service ');
    });

    return (
        [
            ...environmentLines,
            cronLine,
            ...retainedLines,
        ].join('\n') + '\n'
    );
}
