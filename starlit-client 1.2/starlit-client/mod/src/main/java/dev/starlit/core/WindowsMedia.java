package dev.starlit.core;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

/**
 * Reads the system-wide media session (title, artist, position) through the documented Windows
 * System Media Transport Controls API (the same data the Windows volume flyout shows). Works with Spotify,
 * browsers, foobar2000, VLC and most players. No account, token or network access is involved.
 * The PowerShell script is passed with -EncodedCommand, so no script file or execution-policy override is needed.
 */
public final class WindowsMedia {
    private WindowsMedia() {}

    public static boolean supported() { return System.getProperty("os.name", "").toLowerCase().contains("win"); }

    public static final String SCRIPT = String.join("\n",
        "$ErrorActionPreference = 'Stop'",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
        "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
        "$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
        "function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }",
        "[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]",
        "[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]",
        "$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])",
        "while ($true) {",
        "  try {",
        "    $s = $mgr.GetCurrentSession()",
        "    if ($null -eq $s) { Write-Output '{\"status\":\"none\"}' }",
        "    else {",
        "      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])",
        "      $tl = $s.GetTimelineProperties(); $pb = $s.GetPlaybackInfo()",
        "      $playing = ($pb.PlaybackStatus -eq 'Playing')",
        "      $pos = $tl.Position.TotalMilliseconds",
        "      if ($playing) { $pos += ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalMilliseconds }",
        "      $o = [ordered]@{ status = 'ok'; title = $p.Title; artist = $p.Artist; pos = [math]::Round($pos); end = [math]::Round($tl.EndTime.TotalMilliseconds); playing = $playing }",
        "      Write-Output ($o | ConvertTo-Json -Compress)",
        "    }",
        "  } catch { Write-Output '{\"status\":\"error\"}' }",
        "  [Console]::Out.Flush()",
        "  Start-Sleep -Milliseconds 400",
        "}");

    public static List<String> command() {
        String encoded = Base64.getEncoder().encodeToString(SCRIPT.getBytes(StandardCharsets.UTF_16LE));
        return List.of("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded);
    }

    public static MediaSource create() {
        return new ProcessMediaSource("Windows media session", command());
    }
}
