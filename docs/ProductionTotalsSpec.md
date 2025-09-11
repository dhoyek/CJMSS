# Production Sheet Totals — Server-Side Calculation Spec

Goal: Keep `pdg_productionsheet` totals accurate based on related `pdg_consumption` rows, without relying on client-side JavaScript.

Entities
- `pdg_productionsheet`
  - Totals to set: `pdg_overheads` (Money), `pdg_cogp` (Money), `pdg_productionefficiency` (Decimal/Percentage)
- `pdg_consumption`
  - Inputs: `pdg_quantity`, `pdg_cutting`, `pdg_manufacturing`, `pdg_setting`, `pdg_threading`, `pdg_overheads`, `pdg_losspercentage`, `pdg_lossquantity`, `pdg_consumptiontype`, `pdg_itemid`, `pdg_productionsheet`

Events to Handle
- On `pdg_consumption` Create, Update (the columns above), and Delete

Business Rules
- LaborCost = sum of `pdg_cutting + pdg_manufacturing + pdg_setting + pdg_threading` across related consumptions
- Overheads = sum of `pdg_overheads` across related consumptions
- MaterialCost = optional: sum of `Quantity * UnitCost` if present (not required now)
- COGP = MaterialCost + LaborCost + Overheads (MaterialCost can be 0 for first phase)
- Production Efficiency: 100 - average(`pdg_losspercentage`) across related consumptions (or compute from loss qty if preferred)

## Option A: Plugin (C#)

Register
- Step 1: Message Create (PostOperation, Synchronous), Primary Entity: `pdg_consumption`
- Step 2: Message Update (PostOperation, Synchronous) with Filtering Attributes: the cost and loss fields listed above
- Step 3: Message Delete (PostOperation, Synchronous), Primary Entity: `pdg_consumption`

Algorithm (shared method)
1. Resolve `productionSheetId` from the Target (Create/Update) or PreImage (Delete).
2. Aggregate related `pdg_consumption` using FetchXML with sums for labor and overheads; optionally compute material cost.
3. Compute COGP and Efficiency.
4. Update the parent `pdg_productionsheet` with `pdg_overheads`, `pdg_cogp`, `pdg_productionefficiency`.

Images
- For Update: add PostImage with `pdg_productionsheet` to reliably get parent id.
- For Delete: add PreImage with `pdg_productionsheet`.

Code Skeleton
```csharp
public class ProductionTotalsPlugin : IPlugin
{
    public void Execute(IServiceProvider serviceProvider)
    {
        var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
        var serviceFactory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
        var org = serviceFactory.CreateOrganizationService(context.UserId);

        Guid? productionId = null;

        if (context.InputParameters.Contains("Target"))
        {
            if (context.MessageName == "Delete")
            {
                var pre = (Entity)context.PreEntityImages["PreImage"];
                productionId = pre.GetAttributeValue<EntityReference>("pdg_productionsheet")?.Id;
            }
            else
            {
                // Create/Update
                var post = context.PostEntityImages.Contains("PostImage") ? (Entity)context.PostEntityImages["PostImage"] : null;
                var target = (Entity)context.InputParameters["Target"];
                productionId = (post ?? target).GetAttributeValue<EntityReference>("pdg_productionsheet")?.Id;
            }
        }
        if (productionId == null) return;

        // 1) Aggregate related consumptions via FetchXML
        var fetch = $@"<fetch aggregate='true'>
          <entity name='pdg_consumption'>
            <attribute name='pdg_cutting' aggregate='sum' alias='sum_cutting' />
            <attribute name='pdg_manufacturing' aggregate='sum' alias='sum_manu' />
            <attribute name='pdg_setting' aggregate='sum' alias='sum_setting' />
            <attribute name='pdg_threading' aggregate='sum' alias='sum_threading' />
            <attribute name='pdg_overheads' aggregate='sum' alias='sum_overheads' />
            <attribute name='pdg_losspercentage' aggregate='avg' alias='avg_losspct' />
            <filter>
              <condition attribute='pdg_productionsheet' operator='eq' value='{productionId}' />
            </filter>
          </entity>
        </fetch>";

        var result = org.RetrieveMultiple(new FetchExpression(fetch));
        if (result.Entities.Count == 0) return;
        var row = result.Entities[0];

        decimal cutting = GetSum(row, "sum_cutting");
        decimal manu = GetSum(row, "sum_manu");
        decimal setting = GetSum(row, "sum_setting");
        decimal threading = GetSum(row, "sum_threading");
        decimal overheads = GetSum(row, "sum_overheads");
        decimal labor = cutting + manu + setting + threading;

        decimal material = 0m; // extend later
        decimal cogp = material + labor + overheads;
        decimal efficiency = 0m;
        if (row.Attributes.Contains("avg_losspct"))
        {
            decimal avgLoss = ((Money)row["avg_losspct"]).Value; // or decimal via AliasedValue
            efficiency = Math.Max(0m, 100m - avgLoss);
        }

        var update = new Entity("pdg_productionsheet") { Id = productionId.Value };
        update["pdg_overheads"] = new Money(overheads);
        update["pdg_cogp"] = new Money(cogp);
        update["pdg_productionefficiency"] = efficiency;
        org.Update(update);
    }

    private static decimal GetSum(Entity e, string alias)
    {
        if (!e.Attributes.Contains(alias)) return 0m;
        var val = e.Attributes[alias];
        if (val is AliasedValue av) val = av.Value;
        if (val is Money m) return m.Value;
        if (val is decimal d) return d;
        if (val is double f) return (decimal)f;
        return 0m;
    }
}
```

Notes
- Consider an async plugin if the aggregation could be heavy; otherwise, synchronous keeps the form totals immediate.
- Use `TransactionCurrencyId` from parent and set Money values accordingly.

## Option B: Power Automate Flow (Cloud)

Trigger
- When a row is added, modified, or deleted (Dataverse) on `pdg_consumption`.
- For Update: scope to relevant columns.

Actions
1. Compose `productionSheetId` (from the row; for Delete use the old row trigger with pre-image columns).
2. List rows `pdg_consumption` filtered by `_pdg_productionsheet_value eq {productionSheetId}`.
3. Initialize variables for sums; loop and sum Labor components, Overheads, Material (optional), and Loss% average.
4. Update row `pdg_productionsheet` with the computed totals.

Considerations
- Concurrency: enable concurrency control (1 degree) on the flow to avoid race conditions on the same parent.
- Performance: if volume grows, prefer the plugin with FetchXML aggregates.
- Errors: add a “scope” with run-after to post an in-app notification or timeline note on failure.

## Autonumbering
- Configure Dataverse Autonumber for:
  - `pdg_productionnumber`: e.g., `PROD-{DATETIMEUTC:yyMM}-{SEQNUM:4}`
  - `pdg_serialnumber` (optional): e.g., `PS-{DATETIMEUTC:yyMMdd}-{SEQNUM:5}`
- Keep both fields read-only on the form; remove client-side generation.

## Form Wiring (JS)
- Ensure all event handlers pass execution context.
- JS should only assist with UX (visibility/locks, quick calculations). Server remains the source of truth for totals.

