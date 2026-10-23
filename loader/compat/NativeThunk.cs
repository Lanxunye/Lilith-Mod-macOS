using System.Runtime.InteropServices;
using System.Reflection;

namespace LilithLoaderCompat;

public static class NativeThunk
{
    private static int _traceCount;
    private static IntPtr _resolved;
    private static byte[] _before = Array.Empty<byte>();
    private static readonly MainCallback MainCallbackRoot = OnMainQueue;
    private static ScheduleMain? _schedule;
    private static int _attempts;
    private static bool _executed;
    private static IntPtr _gameHandle;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void MainCallback(IntPtr context);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void ScheduleMain(IntPtr context, MainCallback callback, double delay);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate IntPtr DomainGet();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate IntPtr ThreadAttach(IntPtr domain);
    [DllImport("/usr/lib/libSystem.B.dylib")]
    private static extern int pthread_main_np();

    public static IntPtr Resolve(IntPtr address)
    {
        IntPtr target = address;
        // Observed x64 Mach-O export wrapper: push rbp; mov rbp,rsp; pop rbp; jmp rel32.
        byte[] prefix = { 0x55, 0x48, 0x89, 0xe5, 0x5d, 0xe9 };
        if (RuntimeInformation.ProcessArchitecture != Architecture.X64)
            throw new PlatformNotSupportedException("This compatibility probe is x64 only.");
        if (Environment.GetEnvironmentVariable("LILITH_PROBE_FOLLOW_THUNK") == "1")
        {
            for (int i = 0; i < prefix.Length; i++)
                if (Marshal.ReadByte(address, i) != prefix[i])
                    throw new InvalidOperationException("Runtime invoke wrapper differs from inspected bytes.");
            target = IntPtr.Add(address, 10 + Marshal.ReadInt32(address, 6));
            Console.WriteLine($"LILITH_LOADER_THUNK: 0x{address.ToInt64():X} -> 0x{target.ToInt64():X}");
        }
        _resolved = target;
        _before = ReadBytes(target);
        return target;
    }

    private static byte[] ReadBytes(IntPtr address)
    {
        byte[] bytes = new byte[24];
        Marshal.Copy(address, bytes, 0, bytes.Length);
        return bytes;
    }

    public static void AfterHook()
    {
        Console.WriteLine($"LILITH_HOOK_BEFORE: {Convert.ToHexString(_before)}");
        Console.WriteLine($"LILITH_HOOK_AFTER: {Convert.ToHexString(ReadBytes(_resolved))}");
    }

    public static bool WantsMainQueue() => Environment.GetEnvironmentVariable("LILITH_PROBE_MAIN_QUEUE") == "1";

    public static void StartOnMainQueue()
    {
        string native = Path.Combine(Path.GetDirectoryName(typeof(NativeThunk).Assembly.Location)!, "liblilith_probe_dispatch.dylib");
        IntPtr handle = NativeLibrary.Load(native);
        _schedule = Marshal.GetDelegateForFunctionPointer<ScheduleMain>(NativeLibrary.GetExport(handle, "lilith_schedule_main"));
        _schedule(IntPtr.Zero, MainCallbackRoot, 2.0);
        Console.WriteLine("LILITH_MAIN_QUEUE_SCHEDULED");
    }

    private static void OnMainQueue(IntPtr context)
    {
        try
        {
            if (_executed) return;
            if (pthread_main_np() != 1) throw new InvalidOperationException("Callback is not on the macOS main thread.");
            string assemblyPath = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Environment.ProcessPath)!, "..", "Frameworks", "GameAssembly.dylib"));
            if (_gameHandle == IntPtr.Zero) _gameHandle = NativeLibrary.Load(assemblyPath);
            var domainGet = Marshal.GetDelegateForFunctionPointer<DomainGet>(NativeLibrary.GetExport(_gameHandle, "il2cpp_domain_get"));
            IntPtr domain = domainGet();
            if (domain == IntPtr.Zero)
            {
                if (++_attempts >= 30) throw new TimeoutException("IL2CPP domain not ready.");
                _schedule!(IntPtr.Zero, MainCallbackRoot, 1.0);
                return;
            }
            var attach = Marshal.GetDelegateForFunctionPointer<ThreadAttach>(NativeLibrary.GetExport(_gameHandle, "il2cpp_thread_attach"));
            attach(domain);
            var loader = AppDomain.CurrentDomain.GetAssemblies().Single(a => a.GetName().Name == "BepInEx.Unity.IL2CPP");
            var manager = loader.GetType("BepInEx.Unity.IL2CPP.Il2CppInteropManager", true)!;
            manager.GetMethod("PreloadInteropAssemblies", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)!.Invoke(null, null);
            var application = Type.GetType("UnityEngine.Application, UnityEngine.CoreModule", true)!;
            bool playing = (bool)application.GetProperty("isPlaying", BindingFlags.Static | BindingFlags.Public)!.GetValue(null)!;
            if (!playing)
            {
                if (++_attempts >= 30) throw new TimeoutException("Unity isPlaying stayed false.");
                _schedule!(IntPtr.Zero, MainCallbackRoot, 1.0);
                return;
            }
            var chainloader = loader.GetType("BepInEx.Unity.IL2CPP.IL2CPPChainloader", true)!;
            object instance = chainloader.GetProperty("Instance", BindingFlags.Static | BindingFlags.Public)!.GetValue(null)!;
            _executed = true;
            Console.WriteLine("LILITH_MAIN_QUEUE_EXECUTE main=1 unity_is_playing=True");
            chainloader.GetMethod("Execute", BindingFlags.Instance | BindingFlags.Public)!.Invoke(instance, null);
        }
        catch (Exception error)
        {
            Console.WriteLine($"LILITH_MAIN_QUEUE_FAILED: {error}");
        }
    }

    public static void TraceInvoke(string name)
    {
        if (Interlocked.Increment(ref _traceCount) <= 24)
            Console.WriteLine($"LILITH_LOADER_INVOKE: {name}");
    }
}
