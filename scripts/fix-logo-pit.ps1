# Corrige o letreiro da logo: "PITT WALL" -> "PIT WALL" (tira o segundo T e recentraliza).
# Guarda a original em public/brand/logo-original-pitt.png. Depois rode scripts/brand.ps1.
Add-Type -AssemblyName System.Drawing
$dir = Resolve-Path "$PSScriptRoot\..\public\brand"
$srcPath = "$dir\logo-original.png"
$bak = "$dir\logo-original-pitt.png"
if (-not (Test-Path $bak)) { Copy-Item $srcPath $bak }
$src = [System.Drawing.Bitmap]::FromFile($bak)
$dst = New-Object System.Drawing.Bitmap $src.Width, $src.Height
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.DrawImage($src, 0, 0, $src.Width, $src.Height)
$g.Dispose()

$y0 = 388; $y1 = 472          # faixa do letreiro (com o contorno escuro)
$x0 = 44; $x1 = 543
# 1) apaga o letreiro com a cor do fundo de cada linha (tirada do vão entre "PITT" e "WALL")
for ($y = $y0; $y -le $y1; $y++) {
  $bg = $src.GetPixel(265, $y)
  for ($x = $x0; $x -le $x1; $x++) { $dst.SetPixel($x, $y, $bg) }
}
# 2) cola "PIT" (P, I e o primeiro T) e "WALL", centralizados
#    original: P 48-103, I 116-131, T 144-192, T 205-254 (sai), W 278-355 ... L 496-539
$shiftA = 30    # PIT: 44..198 -> 74..228
$shiftB = -32   # WALL: 272..543 -> 240..511
for ($y = $y0; $y -le $y1; $y++) {
  for ($x = 44; $x -le 198; $x++) { $dst.SetPixel($x + $shiftA, $y, $src.GetPixel($x, $y)) }
  for ($x = 272; $x -le 543; $x++) { $dst.SetPixel($x + $shiftB, $y, $src.GetPixel($x, $y)) }
}
$src.Dispose()
$dst.Save($srcPath, [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose()
"ok: $srcPath (original em $bak)"
