# Docker

The OpenBot image is the Linux release, run as a [self-hosted server](self-hosted-server.md) in a
container. It is a normal Remote host of your account. You use it from the desktop app, the iPhone
app or `openbot.run/app`. The image is `ghcr.io/nightly-labs/openbot`, for `linux/amd64` and
`linux/arm64`.

## Run

With Docker Compose:

```sh
curl -fsSLO https://raw.githubusercontent.com/nightly-labs/openbot/main/docker/compose.yaml
curl -fsSLO https://raw.githubusercontent.com/nightly-labs/openbot/main/docker/seccomp.json
docker compose up -d
docker compose exec openbot openbot login
```

With `docker run`:

```sh
curl -fsSLO https://raw.githubusercontent.com/nightly-labs/openbot/main/docker/seccomp.json
docker run -d --name openbot --restart unless-stopped \
  --security-opt seccomp=seccomp.json --security-opt no-new-privileges:true \
  --shm-size 1g --stop-timeout 60 \
  -v openbot-data:/data \
  ghcr.io/nightly-labs/openbot:latest
docker exec -it openbot openbot login
```

`openbot login` asks for your email and the code that OpenBot sends to it. After the sign-in, the
server shows in the server list of that account. Then connect a provider from the app, as on a
[hosted server](hosted-servers.md#providers).

To connect the phone app, show a Mobile Connect code in the terminal and scan it with the app:

```sh
docker exec -it openbot openbot mobile-connect
```

See [Phone app](self-hosted-server.md#phone-app).

The options in both examples are necessary:

| Option | Why |
| --- | --- |
| `seccomp=seccomp.json` | The Electron sandbox makes user namespaces. The default seccomp profile of Docker refuses them, and the container stops with a message. See [Security](#security). |
| `--shm-size 1g` | Chromium uses shared memory. The Docker default of 64 MB is too small. When `/dev/shm` is smaller than 1 GiB, Chromium uses `/tmp`, which is slower. |
| `--stop-timeout 60` | OpenBot stops its agents and closes its database before it exits. |
| `-v openbot-data:/data` | All data is in `/data`. Without a volume, it goes away with the container. |

For Amazon ECS, see [AWS ECS](aws-ecs.md).

The container publishes no port. OpenBot only connects out: to the account server, to the providers,
and to Signal and TURN for remote use. The Team API listens on `127.0.0.1` in the container.
See [Web client delivery](web-client.md) for the browser client and its limits.

## Tags

| Tag | Image |
| --- | --- |
| `latest` | A floating tag for the newest published Docker release. It changes when a new image is published. |
| `<version>`, for example `0.30.0` | One release. Use it to choose when to upgrade. |
| `v<version>` | Alias for `<version>` in releases published after 0.31.0. Earlier releases use the tag without `v`. |
| `sha-<commit>` | The release of that commit. |
| `<version>-amd64`, `<version>-arm64` | One release for one architecture. |

Public images need no GHCR sign-in. If `latest` or a version without `v` returns `denied`,
`unauthorized` or `not found`, a maintainer must check the package visibility. See
[Docker package access](RELEASING.md#docker-package-access).

## Data

`/data` is the home folder of the user `openbot` (UID 1000, GID 1000). OpenBot and its agents run as
that user and keep everything there:

| Path | Contents |
| --- | --- |
| `/data/.config/OpenBot` | The database `openbot.db`, logs, the downloaded provider runtimes and the browser data. |
| `/data/OpenBot` | The agent workspaces (`Agents`), `Shared` and `Downloads`. |
| `/data/.local/share/keyrings`, `/data/.config/openbot-container` | The keyring and its password. The keyring has the key of the encrypted data in `/data`. |
| Other files in `/data` | Provider sign-ins and the files of agent tools, for example `~/.codex` and `~/.claude`. |

Keep `/data` as one unit. The encrypted data cannot open without the keyring, and the keyring cannot
open without its password file. Use one volume for one container at a time.

For a bind mount, give the folder to the user of the image first:

```sh
mkdir openbot-data && sudo chown 1000:1000 openbot-data
```

The data has your account session, your provider sign-ins and your conversations. Protect it as you
protect a home folder. To back it up, stop the container and copy the volume.

## Commands

In the container, `openbot status`, `login`, `mobile-connect`, `logout`, `name` and `version` work as on a
[self-hosted server](self-hosted-server.md#commands). Do the other tasks with Docker on the host:

| Task | Command |
| --- | --- |
| Read the log | `docker logs openbot` |
| Stop, start, restart | `docker stop openbot`, `docker start openbot`, `docker restart openbot` |
| Upgrade | Follow [Upgrades](#upgrades) before replacing the container. |
| Remove | `docker exec openbot openbot logout`, then `docker stop openbot && docker rm openbot`. The data stays in the volume. `docker volume rm openbot-data` deletes it. |

## Upgrades

OpenBot does not update itself in a container. Replace the container to upgrade it.
Do not use an older image on data that a newer release has opened. Database migrations only
work forward. OpenBot makes no database backup before migration. It does not restore a backup
if an upgrade fails.

### Choose a release

Read the installed version with `docker compose exec openbot openbot version` (or
`docker exec openbot openbot version`). Keep its exact release tag and deployed configuration.
The current `latest` tag does not identify the installed release.

Use `curl` and `jq` to read the latest published GitHub Release:

```bash
set -euo pipefail
target_tag=$(curl -fsSL -H 'Accept: application/vnd.github+json' \
  https://api.github.com/repos/nightly-labs/openbot/releases/latest \
  | jq -er 'select(.draft == false and .prerelease == false)
    | .tag_name | select(test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))')
printf '%s\n' "$target_tag"
```

The GitHub Release is published before its Docker image. Read the release notes. Compare the
version numbers and continue only if the target is newer than the installed version.
Use the image tag without `v`: `v0.31.0` becomes `ghcr.io/nightly-labs/openbot:0.31.0`.

Check the target image without downloading its layers:

```bash
docker manifest inspect "ghcr.io/nightly-labs/openbot:${target_tag#v}"
```

Check that the manifest lists your platform: `linux/amd64` or `linux/arm64`.
Stop if the command fails or your platform is missing. Do not use `latest` instead.
For access errors, see [Docker package access](RELEASING.md#docker-package-access).

### Check configuration

Download `docker/compose.yaml` and `docker/seccomp.json` for both the installed and target
release tags. Keep them in separate review directories. Use these URLs, with each release tag
in place of `<tag>`:

- `https://raw.githubusercontent.com/nightly-labs/openbot/<tag>/docker/compose.yaml`
- `https://raw.githubusercontent.com/nightly-labs/openbot/<tag>/docker/seccomp.json`

Do not overwrite deployed files or use `main` for this comparison.
Compare the two releases to find changes in OpenBot. Compare your deployed files with the
installed-release files to find your custom settings.

Apply the required target changes. Keep your volume mapping, environment and other custom
settings. Set the deployed image to the exact target version. Keep the
[security options](#security). Do not publish a port for the upgrade.
If the installed-release files are missing, stop automatic updates and review the files.
Do the same if any configuration or security setting changes.

### Back up and replace

1. Disable other update jobs for this container. Run `docker compose pull openbot` to download
   the pinned target image. Stop if the pull fails. Then run `docker compose stop openbot`.
   Confirm that it has stopped and no other container or process writes to its data.
2. Back up the complete stopped volume or bind mount outside the live data. Include all of
   `/data`, hidden files, ownership and permissions: the database, workspaces, browser data,
   provider sign-ins, `/data/.local/share/keyrings` and
   `/data/.config/openbot-container/keyring-password`. A copy of `openbot.db` is not enough.
   Check that the backup is complete and readable. Protect it as secret data.
   Stop if the backup is missing or incomplete.
3. Run `docker compose up -d openbot` with the reviewed configuration and the same data volume.
   Keep the Compose project name and volume mapping. A different project can create an empty
   volume. Never run two OpenBot containers on this data at the same time.
   Do not run `docker compose down -v` or delete the volume.
4. Check the logs, `openbot status`, `openbot version` and access from your app.
   If the upgrade fails, stop the new container and read the error.
   Do not start an older image on data that the new release has opened.
   There is no automatic rollback or backup restore.

For `docker run`, use the same checks and stopped backup. Pull the pinned image first.
Stop and remove only the old container. Create its replacement with the same volume and
reviewed options. Do not remove the volume or sign out to upgrade.

An automatic update job must stop if the release lookup fails, the target image is unavailable,
or the installed release is unknown. It must also stop for configuration or security changes,
a missing complete stopped backup, or a failed upgrade. A job that only uses `latest` and
replaces the container does not meet these requirements.

## Environment

Pass these with `-e` or the `environment` of the Compose file, never in an image. Agents inherit the
environment of OpenBot, so they can read these values.

| Variable | Use |
| --- | --- |
| `XAI_API_KEY`, `CURSOR_API_KEY`, `CLINE_API_KEY` | A provider API key. |
| `OPENBOT_CODEX_PATH`, `OPENBOT_CLAUDE_PATH`, `OPENBOT_GROK_PATH`, `OPENBOT_OPENCODE_PATH`, `OPENBOT_CURSOR_PATH`, `OPENBOT_CLINE_PATH`, `OPENBOT_ANTIGRAVITY_PATH` | Another provider executable. Mount it read-only in the container. |
| `OPENBOT_AUTH_API_URL` | Another account server, for example a [self-hosted account service](self-hosting.md). |

## Security

- **The Electron sandbox stays on.** `seccomp.json` is the default profile of Docker
  ([moby/profiles](https://github.com/moby/profiles/blob/6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef/seccomp/default.json))
  with one more rule: `clone` and `unshare` without limits on their flags. This lets the container
  make user namespaces, which gives processes in the container more of the kernel to call. The kernel
  still refuses other namespaces to a process that is not in its own user namespace. Do not use
  `seccomp=unconfined`, `--privileged` or `--no-sandbox` instead.
- **Not root.** The image runs as UID 1000. Root owns the release, so agents cannot change it. The
  release has no SUID file. `no-new-privileges` keeps it that way.
- **Agents have full access in the container.** They run commands, change all of `/data` and use the
  network. The container is the boundary. Do not mount the Docker socket, your home folder or another
  host folder that agents must not change.
- **Check the image.** Each release image has a build provenance attestation:

  ```sh
  gh attestation verify oci://ghcr.io/nightly-labs/openbot:<version> --repo nightly-labs/openbot
  ```

## How it works

The release workflow (`.github/workflows/release.yml`) builds the image on a runner of each
architecture from the AppImage of that release, after it checks the AppImage against the release
checksums. `docker/Dockerfile` unpacks the AppImage to `/opt/OpenBot/app` and installs the packages
of a self-hosted server from that release. The workflow starts and stops each image once, and pushes
the images to GHCR only after the GitHub Release is published.

`tini` is process 1. It starts `resources/hosting/openbot-container` from the release, which checks
that it can make a user namespace, starts D-Bus, a virtual display and the keyring, and then becomes
OpenBot with `OPENBOT_SERVER=1`. On a stop, tini gives the signal to OpenBot and waits for it.
`/opt/OpenBot/hosted/mode` is `container`, so the `openbot` command talks to the control socket and
does not use systemd.

## Limits

- Remote desktop and Computer Use need a display. The container has a virtual display, but remote
  desktop and Computer Use were not tested in it. The arm64 release has no remote desktop runtime.
- Voice prompts are not available on Linux.
- Gemini signs in on a Google page in the browser of the container. An owner or admin opens it
  with Connect in the app, and signs in through the live view of that page. This needs a release
  with `provider-host-sign-in-v1` on both sides. It was not tested in a container.

## Not confirmed

- Tested on Docker Desktop 4.45 (Docker Engine 28.3, `linux/arm64`) with the 0.29.0 AppImage and the
  scripts of this image: the start with the sandbox on, `openbot status`, a restart, a new container
  on the same volume after a kill, a stop that exits with 0, and the messages for a missing seccomp
  profile and for a volume that the user cannot write. The release workflow also starts each image.
- Not tested: a sign-in with `openbot login` in a container, remote use of a container from the app,
  Podman, Kubernetes, rootless Docker, and hosts that restrict user namespaces with AppArmor, such as
  Ubuntu 23.10 or newer. On such a host, the container can need an AppArmor profile that permits
  `userns`.
