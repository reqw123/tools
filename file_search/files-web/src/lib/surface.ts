/**
 * 桌面牆模式——由 wallpaper-app（Electron）用 `?surface=desktop&wall=<0..1>` 開啟。
 * 一般瀏覽器開這個網頁不帶參數，完全不受影響。
 */
export function applySurface(): void {
  const p = new URLSearchParams(location.search)
  if (p.get('surface') !== 'desktop') return
  document.documentElement.dataset.surface = 'desktop'
  const wall = Number(p.get('wall'))
  if (Number.isFinite(wall) && wall >= 0 && wall <= 1) {
    document.documentElement.style.setProperty('--wall-opacity', String(wall))
  }
}
