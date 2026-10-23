using Mono.Cecil;
using Mono.Cecil.Cil;

if (args.Length >= 3 && args[0] == "--inspect")
{
    using var assembly = AssemblyDefinition.ReadAssembly(args[1]);
    foreach (var type in assembly.MainModule.Types.Where(t => args.Skip(2).Contains(t.Name)))
    {
        Console.WriteLine(type.FullName);
        foreach (var field in type.Fields) Console.WriteLine($"FIELD {field.FieldType} {field.Name}");
        foreach (var method in type.Methods) Console.WriteLine($"METHOD {method.FullName}");
    }
    return;
}

if (args.Length != 3)
    throw new ArgumentException("Expected original loader, compatibility helper, output loader.");
using var loader = AssemblyDefinition.ReadAssembly(args[0]);
using var helper = AssemblyDefinition.ReadAssembly(args[1]);
var chainloader = loader.MainModule.Types.Single(t => t.FullName == "BepInEx.Unity.IL2CPP.IL2CPPChainloader");
var compat = helper.MainModule.Types.Single(t => t.FullName == "LilithLoaderCompat.NativeThunk");
var resolve = loader.MainModule.ImportReference(compat.Methods.Single(m => m.Name == "Resolve"));
var trace = loader.MainModule.ImportReference(compat.Methods.Single(m => m.Name == "TraceInvoke"));
var audit = loader.MainModule.ImportReference(compat.Methods.Single(m => m.Name == "AfterHook"));
var wantsQueue = loader.MainModule.ImportReference(compat.Methods.Single(m => m.Name == "WantsMainQueue"));
var startQueue = loader.MainModule.ImportReference(compat.Methods.Single(m => m.Name == "StartOnMainQueue"));

var init = chainloader.Methods.Single(m => m.Name == "Initialize");
// Preserve base initialization and Instance, then replace only the startup trigger in opted-in mode.
var setInstance = init.Body.Instructions.Single(i => i.OpCode == OpCodes.Call
    && i.Operand is MethodReference m && m.Name == "set_Instance");
var next = setInstance.Next;
var initIl = init.Body.GetILProcessor();
initIl.InsertBefore(next, Instruction.Create(OpCodes.Call, wantsQueue));
initIl.InsertBefore(next, Instruction.Create(OpCodes.Brfalse, next));
initIl.InsertBefore(next, Instruction.Create(OpCodes.Call, startQueue));
initIl.InsertBefore(next, Instruction.Create(OpCodes.Ret));
var export = init.Body.Instructions.Single(i => i.OpCode == OpCodes.Call && i.Operand is MethodReference m
    && m.Name == "GetExport" && m.DeclaringType.FullName == "System.Runtime.InteropServices.NativeLibrary");
init.Body.GetILProcessor().InsertAfter(export, Instruction.Create(OpCodes.Call, resolve));
init.Body.GetILProcessor().InsertBefore(init.Body.Instructions.Last(), Instruction.Create(OpCodes.Call, audit));

var invoke = chainloader.Methods.Single(m => m.Name == "OnInvokeMethod");
var nameCall = invoke.Body.Instructions.Single(i => i.OpCode == OpCodes.Call
    && i.Operand is MethodReference m && m.Name == "PtrToStringAnsi");
var traceDuplicate = Instruction.Create(OpCodes.Dup);
invoke.Body.GetILProcessor().InsertAfter(nameCall, traceDuplicate);
invoke.Body.GetILProcessor().InsertAfter(traceDuplicate, Instruction.Create(OpCodes.Call, trace));
loader.Write(args[2]);
Console.WriteLine("Patched compatibility resolver and bounded invoke tracing into isolated loader.");
