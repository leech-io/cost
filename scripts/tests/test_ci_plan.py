"""Regression coverage for check-only CI events; no production connections."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class CheckOnlyWorkflowTests(unittest.TestCase):
    def test_deploy_has_an_independent_gate_and_checks_still_run(self):
        workflow = (ROOT / '.github/workflows/ci-cd.yml').read_text()
        deploy = workflow.split('  deploy:', 1)[1]
        self.assertIn("needs.plan.outputs.deployment_required == 'true'", deploy)
        self.assertIn('needs: [checks, plan]', deploy)
        self.assertIn('go test -race -count=1 ./...', workflow)
        self.assertIn('node --test miniprogram/tests/*.test.js', workflow)

SCRIPT = 'scripts/plan-ci.py'
TARGETS = ()
RUNTIME_PATH = 'backend/cmd/api/main.go'
TEST_PATH = 'backend/internal/api/testdata/synthetic.txt'
CHECK_ONLY = ['backend/internal/api/api_test.go', TEST_PATH, 'miniprogram/tests/login.test.js',
              'mcp/src/index.mjs', 'mcp/package-lock.json', 'mcp/README.md', 'mcp/tests/stdio.test.mjs',
              'docs/ops/check.md', 'README.MD', 'scripts/tests/test_ci_plan.py',
              'scripts/plan-ci.py', '.github/workflows/ci-cd.yml']
RUNTIME = {RUNTIME_PATH: [], 'backend/go.mod': [],
           'backend/internal/store/migrations/011.sql': [], 'deploy/compose.cloud.yaml': [],
           'miniprogram/utils/api.js': [], 'unknown.txt': []}


class CIPlanBehaviorTests(unittest.TestCase):
    def planner(self):
        import importlib.util
        name = 'plan_ci_under_test'
        script = ROOT / SCRIPT
        spec = importlib.util.spec_from_file_location(name, script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def call_plan(self, module, event, before='', base_ref='', full=False, target=None):
        if TARGETS:
            return module.plan(target or TARGETS[0], event, before, base_ref, full=full)
        return module.plan(event, before, base_ref, full=full)

    def test_path_classification_preserves_runtime_and_dependency_deployment(self):
        module = self.planner()
        for path in CHECK_ONLY:
            for target in TARGETS or [None]:
                with self.subTest(path=path, target=target):
                    args = (path, target) if target else (path,)
                    self.assertFalse(module.requires_deployment(*args))
        for path, targets in RUNTIME.items():
            for target in TARGETS or [None]:
                with self.subTest(path=path, target=target):
                    args = (path, target) if target else (path,)
                    expected = target in targets if target else True
                    self.assertEqual(module.requires_deployment(*args), expected)

    def test_real_git_histories_docs_fixtures_runtime_rename_and_missing_base(self):
        import os
        import subprocess
        import tempfile
        from unittest.mock import patch
        module = self.planner()
        with tempfile.TemporaryDirectory() as scratch, patch.dict(os.environ, {
            'GIT_AUTHOR_NAME': 'Test', 'GIT_AUTHOR_EMAIL': 'test@example.invalid',
            'GIT_COMMITTER_NAME': 'Test', 'GIT_COMMITTER_EMAIL': 'test@example.invalid',
        }):
            cwd = os.getcwd()
            os.chdir(scratch)
            try:
                def git(*args):
                    return subprocess.check_output(['git', *args], text=True).strip()
                def commit(path, value):
                    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True); p.write_text(value)
                    git('add', '.'); git('commit', '-qm', 'fixture')
                    return git('rev-parse', 'HEAD')
                git('init', '-q'); git('branch', '-M', 'main')
                first = commit(RUNTIME_PATH, 'production v1')
                commit(TEST_PATH, 'synthetic contact')
                docs = commit('docs/check-only.md', 'public docs')
                commit('mcp/src/index.mjs', 'local adapter v1')
                for target in TARGETS or [None]:
                    self.assertFalse(self.call_plan(module, 'push', first, target=target)['deployment_required'])
                self.assertFalse(self.call_plan(module, 'push', '0' * 40)['deployment_required'])
                self.assertFalse(self.call_plan(module, 'push', 'f' * 40)['deployment_required'])
                self.assertFalse(self.call_plan(module, 'workflow_dispatch')['deployment_required'])
                self.assertTrue(self.call_plan(module, 'workflow_dispatch', full=True)['deployment_required'])
                git('update-ref', 'refs/remotes/origin/main', docs)
                runtime = commit(RUNTIME_PATH, 'production v2')
                self.assertTrue(self.call_plan(module, 'push', docs)['deployment_required'])
                self.assertTrue(self.call_plan(module, 'pull_request', base_ref='main')['deployment_required'])
                # A later docs-only push must not release the preceding runtime change.
                after_docs = commit('README.MD', 'documentation only')
                self.assertFalse(self.call_plan(module, 'push', runtime)['deployment_required'])
                git('rm', TEST_PATH)
                deleted = commit('docs/check-only.md', 'fixture removed')
                self.assertFalse(self.call_plan(module, 'push', after_docs)['deployment_required'])
                # Moving production code into a test folder also deletes runtime code.
                destination = Path(TEST_PATH); destination.parent.mkdir(parents=True, exist_ok=True)
                git('mv', RUNTIME_PATH, TEST_PATH)
                renamed = commit('docs/check-only.md', 'runtime moved')
                result = self.call_plan(module, 'push', deleted)
                self.assertTrue(result['deployment_required'])
                self.assertIn(RUNTIME_PATH, result['changed_files'])
                self.assertIn(TEST_PATH, result['changed_files'])
            finally:
                os.chdir(cwd)

    def test_cli_emits_a_false_github_output_for_the_current_check_only_diff(self):
        import json
        import os
        import subprocess
        import sys
        import tempfile
        from unittest.mock import patch
        script = ROOT / SCRIPT
        with tempfile.TemporaryDirectory() as scratch, patch.dict(os.environ, {
            'GIT_AUTHOR_NAME': 'Test', 'GIT_AUTHOR_EMAIL': 'test@example.invalid',
            'GIT_COMMITTER_NAME': 'Test', 'GIT_COMMITTER_EMAIL': 'test@example.invalid',
        }):
            root = Path(scratch)
            def git(*args):
                return subprocess.check_output(['git', '-C', scratch, *args], text=True).strip()
            git('init', '-q')
            (root/'README.md').write_text('first'); git('add', '.'); git('commit', '-qm', 'first')
            before = git('rev-parse', 'HEAD')
            (root/'README.md').write_text('check only'); git('add', '.'); git('commit', '-qm', 'docs')
            output = root/'github-output'
            args = [sys.executable, str(script), '--event', 'push', '--before', before]
            if TARGETS: args += ['--target', TARGETS[0]]
            result = subprocess.run(args, cwd=scratch, text=True, capture_output=True,
                                    env={**os.environ, 'GITHUB_OUTPUT': str(output)})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(json.loads(result.stdout)['deployment_required'])
            self.assertEqual(output.read_text(), 'deployment_required=false\n')


if __name__ == '__main__':
    unittest.main()
