import {convertDuration} from 'date-vir';
import {execFile} from 'node:child_process';
import {access} from 'node:fs/promises';
import {promisify} from 'node:util';
import {assertValidShape, defineShape} from 'object-shape-tester';

/**
 * The parts of the local `tailscale` CLI that ensure-service uses.
 *
 * @category Internal
 */
export type TailscaleCli = {
    /** Read this device's stable node ID. */
    readDeviceId(): Promise<string>;
    /** Serve HTTPS on port 443 of a Tailscale Service, forwarding to a local target. */
    serveService(
        params: Readonly<{
            /** Includes the `svc:` prefix. */
            tailscaleServiceName: string;
            /** Such as `http://localhost:3000` or `https+insecure://localhost:3000`. */
            target: string;
        }>,
    ): Promise<void>;
};

const tailscaleStatusShape = defineShape({
    Self: {
        ID: '',
    },
});

/** The macOS app's CLI is not on `PATH`, which cron's minimal `PATH` would miss anyway. */
async function findTailscaleCliPath() {
    const macAppCliPath = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

    try {
        await access(macAppCliPath);
        return macAppCliPath;
    } catch {
        return 'tailscale';
    }
}

/**
 * Create a {@link TailscaleCli} that runs this device's `tailscale` CLI.
 *
 * @category Internal
 */
export function createTailscaleCli(): TailscaleCli {
    async function runTailscale(args: ReadonlyArray<string>) {
        return await promisify(execFile)(await findTailscaleCliPath(), args, {
            env: {
                ...process.env,
                /**
                 * Without `TERM`, which cron does not set, the macOS app's binary tries to open the
                 * GUI instead of acting as a CLI, and never exits.
                 */
                TERM: process.env.TERM || 'dumb',
            },
            /** A hung command would otherwise hold up this and every later run. */
            timeout: convertDuration(
                {
                    minutes: 1,
                },
                {
                    milliseconds: true,
                },
            ).milliseconds,
        });
    }

    return {
        async readDeviceId() {
            const status: unknown = JSON.parse(
                (
                    await runTailscale([
                        'status',
                        '--json',
                    ])
                ).stdout,
            );
            assertValidShape(status, tailscaleStatusShape, {
                allowExtraKeys: true,
            });

            return status.Self.ID;
        },
        async serveService({tailscaleServiceName, target}) {
            await runTailscale([
                'serve',
                '--bg',
                '--yes',
                `--service=${tailscaleServiceName}`,
                '--https=443',
                target,
            ]);
        },
    };
}
