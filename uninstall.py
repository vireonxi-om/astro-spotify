#!/usr/bin/env python3
from pathlib import Path
import os
import shutil
import subprocess
from gi.repository import Gio

UUID = 'astro-spotify@local'
subprocess.run(['gnome-extensions', 'disable', UUID], capture_output=True)
settings = Gio.Settings.new('org.gnome.shell')
for key in ['enabled-extensions', 'disabled-extensions']:
    settings.set_strv(key, [item for item in settings.get_strv(key) if item != UUID])
Gio.Settings.sync()
path = Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'gnome-shell/extensions' / UUID
if path.is_symlink():
    path.unlink()
elif path.is_dir():
    shutil.rmtree(path)
print('Astro Spotify removed. Astro Vitals and all other extensions are unchanged.')
