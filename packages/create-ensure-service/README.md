# create-ensure-service

Installs [`ensure-service`](https://www.npmjs.com/package/ensure-service) globally (skipped if it's already installed globally), adds the current directory as a service in `~/.config/ensure-service/config.json`, creates `~/.config/ensure-service/tailscale-key.json` with empty values (readable only by you) if it's missing, removes non-interactive Bash guards from `~/.bashrc` when present, and runs it once per minute through a cron. On Linux, it also prints the `sudo tailscale set --operator=<user>` command to run if you are not already Tailscale's operator, since Tailscale Services cannot be published from cron without it.

## Usage

Run `npm init ensure-service` from the directory of the service you want to keep running. Run it again from another service's directory to add that service to the same config.

Init asks for each service's name, suggesting one based on its directory (lowercased, with other characters turned into `-`). Rerunning from a directory that is already configured leaves the config unchanged. If the existing config file is not a valid config, it is replaced with a new one containing only the current service.

| Flag          | Description                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `--port`      | Port this service listens on. When omitted, init asks for it, suggesting one more than the highest port already in the config (or 3000). |
| `--name`      | Name for this service. When omitted, init asks for it.                                                                                   |
| `--overwrite` | Replace the existing config with one containing only this service.                                                                       |
