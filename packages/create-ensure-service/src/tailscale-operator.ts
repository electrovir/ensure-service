// cspell:word prefs

import {wrapInTry} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {userInfo} from 'node:os';
import {checkValidShape, defineShape, nullableShape} from 'object-shape-tester';

const tailscalePreferencesShape = defineShape({
    OperatorUser: nullableShape(''),
});

/**
 * Create the command that lets `username` change Tailscale serve settings without root, which
 * ensure-service needs on Linux to publish Tailscale Services from cron.
 *
 * @category Internal
 * @returns The command, or `undefined` if `username` is already the operator or `preferencesJson`
 *   is not `tailscale debug prefs` output.
 */
export function createTailscaleOperatorCommand({
    preferencesJson,
    username,
}: Readonly<{
    /** Output of `tailscale debug prefs`. */
    preferencesJson: string;
    username: string;
}>) {
    const preferences: unknown = wrapInTry(() => JSON.parse(preferencesJson) as unknown, {
        fallbackValue: undefined,
    });

    if (
        !checkValidShape(preferences, tailscalePreferencesShape, {
            allowExtraKeys: true,
        }) ||
        preferences.OperatorUser === username
    ) {
        return undefined;
    }

    return `sudo tailscale set --operator=${username}`;
}

/**
 * Find the command the current user must run so ensure-service can publish Tailscale Services. Only
 * Linux restricts serve settings to root and the operator user.
 *
 * @category Internal
 * @returns The command, or `undefined` if none is needed or Tailscale is not installed.
 */
export async function findTailscaleOperatorCommand() {
    const {uid, username} = userInfo();

    if (process.platform !== 'linux' || !uid) {
        return undefined;
    }

    const {exitCode, stdout} = await runShellCommand('tailscale debug prefs');

    return exitCode
        ? undefined
        : createTailscaleOperatorCommand({
              preferencesJson: stdout,
              username,
          });
}
