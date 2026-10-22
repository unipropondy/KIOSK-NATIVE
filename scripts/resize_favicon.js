const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const psScript = `
Add-Type -AssemblyName System.Drawing
$src = "D:\\qr-pos-native\\assets\\images\\POS_IMAGE.png"
$img = [System.Drawing.Image]::FromFile($src)
$thumb = New-Object System.Drawing.Bitmap 64, 64
$g = [System.Drawing.Graphics]::FromImage($thumb)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, 0, 0, 64, 64)
$g.Dispose()
$img.Dispose()

$destPng = "D:\\qr-pos-native\\assets\\images\\favicon.png"
$destIco = "D:\\qr-pos-native\\dist\\favicon.ico"
$destDistPng = "D:\\qr-pos-native\\dist\\favicon.png"

$thumb.Save($destPng, [System.Drawing.Imaging.ImageFormat]::Png)
$thumb.Save($destDistPng, [System.Drawing.Imaging.ImageFormat]::Png)
$thumb.Save($destIco, [System.Drawing.Imaging.ImageFormat]::Png)

$bytes = [System.IO.File]::ReadAllBytes($destPng)
$b64 = [Convert]::ToBase64String($bytes)
$thumb.Dispose()

[System.IO.File]::WriteAllText("D:\\qr-pos-native\\src\\constants\\favicon_b64.ts", "export const FAVICON_DATA_URI = 'data:image/png;base64,$b64';\n")
Write-Output "SUCCESS_RESIZED"
`;

fs.writeFileSync(path.join(__dirname, 'resize_favicon.ps1'), psScript);
console.log('Script written');
