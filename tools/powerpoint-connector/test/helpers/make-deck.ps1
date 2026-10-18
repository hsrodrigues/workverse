# Test helper: creates a 5-slide .pptx (distinct text, color and notes per slide) and closes it again.
# Prints "STARTED" when this script had to start PowerPoint itself (the test may then quit it), else "REUSED".
param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
$started = $false
$app = $null
try { $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch {}
if (-not $app) { $app = New-Object -ComObject PowerPoint.Application; $started = $true }
$pres = $app.Presentations.Add(-1)
$colors = @(0xC04040, 0x40A040, 0x4040C0, 0xC0A020, 0x8030A0)  # BGR
$names = @('Azul', 'Verde', 'Vermelho', 'Ciano', 'Roxo')
for ($i = 1; $i -le 5; $i++) {
  $slide = $pres.Slides.Add($i, 2)
  $slide.FollowMasterBackground = 0
  $slide.Background.Fill.Solid()
  $slide.Background.Fill.ForeColor.RGB = $colors[$i - 1]
  $slide.Shapes.Item(1).TextFrame.TextRange.Text = 'Slide ' + $i + ' ' + $names[$i - 1]
  $slide.Shapes.Item(2).TextFrame.TextRange.Text = 'Conteudo do slide ' + $i
  foreach ($sh in $slide.NotesPage.Shapes) {
    if ($sh.Type -eq 14 -and $sh.PlaceholderFormat.Type -eq 2) { $sh.TextFrame.TextRange.Text = 'Notas do orador ' + $i }
  }
}
$pres.SaveAs($Out)
$pres.Close()
if ($started -and $app.Presentations.Count -eq 0) { $app.Quit() }
if ($started) { 'STARTED' } else { 'REUSED' }
