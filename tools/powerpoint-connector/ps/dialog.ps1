# Shows the native "Open" dialog for PowerPoint files. Prints "PATH:<base64 utf8>" or "CANCEL". Run with -STA.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.StartPosition = 'Manual'
$owner.Location = New-Object System.Drawing.Point(-3000, -3000)
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Show()
$owner.Activate()
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = 'WorkVerse - escolher apresenta' + [char]0xE7 + [char]0xE3 + 'o do PowerPoint'
$dlg.Filter = 'Apresenta' + [char]0xE7 + [char]0xF5 + 'es do PowerPoint|*.pptx;*.pptm;*.ppsx;*.ppsm;*.potx;*.ppt;*.pps;*.pot'
$dlg.CheckFileExists = $true
$dlg.Multiselect = $false
$dlg.RestoreDirectory = $true
try {
  if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    $b = [System.Text.Encoding]::UTF8.GetBytes($dlg.FileName)
    [Console]::Out.WriteLine('PATH:' + [Convert]::ToBase64String($b))
  } else {
    [Console]::Out.WriteLine('CANCEL')
  }
} finally {
  $owner.Close()
}
