# WorkVerse PowerPoint worker. ASCII only on purpose (Windows PowerShell 5.1 reads BOM-less files as ANSI).
# Protocol: one JSON object per line on stdin {id, cmd, args}; one line on stdout "@@WV@@{json}" with
# {id, ok, data} or {id, ok:false, code, message}. Non-ASCII characters leave as \uXXXX escapes.
# Never saves, closes or modifies the files of the user. Presentations are opened read-only.
param([string]$ExportRoot)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)

function Emit($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 8
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $json.ToCharArray()) {
    if ([int]$ch -gt 126) { [void]$sb.AppendFormat('\u{0:x4}', [int]$ch) } else { [void]$sb.Append($ch) }
  }
  [Console]::Out.WriteLine('@@WV@@' + $sb.ToString())
  [Console]::Out.Flush()
}

function Fail($code) { throw ('WV:' + $code) }

function Get-App([bool]$create) {
  try { return [System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch {}
  # Only attach to a registered instance here. Never use New-Object for a plain status read: it can start (or
  # resurrect while it is closing) a PowerPoint the person just closed.
  if ($create) {
    try { return New-Object -ComObject PowerPoint.Application } catch { Fail 'no_powerpoint' }
  }
  return $null
}

function Get-Show($app) {
  if ($app.SlideShowWindows.Count -gt 0) { return $app.SlideShowWindows.Item(1) }
  return $null
}

function Get-Pres($app) {
  $w = Get-Show $app
  if ($w) { return $w.Presentation }
  if ($app.Presentations.Count -gt 0) {
    try { return $app.ActivePresentation } catch {}
    return $app.Presentations.Item(1)
  }
  return $null
}

function Need-App() {
  $app = Get-App $false
  if (-not $app) { Fail 'no_powerpoint' }
  return $app
}
function Need-Pres($app) {
  $p = Get-Pres $app
  if (-not $p) {
    if ($app.ProtectedViewWindows.Count -gt 0) { Fail 'protected_view' }
    Fail 'no_presentation'
  }
  return $p
}
function Need-Show($app) {
  $w = Get-Show $app
  if (-not $w) { Fail 'no_show' }
  return $w
}

function Text-Of($shape) {
  try { if ($shape.HasTextFrame -and $shape.TextFrame.HasText) { return [string]$shape.TextFrame.TextRange.Text } } catch {}
  return ''
}

function Snapshot() {
  $app = Get-App $false
  $r = [ordered]@{ app = $false; presentation = $null; show = $null; index = 0; title = ''; notes = '' }
  if (-not $app) { return $r }
  $r.app = $true
  $pres = $null
  try { $pres = Get-Pres $app } catch {}
  if (-not $pres) { return $r }
  $count = [int]$pres.Slides.Count
  $r.presentation = [ordered]@{ name = [string]$pres.Name; slides = $count }
  $win = Get-Show $app
  $idx = 0
  if ($win) {
    $v = $win.View
    $state = 'running'
    switch ([int]$v.State) { 2 { $state = 'paused' } 3 { $state = 'black' } 4 { $state = 'white' } 5 { $state = 'ended' } }
    $mode = 'fullscreen'
    try { if (-not $win.IsFullScreen) { $mode = 'window' } } catch {}
    $ptr = 'arrow'
    try {
      $pt = [int]$v.PointerType
      if ($pt -eq 2) { $ptr = 'pen' } elseif ($pt -eq 3) { $ptr = 'hidden' } elseif ($pt -eq 5) { $ptr = 'erase' }
    } catch {}
    try { if ($v.LaserPointerEnabled) { $ptr = 'laser' } } catch {}
    $r.show = [ordered]@{ state = $state; mode = $mode; pointer = $ptr }
    try { $idx = [int]$v.Slide.SlideIndex } catch { try { $idx = [int]$v.CurrentShowPosition } catch {} }
  } else {
    try { $idx = [int]$app.ActiveWindow.View.Slide.SlideIndex } catch {}
  }
  if ($idx -lt 1 -or $idx -gt $count) { $idx = 0 }
  $r.index = $idx
  if ($idx -gt 0) {
    $s = $pres.Slides.Item($idx)
    try { if ($s.Shapes.HasTitle) { $r.title = (Text-Of $s.Shapes.Title).Trim() } } catch {}
    try {
      $n = ''
      foreach ($sh in $s.NotesPage.Shapes) {
        if ($sh.Type -eq 14 -and $sh.PlaceholderFormat.Type -eq 2) { $n = Text-Of $sh; break }
      }
      $r.notes = $n.Trim()
    } catch {}
    if ($r.title.Length -gt 200) { $r.title = $r.title.Substring(0, 200) }
    if ($r.notes.Length -gt 6000) { $r.notes = $r.notes.Substring(0, 6000) }
  }
  return $r
}

function Cmd-Open($a) {
  $path = [string]$a.path
  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  if (@('.pptx', '.pptm', '.ppsx', '.ppsm', '.potx', '.ppt', '.pps', '.pot') -notcontains $ext) { Fail 'bad_request' }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail 'bad_request' }
  $app = Get-App $true
  foreach ($p in $app.Presentations) {
    if ($p.FullName -eq $path) { try { $p.Windows.Item(1).Activate() } catch {}; return $true }
  }
  $pvBefore = $app.ProtectedViewWindows.Count
  $null = $app.Presentations.Open($path, -1, 0, -1)
  if ($app.ProtectedViewWindows.Count -gt $pvBefore) { Fail 'protected_view' }
  return $true
}

function Cmd-Start($a) {
  $app = Need-App
  $pres = Need-Pres $app
  $win = Get-Show $app
  if (-not $win) {
    $ss = $pres.SlideShowSettings
    $old = $ss.ShowType
    $ss.ShowType = $(if ([string]$a.mode -eq 'window') { 2 } else { 1 })
    try { $win = $ss.Run() } finally { try { $ss.ShowType = $old } catch {} }
  }
  $from = 0
  if ($a.from) { $from = [int]$a.from }
  if ($from -gt 1 -and $from -le $pres.Slides.Count) { $win.View.GotoSlide($from) }
}

function Finish-If-Ended($win) {
  # Past the last slide PowerPoint shows an "end of show" screen: leave the show instead of keeping it hanging.
  try { if ([int]$win.View.State -eq 5) { $win.View.Exit() } } catch {}
}

function Run-Command($cmd, $a) {
  switch ($cmd) {
    'ping' { return $true }
    'status' { return (Snapshot) }
    'open' { return (Cmd-Open $a) }
    'start' { Cmd-Start $a; return $true }
    'next' { $w = Need-Show (Need-App); $w.View.Next(); Finish-If-Ended $w; return $true }
    'previous' { $w = Need-Show (Need-App); $w.View.Previous(); return $true }
    'first' { $w = Need-Show (Need-App); $w.View.First(); return $true }
    'last' { $w = Need-Show (Need-App); $w.View.Last(); return $true }
    'goto' {
      $app = Need-App
      $w = Need-Show $app
      $i = [int]$a.index
      if ($i -lt 1 -or $i -gt $w.Presentation.Slides.Count) { Fail 'bad_request' }
      $w.View.GotoSlide($i)
      return $true
    }
    'blank' {
      $w = Need-Show (Need-App)
      $target = $(if ([string]$a.kind -eq 'white') { 4 } else { 3 })
      if ([int]$w.View.State -eq $target) { $w.View.State = 1 } else { $w.View.State = $target }
      return $true
    }
    'pointer' {
      $w = Need-Show (Need-App)
      $v = $w.View
      $m = [string]$a.mode
      if ($m -eq 'laser') {
        $v.PointerType = 1
        try { $v.LaserPointerEnabled = $true } catch { Fail 'unsupported' }
      } else {
        try { $v.LaserPointerEnabled = $false } catch {}
        if ($m -eq 'pen') { $v.PointerType = 2 }
        elseif ($m -eq 'hidden') { $v.PointerType = 3 }
        elseif ($m -eq 'erase') { $v.EraseDrawing() }
        else { $v.PointerType = 1 }
      }
      return $true
    }
    'end' { $w = Get-Show (Need-App); if ($w) { $w.View.Exit() }; return $true }
    'export' {
      $app = Need-App
      $pres = Need-Pres $app
      $i = [int]$a.index
      if ($i -lt 1 -or $i -gt $pres.Slides.Count) { Fail 'bad_request' }
      $out = [System.IO.Path]::GetFullPath([string]$a.out)
      $root = [System.IO.Path]::GetFullPath($ExportRoot)
      if (-not $out.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { Fail 'bad_request' }
      $fmt = $(if ([string]$a.format -eq 'jpeg') { 'JPG' } else { 'PNG' })
      $w = [int]$a.width
      if ($w -lt 100 -or $w -gt 4000) { Fail 'bad_request' }
      $h = [int][math]::Round($w * $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth)
      $pres.Slides.Item($i).Export($out, $fmt, $w, $h)
      return $true
    }
    default { Fail 'bad_request' }
  }
}

Emit ([ordered]@{ id = 0; ok = $true; data = 'ready' })

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  $id = 0
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $data = Run-Command ([string]$req.cmd) $req.args
    Emit ([ordered]@{ id = $id; ok = $true; data = $data })
  } catch {
    $msg = [string]$_.Exception.Message
    $code = 'internal'
    $hr = 0
    try { $hr = [int]$_.Exception.HResult } catch {}
    if ($msg.StartsWith('WV:')) { $code = $msg.Substring(3) }
    elseif ($hr -eq -2147418111 -or $hr -eq -2147417846) { $code = 'busy' }
    elseif ($hr -eq -2147023174 -or $hr -eq -2147417848 -or $hr -eq -2147023170) { $code = 'no_powerpoint' }
    Emit ([ordered]@{ id = $id; ok = $false; code = $code; message = $(if ($code -eq 'internal') { $msg } else { '' }); hresult = $hr })
  }
}
