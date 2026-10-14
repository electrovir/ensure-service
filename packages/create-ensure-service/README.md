# create-ensure-service

Installs [`ensure-service`](https://www.npmjs.com/package/ensure-service) globally (skipped if it's already installed globally) and then runs `ensure-service init`, which adds the current directory as a service and runs it once per minute through a cron.

## Usage

```sh
npm init ensure-service
```
