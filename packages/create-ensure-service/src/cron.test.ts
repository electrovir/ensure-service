import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createEnsureServiceCrontab} from './cron.js';

describe(createEnsureServiceCrontab.name, () => {
    it('places a single managed cron entry ahead of existing entries', () => {
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
                'SHELL=/bin/bash',
                'HOME=/home/example',
                'BASH_ENV=$HOME/.bashrc',
                "* * * * * ensure-service '/home/example/.config/ensure-service/config.json'",
                '0 * * * * other-command',
                '',
            ].join('\n'),
        );
    });
});
