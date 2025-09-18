using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace CJMSS.Plugins.Plugins.Procurement
{
    /// <summary>
    /// PurchaseOrderChangeAuditPlugin
    ///
    /// Purpose:
    /// - Capture significant PO/PO Line changes into pdg_purchaseorderchange
    /// - Auto-number pdg_changenumber and optionally bump pdg_revisionnumber on header
    ///
    /// Suggested Registration:
    ///   1) Step: Entity = pdg_purchaseorder, Message = Update, Stage = PreOperation, Mode = Sync
    ///      - Filtering Attributes: pdg_supplier,transactioncurrencyid,pdg_warehouse,pdg_discountpercentage,pdg_additionaldiscount,pdg_expecteddeliverydate
    ///      - Images: PreImage name=PreImage (above)
    ///   2) Step: Entity = pdg_purchaseorderline, Message = Update, Stage = PreOperation, Mode = Sync
    ///      - Filtering Attributes: pdg_item,pdg_quantity,pdg_unitprice,pdg_discount,pdg_extracharges,pdg_expecteddeliverydate,pdg_promiseddeliverydate
    ///      - Images: PreImage name=PreImage (above)
    ///
    /// Notes:
    /// - Keep the actual serialization and autonumbering simple and deterministic.
    /// </summary>
    public class PurchaseOrderChangeAuditPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var entity = ctx.PrimaryEntityName ?? string.Empty;
            if (!string.Equals(entity, "pdg_purchaseorder", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(entity, "pdg_purchaseorderline", StringComparison.OrdinalIgnoreCase))
                return;

            if (!(ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is Entity target)) return;

            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var org = factory.CreateOrganizationService(ctx.UserId);
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            try
            {
                // Skeleton: detect changes vs PreImage and write a change record
                var pre = (ctx.PreEntityImages != null && ctx.PreEntityImages.Contains("PreImage")) ? ctx.PreEntityImages["PreImage"] : null;
                if (pre == null)
                {
                    trace.Trace("ChangeAudit: No PreImage available. Skipping.");
                    return;
                }

                // TODO: Compare targeted attributes and if any changed, create pdg_purchaseorderchange
                // TODO: Autonumber pdg_changenumber (e.g., CHG-yyyymmdd-hhmmss-<seq>)
                // TODO: Link change to header and/or line; optionally increment pdg_revisionnumber on header
                trace.Trace("PurchaseOrderChangeAuditPlugin: entity={0} message={1}", entity, ctx.MessageName);
            }
            catch (Exception ex)
            {
                trace.Trace("PurchaseOrderChangeAuditPlugin error: {0}", ex.ToString());
                throw;
            }
        }
    }
}
