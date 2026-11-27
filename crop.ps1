Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$source = Join-Path (Get-Location) '..\peak-photos'
$destination = Join-Path (Get-Location) 'public\photo'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$formats = @(@{ Label = 'thumb'; Side = 250; Quality = 78 }, @{ Label = 'detail'; Side = 580; Quality = 86 })
$groups = Get-Content -LiteralPath "$source\used.txt" | Group-Object { [Math]::Floor([int]$_ / 9) }
foreach ($group in $groups) {
    $sheet = [System.Drawing.Bitmap]::new("$source\$($group.Name).jpg")
    try {
        $width = [int]($sheet.Width / 3)
        $height = [int]($sheet.Height / 3)
        foreach ($id in $group.Group) {
            $cell = [int]$id % 9
            $rect = [System.Drawing.Rectangle]::new(($cell % 3) * $width, [Math]::Floor($cell / 3) * $height, $width, $height)
            foreach ($format in $formats) {
                $factor = [Math]::Min($format.Side / [Math]::Max($width, $height), 1)
                $image = [System.Drawing.Bitmap]::new([int]($width * $factor), [int]($height * $factor))
                $graphics = [System.Drawing.Graphics]::FromImage($image)
                $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
                try {
                    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                    $graphics.DrawImage($sheet, [System.Drawing.Rectangle]::new(0, 0, $image.Width, $image.Height), $rect, [System.Drawing.GraphicsUnit]::Pixel)
                    $parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]$format.Quality)
                    $image.Save("$destination\$($format.Label)-$id.jpg", $encoder, $parameters)
                } finally {
                    $parameters.Dispose()
                    $graphics.Dispose()
                    $image.Dispose()
                }
            }
        }
    } finally {
        $sheet.Dispose()
    }
}
