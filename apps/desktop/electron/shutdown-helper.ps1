param(
    [string]$StatusFile,
    [int]$ElectronPid
)

$ErrorActionPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing       | Out-Null

$csharp = @"
using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class ShutdownBlockerForm : Form
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool ShutdownBlockReasonCreate(IntPtr hWnd, [MarshalAs(UnmanagedType.LPWStr)] string pwszReason);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool ShutdownBlockReasonDestroy(IntPtr hWnd);

    private const int WM_QUERYENDSESSION = 0x0011;
    private const int WM_ENDSESSION      = 0x0016;
    private const string BLOCK_REASON    = "Please punch out first in Attendance Management System before shutting down.";

    private readonly string _statusFile;
    private readonly int _electronPid;
    private readonly System.Windows.Forms.Timer _watchdog;

    public ShutdownBlockerForm(string statusFile, int electronPid)
    {
        _statusFile  = statusFile;
        _electronPid = electronPid;

        // Completely invisible, off-screen, no taskbar entry
        this.ShowInTaskbar   = false;
        this.Opacity         = 0;
        this.Width           = 1;
        this.Height          = 1;
        this.FormBorderStyle = FormBorderStyle.None;
        this.StartPosition   = FormStartPosition.Manual;
        this.Location        = new System.Drawing.Point(-32000, -32000);
        this.Text            = "AttendanceShutdownGate";

        // Watchdog: exit this helper when Electron is no longer running
        _watchdog          = new System.Windows.Forms.Timer();
        _watchdog.Interval = 3000;  // check every 3 seconds
        _watchdog.Tick    += OnWatchdogTick;
        _watchdog.Start();
    }

    private void OnWatchdogTick(object sender, EventArgs e)
    {
        if (!IsElectronRunning()) Application.Exit();
    }

    /// <summary>Returns true only if the Electron process is still alive.</summary>
    private bool IsElectronRunning()
    {
        try
        {
            var proc = Process.GetProcessById(_electronPid);
            return !proc.HasExited;
        }
        catch { return false; }
    }

    private void SafeWriteStdout(string msg)
    {
        try { Console.Out.WriteLine(msg); Console.Out.Flush(); } catch { }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_QUERYENDSESSION)
        {
            // --- Read punch status synchronously (very fast, < 1 ms) ---
            bool isPunchedIn = false;
            try
            {
                if (File.Exists(_statusFile))
                {
                    string json = File.ReadAllText(_statusFile);
                    isPunchedIn = json.Contains("\"isPunchedIn\":true") ||
                                  json.Contains("\"isPunchedIn\": true");
                }
            }
            catch { /* on error -> default: allow */ }

            // Only block when BOTH conditions hold:
            //   1. Employee is actually clocked in
            //   2. Electron is still running (stale status should not block)
            bool shouldBlock = isPunchedIn && IsElectronRunning();

            if (shouldBlock)
            {
                ShutdownBlockReasonCreate(this.Handle, BLOCK_REASON);
                SafeWriteStdout("SHUTDOWN_BLOCKED");
                m.Result = IntPtr.Zero;   // Return FALSE -> Windows blocks shutdown
            }
            else
            {
                SafeWriteStdout("SHUTDOWN_ALLOWED");
                m.Result = new IntPtr(1); // Return TRUE -> allow
            }
            return;
        }

        if (m.Msg == WM_ENDSESSION)
        {
            SafeWriteStdout("SESSION_ENDED");
            try { ShutdownBlockReasonDestroy(this.Handle); } catch { }
            Application.Exit();
        }

        base.WndProc(ref m);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            try { _watchdog.Stop(); _watchdog.Dispose(); } catch { }
        }
        base.Dispose(disposing);
    }
}
"@

Add-Type -TypeDefinition $csharp -ReferencedAssemblies "System.Windows.Forms","System.Drawing" -Language CSharp | Out-Null

$form = New-Object ShutdownBlockerForm($StatusFile, $ElectronPid)
# Force HWND creation so WM_QUERYENDSESSION is delivered to this window
$null = $form.Handle

Write-Host "HELPER_READY"
[Console]::Out.Flush()

# Enter Windows message loop (blocks forever, handles WM_QUERYENDSESSION)
[System.Windows.Forms.Application]::Run($form)
