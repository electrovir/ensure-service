import {LogColorKey, logColors} from '@augment-vir/common';
import {type parseServiceProcessGroups} from './process.js';
import {serviceProcessLabelPrefix} from './service.js';

/**
 * Format {@link parseServiceProcessGroups} results for `ensure-service list` as lines to pass to the
 * matching `log` method: one block per service with a header, the command that stops it, and one
 * line per process. The leading shell's line shows the service's start command without the wrapper
 * ensure-service adds, and `homePath` is shortened to `~`.
 *
 * @category Internal
 */
export function formatServiceProcessList({
    homePath,
    processGroups,
}: Readonly<{
    homePath: string;
    processGroups: ReadonlyArray<Readonly<ReturnType<typeof parseServiceProcessGroups>[number]>>;
}>) {
    if (!processGroups.length) {
        return [
            {
                colorKey: LogColorKey.Warning,
                text: 'No services started by ensure-service are running.',
            },
        ];
    }

    const processIdWidth = Math.max(
        ...processGroups.flatMap(({processes}) => {
            return processes.map(({processId}) => String(processId).length);
        }),
    );

    return processGroups.flatMap(({processes, processGroupIds, serviceName}) => {
        return [
            {
                colorKey: LogColorKey.Plain,
                text: '',
            },
            {
                colorKey: LogColorKey.Info,
                text: `${logColors.bold}${serviceName}${logColors.normalWeight} (${processes.length} ${processes.length === 1 ? 'process' : 'processes'})`,
            },
            {
                colorKey: LogColorKey.Faint,
                text: [
                    '  stop: kill --',
                    ...processGroupIds.map((processGroupId) => -processGroupId),
                ].join(' '),
            },
            ...processes.map(({command, processId}) => {
                return {
                    colorKey: LogColorKey.Faint,
                    text: `  ${String(processId).padEnd(processIdWidth)}  ${cleanServiceShellCommand(
                        command,
                    )
                        .split(' ')
                        .map((word) => {
                            return word.startsWith(homePath)
                                ? `~${word.slice(homePath.length)}`
                                : word;
                        })
                        .join(' ')}`,
                };
            }),
        ];
    });
}

function cleanServiceShellCommand(command: string) {
    /** `ps` prints the newline before the wrapper's `exit $?` as `\012`. */
    return (
        new RegExp(
            String.raw`^/bin/sh -c (.*)(?:\\012|\n)exit \$\? ${serviceProcessLabelPrefix}\S+$`,
            's',
        ).exec(command)?.[1] || command
    );
}
