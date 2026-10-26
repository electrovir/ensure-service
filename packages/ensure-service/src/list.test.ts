import {assert} from '@augment-vir/assert';
import {LogColorKey, logColors} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {formatServiceProcessList} from './list.js';
import {parseServiceProcessGroups} from './process.js';

const processGroups = parseServiceProcessGroups(
    [
        String.raw`5686     1  5686 /bin/sh -c npm start ~/.config/hub-vir/config.json\012exit $? ensure-service:hub`,
        '5688  5686  5686 npm start /home/user/.config/hub-vir/config.json --port 9672',
        String.raw`5690     1  5690 /bin/sh -c npm run start\012exit $? ensure-service:gas`,
        '5691  5690  5690 npm run start',
        '5812  5691  5812 node file:///home/user/x /home/user/repos/gas-app/runstorm/watchdog.script.js',
    ].join('\n'),
);

describe(formatServiceProcessList.name, () => {
    it('separates services and shows how to stop each one', () => {
        const lines = formatServiceProcessList({
            homePath: '/home/user',
            processGroups,
        });

        assert.deepEquals(
            lines.slice(0, 3).map(({colorKey}) => colorKey),
            [
                LogColorKey.Info,
                LogColorKey.Faint,
                LogColorKey.Faint,
            ],
        );
        assert.strictEquals(
            lines.map(({text}) => text).join('\n'),
            [
                `${logColors.bold}gas${logColors.normalWeight} (3 processes)`,
                '  stop: kill -- -5690 -5812',
                '  5690  npm run start',
                '  5691  npm run start',
                '  5812  node file:///home/user/x ~/repos/gas-app/runstorm/watchdog.script.js',
                '',
                `${logColors.bold}hub${logColors.normalWeight} (2 processes)`,
                '  stop: kill -- -5686',
                '  5686  npm start ~/.config/hub-vir/config.json',
                '  5688  npm start ~/.config/hub-vir/config.json --port 9672',
            ].join('\n'),
        );
    });

    it('says when nothing is running', () => {
        assert.deepEquals(
            formatServiceProcessList({
                homePath: '/home/user',
                processGroups: [],
            }),
            [
                {
                    colorKey: LogColorKey.Plain,
                    text: 'No services started by ensure-service are running.',
                },
            ],
        );
    });
});
