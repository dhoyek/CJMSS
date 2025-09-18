using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace CJMSS.Plugins.Plugins.Procurement
{
    /// <summary>
    /// PurchaseLifecycleGuardPlugin
    ///
    /// Purpose:
    /// - Enforce immutability of key fields after submission/approval or when lines/receipts exist
    /// - Stamp approval metadata on transition to Approved
    /// - Optionally set posted date on transition to Received/Posted
    ///
    /// Suggested Registration:
    ///   Step: Entity = pdg_purchaseorder, Message = Update, Stage = PreOperation, Mode = Sync
    ///     - Filtering Attributes: pdg_orderstatus,pdg_supplier,transactioncurrencyid,pdg_warehouse
    ///     - Images: PreImage name=PreImage (pdg_orderstatus,pdg_supplier,transactioncurrencyid,pdg_warehouse)
    ///
    /// Notes:
    /// - Keep business rules server-side to protect API/headless updates.
    /// </summary>
    public class PurchaseLifecycleGuardPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            if (!string.Equals(ctx.PrimaryEntityName, "pdg_purchaseorder", StringComparison.OrdinalIgnoreCase)) return;
            if (!(ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is Entity target)) return;

            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var org = factory.CreateOrganizationService(ctx.UserId);
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            try
            {
                // Skeleton: read pre image/current values to detect forbidden changes
                var pre = (ctx.PreEntityImages != null && ctx.PreEntityImages.Contains("PreImage")) ? ctx.PreEntityImages["PreImage"] : null;
                var oldStatus = pre?.GetAttributeValue<OptionSetValue>("pdg_orderstatus")?.Value;
                var newStatus = target.GetAttributeValue<OptionSetValue>("pdg_orderstatus")?.Value ?? oldStatus;

                trace.Trace("PurchaseLifecycleGuardPlugin: oldStatus={0} newStatus={1}", oldStatus, newStatus);

                // Immutability after Submitted (>= 890590001) or when lines/receipts exist
                var threshold = 890590001; // Submitted
                bool submittedOrMore = (newStatus ?? oldStatus ?? 0) >= threshold;
                var poId = ctx.PrimaryEntityId;

                // Check existence of lines/receipts only if needed
                bool hasLinesOrReceipts = false;
                if (!submittedOrMore)
                {
                    var ql = new QueryExpression("pdg_purchaseorderline") { ColumnSet = new ColumnSet(false), TopCount = 1, NoLock = true };
                    ql.Criteria.AddCondition("pdg_purchaseorderid", ConditionOperator.Equal, poId);
                    hasLinesOrReceipts = org.RetrieveMultiple(ql).Entities.Count > 0;
                    if (!hasLinesOrReceipts)
                    {
                        var qr = new QueryExpression("pdg_purchaseorderreceipt") { ColumnSet = new ColumnSet(false), TopCount = 1, NoLock = true };
                        qr.Criteria.AddCondition("pdg_purchaseorderid", ConditionOperator.Equal, poId);
                        hasLinesOrReceipts = org.RetrieveMultiple(qr).Entities.Count > 0;
                    }
                }

                bool guard = submittedOrMore || hasLinesOrReceipts;
                if (guard && pre != null)
                {
                    if (Changed(target, pre, "pdg_supplier") || Changed(target, pre, "transactioncurrencyid") || Changed(target, pre, "pdg_warehouse"))
                    {
                        throw new InvalidPluginExecutionException("Supplier, Currency, and Warehouse cannot be changed after submission or when lines/receipts exist.");
                    }
                }

                // On transition to Approved, stamp approval date/by if empty
                var approvedVal = 890590002;
                bool movedToApproved = (newStatus == approvedVal) && (oldStatus != approvedVal);
                if (movedToApproved)
                {
                    if (!target.Attributes.Contains("pdg_approvaldate"))
                        target["pdg_approvaldate"] = DateTime.UtcNow;
                    if (!target.Attributes.Contains("pdg_approvedby"))
                        target["pdg_approvedby"] = new EntityReference("systemuser", ctx.UserId);
                }

                // On Received, set order date if empty
                var receivedVal = 890590004;
                bool movedToReceived = (newStatus == receivedVal) && (oldStatus != receivedVal);
                if (movedToReceived)
                {
                    var hasOrderDate = (pre?.Contains("pdg_orderdate") == true) || target.Attributes.Contains("pdg_orderdate");
                    if (!hasOrderDate)
                        target["pdg_orderdate"] = DateTime.UtcNow;
                }
            }
            catch (Exception ex)
            {
                trace.Trace("PurchaseLifecycleGuardPlugin error: {0}", ex.ToString());
                throw;
            }
        }

        private static bool Changed(Entity target, Entity pre, string attr)
        {
            if (!target.Attributes.Contains(attr)) return false;
            var newVal = target.Attributes[attr];
            var oldVal = pre.Attributes.Contains(attr) ? pre.Attributes[attr] : null;
            if (newVal == null && oldVal == null) return false;
            if (newVal == null || oldVal == null) return true;
            if (newVal is EntityReference nref && oldVal is EntityReference oref) return nref.Id != oref.Id || nref.LogicalName != oref.LogicalName;
            if (newVal is OptionSetValue nov && oldVal is OptionSetValue oov) return nov.Value != oov.Value;
            return !newVal.Equals(oldVal);
        }
    }
}
