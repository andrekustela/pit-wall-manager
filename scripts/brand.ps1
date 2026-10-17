# Gera o logo e os ícones do app a partir da imagem do logo (PNG com fundo transparente).
# uso: powershell -File scripts/brand.ps1 [caminho-da-imagem]
# Saída: public/brand/logo.png (recortado nas bordas do desenho) e public/icons/icon-{512,192,32}.png
param([string]$Src = "$PSScriptRoot\..\public\brand\logo-original.png")
Add-Type -AssemblyName System.Drawing
$pub = Resolve-Path "$PSScriptRoot\..\public"
$img = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Src))

# recorta nas bordas do desenho (ignora o transparente em volta)
$x0 = $img.Width; $y0 = $img.Height; $x1 = 0; $y1 = 0
for ($y = 0; $y -lt $img.Height; $y += 2) {
  for ($x = 0; $x -lt $img.Width; $x += 2) {
    if ($img.GetPixel($x, $y).A -gt 24) {
      if ($x -lt $x0) { $x0 = $x }; if ($x -gt $x1) { $x1 = $x }
      if ($y -lt $y0) { $y0 = $y }; if ($y -gt $y1) { $y1 = $y }
    }
  }
}
$w = $x1 - $x0 + 2; $h = $y1 - $y0 + 2
$logo = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($logo); $g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), (New-Object System.Drawing.Rectangle $x0, $y0, $w, $h), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
New-Item -ItemType Directory -Force "$pub\brand" | Out-Null
$logo.Save("$pub\brand\logo.png", [System.Drawing.Imaging.ImageFormat]::Png)

# ícones quadrados: logo sobre fundo escuro com cantos arredondados
foreach ($s in 512, 192, 32) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $r = [int]($s * 0.22); $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($s - $r - 1, 0, $r, $r, 270, 90)
  $path.AddArc($s - $r - 1, $s - $r - 1, $r, $r, 0, 90); $path.AddArc(0, $s - $r - 1, $r, $r, 90, 90); $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 18, 21, 29))), $path)
  $pad = [int]($s * 0.07); $box = $s - 2 * $pad
  $k = [Math]::Min($box / $logo.Width, $box / $logo.Height)
  $lw = [int]($logo.Width * $k); $lh = [int]($logo.Height * $k)
  $g.DrawImage($logo, [int](($s - $lw) / 2), [int](($s - $lh) / 2), $lw, $lh)
  $g.Dispose(); $bmp.Save("$pub\icons\icon-$s.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}
$logo.Dispose(); $img.Dispose()
"logo $w x $h (recorte em $x0,$y0) e ícones 512/192/32 gerados"
