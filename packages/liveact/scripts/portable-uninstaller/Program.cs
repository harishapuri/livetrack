using System.Diagnostics;
using System.Runtime.InteropServices;

internal static class Program
{
    const uint MbYesNo = 0x00000004;
    const uint MbIconQuestion = 0x00000020;
    const uint MbIconInformation = 0x00000040;
    const int IdYes = 6;

    [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int MessageBoxW(nint hWnd, string text, string caption, uint type);

    static int Main(string[] args)
    {
        var silent = args.Any(a =>
            string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase)
            || string.Equals(a, "-s", StringComparison.OrdinalIgnoreCase)
            || string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase));

        if (!silent)
        {
            var choice = MessageBoxW(
                0,
                "Uninstall LiveTrack portable and remove local data?\r\n\r\nThis will:\r\n"
                    + "- Quit LiveTrack if it is running\r\n"
                    + "- Delete LiveTrack-Portable-*.exe next to this uninstaller\r\n"
                    + "- Remove user data under Projects\\coact, Documents\\Coact, .coact\r\n"
                    + "- Remove AppData\\LiveTrack (Roaming + Local)\r\n\r\n"
                    + "The NSIS Setup install (if present) is left alone — use Apps & Features for that.",
                "LiveTrack Portable Uninstall",
                MbYesNo | MbIconQuestion);
            if (choice != IdYes) return 0;
        }

        var exeDir = AppContext.BaseDirectory.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar);

        KillLiveTrack();
        DeletePortableExes(exeDir);
        TryDeleteDir(Path.Combine(exeDir, "data"));
        TryDeleteDir(Path.Combine(exeDir, "LiveTrack"));

        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        TryDeleteDir(Path.Combine(profile, "Projects", "coact"));
        TryDeleteDir(Path.Combine(profile, "Documents", "Coact"));
        TryDeleteDir(Path.Combine(profile, ".coact"));
        TryDeleteDir(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "LiveTrack"));
        TryDeleteDir(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "LiveTrack"));

        TryDeleteFile(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            "LiveTrack.lnk"));
        TryDeleteFile(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
            "LiveTrack.lnk"));
        TryDeleteDir(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            "LiveTrack"));

        if (!silent)
        {
            MessageBoxW(
                0,
                "LiveTrack portable cleanup finished.",
                "LiveTrack Portable Uninstall",
                MbIconInformation);
        }

        return 0;
    }

    static void KillLiveTrack()
    {
        foreach (var proc in Process.GetProcesses())
        {
            try
            {
                var name = proc.ProcessName;
                if (name.Equals("LiveTrack", StringComparison.OrdinalIgnoreCase)
                    || name.StartsWith("LiveTrack-Portable-", StringComparison.OrdinalIgnoreCase))
                {
                    proc.Kill(entireProcessTree: true);
                    proc.WaitForExit(3000);
                }
            }
            catch
            {
                // process already exited or access denied
            }
            finally
            {
                proc.Dispose();
            }
        }
        Thread.Sleep(400);
    }

    static void DeletePortableExes(string exeDir)
    {
        string[] matches;
        try
        {
            matches = Directory.GetFiles(exeDir, "LiveTrack-Portable-*.exe");
        }
        catch
        {
            return;
        }

        foreach (var file in matches)
        {
            TryDeleteFile(file);
        }
    }

    static void TryDeleteFile(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // leftover locked files are ignored
        }
    }

    static void TryDeleteDir(string path)
    {
        try
        {
            if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
        }
        catch
        {
            // leftover locked files are ignored
        }
    }
}
