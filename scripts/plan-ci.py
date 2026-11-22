#!/usr/bin/env python3
"""Keep checks unconditional; independently decide whether this event may deploy."""
import argparse
import json
import os
from pathlib import PurePosixPath
import re
import subprocess


def requires_deployment(path):
    parts = PurePosixPath(path).parts
    if path.startswith(('docs/', '.idea/', '.qoder/', '.run/', 'scripts/tests/', 'mcp/')):
        return False
    if parts[-1].lower() in ('readme.md', 'agents.md', 'claude.md', '.gitignore'):
        return False
    if path in ('scripts/plan-ci.py', '.github/workflows/ci-cd.yml'):
        return False
    if path.startswith(('backend/', 'miniprogram/')):
        if any(p in ('test', 'tests', '__tests__', 'testdata') for p in parts[:-1]):
            return False
        if parts[-1].endswith('_test.go') or re.search(r'\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$', parts[-1]):
            return False
    return True


def git(*args):
    return subprocess.check_output(['git', *args], stderr=subprocess.DEVNULL)


def event_base(event, before, base_ref, head):
    if event == 'push' and re.fullmatch(r'[a-f0-9]{40}', before or '') and before != '0' * 40:
        try:
            git('cat-file', '-e', before + '^{commit}')
            return before
        except subprocess.CalledProcessError:
            return None
    if event == 'pull_request' and base_ref:
        try:
            return git('merge-base', head, 'origin/' + base_ref).decode().strip()
        except subprocess.CalledProcessError:
            return None
    return None


def plan(event, before='', base_ref='', head='HEAD', full=False):
    base = event_base(event, before, base_ref, head)
    # Disabling rename detection includes both a removed runtime path and its
    # new test/docs destination; moving runtime code cannot bypass deployment.
    changed = git('diff', '--no-renames', '--name-only', '-z', base, head).decode().split('\0') if base else []
    changed = [p for p in changed if p]
    required = full or bool(base) and any(requires_deployment(p) for p in changed)
    return {'deployment_required': required, 'base': base,
            'reason': 'manual-full' if full else 'unknown-base-check-only' if not base else 'runtime-change' if required else 'check-only-change',
            'changed_files': changed}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--event', required=True)
    parser.add_argument('--before', default='')
    parser.add_argument('--base-ref', default='')
    parser.add_argument('--head', default='HEAD')
    parser.add_argument('--full', action='store_true')
    args = parser.parse_args()
    result = plan(args.event, args.before, args.base_ref, args.head, args.full)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            print('deployment_required=' + str(result['deployment_required']).lower(), file=output)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
