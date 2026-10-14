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

`openbot login` asks for your email and the code that OpenBot sends to it. An operator who sets up
the container for somebody else can use `openbot login --claim` instead (see
[server claims](self-hosted-server.md#sign-in-with-a-server-claim)). After the sign-in, the
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

## Tags

| Tag | Image |
| --- | --- |
| `latest` | The newest release. |
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
| Upgrade | `docker compose pull && docker compose up -d`, or pull the image and make the container again with the same volume |
| Remove | `docker exec openbot openbot logout`, then `docker stop openbot && docker rm openbot`. The data stays in the volume. `docker volume rm openbot-data` deletes it. |

## Several instances on one host

`docker/instances/` runs more than one OpenBot container on one Linux host with systemd. Each
instance has its own CPU, memory and disk limit, its own data and its own account. Copy the `docker`
folder of the repository to the host, for example to `/opt/openbot-docker`, and run as root:

```sh
/opt/openbot-docker/instances/openbot-instance setup
/opt/openbot-docker/instances/openbot-instance create main --cpus 8 --mem 32g --disk 200G
/opt/openbot-docker/instances/openbot-instance run main login
```

| Path | Contents |
| --- | --- |
| `instances/<name>.env` | The name and the limits of the instance. Change `OPENBOT_CPUS` or `OPENBOT_MEM`, then run `openbot-instance up <name>`. `OPENBOT_DISK` is for information only: a change to it does nothing. |
| `/srv/openbot/<name>/data.img` | An ext4 image. Its size is the disk limit. `create` reserves all of it on the disk of the host, so the images can never need more space than the host has. |
| `/srv/openbot/<name>/data` | The mount of the image, which is `/data` in the container. `/etc/fstab` mounts it before Docker starts. `X-fstrim.notrim` stops `fstrim.timer` from freeing the reserved space. |
| `/srv/openbot/<name>/update-requests` | The update requests of the app. The container writes empty files here. It is a tmpfs of 64 KiB and 16 files, which `/etc/fstab` mounts. |
| `/srv/openbot/<name>/update-status` | The state of an update, which root writes. The container can only read it. |

The container is `openbot-<name>`. Its root file system is read-only: the container layer is on the
disk of the host, where Docker on ext4 cannot limit its size. Outside `/data`, the container writes
only to `tmpfs` folders that count toward the memory limit: `/tmp` (8 GiB), `/var/tmp` (1 GiB),
`/run/lock` and `/run/openbot`, and to the small tmpfs of its update requests. Before the image is mounted, root owns the folder, so the container cannot write to
`/data` and stops. It never starts with an empty home folder.

### Logs

The container log goes through the `syslog` log driver to a socket of rsyslog,
`/var/lib/openbot-docker/dev/log`, and not to the journal or `/var/log/syslog`, whose size limits
other services share. rsyslog writes `/var/log/openbot/openbot-<name>.log`. logrotate rotates it each
day, or sooner when it is larger than 200 MB. `openbot-logrotate.timer` checks every 5 minutes. It keeps
the 30 newest rotated files and none older than 30 days, so one instance keeps at most 31 files of
about 200 MB. An instance that writes very much keeps less than 30 days. `docker logs` reads the local
cache of Docker, which keeps
only the recent lines. rsyslog cuts a line longer than 8 KB. `setup` installs the rsyslog and logrotate
files and the timer. Its drop-in `docker.service.d/openbot.conf` makes Docker start after rsyslog, because
a container does not start without the socket, and require `openbot-firewall.service`: when the
firewall fails, Docker does not start.

### Host settings

`setup` also installs `/etc/sysctl.d/90-openbot-docker.conf`. With userns-remap, all containers run as
one host user and share its inotify limits, so the file raises them. Each container may open 65536
files (Docker gives 1024 by default). Add `"live-restore": true` to `/etc/docker/daemon.json`, then run
`systemctl reload docker`: a restart or upgrade of Docker then does not stop the instances.

### Isolation

Agents have full access in their container, so the host limits what a container can reach.

- **Network.** `setup` makes the Docker network `openbot` (`172.30.0.0/16`, bridge `br-openbot`)
  with inter-container traffic off, so instances cannot reach each other. It installs
  `openbot-firewall.service`, which runs `instances/openbot-firewall` before Docker starts. The
  chain `OPENBOT-EGRESS` in `DOCKER-USER` drops traffic to private, local and multicast ranges and to
  the addresses in `/etc/openbot-docker/deny`. A rule at the start of `INPUT` drops traffic from the
  bridge to the host. The containers reach only the internet. `create`, `up` and `upgrade` refuse
  to start a container when the firewall is off.
- **Other servers.** Traffic from a container leaves with the address of the host. Put servers that
  trust that address in `/etc/openbot-docker/deny`, one per line, then run `setup` again.
- **Users.** With `"userns-remap": "default"` in `/etc/docker/daemon.json`, UID 1000 in the
  container is the start of the `dockremap` range in `/etc/subuid` plus 1000 on the host, a user with
  no rights there. `create` gives the data to that user. This setting is for the whole Docker
  daemon: Docker then uses another data folder, so containers, images and networks made before are
  not visible until it is removed. To turn it on for existing instances: `down` each instance, add
  the setting, restart Docker, run `setup`, `chown -R <uid>:<gid>` each `/srv/openbot/<name>/data`,
  then `up` each instance. `setup` shows a warning when it is off.
- **DNS.** Docker sends the DNS queries of a container from the network of the container, so the
  firewall also applies to them. When the host uses a resolver on a private or link-local address,
  for example on AWS or GCP, the containers have no DNS. Then set `dns:` in `compose.yaml` to
  resolvers on the internet.
- **Kernel.** The containers share the kernel of the host. For owners that you do not trust, use a
  host with no other services, or a virtual machine for each instance.

| Task | Command |
| --- | --- |
| Show the instances | `openbot-instance list` |
| Stop, start, restart | `openbot-instance down <name>`, `up <name>`, `restart <name>` |
| Read the log | `openbot-instance logs <name> -f` (recent lines), or `/var/log/openbot/openbot-<name>.log*` (30 days) |
| Upgrade | In the app (see [Updates from the app](#updates-from-the-app)), or `openbot-instance upgrade <name>` or `upgrade --all` |
| `openbot` commands | `openbot-instance run <name> status`, `login`, `mobile-connect`, `name <name>` |
| Make the disk larger | `down <name>`, `umount /srv/openbot/<name>/data`, `fallocate --length <new size> data.img`, `e2fsck -f data.img`, `resize2fs data.img`, `mount /srv/openbot/<name>/data`, `up <name>` |

There is no command to remove an instance. To remove one and delete its data: `run <name> logout`,
`down <name>`, `systemctl disable --now openbot-instance-update@<name>.path`,
`umount /srv/openbot/<name>/data /srv/openbot/<name>/update-requests`, delete its two lines in
`/etc/fstab`, then delete `/srv/openbot/<name>` and `instances/<name>.env`.

### Updates from the app

The owner or an admin updates an instance in Server settings › Updates, or in the update dialog, as on a
hosted server. The container never gets the Docker socket. OpenBot writes an empty request file to
`/srv/openbot/<name>/update-requests`. `openbot-instance-update@<name>.path` sees it and runs
`openbot-instance update-request <name>` as root. Root only tests and removes the request; it never
reads or follows it. It pulls the image of the instance and writes its version to `update-status` only
when it is newer than the container. For an install, it makes the container again from that image,
with the same data. It writes the state of the request to `update-status`, which the container mounts
read-only.

`setup` installs the units. `create`, `up` and `upgrade` make the folders, add the tmpfs of the
requests to `/etc/fstab` and enable the path unit of the instance. An instance with `OPENBOT_TAG` in
its env file keeps that tag and offers no update in the app. An instance made before this release gets them with `setup`, then
`openbot-instance upgrade <name>` once. A container started with `docker/compose.yaml` or
`docker run` has no request folders, so it offers no update in the app.

## Upgrades

OpenBot does not update itself in a container. A new image replaces it. An instance of
`docker/instances` can ask the host for that from the app, see
[Updates from the app](#updates-from-the-app). Do not go back to an older tag: an older OpenBot cannot
open a database that a newer one migrated, so it does not start.

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
