using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace CJMSS.Plugins.Plugins.Procurement
{
    /// <summary>
    /// PurchaseOrderPrintPlugin
    /// Increments pdg_printcount and updates pdg_lastprintdate when a custom Action is invoked.
    ///
    /// Suggested Registration:
    ///   Message: pdg_PurchaseOrderPrint (Unbound Custom Action)
    ///   Stage: PostOperation, Mode: Synchronous
    ///   Images: none
    ///   Inputs: PurchaseOrderId (Guid) OR Target (EntityReference to pdg_purchaseorder)
    ///
    /// Ribbon button or JS can call the custom Action to drive the print and counters transactionally.
    /// </summary>
    public class PurchaseOrderPrintPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var org = factory.CreateOrganizationService(ctx.UserId);
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            if (!string.Equals(ctx.MessageName, "pdg_PurchaseOrderPrint", StringComparison.OrdinalIgnoreCase))
            {
                // Only handle the custom action by default (avoid misfires if accidentally registered elsewhere)
                return;
            }

            // Resolve Purchase Order id from inputs
            Guid poId = Guid.Empty;
            if (ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is EntityReference er &&
                string.Equals(er.LogicalName, "pdg_purchaseorder", StringComparison.OrdinalIgnoreCase))
            {
                poId = er.Id;
            }
            else if (ctx.InputParameters.Contains("PurchaseOrderId"))
            {
                var val = ctx.InputParameters["PurchaseOrderId"];
                if (val is Guid g) poId = g;
                else if (val is string s && Guid.TryParse(s, out var g2)) poId = g2;
            }

            if (poId == Guid.Empty)
            {
                throw new InvalidPluginExecutionException("PurchaseOrderPrintPlugin: Missing PurchaseOrderId input.");
            }

            try
            {
                // Retrieve current values if present (gracefully handle missing attributes)
                var cols = new ColumnSet("pdg_printcount", "pdg_lastprintdate");
                var po = org.Retrieve("pdg_purchaseorder", poId, cols);

                var current = po.Contains("pdg_printcount") ? po.GetAttributeValue<int?>("pdg_printcount") ?? 0 : 0;

                var update = new Entity("pdg_purchaseorder", poId)
                {
                    ["pdg_printcount"] = current + 1,
                    ["pdg_lastprintdate"] = DateTime.UtcNow
                };
                org.Update(update);

                trace?.Trace("PurchaseOrderPrintPlugin: PO {0} printcount {1} -> {2}", poId, current, current + 1);
            }
            catch (Exception ex)
            {
                trace?.Trace("PurchaseOrderPrintPlugin error: {0}", ex.ToString());
                throw;
            }
        }
    }
}

