import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createEnsureServiceCrontab} from './cron.js';

describe(createEnsureServiceCrontab.name, () => {
    const bashEnvironmentLines = [
        'SHELL=/bin/bash',
        'HOME=/home/example',
        'BASH_ENV=$HOME/.bashrc',
    ];
    const bashCronLine =
        "* * * * * ensure-service '/home/example/.config/ensure-service/config.json'";

    it('moves an existing managed entry after existing entries', () => {
        assert.deepEquals(
            createEnsureServiceCrontab({
                configPath: '/home/example/.config/ensure-service/config.json',
                currentCrontab: [
                    'SHELL=/bin/bash',
                    'HOME=/home/example',
                    'BASH_ENV=$HOME/.bashrc',
                    "* * * * * ensure-service '/old/config.json'",
                    '0 * * * * other-command',
                ].join('\n'),
                homePath: '/home/example',
            }),
            [
                ...bashEnvironmentLines,
                '',
                '0 * * * * other-command',
                bashCronLine,
                '',
            ].join('\n'),
        );
    });

    it("keeps the user's own environment lines below the managed ones", () => {
        assert.deepEquals(
            createEnsureServiceCrontab({
                configPath: '/home/example/.config/ensure-service/config.json',
                currentCrontab: [
                    'MAILTO=example@example.com',
                    'SHELL=/bin/bash',
                    '0 * * * * other-command',
                ].join('\n'),
                homePath: '/home/example',
            }),
            [
                ...bashEnvironmentLines,
                '',
                'MAILTO=example@example.com',
                '0 * * * * other-command',
                bashCronLine,
                '',
            ].join('\n'),
        );
    });
});
