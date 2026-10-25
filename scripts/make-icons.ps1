# Gera os ícones (site e programa de PC) a partir do letreiro novo (public/brand/logo.png):
# fundo escuro arredondado, a faixa vermelha diagonal do menu e o letreiro no meio.
# uso: powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$logo = [System.Drawing.Image]::FromFile((Join-Path $root "public\brand\logo.png"))

function Make-Icon([int]$S, [string]$out) {
  $bmp = New-Object System.Drawing.Bitmap $S, $S
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.InterpolationMode = "HighQualityBicubic"
  $g.Clear([System.Drawing.Color]::Transparent)
  # quadrado arredondado com degradê escuro
  $r = [int]($S * 0.2)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
  $path.AddArc($S - $r * 2 - 1, 0, $r * 2, $r * 2, 270, 90)
  $path.AddArc($S - $r * 2 - 1, $S - $r * 2 - 1, $r * 2, $r * 2, 0, 90)
  $path.AddArc(0, $S - $r * 2 - 1, $r * 2, $r * 2, 90, 90)
  $path.CloseFigure()
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $S, $S), ([System.Drawing.Color]::FromArgb(255, 30, 38, 58)), ([System.Drawing.Color]::FromArgb(255, 8, 10, 15))
  $g.FillPath($bg, $path)
  $g.SetClip($path)
  # faixa vermelha diagonal (a do menu)
  $band = New-Object System.Drawing.Drawing2D.GraphicsPath
  $band.AddPolygon(@(
      (New-Object System.Drawing.PointF ($S * 0.52), 0),
      (New-Object System.Drawing.PointF ($S * 0.74), 0),
      (New-Object System.Drawing.PointF ($S * 0.42), $S),
      (New-Object System.Drawing.PointF ($S * 0.20), $S)))
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, 232, 32, 42))), $band)
  # letreiro no meio (com uma sombra pra destacar do fundo)
  $w = $S * 0.9
  $h = $w * $logo.Height / $logo.Width
  $x = ($S - $w) / 2
  $y = ($S - $h) / 2
  $ia = New-Object System.Drawing.Imaging.ImageAttributes
  $cm = New-Object System.Drawing.Imaging.ColorMatrix
  $cm.Matrix00 = 0; $cm.Matrix11 = 0; $cm.Matrix22 = 0; $cm.Matrix33 = 0.6
  $ia.SetColorMatrix($cm)
  $off = [Math]::Max(1, $S * 0.012)
  $sx = [int]($x + $off); $sy = [int]($y + $off * 1.5); $sw = [int]$w; $sh = [int]$h
  $dst = New-Object System.Drawing.Rectangle $sx, $sy, $sw, $sh
  $g.DrawImage($logo, $dst, 0, 0, $logo.Width, $logo.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
  $g.DrawImage($logo, (New-Object System.Drawing.RectangleF $x, $y, $w, $h))
  $g.ResetClip()
  # borda fina
  $g.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 255, 255, 255)), ([Math]::Max(1, $S / 160))), $path)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  "ok $out"
}

Make-Icon 512 (Join-Path $root "public\icons\icon-512.png")
Make-Icon 192 (Join-Path $root "public\icons\icon-192.png")
Make-Icon 32 (Join-Path $root "public\icons\icon-32.png")
Make-Icon 512 (Join-Path $root "desktop\icon.png")
$logo.Dispose()
