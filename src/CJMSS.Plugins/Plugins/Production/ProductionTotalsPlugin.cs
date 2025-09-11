using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace CJMSS.Plugins.Plugins.Production
{
    /// <summary>
    /// Recalculates totals on pdg_productionsheet whenever a related pdg_consumption
    /// row is created, updated, or deleted.
    ///
    /// Register Steps (suggested):
    ///  - Create:     PostOperation, Synchronous, Primary Entity = pdg_consumption
    ///  - Update:     PostOperation, Synchronous, Primary Entity = pdg_consumption
    ///                Filtering Attributes: pdg_productionsheet,pdg_quantity,pdg_cutting,pdg_manufacturing,
    ///                pdg_setting,pdg_threading,pdg_overheads,pdg_losspercentage,pdg_lossquantity
    ///                Post Image: "PostImage" with pdg_productionsheet
    ///  - Delete:     PostOperation, Synchronous, Primary Entity = pdg_consumption
    ///                Pre Image: "PreImage" with pdg_productionsheet
    /// </summary>
    public class ProductionTotalsPlugin : IPlugin
    {
        private const string ConsumptionEntity = "pdg_consumption";
        private const string ProductionEntity = "pdg_productionsheet";

        // Consumption attributes
        private const string AttrParent = "pdg_productionsheet"; // lookup to pdg_productionsheet
        private const string AttrQty = "pdg_quantity";
        private const string AttrCutting = "pdg_cutting";
        private const string AttrManufacturing = "pdg_manufacturing";
        private const string AttrSetting = "pdg_setting";
        private const string AttrThreading = "pdg_threading";
        private const string AttrOverheads = "pdg_overheads";
        private const string AttrLossPct = "pdg_losspercentage";
        private const string AttrLossQty = "pdg_lossquantity";

        // Production attributes to update
        private const string OutOverheads = "pdg_overheads";     // Money
        private const string OutCogp = "pdg_cogp";               // Money
        private const string OutEfficiency = "pdg_productionefficiency"; // Decimal/Float

        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            if (!string.Equals(ctx.PrimaryEntityName, ConsumptionEntity, StringComparison.OrdinalIgnoreCase))
                return;

            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var org = factory.CreateOrganizationService(ctx.UserId);
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            // Determine the parent production sheet id affected by this change
            Guid? productionId = null;

            if (string.Equals(ctx.MessageName, "Delete", StringComparison.OrdinalIgnoreCase))
            {
                if (ctx.PreEntityImages.Contains("PreImage") && ctx.PreEntityImages["PreImage"] is Entity pre)
                {
                    productionId = (pre.Contains(AttrParent) && pre[AttrParent] is EntityReference er) ? (Guid?)er.Id : null;
                }
            }
            else
            {
                // Create/Update: prefer PostImage, fallback to Target
                if (ctx.PostEntityImages.Contains("PostImage") && ctx.PostEntityImages["PostImage"] is Entity post)
                {
                    productionId = (post.Contains(AttrParent) && post[AttrParent] is EntityReference er1) ? (Guid?)er1.Id : null;
                }
                if (productionId == null && ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is Entity target)
                {
                    productionId = (target.Contains(AttrParent) && target[AttrParent] is EntityReference er2) ? (Guid?)er2.Id : null;
                }
            }

            if (productionId == null || productionId == Guid.Empty)
            {
                trace.Trace("ProductionTotalsPlugin: No parent production sheet found; skipping.");
                return;
            }

            // Aggregate sums and averages across related consumption rows
            var fetch = $@"<fetch aggregate='true'>
  <entity name='{ConsumptionEntity}'>
    <attribute name='{AttrCutting}' aggregate='sum' alias='sum_cut' />
    <attribute name='{AttrManufacturing}' aggregate='sum' alias='sum_manu' />
    <attribute name='{AttrSetting}' aggregate='sum' alias='sum_set' />
    <attribute name='{AttrThreading}' aggregate='sum' alias='sum_thread' />
    <attribute name='{AttrOverheads}' aggregate='sum' alias='sum_ovh' />
    <attribute name='{AttrLossPct}' aggregate='avg' alias='avg_losspct' />
    <attribute name='{AttrQty}' aggregate='sum' alias='sum_qty' />
    <attribute name='{AttrLossQty}' aggregate='sum' alias='sum_lossqty' />
    <filter>
      <condition attribute='{AttrParent}' operator='eq' value='{productionId}' />
    </filter>
  </entity>
</fetch>";

            var result = org.RetrieveMultiple(new FetchExpression(fetch));
            if (result.Entities.Count == 0)
            {
                // No consumptions: set totals to zero to keep parent consistent
                var reset = new Entity(ProductionEntity) { Id = productionId.Value };
                reset[OutOverheads] = new Money(0m);
                reset[OutCogp] = new Money(0m);
                reset[OutEfficiency] = 0m;
                org.Update(reset);
                trace.Trace("ProductionTotalsPlugin: Reset totals to 0 for parent {0}", productionId);
                return;
            }

            var row = result.Entities[0];

            decimal Sum(object o)
            {
                if (o is AliasedValue av) o = av.Value;
                if (o is Money m) return m.Value;
                if (o is decimal d) return d;
                if (o is double f) return (decimal)f;
                if (o == null) return 0m;
                return decimal.TryParse(o.ToString(), out var z) ? z : 0m;
            }

            decimal labor = Sum(row.GetAttributeValue<object>("sum_cut"))
                          + Sum(row.GetAttributeValue<object>("sum_manu"))
                          + Sum(row.GetAttributeValue<object>("sum_set"))
                          + Sum(row.GetAttributeValue<object>("sum_thread"));
            decimal overheads = Sum(row.GetAttributeValue<object>("sum_ovh"));

            // Material optional (0 for now). Extend here when you have unit costs per item.
            decimal material = 0m;
            decimal cogp = material + labor + overheads;

            // Efficiency prefer 100 - avg(loss%) else compute from qty/lossqty
            decimal efficiency = 0m;
            var avgLossObj = row.GetAttributeValue<object>("avg_losspct");
            if (avgLossObj != null)
            {
                var avgLoss = Sum(avgLossObj);
                efficiency = Math.Max(0m, 100m - avgLoss);
            }
            else
            {
                var totalQty = Sum(row.GetAttributeValue<object>("sum_qty"));
                var totalLossQty = Sum(row.GetAttributeValue<object>("sum_lossqty"));
                if (totalQty > 0m)
                {
                    efficiency = Math.Max(0m, ((totalQty - totalLossQty) / totalQty) * 100m);
                }
            }

            var update = new Entity(ProductionEntity)
            {
                Id = productionId.Value
            };
            update[OutOverheads] = new Money(overheads);
            update[OutCogp] = new Money(cogp);
            update[OutEfficiency] = efficiency;
            org.Update(update);

            trace.Trace("ProductionTotalsPlugin: Updated parent {0} -> Overheads={1}, COGP={2}, Eff={3}", productionId, overheads, cogp, efficiency);
        }
    }
}
