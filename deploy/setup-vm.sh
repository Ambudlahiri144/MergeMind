#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VM for the MergeMind backend (Deploy.md).
# Idempotent: safe to run again. Run as the default sudo user (e.g. `ubuntu`):
#   curl -fsSL https://raw.githubusercontent.com/Ambudlahiri144/MergeMind/main/deploy/setup-vm.sh | bash
# or, after cloning: bash deploy/setup-vm.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Ambudlahiri144/MergeMind.git}"
APP_DIR="${APP_DIR:-/opt/mergemind}"

echo "==> Docker Engine and the compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl git
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo systemctl enable --now docker
if ! id -nG "$USER" | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  echo "    added $USER to the docker group (log out and back in for it to apply)"
fi

echo "==> Firewall: open 80/tcp, 443/tcp and 443/udp (Oracle's Ubuntu images allow only SSH)"
for rule in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
  # shellcheck disable=SC2086
  if ! sudo iptables -C INPUT $rule -m state --state NEW -j ACCEPT 2>/dev/null; then
    # shellcheck disable=SC2086
    sudo iptables -I INPUT 5 $rule -m state --state NEW -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save
fi

echo "==> Repository in $APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  sudo mkdir -p "$APP_DIR"
  sudo chown "$USER":"$USER" "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi

echo
echo "Next: create $APP_DIR/.env.production from deploy/env.production.example,"
echo "      run 'chmod 600 $APP_DIR/.env.production', then 'bash $APP_DIR/deploy/deploy.sh'."
