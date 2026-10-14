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

To setup this package and install a cron for it on a fresh server, run the following:

```sh
npm init ensure-service
```

This command:

1. Installs `ensure-service` globally, unless it's already installed globally.
2. Adds a service for the directory where you run it to `~/.config/ensure-service/config.json`, creating the file if needed. Run it again from another directory to add another service.
3. Creates `~/.config/ensure-service/tailscale-key.json` with empty values if it's missing. See [Tailscale](#tailscale).
4. Adds the following to the top of your crontab, so every cron job runs in bash with `~/.bashrc` loaded:
    ```
    SHELL=/bin/bash
    HOME=<your home directory>
    BASH_ENV=$HOME/.bashrc
    ```
    - [explanation](https://electrovir.com/post/2025-08-16-T02-cron-jobs-that-dont-suck)
5. Adds a once-per-minute cron command that runs `ensure-service ~/.config/ensure-service/config.json` to the end of your crontab.

## Usage

This package is primarily intended to be used via CLI:

-   global install: `ensure-service my-config.json`
-   repo install: `npx ensure-service my-config.json`

Any file format supported by [`config-vir`](https://www.npmjs.com/package/config-vir) may be used for the config file.

There is also a JS API exported by this package that you can import and use (see the types exported by this package to know how to use it)

## Opening the config

Show `~/.config/ensure-service/config.json` (the file `npm init ensure-service` writes) in your file explorer:

```sh
ensure-service config
```

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

Each service with `useTailscaleService` is published as the [Tailscale Service](https://tailscale.com/kb/1552/tailscale-services) `svc:<service name>`, reachable from your tailnet at `https://<service name>.<tailnet name>.ts.net` with a certificate from Tailscale. ensure-service:

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
