from pathlib import Path
from zipfile import ZipFile

target = Path(__file__).resolve().parent / 'public' / 'photo'
target.mkdir(parents=True, exist_ok=True)
for archive in sorted((target.parent.parent / 'assets' / 'photos').glob('*.zip')):
    with ZipFile(archive) as photos:
        for entry in photos.infolist():
            if Path(entry.filename).name != entry.filename or not entry.filename.endswith('.jpg'):
                raise ValueError('Invalid photo archive')
            (target / entry.filename).write_bytes(photos.read(entry))
