# ensure-service

Restarts a configured service when its local HTTP health check fails. Most effective when triggered via cron.

## Install

For configuring an individual repo:

```sh
npm i -D ensure-service
```

For running this for any service on your computer/server:

```sh
npm i -g ensure-service
```

## Init

To set up this package and install a cron for it on a fresh server, run the following from the directory of the service you want to keep running:

```sh
npm init ensure-service
```

This installs `ensure-service` globally, unless it's already installed globally, and then runs `ensure-service init`. If `ensure-service` is already installed globally, you can run `ensure-service init` directly. It:

1. Adds a service for the current directory to `~/.config/ensure-service/config.json`, creating the file if needed. Run it again from another directory to add another service.
2. Creates `~/.config/ensure-service/tailscale-key.json` with empty values (readable only by you) if it's missing. See [Tailscale](#tailscale).
3. Removes non-interactive Bash guards from `~/.bashrc` when present.
4. Adds the following to the top of your crontab, so every cron job runs in bash with `~/.bashrc` loaded:
    ```
    SHELL=/bin/bash
    HOME=<your home directory>
    BASH_ENV=$HOME/.bashrc
    ```
    - [explanation](https://electrovir.com/post/2025-08-16-T02-cron-jobs-that-dont-suck)
5. Adds a once-per-minute cron command that runs `ensure-service ~/.config/ensure-service/config.json` to the end of your crontab.
6. On Linux, prints the `sudo tailscale set --operator=<user>` command to run if you are not already Tailscale's operator, since Tailscale Services cannot be published from cron without it.

Init asks for each service's name, suggesting one based on its directory (lowercased, with other characters turned into `-`), and its port. It then asks for `serviceStartCommand`, `startServiceCwd`, `healthCheckUrl`, and `useTailscaleService` (see [Config](#config)). Leave an answer blank to keep that option at its default. `startServiceCwd` defaults to the current directory, and the others are left out of the config. Init skips the `useTailscaleService` question when the config already sets `useTailscaleService` at the top level. Each question is also skipped when its flag is given, so passing every prompted flag runs init without prompts. Pass `--skip-prompts` to skip every question, treating each one without a flag as left blank. Rerunning from a directory that is already configured leaves the config unchanged. If the existing config file is not a valid config, it is replaced with a new one containing only the current service.

| Flag                              | Description                                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `--name`                          | Name for this service. When omitted, init asks for it.                                                                                   |
| `--port`                          | Port this service listens on. When omitted, init asks for it, suggesting one more than the highest port already in the config (or 3000). |
| `--service-start-command`         | `serviceStartCommand`. When omitted, init asks for it.                                                                                   |
| `--start-service-cwd`             | `startServiceCwd`, resolved against the current directory. When omitted, init asks for it.                                               |
| `--health-check-url`              | `healthCheckUrl`. When omitted, init asks for it.                                                                                        |
| `--use-tailscale-service`         | `useTailscaleService`, either `true` or `false`. When omitted, init asks for it unless the config sets it at the top level.              |
| `--health-check-timeout-seconds`  | `healthCheckTimeout`, in seconds.                                                                                                        |
| `--service-start-timeout-seconds` | `serviceStartTimeout`, in seconds.                                                                                                       |
| `--log-dir-path`                  | `logDirPath`, resolved against the current directory.                                                                                    |
| `--lock-file-path`                | `lockFilePath`, resolved against the current directory.                                                                                  |
| `--skip-prompts`                  | Skip every question. Options without a flag use their defaults.                                                                          |
| `--overwrite`                     | Replace the existing config with one containing only this service.                                                                       |

## Usage

This package is primarily intended to be used via CLI:

-   global install: `ensure-service my-config.json`
-   repo install: `npx ensure-service my-config.json`

Any file format supported by [`config-vir`](https://www.npmjs.com/package/config-vir) may be used for the config file.

There is also a JS API exported by this package that you can import and use (see the types exported by this package to know how to use it)

## Opening the config

Show `~/.config/ensure-service/config.json` (the file `ensure-service init` writes) in your file explorer:

```sh
ensure-service config
```

## Restarting services

Restart services from `~/.config/ensure-service/config.json` right away, even if they are healthy:

```sh
ensure-service restart api web-app
```

With no service names, it asks which one service to restart. It fails without restarting anything if a name is not in the config, and it fails for a service that a cron run is checking at the same moment.

## Finding service processes

Each service started by ensure-service runs in its own process group, led by a shell labeled `ensure-service:<service-name>`. List every running process ensure-service started, grouped by service:

```sh
ensure-service list
```

To stop a service and everything it started, run `kill -- -<process group>` for each process group that `ensure-service list` prints for it.

## Config

The config lists every service to check under `services`, keyed by service name. All services are checked in parallel on each run, and one failing service does not stop the others.

```json
{
    "services": {
        "api": {
            "servicePort": 3000,
            "startServiceCwd": "/home/me/repos/api"
        },
        "web-app": {
            "servicePort": 8080,
            "serviceStartCommand": "npm run serve",
            "startServiceCwd": "/home/me/repos/web-app"
        }
    }
}
```

Set the optional top-level `useTailscaleService` to `true` to run every service as a Tailscale service. Each service can override it by setting its own `useTailscaleService`. See [Tailscale](#tailscale) for the required setup.

Service names must be a single DNS label: lowercase letters, digits, and hyphens, at most 63 characters, not starting or ending with a hyphen.

Each service requires `servicePort`. All other fields are optional: any field omitted, set to `undefined`, or set to `null` will fallback to its default noted below. Two services may not share a `servicePort`, `lockFilePath`, or `logDirPath`.

| Option                | Default                                       | Description                                                                                                                                              |
| --------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `healthCheckTimeout`  | `{seconds: 10}`                               | Maximum time to wait for the health-check request before considering the service unhealthy.                                                              |
| `healthCheckUrl`      | `http://127.0.0.1:<servicePort>/health`       | URL that must return a successful HTTP response for the service to be considered healthy. An `http:` URL is checked over HTTPS when its port speaks TLS. |
| `lockFilePath`        | `~/.config/ensure-service/<serviceName>/lock` | File used to prevent overlapping checks.                                                                                                                 |
| `logDirPath`          | `~/.config/ensure-service/<serviceName>/logs` | Directory where stdout and stderr from restarted services are written.                                                                                   |
| `serviceStartCommand` | `npm start`                                   | Shell command used to start the service after a failed health check.                                                                                     |
| `serviceStartTimeout` | `{minutes: 5}`                                | Grace period after a service start: a recently updated log directory prevents another restart while the service boots.                                   |
| `servicePort`         | Required                                      | Port whose listening processes are stopped before the service is restarted, along with every process from the service's previous start.                  |
| `startServiceCwd`     | Current working directory                     | Directory in which `serviceStartCommand` runs.                                                                                                           |
| `useTailscaleService` | Top-level `useTailscaleService`               | Run this service as a Tailscale service. See [Tailscale](#tailscale).                                                                                    |

Timeouts accept objects with one or more units, such as `{seconds: 30}` or `{minutes: 2, seconds: 30}`.

## Tailscale

Each service with `useTailscaleService` is published as the [Tailscale Service](https://tailscale.com/kb/1552/tailscale-services) `svc:<service name>`, reachable from your tailnet at `https://<service name>.<tailnet name>.ts.net` with a certificate from Tailscale. Once the service passes its health check, ensure-service:

1. Creates the Tailscale Service, or adds port 443 to an existing one. Its other settings are kept.
2. Runs `tailscale serve` so this machine forwards the Service's HTTPS traffic to the service's port. If the service's `healthCheckUrl` uses HTTPS, or its port speaks TLS, traffic is forwarded over HTTPS without verifying the service's own certificate, so self-signed certificates work.
3. Approves this machine as a host of the Tailscale Service.

This needs the `tailscale` CLI on this machine and a Tailscale OAuth client so ensure-service can call the Tailscale API:

1. Open the [Trust credentials](https://console.tailscale.com/admin/settings/trust-credentials) page of the Tailscale admin console and create an OAuth client. Only Owners, Admins, Network admins, and IT admins can create one.
2. Give it these two scopes and no others:
    - **Services**: read and write.
    - **Devices Core**: read and write. Add the tag this machine uses, such as `tag:server`.
3. Fill in the client ID and secret in `~/.config/ensure-service/tailscale-key.json`:
    ```json
    {
        "clientId": "<client ID>",
        "clientSecret": "tskey-client-..."
    }
    ```

If `tailscale-key.json` is missing, ensure-service creates it with empty values. It makes the file readable only by its owner before every read. If it cannot fix the file's permissions, it logs an error and skips Tailscale for that run.

Tailscale checks run at most once every 30 minutes per service, tracked in `~/.config/ensure-service/tailscale-progress.json`. Delete that file to check every service on the next run.

Tailscale only lets a machine host a Service if it is logged in with a tag, not a user account.
