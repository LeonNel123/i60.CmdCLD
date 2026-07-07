// 7za.exe shim for Windows packaging.
//
// electron-builder's app-builder downloads winCodeSign-2.6.0.7z, which contains
// two macOS symlinks (darwin/10.12/lib/libcrypto.dylib, libssl.dylib). On Windows
// without admin rights / Developer Mode, 7-Zip cannot create symlinks and returns
// exit code 2 ("warning") -- even though every Windows file (signtool, rcedit, ...)
// extracts correctly. app-builder treats any non-zero exit as fatal, so the whole
// `electron-builder --win nsis` run fails.
//
// This shim invokes the real 7-Zip (7za-real.exe, a sibling of this exe) with the
// exact same arguments, inherits this process's stdio, and maps the symlink-only
// warning (exit 2) to success (exit 0). Every other exit code passes through
// unchanged, so genuine extraction failures still fail the build.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

internal static class SevenZipShim
{
    private static int Main()
    {
        string shimPath = Assembly.GetExecutingAssembly().Location;
        string dir = Path.GetDirectoryName(shimPath);
        string realExe = Path.Combine(dir, "7za-real.exe");

        if (!File.Exists(realExe))
        {
            Console.Error.WriteLine("7za shim: 7za-real.exe not found next to " + shimPath);
            return 127;
        }

        // Take the raw command line and strip the leading program token, so the
        // remaining arguments (with their original quoting) forward verbatim.
        string args = StripFirstToken(Environment.CommandLine);

        var psi = new ProcessStartInfo
        {
            FileName = realExe,
            Arguments = args,
            UseShellExecute = false,   // inherit this console's stdout/stderr/stdin
        };

        using (var proc = Process.Start(psi))
        {
            proc.WaitForExit();
            int code = proc.ExitCode;
            // 2 == 7-Zip "warning (non-fatal)"; here it is only the unsupported
            // macOS symlinks, which are irrelevant on Windows. Treat as success.
            return code == 2 ? 0 : code;
        }
    }

    // Removes the first whitespace-delimited token from a Windows command line,
    // honoring a leading double-quoted program path. Returns the rest, trimmed.
    private static string StripFirstToken(string commandLine)
    {
        if (string.IsNullOrEmpty(commandLine)) return string.Empty;
        int i = 0;
        int n = commandLine.Length;
        if (commandLine[0] == '"')
        {
            i = 1;
            while (i < n && commandLine[i] != '"') i++;
            if (i < n) i++; // skip closing quote
        }
        else
        {
            while (i < n && !char.IsWhiteSpace(commandLine[i])) i++;
        }
        while (i < n && char.IsWhiteSpace(commandLine[i])) i++;
        return commandLine.Substring(i);
    }
}
