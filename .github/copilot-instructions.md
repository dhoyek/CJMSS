<!-- Copilot / AI agent instructions for CJMSS repository -->
# CJMSS — Quick AI Contributor Guide

This file contains concise, actionable guidance for AI coding assistants working in this repository so they can be immediately productive.

1) Big-picture architecture
- Solution: `CJMSS.sln` — opened with Visual Studio 2022. Projects of interest:
  - `src/CJMSS.Plugins` — .NET Framework 4.6.2 plugin assembly (server-side CRM plugins).
  - `src/CJMSS.WebResources` — .NET 8 project that carries web resource files (JS, HTML, form XML).
  - `src/CJMSS.DataMigration` — SSIS `.dtsx` packages and migration artifacts.
  - `Dataverse Solutions/` — exported solution packages and deployment artifacts.

2) Primary integration points & dependencies
- Dataverse / Dynamics CRM: server plugins, web resources, and solution bindings. The solution is CRM-bound (see `CJMSS.sln` global section).
- NuGet packages for CRM SDK are referenced in `CJMSS.Plugins.csproj` (e.g., `Microsoft.CrmSdk.CoreAssemblies`).
- SSIS/DTS packages under `CJMSS.DataMigration` for bulk data import/migrations (`*.dtsx`, `ispac`).
- Local key `CJMSSKey.snk` is used to sign plugin assembly (present at repo root) — builds rely on this file path.

3) Developer workflows (how humans build & deploy)
- Primary: open `CJMSS.sln` in Visual Studio 2022 and build (NuGet restores automatically).
- CLI build: prefer MSBuild on Windows: `msbuild .\CJMSS.sln /p:Configuration=Release` (PowerShell). Note: `CJMSS.Plugins` targets `net462` so use Visual Studio/MSBuild that supports .NET Framework.
- Registering plugins: use the Plugin Registration Tool (XrmTooling). See `README.md` for recommended registration steps and required PreImage names (the code expects `PreImage`).
- Deploy web resources: the `CJMSS.WebResources` project is a carrier for files under `Source/` — web resources are typically updated by your CRM deployment pipeline or manually via the CRM UI/Tools.

4) Project-specific conventions & patterns
- Plugin patterns:
  - PreImage name: code looks for `PreImage` in `IPluginExecutionContext.PreEntityImages`.
  - Merge Target + PreImage for reliable reads (see `src/CJMSS.Plugins/Plugins/InventoryItem/ItemCostingPlugin.cs`).
  - Money fields use `Money` type; helper `GetDecimal` logic is used to normalize Money/decimal/string values.
  - Business constraints are enforced server-side (e.g., public price > unit cost) and mirrored in `item.form.js`.
- WebResources/JS:
  - Form logic lives under `src/CJMSS.WebResources/Source/JavaScript/Forms/` (e.g., `item.form.js` — a long, authoritative implementation).
  - The JS mirrors server validations; do not remove server-side checks even if JS validates them.
- OptionSet / magic values:
  - Jewelry OptionSet value assumed `100000001` in code & JS. If altering logic, update both server and client code.

5) Useful example snippets to reference when editing
- Server-side total value calculation: `src/CJMSS.Plugins/Plugins/InventoryItem/ItemCostingPlugin.cs` — computes `Total Value = QuantityOnHand * UnitCost` and updates via `service.Update`.
- Client form behaviors: `src/CJMSS.WebResources/Source/JavaScript/Forms/item.form.js` — extensive handlers for `onLoad`, `onSave`, and many field-level events.

6) Safety and merge guidance for AI edits
- Preserve public business invariants: when changing validation or pricing logic, update both plugin code and the corresponding form JS.
- Do not remove hard-coded option values without locating and updating every occurrence (search for `100000001` and the logical field names below).
- Logical field names commonly used: `pdg_publicprice`, `pdg_unitcost`, `pdg_quantityonhand`, `pdg_totalvalue`, `pdg_grossweight`, `pdg_itemtype`.

7) Where to look next
- Start files: `README.md`, `CJMSS.sln`, `src/CJMSS.Plugins/`, `src/CJMSS.WebResources/Source/JavaScript/Forms/item.form.js`, `src/CJMSS.DataMigration/`.

If any section is unclear or you want me to expand examples (e.g., specific places to change when adjusting jewelry option values, or an automated deployment script), tell me which area to expand and I will update this file.
