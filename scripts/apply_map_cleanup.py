#!/usr/bin/env python3
"""既存 components/map.tsx の車両マーカー削除処理だけを安全に追加する。
実行場所: my-app プロジェクト直下。GitHubへの変更は行わない。
"""
from pathlib import Path
import shutil
import sys

path = Path('components/map.tsx')
if not path.is_file():
    sys.exit('ERROR: my-app の直下から実行してください。components/map.tsx が見つかりません。')

source = path.read_text(encoding='utf-8')
old = '''  useEffect(() => {
    if (!mapRef.current || locations.length === 0 || !leafletRef.current) return

    const latestLocation = locations[locations.length - 1]'''
new = '''  useEffect(() => {
    if (!mapRef.current || !leafletRef.current) return

    // 位置情報がなくなったとき、以前の車両マーカーも地図から削除する。
    if (locations.length === 0) {
      if (vehicleMarkerRef.current) {
        vehicleMarkerRef.current.unbindTooltip()
        vehicleMarkerRef.current.remove()
        vehicleMarkerRef.current = null
      }
      lastValidHeadingRef.current = 0
      return
    }

    const latestLocation = locations[locations.length - 1]'''

if new in source:
    print('OK: 既にマーカー削除処理が追加されています。変更は不要です。')
    sys.exit(0)
if source.count(old) != 1:
    sys.exit('ERROR: 想定した箇所が見つからないため変更しませんでした。components/map.tsx の対象useEffectを確認してください。')
backup = path.with_name('map.tsx.before-gps-reset.bak')
if not backup.exists():
    shutil.copy2(path, backup)
path.write_text(source.replace(old, new), encoding='utf-8')
print(f'OK: {path} に車両マーカー削除処理を追加しました。')
print(f'バックアップ: {backup}')
