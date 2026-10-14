"""Run with the SDK venv: python -m unittest discover -p '*_test.py'."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('totem_muse_bridge', Path(__file__).with_name('muse_bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class SecurityTest(unittest.TestCase):
    def test_registry_has_no_shell_or_files(self):
        self.assertTrue(bridge.COMMANDS)
        self.assertTrue(all(name.startswith('totem.') for name in bridge.COMMANDS))
        self.assertNotIn('system.run', bridge.COMMANDS)
        self.assertNotIn('file.read', bridge.COMMANDS)
        self.assertNotIn('file.write', bridge.COMMANDS)
        self.assertNotIn('totem.approve', bridge.COMMANDS)

    def test_unknown_commands_never_open_socket(self):
        executor = bridge.RestrictedExecutor()
        with patch.object(bridge.socket, 'socket') as socket:
            for command in ('system.run', 'file.read', 'file.write', 'device.ota', 'totem.shell'):
                self.assertFalse(executor.run(command, {'command': 'sudo id'})['ok'])
            socket.assert_not_called()

    def test_arguments_and_unavailable_bridge_fail_closed(self):
        executor = bridge.RestrictedExecutor()
        self.assertFalse(executor.run('totem.health', [])['ok'])
        with patch.object(bridge.socket, 'socket', side_effect=OSError('private error')):
            result = executor.run('totem.health', {})
            self.assertFalse(result['ok'])
            self.assertNotIn('private error', result['error'])


if __name__ == '__main__':
    unittest.main()
