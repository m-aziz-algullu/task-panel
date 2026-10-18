#!/bin/sh
# A shell as the bundled OpenClaw Gateway sees the world: its user, its HOME on
# the /data volume and its token. For one-off setup such as signing in to Claude:
#
#   docker exec -it -u node <container> /srv/docker/agent-shell.sh
#
#   curl -fsSL https://claude.ai/install.sh | bash      # Claude Code, kept on the volume
#   claude auth login                                    # your own Claude account
#   openclaw models auth login --provider anthropic --method cli --set-default
set -e
HOME=/data/openclaw
# `docker exec` hands every shell the container's whole environment, DATABASE_URL
# included; start from an empty one, like the Gateway itself.
# Not a login shell either: /etc/profile would reset PATH.
exec env -i \
  HOME="$HOME" \
  OPENCLAW_HOME="$HOME" \
  OPENCLAW_GATEWAY_TOKEN="$(cat /data/secrets/gateway-token)" \
  PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-}" \
  NODE_ENV=production \
  TERM="${TERM:-xterm}" \
  LANG=C.UTF-8 \
  sh -c 'cd "$HOME" && exec bash'
