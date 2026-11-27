"""Recreate synthetic browser probes in a disposable d329285 checkout only."""
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
fixture = json.loads(Path(__file__).with_name('browser-fixtures.json').read_text())
base = (root / fixture['base']).read_text()
assert hashlib.sha256(base.encode()).hexdigest() == fixture['base_sha256'], 'Use the recorded source revision.'
for item in fixture['outputs']:
    result = base.splitlines(True)
    for change in reversed(item['changes']):
        result = result[:change['start']] + change['replacement'].splitlines(True) + result[change['end']:]
    result = ''.join(result)
    assert hashlib.sha256(result.encode()).hexdigest() == item['sha256']
    destination = root / 'frontend/e2e' / item['name']
    assert destination.name.startswith('.pr293-') and destination.suffix == '.mjs'
    destination.write_text(result)
    print('Recreated', destination.name, item['sha256'])
