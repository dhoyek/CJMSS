using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using System.Linq;

namespace CJMSS.Plugins.Plugins.Procurement
{
    /// <summary>
    /// PurchaseReturnPostingPlugin (stub)
    ///
    /// Purpose:
    /// - Post inventory OUT transactions when goods are returned to supplier
    /// - Reference original receipt/layer when available to preserve costing
    ///
    /// Suggested Registration (adjust to your return entities):
    ///   Option A: Header driven
    ///     - Entity: pdg_purchasereturn (Message: Update, Stage: PostOperation, Mode: Sync)
    ///       Filter: status/posted flag to trigger posting
    ///   Option B: Line driven (preferred)
    ///     - Entity: pdg_purchasereturnline (Create/Update/Delete, PostOperation, Sync)
    ///       Filtering Attributes: pdg_itemid,pdg_quantity,pdg_purchaseorderlineid,pdg_receiptid,pdg_binid,pdg_lotnumber
    ///       Images: PostImage on Create/Update; PreImage on Delete
    ///
    /// Behavior (outline):
    /// - On create/update of a posted/valid return line: create OUT transaction with ReferenceType=Purchase, TransactionType=Out
    /// - If a specific receipt is referenced: find the cost layer (pdg_costlayer.pdg_referenceid = <receiptId>) and reduce quantity/track cost
    /// - On change/delete: reverse/repost accordingly
    ///
    /// This file is a stub to be completed when your return entities are finalized.
    /// </summary>
    public class PurchaseReturnPostingPlugin : IPlugin
    {
        private class InventoryTxn
        {
            public EntityReference? Item { get; set; }
            public EntityReference? WarehouseFrom { get; set; }
            public EntityReference? WarehouseTo { get; set; }
            public EntityReference? BinFrom { get; set; }
            public EntityReference? BinTo { get; set; }
            public decimal Quantity { get; set; }
            public decimal UnitCost { get; set; }
            public decimal TotalCost { get; set; }
            public DateTime TransactionDate { get; set; }
            public int TransactionType { get; set; }
            public int ReferenceType { get; set; }
            public int CostCalculationMethod { get; set; }
            public string? LotNumber { get; set; }
        }

        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var org = factory.CreateOrganizationService(ctx.UserId);
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            trace.Trace("PurchaseReturnPostingPlugin invoked for entity {0} message {1}", ctx.PrimaryEntityName, ctx.MessageName);

            // Minimal, schema-tolerant posting for purchase return lines
            // Assumptions (best-effort):
            // - Line entity logical name contains "purchasereturnline"
            // - Common attributes attempted: pdg_itemid, pdg_quantity, pdg_warehouseid, pdg_binid, pdg_lotnumber
            // - Optional: receipt reference on line as one of pdg_receiptid/pdg_purchaseorderreceiptid
            // - Posts single OUT inventory transaction keyed by reference token "<lineId>-PO-RET"

            var entityName = ctx.PrimaryEntityName ?? string.Empty;
            if (entityName.IndexOf("purchasereturnline", StringComparison.OrdinalIgnoreCase) < 0)
            {
                // Not a return line; nothing to do (header-driven variants can be added later)
                return;
            }

            var pre = GetImage(ctx, "PreImage");
            var post = GetImage(ctx, "PostImage");
            var target = ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is Entity t ? t : null;
            var msg = ctx.MessageName ?? string.Empty;

            Entity? src = string.Equals(msg, "Delete", StringComparison.OrdinalIgnoreCase) ? pre : (post ?? target);
            if (src == null)
            {
                trace.Trace("PurchaseReturn: no source entity available. Skipping.");
                return;
            }

            // Identify key fields (best-effort across possible schemas)
            var lineId = (ctx.PrimaryEntityId != Guid.Empty) ? ctx.PrimaryEntityId : (src.Id != Guid.Empty ? src.Id : Guid.Empty);
            var itemRef = TryGet<EntityReference>(src, trace, "pdg_itemid");
            var whRef = TryGet<EntityReference>(src, trace, "pdg_warehouseid");
            var qty = TryGetDecimal(src, trace, "pdg_quantity");
            var fromBin = TryGet<EntityReference>(src, trace, "pdg_binid") ?? TryGet<EntityReference>(src, trace, "pdg_frombinid");
            var lotNumber = TryGet<string>(src, trace, "pdg_lotnumber");

            // If warehouse is on header, try to resolve via parent reference
            if (whRef == null)
            {
                var headerRef = TryGet<EntityReference>(src, trace, "pdg_purchasereturnid") ?? TryGet<EntityReference>(src, trace, "pdg_purchasereturn");
                if (headerRef != null)
                {
                    try
                    {
                        var header = org.Retrieve(headerRef.LogicalName, headerRef.Id, new ColumnSet("pdg_warehouseid"));
                        whRef = header.GetAttributeValue<EntityReference>("pdg_warehouseid");
                    }
                    catch (Exception ex)
                    {
                        trace.Trace("PurchaseReturn: header load failed {0}", ex.Message);
                    }
                }
            }

            // Determine unit cost from original receipt's cost layer if provided
            decimal unitCost = 0m;
            var receiptRef = TryGet<EntityReference>(src, trace, "pdg_receiptid")
                             ?? TryGet<EntityReference>(src, trace, "pdg_purchaseorderreceiptid")
                             ?? TryGet<EntityReference>(src, trace, "pdg_receipt");
            if (receiptRef != null && itemRef != null)
            {
                try
                {
                    var q = new QueryExpression("pdg_costlayer")
                    {
                        ColumnSet = new ColumnSet("pdg_unitcost"),
                        Criteria = new FilterExpression(LogicalOperator.And)
                    };
                    q.Criteria.AddCondition("pdg_referenceid", ConditionOperator.Equal, receiptRef.Id.ToString());
                    q.Criteria.AddCondition("pdg_itemid", ConditionOperator.Equal, itemRef.Id);
                    var layer = org.RetrieveMultiple(q).Entities.FirstOrDefault();
                    if (layer != null)
                    {
                        var costMoney = layer.GetAttributeValue<Money>("pdg_unitcost");
                        if (costMoney != null && costMoney.Value > 0m) unitCost = costMoney.Value;
                    }
                }
                catch (Exception ex)
                {
                    trace.Trace("PurchaseReturn: cost layer lookup failed {0}", ex.Message);
                }
            }

            // Fallback to item's last cost if available
            if (unitCost <= 0m && itemRef != null)
            {
                try
                {
                    var item = org.Retrieve("pdg_inventoryitem", itemRef.Id, new ColumnSet("pdg_lastcost"));
                    unitCost = (item.GetAttributeValue<Money>("pdg_lastcost")?.Value) ?? 0m;
                }
                catch { }
            }

            // Simple idempotent reference for the inventory transaction
            var txnRef = $"{lineId}-PO-RET";

            if (string.Equals(msg, "Delete", StringComparison.OrdinalIgnoreCase))
            {
                DeleteInventoryTransactionByReference(org, trace, txnRef);
                return;
            }

            // Validate minimal requirements
            if (itemRef == null || whRef == null || qty <= 0m)
            {
                trace.Trace("PurchaseReturn: missing required fields (item/warehouse/qty). Skipping post.");
                return;
            }

            // Upsert OUT inventory transaction with ReferenceType=Purchase, TransactionType=Out
            UpsertInventoryTransaction(org, trace, txnRef, new InventoryTxn
            {
                Item = itemRef,
                WarehouseFrom = whRef,
                BinFrom = fromBin,
                Quantity = qty,
                UnitCost = unitCost,
                TotalCost = unitCost * qty,
                TransactionDate = DateTime.UtcNow,
                TransactionType = 100000001, // Out
                ReferenceType = 100000000,   // Purchase
                CostCalculationMethod = 100000000, // Default to Average
                LotNumber = lotNumber
            });
        }

        private static Entity? GetImage(IPluginExecutionContext ctx, string name)
        {
            if (ctx.PreEntityImages != null && ctx.PreEntityImages.Contains(name))
                return ctx.PreEntityImages[name] as Entity;
            if (ctx.PostEntityImages != null && ctx.PostEntityImages.Contains(name))
                return ctx.PostEntityImages[name] as Entity;
            return null;
        }

        private static T? TryGet<T>(Entity e, ITracingService trace, string attribute) where T : class
        {
            try
            {
                if (e.Contains(attribute) && e[attribute] is T t) return t;
            }
            catch (Exception ex) { trace.Trace("TryGet<{0}>({1}) failed: {2}", typeof(T).Name, attribute, ex.Message); }
            return default;
        }

        private static decimal TryGetDecimal(Entity e, ITracingService trace, string attribute)
        {
            try
            {
                if (!e.Contains(attribute) || e[attribute] == null) return 0m;
                var v = e[attribute];
                if (v is decimal d) return d;
                if (v is double db) return (decimal)db;
                if (v is Money m) return m.Value;
                if (v is int i) return i;
                if (v is long l) return l;
                if (decimal.TryParse(v.ToString(), out var parsed)) return parsed;
            }
            catch (Exception ex) { trace.Trace("TryGetDecimal({0}) failed: {1}", attribute, ex.Message); }
            return 0m;
        }

        private void DeleteInventoryTransactionByReference(IOrganizationService org, ITracingService trace, string referenceId)
        {
            var query = new QueryExpression("pdg_inventorytransaction")
            {
                ColumnSet = new ColumnSet("pdg_inventorytransactionid"),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            query.Criteria.AddCondition("pdg_referenceid", ConditionOperator.Equal, referenceId);
            var coll = org.RetrieveMultiple(query).Entities;
            foreach (var e in coll)
            {
                org.Delete("pdg_inventorytransaction", e.Id);
                trace.Trace("Deleted inventory transaction {0} for {1}", e.Id, referenceId);
            }
        }

        private bool UpsertInventoryTransaction(IOrganizationService org, ITracingService trace, string referenceId, InventoryTxn data)
        {
            var query = new QueryExpression("pdg_inventorytransaction")
            {
                ColumnSet = new ColumnSet("pdg_inventorytransactionid"),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            query.Criteria.AddCondition("pdg_referenceid", ConditionOperator.Equal, referenceId);
            var existing = org.RetrieveMultiple(query).Entities.FirstOrDefault();

            if (data.Item == null) throw new InvalidPluginExecutionException("Inventory transaction requires Item");

            var ent = new Entity("pdg_inventorytransaction");
            if (existing != null) ent.Id = existing.Id;
            ent["pdg_referenceid"] = referenceId;
            ent["pdg_itemid"] = data.Item;
            ent["pdg_transactiondate"] = data.TransactionDate.ToUniversalTime();
            ent["pdg_quantity"] = data.Quantity;
            ent["pdg_unitcost"] = new Money(data.UnitCost);
            ent["pdg_totalcost"] = new Money(data.TotalCost);
            ent["pdg_transactiontype"] = new OptionSetValue(data.TransactionType);
            ent["pdg_referencetype"] = new OptionSetValue(data.ReferenceType);
            ent["pdg_costcalculationmethod"] = new OptionSetValue(data.CostCalculationMethod);
            if (!string.IsNullOrEmpty(data.LotNumber)) ent["pdg_lotnumber"] = data.LotNumber;
            if (data.WarehouseFrom != null) ent["pdg_fromwarehouseid"] = data.WarehouseFrom;
            if (data.WarehouseTo != null) ent["pdg_towarehouseid"] = data.WarehouseTo;
            if (data.BinFrom != null) ent["pdg_frombinid"] = data.BinFrom;
            if (data.BinTo != null) ent["pdg_tobinid"] = data.BinTo;

            if (existing == null)
            {
                var id = org.Create(ent);
                trace.Trace("Created inventory transaction {0} for {1}", id, referenceId);
            }
            else
            {
                org.Update(ent);
                trace.Trace("Updated inventory transaction {0} for {1}", existing.Id, referenceId);
            }
            return true;
        }
    }
}
