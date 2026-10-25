# Compiles and runs the Minecraft-free tests (JDK 21 required).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$out = Join-Path $env:TEMP 'starlit-pure-tests'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory $out | Out-Null
javac -d $out (Get-ChildItem src/main/java/dev/starlit/core/*.java).FullName tests/PureTests.java
java -cp $out PureTests @args
