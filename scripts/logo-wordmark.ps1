# Logo do menu a partir de uma imagem com fundo liso (ex.: letreiro gerado no Gemini):
# tira o fundo (vira transparente, com borda suave), recorta no desenho e salva em
# public/brand/logo.png. A logo anterior fica em public/brand/logo-pixel.png.
# uso: powershell -File scripts/logo-wordmark.ps1 <imagem>
param([Parameter(Mandatory = $true)][string]$Src)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class Chroma {
  // alpha pela distância de cor até o fundo: perto = transparente, longe = opaco (borda suave)
  public static Bitmap Key(Bitmap src, int lo, int hi) {
    int w = src.Width, h = src.Height;
    var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(bmp)) g.DrawImage(src, 0, 0, w, h);
    var d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    var px = new byte[d.Stride * h]; Marshal.Copy(d.Scan0, px, 0, px.Length);
    // fundo = média dos 4 cantos (blocos de 16x16)
    long sr = 0, sg = 0, sb = 0, n = 0;
    foreach (var c in new[] { new[] { 0, 0 }, new[] { w - 16, 0 }, new[] { 0, h - 16 }, new[] { w - 16, h - 16 } })
      for (int y = c[1]; y < c[1] + 16; y++) for (int x = c[0]; x < c[0] + 16; x++) { int i = y * d.Stride + x * 4; sb += px[i]; sg += px[i + 1]; sr += px[i + 2]; n++; }
    int br = (int)(sr / n), bgc = (int)(sg / n), bb = (int)(sb / n);
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      int i = y * d.Stride + x * 4;
      int dist = Math.Max(Math.Abs(px[i + 2] - br), Math.Max(Math.Abs(px[i + 1] - bgc), Math.Abs(px[i] - bb)));
      double a = Math.Min(1, Math.Max(0, (dist - lo) / (double)(hi - lo)));
      if (a > 0 && a < 1) {
        // tira a cor do fundo misturada na borda (sem halo escuro)
        for (int k = 0; k < 3; k++) { int bgk = k == 0 ? bb : k == 1 ? bgc : br; px[i + k] = (byte)Math.Max(0, Math.Min(255, (px[i + k] - bgk * (1 - a)) / a)); }
      }
      px[i + 3] = (byte)(a * 255);
    }
    Marshal.Copy(px, 0, d.Scan0, px.Length); bmp.UnlockBits(d);
    return bmp;
  }
}
"@
$pub = Resolve-Path "$PSScriptRoot\..\public\brand"
if (-not (Test-Path "$pub\logo-pixel.png")) { Copy-Item "$pub\logo.png" "$pub\logo-pixel.png" }
$img = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Src))
$k = [Chroma]::Key($img, 14, 60)
# recorta no desenho (alpha visível) com uma margem
$x0 = $k.Width; $y0 = $k.Height; $x1 = 0; $y1 = 0
for ($y = 0; $y -lt $k.Height; $y += 2) { for ($x = 0; $x -lt $k.Width; $x += 2) { if ($k.GetPixel($x, $y).A -gt 40) { if ($x -lt $x0) { $x0 = $x }; if ($x -gt $x1) { $x1 = $x }; if ($y -lt $y0) { $y0 = $y }; if ($y -gt $y1) { $y1 = $y } } } }
$pad = 10
$x0 = [Math]::Max(0, $x0 - $pad); $y0 = [Math]::Max(0, $y0 - $pad); $x1 = [Math]::Min($k.Width - 1, $x1 + $pad); $y1 = [Math]::Min($k.Height - 1, $y1 + $pad)
$w = $x1 - $x0 + 1; $h = $y1 - $y0 + 1
$out = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($out); $g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($k, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), (New-Object System.Drawing.Rectangle $x0, $y0, $w, $h), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$out.Save("$pub\logo.png", [System.Drawing.Imaging.ImageFormat]::Png)
"logo $w x $h salva em $pub\logo.png (anterior em logo-pixel.png)"
