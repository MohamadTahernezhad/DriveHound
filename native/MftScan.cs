// DriveHound — MFT reader.
// Reads the NTFS Master File Table of a volume directly (like WizTree) and writes a compact
// binary listing: record index, parent, flags, size, timestamps, name.
// Read-only: the volume handle is opened with GENERIC_READ only. Requires administrator rights.
//
// Usage: mftscan.exe <DriveLetter> <output.bin>
// Build: csc.exe /nologo /optimize+ /platform:x64 /out:mftscan.exe MftScan.cs   (C# 5, .NET Framework 4.x)

using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

static class MftScan
{
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);

    const uint GENERIC_READ = 0x80000000;
    const uint FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2;
    const uint OPEN_EXISTING = 3;

    static int bytesPerSector;

    static int Main(string[] args)
    {
        try
        {
            if (args.Length != 2) { Console.Error.WriteLine("usage: mftscan <DriveLetter> <output.bin>"); return 64; }
            string drive = args[0].TrimEnd(':', '\\');
            if (drive.Length != 1 || !char.IsLetter(drive[0])) { Console.Error.WriteLine("invalid drive"); return 64; }
            string output = Path.GetFullPath(args[1]);
            if (!output.EndsWith(".bin", StringComparison.OrdinalIgnoreCase)) { Console.Error.WriteLine("output must be .bin"); return 64; }
            return Run(drive.ToUpperInvariant(), output);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("ERROR " + e.GetType().Name + ": " + e.Message);
            return 1;
        }
    }

    static void Progress(string output, long done, long total)
    {
        try { File.WriteAllText(output + ".progress", done + " " + total); } catch { }
        Console.Error.WriteLine("P " + done + " " + total);
    }

    static int Run(string drive, string output)
    {
        SafeFileHandle h = CreateFile("\\\\.\\" + drive + ":", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
        if (h.IsInvalid)
        {
            int err = Marshal.GetLastWin32Error();
            Console.Error.WriteLine(err == 5 ? "ACCESS_DENIED" : "OPEN_FAILED " + err);
            return err == 5 ? 5 : 2;
        }
        using (FileStream vol = new FileStream(h, FileAccess.Read, 1 << 20, false))
        {
            byte[] boot = ReadAt(vol, 0, 512);
            if (Encoding.ASCII.GetString(boot, 3, 4) != "NTFS") { Console.Error.WriteLine("NOT_NTFS"); return 3; }
            bytesPerSector = BitConverter.ToUInt16(boot, 0x0B);
            int sectorsPerCluster = boot[0x0D];
            long clusterSize = (long)bytesPerSector * sectorsPerCluster;
            long mftCluster = BitConverter.ToInt64(boot, 0x30);
            sbyte cpr = (sbyte)boot[0x40];
            int recSize = cpr > 0 ? (int)(cpr * clusterSize) : 1 << (-cpr);

            byte[] rec0 = ReadAt(vol, mftCluster * clusterSize, recSize);
            if (!Fixup(rec0, 0, recSize)) { Console.Error.WriteLine("BAD_MFT_RECORD0"); return 4; }
            long mftDataSize;
            List<long[]> runs = DataRuns(rec0, out mftDataSize);
            if (runs == null || runs.Count == 0) { Console.Error.WriteLine("NO_MFT_RUNS"); return 4; }
            long total = mftDataSize / recSize;
            if (total > int.MaxValue) total = int.MaxValue;
            int n = (int)total;

            uint[] parent = new uint[n];
            long[] size = new long[n];
            long[] mtime = new long[n];
            long[] ctime = new long[n];
            byte[] flags = new byte[n];    // 1 in use, 2 directory
            byte[] nameRank = new byte[n];
            string[] names = new string[n];

            long index = 0;
            const int chunkRecords = 4096;
            byte[] buf = new byte[chunkRecords * recSize];
            long lastReport = 0;
            foreach (long[] run in runs)
            {
                long lcn = run[0], clusters = run[1];
                long runBytes = clusters * clusterSize;
                long pos = 0;
                while (pos < runBytes && index < n)
                {
                    int want = (int)Math.Min(buf.Length, runBytes - pos);
                    want -= want % recSize;
                    if (want <= 0) break;
                    vol.Position = lcn * clusterSize + pos;
                    int got = ReadFully(vol, buf, want);
                    int count = got / recSize;
                    for (int i = 0; i < count && index < n; i++, index++)
                        ParseRecord(buf, i * recSize, recSize, (int)index, n, parent, size, mtime, ctime, flags, nameRank, names);
                    pos += want;
                    if (index - lastReport > 200000) { Progress(output, index, n); lastReport = index; }
                }
            }
            Progress(output, n, n);
            Write(output, n, parent, size, mtime, ctime, flags, names);
        }
        return 0;
    }

    static byte[] ReadAt(FileStream fs, long offset, int len)
    {
        // raw volume reads must be sector aligned
        long aligned = offset - (offset % 512);
        int pad = (int)(offset - aligned);
        int total = ((pad + len + 511) / 512) * 512;
        byte[] tmp = new byte[total];
        fs.Position = aligned;
        ReadFully(fs, tmp, total);
        byte[] res = new byte[len];
        Buffer.BlockCopy(tmp, pad, res, 0, len);
        return res;
    }

    static int ReadFully(FileStream fs, byte[] buf, int len)
    {
        int off = 0;
        while (off < len)
        {
            int r = fs.Read(buf, off, len - off);
            if (r <= 0) break;
            off += r;
        }
        return off;
    }

    // Apply the update sequence array (multi-sector protection)
    static bool Fixup(byte[] b, int off, int recSize)
    {
        if (BitConverter.ToUInt32(b, off) != 0x454C4946) return false;      // "FILE"
        int usaOfs = BitConverter.ToUInt16(b, off + 4);
        int usaCount = BitConverter.ToUInt16(b, off + 6);
        if (usaOfs + usaCount * 2 > recSize || usaCount == 0) return false;
        ushort usn = BitConverter.ToUInt16(b, off + usaOfs);
        int sector = bytesPerSector > 0 ? bytesPerSector : 512;
        for (int i = 1; i < usaCount; i++)
        {
            int p = off + i * sector - 2;
            if (p + 2 > off + recSize) break;
            if (BitConverter.ToUInt16(b, p) != usn) return false;
            b[p] = b[off + usaOfs + i * 2];
            b[p + 1] = b[off + usaOfs + i * 2 + 1];
        }
        return true;
    }

    static List<long[]> DataRuns(byte[] rec, out long dataSize)
    {
        dataSize = 0;
        int a = BitConverter.ToUInt16(rec, 0x14);
        while (a + 16 < rec.Length)
        {
            uint type = BitConverter.ToUInt32(rec, a);
            if (type == 0xFFFFFFFF || type == 0) break;
            int len = (int)BitConverter.ToUInt32(rec, a + 4);
            if (len <= 0 || a + len > rec.Length) break;
            if (type == 0x80 && rec[a + 8] == 1 && rec[a + 9] == 0)
            {
                dataSize = BitConverter.ToInt64(rec, a + 0x30);
                int runOfs = a + BitConverter.ToUInt16(rec, a + 0x20);
                return DecodeRuns(rec, runOfs, a + len);
            }
            a += len;
        }
        return null;
    }

    static List<long[]> DecodeRuns(byte[] b, int p, int end)
    {
        List<long[]> runs = new List<long[]>();
        long lcn = 0;
        while (p < end && b[p] != 0)
        {
            int header = b[p++];
            int lenBytes = header & 0x0F, offBytes = header >> 4;
            if (lenBytes == 0 || p + lenBytes + offBytes > end) break;
            long length = 0;
            for (int i = 0; i < lenBytes; i++) length |= (long)b[p + i] << (8 * i);
            p += lenBytes;
            if (offBytes == 0) { p += 0; continue; }                             // sparse run: no clusters on disk
            long delta = 0;
            for (int i = 0; i < offBytes; i++) delta |= (long)b[p + i] << (8 * i);
            if ((b[p + offBytes - 1] & 0x80) != 0) delta |= -1L << (8 * offBytes);  // sign extend
            p += offBytes;
            lcn += delta;
            runs.Add(new long[] { lcn, length });
        }
        return runs;
    }

    static void ParseRecord(byte[] b, int off, int recSize, int idx, int n, uint[] parent, long[] size, long[] mtime, long[] ctime, byte[] flags, byte[] nameRank, string[] names)
    {
        if (!Fixup(b, off, recSize)) return;
        int recFlags = BitConverter.ToUInt16(b, off + 0x16);
        if ((recFlags & 1) == 0) return;                                        // not in use
        long baseRef = BitConverter.ToInt64(b, off + 0x20) & 0xFFFFFFFFFFFFL;
        int target = baseRef != 0 ? (int)baseRef : idx;
        if (target < 0 || target >= n) return;
        if (baseRef == 0) flags[target] |= (byte)(1 | ((recFlags & 2) != 0 ? 2 : 0));

        int a = off + BitConverter.ToUInt16(b, off + 0x14);
        int end = off + recSize;
        while (a + 16 <= end)
        {
            uint type = BitConverter.ToUInt32(b, a);
            if (type == 0xFFFFFFFF || type == 0) break;
            int len = (int)BitConverter.ToUInt32(b, a + 4);
            if (len < 16 || a + len > end) break;
            byte nonRes = b[a + 8];
            byte attrNameLen = b[a + 9];
            if (type == 0x10 && nonRes == 0)
            {
                int v = a + BitConverter.ToUInt16(b, a + 0x14);
                if (v + 16 <= end) { ctime[target] = BitConverter.ToInt64(b, v); mtime[target] = BitConverter.ToInt64(b, v + 8); }
            }
            else if (type == 0x30 && nonRes == 0)
            {
                int v = a + BitConverter.ToUInt16(b, a + 0x14);
                if (v + 0x42 <= end)
                {
                    long pref = BitConverter.ToInt64(b, v) & 0xFFFFFFFFFFFFL;
                    int nlen = b[v + 0x40];
                    int ns = b[v + 0x41];
                    byte rank = (byte)(ns == 2 ? 1 : ns == 0 ? 2 : 3);              // DOS < POSIX < Win32
                    if (rank > nameRank[target] && v + 0x42 + nlen * 2 <= end)
                    {
                        nameRank[target] = rank;
                        names[target] = Encoding.Unicode.GetString(b, v + 0x42, nlen * 2);
                        parent[target] = (uint)pref;
                    }
                }
            }
            else if (type == 0x80 && attrNameLen == 0)
            {
                if (nonRes == 0) { if (size[target] == 0) size[target] = BitConverter.ToUInt32(b, a + 0x10); }
                else if (BitConverter.ToInt64(b, a + 0x10) == 0) size[target] = BitConverter.ToInt64(b, a + 0x30);   // first segment holds real size
            }
            a += len;
        }
    }

    static double ToUnixMs(long ft)
    {
        if (ft <= 116444736000000000L) return 0;
        return (ft - 116444736000000000L) / 10000.0;
    }

    static void Write(string output, int n, uint[] parent, long[] size, long[] mtime, long[] ctime, byte[] flags, string[] names)
    {
        string tmp = output + ".tmp";
        using (FileStream fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20))
        using (BinaryWriter w = new BinaryWriter(fs, Encoding.Unicode))
        {
            w.Write(Encoding.ASCII.GetBytes("DIMFT1"));
            long countPos = fs.Position;
            w.Write((uint)0);
            w.Write((uint)5);                                                    // root directory record
            uint count = 0;
            for (int i = 0; i < n; i++)
            {
                if ((flags[i] & 1) == 0 || names[i] == null) continue;
                string nm = names[i];
                if (nm.Length > 32000) continue;
                w.Write((uint)i);
                w.Write(parent[i]);
                w.Write(flags[i]);
                w.Write(size[i]);
                w.Write(ToUnixMs(mtime[i]));
                w.Write(ToUnixMs(ctime[i]));
                w.Write((ushort)nm.Length);
                w.Write(Encoding.Unicode.GetBytes(nm));
                count++;
            }
            fs.Position = countPos;
            w.Write(count);
        }
        if (File.Exists(output)) File.Delete(output);
        File.Move(tmp, output);
    }
}
