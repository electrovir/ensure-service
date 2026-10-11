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
3. Adds the following to the top of your crontab:
    ```
    SHELL=/bin/bash
    HOME=<your home directory>
    BASH_ENV=$HOME/.bashrc
    ```
    - [explanation](https://electrovir.com/post/2025-08-16-T02-cron-jobs-that-dont-suck)
4. Adds a once-per-minute cron command that runs `ensure-service ~/.config/ensure-service/config.json`.

## Usage

This package is primarily intended to be used via CLI:

-   global install: `ensure-service my-config.json`
-   repo install: `npx ensure-service my-config.json`

Any file format supported by [`config-vir`](https://www.npmjs.com/package/config-vir) may be used for the config file.

There is also a JS API exported by this package that you can import and use (see the types exported by this package to know how to use it)

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

Service names must be a single DNS label: lowercase letters, digits, and hyphens, at most 63 characters, not starting or ending with a hyphen.

Each service requires `servicePort`. All other fields are optional: any field omitted, set to `undefined`, or set to `null` will fallback to its default noted below. Two services may not share a `servicePort`, `lockFilePath`, or `logDirPath`.

| Option                | Default                                       | Description                                                                                                            |
| --------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `healthCheckTimeout`  | `{seconds: 10}`                               | Maximum time to wait for the health-check request before considering the service unhealthy.                            |
| `healthCheckUrl`      | `http://127.0.0.1:<servicePort>/health`       | URL that must return a successful HTTP response for the service to be considered healthy.                              |
| `lockFilePath`        | `~/.config/ensure-service/<serviceName>/lock` | File used to prevent overlapping checks.                                                                               |
| `logDirPath`          | `~/.config/ensure-service/<serviceName>/logs` | Directory where stdout and stderr from restarted services are written.                                                 |
| `serviceStartCommand` | `npm start`                                   | Shell command used to start the service after a failed health check.                                                   |
| `serviceStartTimeout` | `{minutes: 5}`                                | Grace period after a service start: a recently updated log directory prevents another restart while the service boots. |
| `servicePort`         | Required                                      | Port whose listening processes are stopped before the service is restarted.                                            |
| `startServiceCwd`     | Current working directory                     | Directory in which `serviceStartCommand` runs.                                                                         |

Timeouts accept objects with one or more units, such as `{seconds: 30}` or `{minutes: 2, seconds: 30}`.
