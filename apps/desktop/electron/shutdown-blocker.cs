using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace AttendanceShutdownGate
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            string statusFile  = "";
            int    electronPid = 0;
            string electronExe = "";

            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--status-file")  statusFile  = args[i + 1];
                if (args[i] == "--pid")          int.TryParse(args[i + 1], out electronPid);
                if (args[i] == "--electron-exe") electronExe = args[i + 1];
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ShutdownBlockerForm(statusFile, electronPid, electronExe));
        }
    }

    class ShutdownBlockerForm : Form
    {
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool ShutdownBlockReasonCreate(IntPtr hWnd,
            [MarshalAs(UnmanagedType.LPWStr)] string pwszReason);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool ShutdownBlockReasonDestroy(IntPtr hWnd);

        const int WM_QUERYENDSESSION = 0x0011;
        const int WM_ENDSESSION      = 0x0016;
        const string BLOCK_REASON    =
            "Please punch out first in Attendance Management System before shutting down.";

        readonly string _statusFile;
        readonly int    _electronPid;
        readonly string _electronExe;
        readonly Timer  _watchdog;

        public ShutdownBlockerForm(string statusFile, int electronPid, string electronExe)
        {
            _statusFile  = statusFile;
            _electronPid = electronPid;
            _electronExe = electronExe;

            // Completely invisible, off-screen, no taskbar entry
            ShowInTaskbar   = false;
            Opacity         = 0;
            Width           = 1;
            Height          = 1;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition   = FormStartPosition.Manual;
            SetDesktopLocation(-32000, -32000);
            Text            = "AttendanceShutdownGate";

            // Watchdog: exit ONLY when Electron is gone AND employee is safely clocked out.
            // If the employee is still punched in after Electron exits, we STAY ALIVE so
            // we can block any shutdown attempt until they actually clock out.
            _watchdog          = new Timer();
            _watchdog.Interval = 3000;
            _watchdog.Tick    += OnWatchdogTick;
            _watchdog.Start();

            SafeOut("HELPER_READY");
        }

        // -----------------------------------------------------------------------
        // Watchdog: only exit when it is safe to do so
        // -----------------------------------------------------------------------
        private void OnWatchdogTick(object sender, EventArgs e)
        {
            bool alive   = IsElectronAlive();
            bool punched = IsPunchedIn();

            // Safe to exit: Electron is gone AND employee is not clocked in
            if (!alive && !punched)
            {
                Application.Exit();
            }

            // If Electron is gone but employee IS punched in → STAY ALIVE.
            // We need to block any incoming shutdown and bring the app back up.
        }

        // -----------------------------------------------------------------------
        // Helpers
        // -----------------------------------------------------------------------

        bool IsElectronAlive()
        {
            if (_electronPid <= 0) return false;
            try
            {
                var p = Process.GetProcessById(_electronPid);
                return !p.HasExited;
            }
            catch { return false; }
        }

        bool IsPunchedIn()
        {
            try
            {
                if (!File.Exists(_statusFile)) return false;
                string json = File.ReadAllText(_statusFile);
                return json.Contains("\"isPunchedIn\":true") ||
                       json.Contains("\"isPunchedIn\": true");
            }
            catch { return false; }
        }

        void SafeOut(string msg)
        {
            try { Console.WriteLine(msg); Console.Out.Flush(); } catch { }
        }

        /// <summary>
        /// If the Electron app is not already running, launch it from the known
        /// executable path.  Silently ignores failures (e.g. dev-mode path not set).
        /// </summary>
        void TryLaunchElectron()
        {
            // Already running — nothing to do
            if (IsElectronAlive()) return;

            try
            {
                // In production the caller passes --electron-exe so we can relaunch
                if (!string.IsNullOrEmpty(_electronExe) && File.Exists(_electronExe))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName        = _electronExe,
                        UseShellExecute = true,
                    });
                    return;
                }

                // Fallback: look for the installed app in the default NSIS per-user location
                string localApp  = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string candidate = Path.Combine(localApp, "Programs",
                    "Attendance Management System",
                    "Attendance Management System.exe");

                if (File.Exists(candidate))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName        = candidate,
                        UseShellExecute = true,
                    });
                }
            }
            catch { /* best-effort */ }
        }

        // -----------------------------------------------------------------------
        // Windows shutdown interception
        // -----------------------------------------------------------------------
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_QUERYENDSESSION)
            {
                // DECISION: based ONLY on local punch-status.json — no API call,
                // no Electron alive check.  This works even if Antigravity/API is down.
                bool shouldBlock = IsPunchedIn();

                if (shouldBlock)
                {
                    ShutdownBlockReasonCreate(Handle, BLOCK_REASON);
                    SafeOut("SHUTDOWN_BLOCKED");
                    m.Result = IntPtr.Zero;   // Return FALSE → Windows blocks shutdown

                    // Asynchronously handle user notification (cannot block WndProc)
                    BeginInvoke(new Action(() =>
                    {
                        bool electronIsUp = IsElectronAlive();

                        if (!electronIsUp)
                        {
                            // Electron is closed — show a native Windows dialog immediately
                            // so the employee knows what to do WITHOUT needing the app open.
                            MessageBox.Show(
                                "You are still clocked in to the Attendance System.\n\n" +
                                "Shutdown has been blocked.\n\n" +
                                "The Attendance app is opening — please punch out, then try shutting down again.",
                                "Punch Out Required",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Warning,
                                MessageBoxDefaultButton.Button1,
                                MessageBoxOptions.DefaultDesktopOnly);

                            // Then launch the Electron app so the employee can punch out
                            TryLaunchElectron();
                        }
                        // If Electron IS running, it received "SHUTDOWN_BLOCKED" via stdout
                        // and will show its own in-app modal (better UX when app is already open)
                    }));
                }
                else
                {
                    SafeOut("SHUTDOWN_ALLOWED");
                    m.Result = (IntPtr)1;     // Return TRUE → allow shutdown
                }
                return;
            }

            if (m.Msg == WM_ENDSESSION)
            {
                SafeOut("SESSION_ENDED");
                try { ShutdownBlockReasonDestroy(Handle); } catch { }
                Application.Exit();
            }

            base.WndProc(ref m);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { try { _watchdog.Stop(); _watchdog.Dispose(); } catch { } }
            base.Dispose(disposing);
        }
    }
}
