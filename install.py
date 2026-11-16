#!/usr/bin/env python3
"""Install the local source without changing other GNOME extensions."""
from pathlib import Path
from datetime import datetime
import os
import shutil
import tempfile
from gi.repository import Gio

ROOT = Path(__file__).resolve().parent
UUID = 'astro-spotify@local'
data = Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share')))
base = data / 'gnome-shell/extensions'
base.mkdir(parents=True, exist_ok=True)
target = base / UUID
settings = Gio.Settings.new('org.gnome.shell')
enabled = settings.get_strv('enabled-extensions')
disabled = settings.get_strv('disabled-extensions')
state = Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state'))) / 'astro-spotify'
state.mkdir(parents=True, exist_ok=True)
stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
(state / f'settings-{stamp}.txt').write_text(repr({'enabled': enabled, 'disabled': disabled}) + '\n')

with tempfile.TemporaryDirectory(prefix='.astro-spotify-stage-', dir=base) as temp:
    stage = Path(temp) / UUID
    stage.mkdir()
    for name in ['extension.js', 'player.js', 'stylesheet.css', 'metadata.json']:
        shutil.copy2(ROOT / name, stage / name)
    shutil.copytree(ROOT / 'icons', stage / 'icons')
    backup = None
    if target.exists():
        backup = state / f'backup-{stamp}'
        target.rename(backup)
    try:
        stage.rename(target)
    except BaseException:
        if backup is not None:
            backup.rename(target)
        raise

if UUID not in enabled:
    settings.set_strv('enabled-extensions', enabled + [UUID])
if UUID in disabled:
    settings.set_strv('disabled-extensions', [item for item in disabled if item != UUID])
Gio.Settings.sync()
print(f'Installed: {target}')
print('Enabled for the next GNOME login. Log out and back in once to activate.')
print('Other extensions preserved. No logout or desktop restart performed.')
