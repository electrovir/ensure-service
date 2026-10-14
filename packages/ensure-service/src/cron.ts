import {shellQuote} from '@augment-vir/common';

/**
 * Create the idempotent crontab content that runs ensure-service once per minute: shell setup at
 * the top and the ensure-service entry last. Existing setup lines and entries are replaced.
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
    const retainedCrontab = currentCrontab
        .split('\n')
        .filter((line) => {
            return (
                !environmentLines.includes(line) && !line.startsWith('* * * * * ensure-service ')
            );
        })
        .join('\n')
        .trim();

    return (
        [
            ...environmentLines,
            '',
            ...(retainedCrontab
                ? [
                      retainedCrontab,
                  ]
                : []),
            `* * * * * ensure-service ${shellQuote(configPath)}`,
        ].join('\n') + '\n'
    );
}
