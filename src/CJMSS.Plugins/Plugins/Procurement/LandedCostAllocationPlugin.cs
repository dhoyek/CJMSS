using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace CJMSS.Plugins.Plugins.Procurement
{
    /// <summary>
    /// LandedCostAllocationPlugin
    ///
    /// Purpose:
    /// - Allocate header shipping charges to PO lines per selected method
    /// - Update pdg_shippingallocation on lines
    /// - If receipts already posted, post cost adjustments to layers / moving average
    ///
    /// Suggested Registration:
    ///   1) Step: Entity = pdg_purchaseorder, Message = Update, Stage = PostOperation, Mode = Sync
    ///      - Filtering Attributes: pdg_landedcostallocationmethod
    ///      - Images: PostImage name=PostImage (pdg_landedcostallocationmethod)
    ///   2) Step: Entity = pdg_shippingcharges, Messages = Create/Update/Delete, Stage = PostOperation, Mode = Sync
    ///      - Filtering Attributes (Update): pdg_amount,pdg_weight,pdg_volume,pdg_purchaseorderid,pdg_purchaseorderlineid
    ///      - Images: PreImage (same as above) on Delete; PostImage on Create/Update
    ///
    /// Notes:
    /// - Calculated/rollup totals are server-driven; do not recompute header totals here.
    /// - Use existing inventory helpers to adjust cost layers when needed.
    /// </summary>
    public class LandedCostAllocationPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var org = factory.CreateOrganizationService(ctx.UserId);
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            var entityName = ctx.PrimaryEntityName ?? string.Empty;
            if (!string.Equals(entityName, "pdg_purchaseorder", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(entityName, "pdg_shippingcharges", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            try
            {
                trace.Trace("LandedCostAllocationPlugin: entity={0} message={1}", entityName, ctx.MessageName);

                // Resolve header id from context
                Guid poId = Guid.Empty;
                Entity? src = GetAnyImage(ctx) ?? (ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is Entity t ? t : null);
                if (string.Equals(entityName, "pdg_purchaseorder", StringComparison.OrdinalIgnoreCase))
                {
                    poId = ctx.PrimaryEntityId;
                }
                else if (string.Equals(entityName, "pdg_shippingcharges", StringComparison.OrdinalIgnoreCase))
                {
                    var poRef = src?.GetAttributeValue<EntityReference>("pdg_purchaseorder")
                               ?? src?.GetAttributeValue<EntityReference>("pdg_purchaseorderid");
                    if (poRef == null)
                    {
                        // Try via line link
                        var lineRef = src?.GetAttributeValue<EntityReference>("pdg_purchaseorderlineid");
                        if (lineRef != null)
                        {
                            var line = org.Retrieve("pdg_purchaseorderline", lineRef.Id, new ColumnSet("pdg_purchaseorderid"));
                            poRef = line.GetAttributeValue<EntityReference>("pdg_purchaseorderid");
                        }
                    }
                    poId = poRef?.Id ?? Guid.Empty;
                }
                if (poId == Guid.Empty) return;

                // Pull header values
                var po = org.Retrieve("pdg_purchaseorder", poId, new ColumnSet(
                    "pdg_landedcostallocationmethod",
                    "pdg_shippingchargestotal",
                    "pdg_warehouse"
                ));
                var method = po.GetAttributeValue<OptionSetValue>("pdg_landedcostallocationmethod")?.Value;
                var totalShip = GetMoney(po, "pdg_shippingchargestotal");
                trace.Trace("LandedCost: po={0} method={1} total={2}", poId, method, totalShip);
                if (method == null || totalShip <= 0m)
                {
                    // Nothing to allocate
                    return;
                }

                // Gather lines
                var ql = new QueryExpression("pdg_purchaseorderline")
                {
                    ColumnSet = new ColumnSet("pdg_purchaseorderlineid", "pdg_quantity", "pdg_linetotal", "pdg_unitweight", "pdg_item"),
                    NoLock = true
                };
                ql.Criteria.AddCondition("pdg_purchaseorderid", ConditionOperator.Equal, poId);
                var lines = org.RetrieveMultiple(ql).Entities;
                if (lines.Count == 0) return;

                // For volume, read item volumes in one go
                var itemIds = new System.Collections.Generic.HashSet<Guid>();
                foreach (var l in lines)
                {
                    var it = l.GetAttributeValue<EntityReference>("pdg_item");
                    if (it != null) itemIds.Add(it.Id);
                }
                var itemVolume = new System.Collections.Generic.Dictionary<Guid, decimal>();
                if (itemIds.Count > 0)
                {
                    var qi = new QueryExpression("pdg_inventoryitem")
                    {
                        ColumnSet = new ColumnSet("pdg_volume"),
                        NoLock = true
                    };
                    qi.Criteria.AddCondition("pdg_inventoryitemid", ConditionOperator.In, new System.Collections.Generic.List<object>(System.Linq.Enumerable.Select(itemIds, id => (object)id)));
                    var items = org.RetrieveMultiple(qi).Entities;
                    foreach (var it in items)
                    {
                        var vol = it.Contains("pdg_volume") && it["pdg_volume"] != null ? (decimal)it["pdg_volume"] : 0m;
                        itemVolume[it.Id] = vol;
                    }
                }

                // Compute metrics
                decimal sumMetric = 0m;
                var metrics = new System.Collections.Generic.Dictionary<Guid, decimal>();
                foreach (var l in lines)
                {
                    var id = l.Id;
                    var qty = l.GetAttributeValue<decimal?>("pdg_quantity") ?? 0m;
                    if (qty <= 0m) { metrics[id] = 0m; continue; }
                    decimal m = 0m;
                    switch (method.Value)
                    {
                        case 100100000: // By Weight
                            var uw = l.GetAttributeValue<decimal?>("pdg_unitweight") ?? 0m;
                            m = uw * qty;
                            break;
                        case 100100001: // By Volume
                            var it = l.GetAttributeValue<EntityReference>("pdg_item");
                            var volu = (it != null && itemVolume.ContainsKey(it.Id)) ? itemVolume[it.Id] : 0m;
                            m = volu * qty;
                            break;
                        case 100100002: // By Value
                            var lt = GetMoney(l, "pdg_linetotal");
                            m = lt;
                            break;
                        case 100100003: // Even Split
                        default:
                            m = 1m;
                            break;
                    }
                    metrics[id] = m;
                    sumMetric += m;
                }
                if (sumMetric <= 0m)
                {
                    // fallback to even split
                    metrics.Clear();
                    sumMetric = lines.Count;
                    foreach (var l in lines) metrics[l.Id] = 1m;
                }

                // Allocate amounts
                var updates = new System.Collections.Generic.List<Entity>();
                decimal allocated = 0m; int idx = 0;
                foreach (var l in lines)
                {
                    idx++;
                    var id = l.Id; var part = metrics[id];
                    decimal share;
                    if (idx == lines.Count)
                    {
                        share = totalShip - allocated; // remainder to last line
                        if (share < 0m) share = 0m;
                    }
                    else
                    {
                        share = (sumMetric > 0m) ? System.Math.Round(totalShip * (part / sumMetric), 2) : 0m; // 2-decimal rounding
                        allocated += share;
                    }
                    var upd = new Entity("pdg_purchaseorderline") { Id = id };
                    upd["pdg_shippingallocation"] = new Money(share);
                    updates.Add(upd);
                }
                foreach (var u in updates) org.Update(u);

                // Post-allocation: adjust existing receipt layers and WAC.
                // If warehouse valuation is explicitly not Moving Average, skip adjustments globally.
                var whRef = po.GetAttributeValue<EntityReference>("pdg_warehouse");
                bool? warehouseIsMovingAverage = null;
                try
                {
                    if (whRef != null)
                    {
                        var wh = org.Retrieve("pdg_warehouse", whRef.Id, new ColumnSet("pdg_valuationmethod"));
                        var val = wh.GetAttributeValue<OptionSetValue>("pdg_valuationmethod")?.Value;
                        if (val != null) warehouseIsMovingAverage = (val == 100100002);
                    }
                }
                catch { }
                if (warehouseIsMovingAverage.HasValue && warehouseIsMovingAverage.Value == false)
                {
                    trace.Trace("LandedCost: skipping cost layer/WAC adjustments (warehouse valuation not Moving Average).");
                    return;
                }

                // Adjust existing receipt layers and WAC
                var affectedInventories = new System.Collections.Generic.HashSet<Guid>();
                foreach (var l in lines)
                {
                    var lineId = l.Id;
                    var alloc = updates.Find(e => e.Id == lineId)?.GetAttributeValue<Money>("pdg_shippingallocation")?.Value ?? 0m;
                    if (alloc <= 0m) continue;

                    // Sum received quantity for this line
                    var qr = new QueryExpression("pdg_purchaseorderreceipt")
                    {
                        ColumnSet = new ColumnSet("pdg_purchaseorderreceiptid", "pdg_quantityreceived"),
                        NoLock = true
                    };
                    qr.Criteria.AddCondition("pdg_purchaseorderlineid", ConditionOperator.Equal, lineId);
                    var recs = org.RetrieveMultiple(qr).Entities;
                    decimal recQty = 0m;
                    foreach (var r in recs) recQty += r.GetAttributeValue<decimal?>("pdg_quantityreceived") ?? 0m;
                    if (recQty <= 0m) continue;

                    // Skip adjustments if this line's valuation (warehouse->item) is not Moving Average
                    bool lineIsMovingAverage = IsMovingAverageForLine(org, whRef, l.GetAttributeValue<EntityReference>("pdg_item"));
                    if (!lineIsMovingAverage)
                    {
                        trace.Trace("LandedCost: skip layer adjust for line {0} (non-Moving Average)", lineId);
                        continue;
                    }

                    var perUnit = alloc / recQty;

                    foreach (var r in recs)
                    {
                        var rid = r.Id;
                        // Find cost layer by reference id
                        var qlref = new QueryExpression("pdg_costlayer")
                        {
                            ColumnSet = new ColumnSet("pdg_costlayerid", "pdg_unitcost", "pdg_inventoryid", "pdg_quantityremaining"),
                            NoLock = true
                        };
                        qlref.Criteria.AddCondition("pdg_referenceid", ConditionOperator.Equal, rid.ToString());
                        var layers = org.RetrieveMultiple(qlref).Entities;
                        foreach (var cl in layers)
                        {
                            var oldUnit = GetMoney(cl, "pdg_unitcost");
                            var newUnit = oldUnit + perUnit;
                            var upd = new Entity("pdg_costlayer") { Id = cl.Id };
                            upd["pdg_unitcost"] = new Money(newUnit);
                            org.Update(upd);
                            var invRef = cl.GetAttributeValue<EntityReference>("pdg_inventoryid");
                            if (invRef != null) affectedInventories.Add(invRef.Id);
                        }
                    }
                }

                // Recompute weighted average for affected inventories
                foreach (var invId in affectedInventories)
                {
                    var qlayers = new QueryExpression("pdg_costlayer")
                    {
                        ColumnSet = new ColumnSet("pdg_quantityremaining", "pdg_unitcost"),
                        NoLock = true
                    };
                    qlayers.Criteria.AddCondition("pdg_inventoryid", ConditionOperator.Equal, invId);
                    var allLayers = org.RetrieveMultiple(qlayers).Entities;
                    decimal sumQty = 0m; decimal sumVal = 0m;
                    foreach (var cl in allLayers)
                    {
                        var qrem = cl.Contains("pdg_quantityremaining") && cl["pdg_quantityremaining"] != null ? (decimal)cl["pdg_quantityremaining"] : 0m;
                        var u = GetMoney(cl, "pdg_unitcost");
                        sumQty += qrem; sumVal += (qrem * u);
                    }
                    if (sumQty > 0m)
                    {
                        var wac = sumVal / sumQty;
                        var invUpd = new Entity("pdg_inventory") { Id = invId };
                        invUpd["pdg_weightedaveragecost"] = new Money(wac);
                        org.Update(invUpd);
                    }
                }
            }
            catch (Exception ex)
            {
                trace.Trace("LandedCostAllocationPlugin error: {0}", ex.ToString());
                throw;
            }
        }

        private static Entity? GetAnyImage(IPluginExecutionContext ctx)
        {
            if (ctx.PostEntityImages != null && ctx.PostEntityImages.Count > 0)
                foreach (var k in ctx.PostEntityImages.Keys) return ctx.PostEntityImages[k];
            if (ctx.PreEntityImages != null && ctx.PreEntityImages.Count > 0)
                foreach (var k in ctx.PreEntityImages.Keys) return ctx.PreEntityImages[k];
            return null;
        }

        private static decimal GetMoney(Entity e, string attr)
        {
            if (e == null || !e.Attributes.Contains(attr) || e[attr] == null) return 0m;
            var o = e[attr];
            if (o is Money m) return m.Value;
            if (o is decimal d) return d;
            if (o is double f) return (decimal)f;
            return 0m;
        }

        // Warehouse valuation takes precedence; if not set, fall back to item costing method
        private static bool IsMovingAverageForLine(IOrganizationService org, EntityReference? warehouse, EntityReference? item)
        {
            try
            {
                if (warehouse != null)
                {
                    var wh = org.Retrieve("pdg_warehouse", warehouse.Id, new ColumnSet("pdg_valuationmethod"));
                    var val = wh.GetAttributeValue<OptionSetValue>("pdg_valuationmethod")?.Value;
                    if (val != null)
                    {
                        return val == 100100002; // Average
                    }
                }
            }
            catch { }
            try
            {
                if (item != null)
                {
                    var it = org.Retrieve("pdg_inventoryitem", item.Id, new ColumnSet("pdg_costingmethod"));
                    var ival = it.GetAttributeValue<OptionSetValue>("pdg_costingmethod")?.Value;
                    if (ival != null)
                    {
                        return ival == 100000001; // Item costing: Average
                    }
                }
            }
            catch { }
            // Default: treat as not Moving Average to be conservative for landed-cost adjustments
            return false;
        }
    }
}
