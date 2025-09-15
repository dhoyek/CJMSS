using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Metadata;

namespace CJMSS.Plugins.Plugins.Procurement
{
    /// <summary>
    /// Recomputes received quantities and status rollups when receipts change.
    ///
    /// Suggested Registration:
    ///   Entity: pdg_purchaseorderreceipt
    ///     - Create (PostOperation, Sync)
    ///     - Update (PostOperation, Sync) Filter: pdg_quantityreceived,pdg_purchaseorderid,pdg_purchaseorderlineid
    ///       Images: PostImage (pdg_purchaseorderid,pdg_purchaseorderlineid,pdg_quantityreceived)
    ///     - Delete (PostOperation, Sync)
    ///       Images: PreImage (pdg_purchaseorderid,pdg_purchaseorderlineid,pdg_quantityreceived)
    ///
    /// Behavior:
    ///   - Updates pdg_purchaseorderline.pdg_qtyreceived to sum of related receipt quantities
    ///   - Sets pdg_purchaseorderline.pdg_linestatus to Open / Partially Received / Fully Received
    ///   - Promotes pdg_purchaseorder.pdg_status (or pdg_orderstatus if present) to Partially/Fully Received
    /// </summary>
    public class PurchaseOrderStatusRollupPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            if (!string.Equals(ctx.PrimaryEntityName, "pdg_purchaseorderreceipt", StringComparison.OrdinalIgnoreCase)) return;

            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var org = factory.CreateOrganizationService(ctx.UserId);
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            try
            {
                // Resolve affected header and line from images (post for create/update, pre for delete)
                var image = GetImage(ctx, ctx.MessageName.Equals("Delete", StringComparison.OrdinalIgnoreCase) ? "PreImage" : "PostImage");
                if (image == null)
                {
                    // As a fallback, attempt to parse Target
                    if (ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is Entity target)
                        image = target;
                }
                if (image == null) return;

                var poRef = image.GetAttributeValue<EntityReference>("pdg_purchaseorderid");
                var lineRef = image.GetAttributeValue<EntityReference>("pdg_purchaseorderlineid");
                if (poRef == null)
                {
                    // Try to derive header from line if only line was provided
                    if (lineRef != null)
                    {
                        var line = org.Retrieve("pdg_purchaseorderline", lineRef.Id, new ColumnSet("pdg_purchaseorderid"));
                        poRef = line.GetAttributeValue<EntityReference>("pdg_purchaseorderid");
                    }
                }
                if (poRef == null) return;

                // Recompute received totals for the line
                if (lineRef != null)
                {
                    RecomputeLine(org, trace, lineRef.Id);
                }

                // Roll up header status based on all lines
                RecomputeHeader(org, trace, poRef.Id);
            }
            catch (Exception ex)
            {
                trace?.Trace("PurchaseOrderStatusRollupPlugin error: {0}", ex.ToString());
                throw; // bubble up for sync consistency
            }
        }

        private static void RecomputeLine(IOrganizationService org, ITracingService trace, Guid lineId)
        {
            // Sum receipts for this line
            var qe = new QueryExpression("pdg_purchaseorderreceipt")
            {
                ColumnSet = new ColumnSet("pdg_quantityreceived"),
                NoLock = true
            };
            qe.Criteria.AddCondition("pdg_purchaseorderlineid", ConditionOperator.Equal, lineId);
            var recs = org.RetrieveMultiple(qe);
            decimal totalReceived = 0m;
            foreach (var r in recs.Entities)
            {
                totalReceived += r.GetAttributeValue<decimal?>("pdg_quantityreceived") ?? 0m;
            }

            // Retrieve ordered qty and current status on the line
            var line = org.Retrieve("pdg_purchaseorderline", lineId, new ColumnSet("pdg_quantity", "pdg_linestatus"));
            var ordered = line.GetAttributeValue<decimal?>("pdg_quantity") ?? 0m;

            // Update qtyreceived on line
            var upd = new Entity("pdg_purchaseorderline", lineId)
            {
                ["pdg_qtyreceived"] = totalReceived
            };

            // Determine new line status label
            string? newStatusLabel = null;
            if (totalReceived <= 0m)
                newStatusLabel = "Open";
            else if (ordered > 0m && totalReceived + 0.00001m < ordered)
                newStatusLabel = "Partially Received";
            else if (ordered == 0m && totalReceived > 0m)
                newStatusLabel = "Partially Received"; // edge: unexpected receipt without ordered qty
            else
                newStatusLabel = "Fully Received";

            // Try to set pdg_linestatus via option label
            var osVal = TryGetOptionValue(org, "pdg_purchaseorderline", "pdg_linestatus", newStatusLabel);
            if (osVal.HasValue)
            {
                upd["pdg_linestatus"] = new OptionSetValue(osVal.Value);
            }

            org.Update(upd);
            trace?.Trace("Line {0}: qtyreceived={1} ordered={2} status={3}", lineId, totalReceived, ordered, newStatusLabel);
        }

        private static void RecomputeHeader(IOrganizationService org, ITracingService trace, Guid poId)
        {
            // Pull all lines and assess received vs ordered
            var qe = new QueryExpression("pdg_purchaseorderline")
            {
                ColumnSet = new ColumnSet("pdg_quantity", "pdg_qtyreceived"),
                NoLock = true
            };
            qe.Criteria.AddCondition("pdg_purchaseorderid", ConditionOperator.Equal, poId);
            var lines = org.RetrieveMultiple(qe).Entities;
            if (lines.Count == 0) return;

            bool anyReceived = false;
            bool allFullyReceived = true;
            foreach (var l in lines)
            {
                var ord = l.GetAttributeValue<decimal?>("pdg_quantity") ?? 0m;
                var rec = l.GetAttributeValue<decimal?>("pdg_qtyreceived") ?? 0m;
                if (rec > 0m) anyReceived = true;
                if (!(ord > 0m && rec >= ord)) allFullyReceived = false;
            }

            string? headerLabel = null;
            if (allFullyReceived) headerLabel = "Fully Received";
            else if (anyReceived) headerLabel = "Partially Received";
            else headerLabel = null; // no change if nothing received

            if (headerLabel == null) return;

            // Attempt to update pdg_status or pdg_orderstatus based on available attribute
            var header = new Entity("pdg_purchaseorder", poId);
            var statusVal = TryGetOptionValue(org, "pdg_purchaseorder", "pdg_status", headerLabel);
            if (statusVal.HasValue)
            {
                header["pdg_status"] = new OptionSetValue(statusVal.Value);
            }
            var orderStatusVal = TryGetOptionValue(org, "pdg_purchaseorder", "pdg_orderstatus", headerLabel);
            if (orderStatusVal.HasValue)
            {
                header["pdg_orderstatus"] = new OptionSetValue(orderStatusVal.Value);
            }

            if (header.Attributes.Count > 0)
            {
                org.Update(header);
                trace?.Trace("PO {0}: status -> {1}", poId, headerLabel);
            }
        }

        private static int? TryGetOptionValue(IOrganizationService org, string entityLogicalName, string attributeLogicalName, string label)
        {
            try
            {
                var req = new RetrieveAttributeRequest
                {
                    EntityLogicalName = entityLogicalName,
                    LogicalName = attributeLogicalName,
                    RetrieveAsIfPublished = true
                };
                var resp = (RetrieveAttributeResponse)org.Execute(req);
                if (resp.AttributeMetadata is EnumAttributeMetadata enumMeta && enumMeta.OptionSet != null)
                {
                    foreach (var opt in enumMeta.OptionSet.Options)
                    {
                        var lab = opt.Label?.UserLocalizedLabel?.Label;
                        if (string.Equals(lab, label, StringComparison.OrdinalIgnoreCase))
                        {
                            return opt.Value;
                        }
                    }
                }
            }
            catch
            {
                // ignore missing metadata or access issues; caller will skip update
            }
            return null;
        }

        private static Entity? GetImage(IPluginExecutionContext ctx, string name)
        {
            if (ctx.PreEntityImages != null && ctx.PreEntityImages.Contains(name)) return ctx.PreEntityImages[name];
            if (ctx.PostEntityImages != null && ctx.PostEntityImages.Contains(name)) return ctx.PostEntityImages[name];
            return null;
        }
    }
}

