#!/usr/bin/env python3
"""Prepare a Coolify service from the finalized P100 benchmark; never start/stop services."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys


def docker(*args):
    result = subprocess.run(['docker', *args], text=True, capture_output=True, check=False)
    if result.returncode:
        raise ValueError(result.stderr.strip())
    return result.stdout.strip()


def prepare(root, app_container, network=None):
    root = root.resolve(strict=True)
    selected = json.loads((root / 'selected.json').read_text())
    if selected['configuration'] != '35b-stock-mtp-off':
        raise ValueError('Expected finalized 35b-stock-mtp-off selection.')
    model = (root / selected['model']['path']).resolve(strict=True)
    if not model.is_relative_to(root) or not model.is_file():
        raise ValueError('Selected model must be a file inside the benchmark workspace.')
    print('Verifying the selected model checksum…', file=sys.stderr)
    digest = hashlib.sha256()
    with model.open('rb') as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != selected['model']['sha256']:
        raise ValueError('Model checksum changed. No configuration written.')
    image_id = selected['image']['id']
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', image_id):
        raise ValueError('Invalid selected image ID.')
    image = json.loads(docker('image', 'inspect', image_id))[0]
    if image['Id'] != image_id or not image.get('Config', {}).get('Labels', {}).get('org.anii.ai-bench'):
        raise ValueError('Selected image is not a benchmark image.')
    gpu = selected['gpu']
    if not re.fullmatch(r'GPU-[0-9a-fA-F-]+', gpu):
        raise ValueError('Selected GPU UUID is invalid.')
    container = json.loads(docker('inspect', '--type', 'container', app_container))[0]
    networks = container['NetworkSettings']['Networks']
    if not network:
        network = 'coolify' if 'coolify' in networks else next(iter(networks)) if len(networks) == 1 else None
    if not network or network not in networks:
        raise ValueError('Choose an ANII network with --network: ' + ', '.join(networks))
    docker('network', 'inspect', network)

    # Reuse the exact retained launch arguments rather than guessing benchmark defaults.
    launch = (root / 'start-selected.sh').read_text().splitlines()
    exec_lines = [line for line in launch if line.startswith('exec ')]
    if len(exec_lines) != 1:
        raise ValueError('Cannot read the finalized launcher.')
    tokens = shlex.split(exec_lines[0][5:])
    if tokens[:2] != ['docker', 'run'] or tokens.count(image_id) != 1:
        raise ValueError('Launcher does not match the selected image.')
    args = tokens[tokens.index(image_id) + 1:]
    expected = {'-m': f'/models/{model.name}', '--host': '0.0.0.0', '--port': '8080',
                '--spec-type': 'none', '--parallel': '1', '--ctx-size': str(selected['context'])}
    for flag, value in expected.items():
        if args.count(flag) != 1 or args[args.index(flag) + 1] != value:
            raise ValueError(f'Unexpected launcher argument: {flag}')
    if '--alias' in args:
        raise ValueError('Launcher already has a model alias; review it manually.')
    args[args.index('--port') + 1] = '11434'
    args += ['--alias', 'qwen3.6-35b-a3b']

    # Give the retained local image a production tag. No pull, rebuild, or deletion.
    tag = 'anii-local/llama-p100:stock-' + image_id.removeprefix('sha256:')[:12]
    existing = subprocess.run(['docker', 'image', 'inspect', tag], capture_output=True, text=True)
    if existing.returncode == 0 and json.loads(existing.stdout)[0]['Id'] != image_id:
        raise ValueError('Production tag points at another image. Refusing to overwrite it.')
    docker('tag', image_id, tag)
    health = "exec 3<>/dev/tcp/127.0.0.1/11434; printf 'GET /health HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' >&3; IFS= read -r status <&3; [[ \"$$status\" == *' 200 '* ]]"
    q = json.dumps
    # JSON scalars/arrays are also valid YAML; no pip dependencies needed.
    compose = f'''# Generated from {selected['configuration']}; local image, never pull.
services:
  llama:
    image: {q(tag)}
    pull_policy: never
    restart: unless-stopped
    command: {q(args)}
    expose:
      - "11434"
    volumes:
      - type: bind
        source: {q(str(model))}
        target: {q('/models/' + model.name)}
        read_only: true
        bind:
          create_host_path: false
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              device_ids: {q([gpu])}
              capabilities: [gpu]
    networks:
      anii:
        aliases: [anii-llama]
    healthcheck:
      test: {q(['CMD', 'bash', '-ec', health])}
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 180s
    stop_grace_period: 45s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
networks:
  anii:
    external: true
    name: {q(network)}
'''
    return compose, tag


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/root/.local/share/anii-ai-bench'))
    parser.add_argument('--app-container', required=True, help='Running ANII container name from docker ps')
    parser.add_argument('--network', help='Existing network shared with ANII; auto-detected when unambiguous')
    parser.add_argument('--output', type=Path, default=Path('llama-coolify.yaml'))
    args = parser.parse_args()
    try:
        compose, tag = prepare(args.root, args.app_container, args.network)
        args.output.write_text(compose)
        print(f'Created {args.output.resolve()}\nImage: {tag}\nANII provider: llama.cpp\nANII URL: http://anii-llama:11434\nModel: qwen3.6-35b-a3b\nNo services started or stopped.')
    except (OSError, ValueError, KeyError, IndexError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
