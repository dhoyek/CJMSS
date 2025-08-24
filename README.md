# CJMSS Solution (Visual Studio 2022)

This solution contains two projects:

- **CJMSS.Plugins** (.NET Framework 4.6.2): sample `IPlugin` for `pdg_inventoryitem`.
- **CJMSS.WebResources** (.NET 8 project that simply carries files): your existing `item.form.js` and `item.form.xml.txt` for the model-driven form.

## Build

Open `CJMSS.sln` in Visual Studio 2022 and build. NuGet packages will restore automatically.

## Register the plugin

Use the **Plugin Registration Tool** (XrmTooling) and register:

- Assembly: `CJMSS.Plugins.dll`
- Step 1 (suggested): Message = `Update`, Primary Entity = `pdg_inventoryitem`, Stage = `PreOperation`
  - Pre Image: `PreImage` with `pdg_publicprice,pdg_unitcost,pdg_quantityonhand,pdg_grossweight,pdg_itemtype`

The sample plugin:

- Requires **Gross Weight** and **Public Price** for jewelry items (Item Type option value `100000001` — update to match your environment).
- Blocks updates when **Public Price ≤ Unit Cost**.
- Sets **Total Value** = **Quantity On Hand** × **Unit Cost**.

## Deploy the web resources

Add `webresources/item.form.js` as a JavaScript web resource in your solution and bind the `PDG.Item` handlers to the form events as needed.

## Notes

- The plugin mirrors validations present in your form JS and uses these logical names:
  `pdg_publicprice`, `pdg_unitcost`, `pdg_quantityonhand`, `pdg_totalvalue`, `pdg_grossweight`, `pdg_itemtype`.
- Adjust the jewelry OptionSet value to match your environment if different.