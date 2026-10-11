# create-ensure-service

Installs [`ensure-service`](https://www.npmjs.com/package/ensure-service) globally (skipped if it's already installed globally), adds the current directory as a service in `~/.config/ensure-service/config.json`, removes non-interactive Bash guards from `~/.bashrc` when present, and runs it once per minute through a cron.

## Usage

Run `npm init ensure-service` from the directory of the service you want to keep running. Run it again from another service's directory to add that service to the same config.

Each service is named after its directory (lowercased, with other characters turned into `-`). Rerunning from a directory that is already configured leaves the config unchanged. If the existing config file is not a valid config, it is replaced with a new one containing only the current service.

| Flag          | Description                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `--port`      | Port this service listens on. When omitted, init asks for it, suggesting one more than the highest port already in the config (or 3000). |
| `--overwrite` | Replace the existing config with one containing only this service.                                                                       |
