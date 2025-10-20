using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Metadata;

namespace CJMSS.Plugins.Plugins.Reorder
{
    /// <summary>
    /// ReorderPointValidationPlugin
    /// - Enforces: one active Reorder Point per Item + Warehouse
    /// - Enforces: Preferred Supplier is required when Auto Create Purchase = true
    ///
    /// Suggested Registration (both Sync, PreOperation):
    ///   Entity: pdg_reorderpoint
    ///     - Create (PreOperation)
    ///     - Update (PreOperation) Filtering: pdg_itemid,pdg_warehouseid,pdg_isactive,statecode,pdg_autocreatepurchase,pdg_preferredsupplierid
    /// </summary>
    public class ReorderPointValidationPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var org = factory.CreateOrganizationService(ctx.UserId);
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            if (!string.Equals(ctx.PrimaryEntityName, "pdg_reorderpoint", StringComparison.OrdinalIgnoreCase)) return;
            if (!(ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is Entity target)) return;

            // Read from Target, fallback to PreImage for Update when attributes aren't in Target
            Entity? pre = null;
            try
            {
                if (ctx.PreEntityImages != null && ctx.PreEntityImages.Contains("PreImage"))
                {
                    pre = ctx.PreEntityImages["PreImage"];
                }
            }
            catch { /* ignore */ }
            var item = GetRef(target, "pdg_itemid") ?? (pre != null ? GetRef(pre, "pdg_itemid") : null);
            var wh = GetRef(target, "pdg_warehouseid") ?? (pre != null ? GetRef(pre, "pdg_warehouseid") : null);
            var isActive = (GetBool(target, "pdg_isactive") ?? (pre != null ? GetBool(pre, "pdg_isactive") : null)) ?? true; // default true per UI
            var autoPO = GetBool(target, "pdg_autocreatepurchase") ?? false;
            var supplier = GetRef(target, "pdg_preferredsupplierid") ?? (pre != null ? GetRef(pre, "pdg_preferredsupplierid") : null);
            var rq = target.Contains("pdg_reorderquantity") ? target.GetAttributeValue<decimal?>("pdg_reorderquantity") : (decimal?)null;

            // Trace basic context for visibility and to avoid IDE warnings about unused variables
            trace?.Trace("ROP Validation: item={0}, wh={1}, isActive={2}, autoPO={3}", item?.Id, wh?.Id, isActive, autoPO);

            if (autoPO && supplier == null)
            {
                throw new InvalidPluginExecutionException("Preferred Supplier is required when Auto Create Purchase is enabled.");
            }

            // MOQ / Order Multiple enforcement (mirror client-side)
            try
            {
                if (!rq.HasValue && ctx.PrimaryEntityId != Guid.Empty)
                {
                    var existingRop = org.Retrieve("pdg_reorderpoint", ctx.PrimaryEntityId, new ColumnSet("pdg_reorderquantity", "pdg_itemid", "pdg_warehouseid", "pdg_isactive"));
                    rq = existingRop?.GetAttributeValue<decimal?>("pdg_reorderquantity");
                    // if item/warehouse missing, fall back from existing record
                    if (item == null) item = existingRop?.GetAttributeValue<EntityReference>("pdg_itemid");
                    if (wh == null) wh = existingRop?.GetAttributeValue<EntityReference>("pdg_warehouseid");
                    if (!GetBool(target, "pdg_isactive").HasValue)
                    {
                        var preIsActive = existingRop?.GetAttributeValue<bool?>("pdg_isactive");
                        if (preIsActive.HasValue) isActive = preIsActive.Value;
                    }
                }
                if (rq.HasValue && item != null)
                {
                    var itemRec = org.Retrieve("pdg_inventoryitem", item.Id, new ColumnSet("pdg_minimumorderquantity", "pdg_ordermultiple", "pdg_maximumorderqty"));
                    var moq = itemRec.GetAttributeValue<decimal?>("pdg_minimumorderquantity") ?? 0m;
                    var mult = itemRec.GetAttributeValue<decimal?>("pdg_ordermultiple") ?? 0m;
                    if (moq > 0m && rq.Value < moq)
                    {
                        throw new InvalidPluginExecutionException($"Reorder Quantity ({rq.Value}) must be greater than or equal to Item MOQ ({moq}).");
                    }
                    if (mult > 0m)
                    {
                        var remainder = rq.Value % mult;
                        if (remainder != 0m)
                        {
                            throw new InvalidPluginExecutionException($"Reorder Quantity ({rq.Value}) must be a multiple of {mult}.");
                        }
                    }
                }
            }
            catch (InvalidPluginExecutionException)
            {
                throw;
            }
            catch (Exception ex)
            {
                trace?.Trace("ROP MOQ/Multiple validation warning: {0}", ex.Message);
                // Non-fatal issues in validation helper shouldn't mask main uniqueness rule
            }

            // Only enforce uniqueness if record is active
            if (item == null || wh == null || !isActive) return;

            var qe = new QueryExpression("pdg_reorderpoint")
            {
                ColumnSet = new ColumnSet(false),
                NoLock = true
            };
            qe.Criteria.AddCondition("statecode", ConditionOperator.Equal, 0); // Active
            qe.Criteria.AddCondition("pdg_isactive", ConditionOperator.Equal, true);
            qe.Criteria.AddCondition("pdg_itemid", ConditionOperator.Equal, item.Id);
            qe.Criteria.AddCondition("pdg_warehouseid", ConditionOperator.Equal, wh.Id);

            // Exclude current in Update
            if (ctx.PrimaryEntityId != Guid.Empty)
            {
                qe.Criteria.AddCondition("pdg_reorderpointid", ConditionOperator.NotEqual, ctx.PrimaryEntityId);
            }

            var existing = org.RetrieveMultiple(qe);
            if (existing.Entities.Any())
            {
                throw new InvalidPluginExecutionException("An active Reorder Point already exists for this Item and Warehouse.");
            }
        }

        private static EntityReference? GetRef(Entity e, string name) => e.Contains(name) ? e.GetAttributeValue<EntityReference>(name) : null;
        private static bool? GetBool(Entity e, string name) => e.Contains(name) ? e.GetAttributeValue<bool?>(name) : null;
    }

    /// <summary>
    /// ReorderPointAutomationPlugin
    /// - Listens to Inventory updates and triggers purchase creation when stock <= reorder point
    ///
    /// Suggested Registration (Async, PostOperation):
    ///   Entity: pdg_inventory, Message: Update
    ///   Filtering Attributes: pdg_onhandquantity,pdg_onlinequantity,pdg_reservedquantity,pdg_quarantined
    ///   Images: PostImage (pdg_itemid,pdg_warehouseid,pdg_onhandquantity,pdg_onlinequantity,pdg_reservedquantity)
    /// </summary>
    public class ReorderPointAutomationPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            if (!string.Equals(ctx.PrimaryEntityName, "pdg_inventory", StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(ctx.MessageName, "Update", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var org = factory.CreateOrganizationService(ctx.UserId);
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            var post = GetImage(ctx, "PostImage");
            if (post == null) return;

            var item = post.GetAttributeValue<EntityReference>("pdg_itemid");
            var wh = post.GetAttributeValue<EntityReference>("pdg_warehouseid");
            if (item == null || wh == null) return;

            // Prefer available/online quantity if present; else compute fallback
            var online = GetDecimal(post, "pdg_onlinequantity");
            var onhand = GetDecimal(post, "pdg_onhandquantity");
            var reserved = GetDecimal(post, "pdg_reservedquantity");
            decimal available = online ?? ((onhand ?? 0m) - (reserved ?? 0m));

            try
            {
                var rop = GetActiveReorderPoint(org, item.Id, wh.Id);
                if (rop == null) { trace.Trace("ROP: none found for item {0} wh {1}", item.Id, wh.Id); return; }

                var auto = rop.GetAttributeValue<bool?>("pdg_autocreatepurchase") ?? false;
                if (!auto) return;

                var threshold = rop.GetAttributeValue<decimal?>("pdg_reorderpoint") ?? 0m;
                // Idempotency and coverage: include open PO quantities for this item+warehouse
                var openQty = GetOpenPOQuantity(org, item.Id, wh.Id);
                var covered = available + openQty;
                if (covered > threshold) { trace.Trace("ROP: Covered by available+openPO ({0} > {1})", covered, threshold); return; }

                CreatePurchaseOrderForROP(org, trace, rop, item, wh, available, openQty, threshold);
            }
            catch (Exception ex)
            {
                trace.Trace("ReorderPointAutomationPlugin error: {0}", ex.ToString());
                // Swallow exceptions in async to avoid blocking inventory updates
            }
        }

        private static Entity? GetActiveReorderPoint(IOrganizationService org, Guid itemId, Guid whId)
        {
            var qe = new QueryExpression("pdg_reorderpoint")
            {
                ColumnSet = new ColumnSet("pdg_reorderpoint","pdg_reorderquantity","pdg_autocreatepurchase","pdg_preferredsupplierid","pdg_maximumstock"),
                NoLock = true
            };
            qe.Criteria.AddCondition("statecode", ConditionOperator.Equal, 0);
            qe.Criteria.AddCondition("pdg_isactive", ConditionOperator.Equal, true);
            qe.Criteria.AddCondition("pdg_itemid", ConditionOperator.Equal, itemId);
            qe.Criteria.AddCondition("pdg_warehouseid", ConditionOperator.Equal, whId);
            var res = org.RetrieveMultiple(qe);
            return res.Entities.FirstOrDefault();
        }

        private static void CreatePurchaseOrderForROP(IOrganizationService org, ITracingService trace, Entity rop, EntityReference item, EntityReference wh, decimal available, decimal openPoQty, decimal threshold)
        {
            var supplier = rop.GetAttributeValue<EntityReference>("pdg_preferredsupplierid");
            if (supplier == null)
            {
                trace.Trace("ROP: Auto-create enabled but Preferred Supplier missing; skipping PO.");
                return;
            }

            var qty = rop.GetAttributeValue<decimal?>("pdg_reorderquantity") ?? 0m;
            if (qty <= 0m) { trace.Trace("ROP: ReorderQuantity is not > 0; skipping."); return; }

            // Optional cap by maximum stock
            var maxStock = rop.GetAttributeValue<decimal?>("pdg_maximumstock");
            if (maxStock.HasValue)
            {
                var needed = maxStock.Value - available;
                if (needed <= 0m) { trace.Trace("ROP: Max stock reached; no order needed."); return; }
                qty = Math.Min(qty, needed);
            }

            // Cap by threshold coverage (avoid ordering more than needed to get above threshold)
            var deficitToThreshold = Math.Max(0m, threshold - (available + openPoQty));
            if (deficitToThreshold <= 0m) { trace.Trace("ROP: No deficit vs threshold"); return; }
            qty = Math.Min(qty, deficitToThreshold);
            if (qty <= 0m) { trace.Trace("ROP: Computed qty <= 0 after coverage capping"); return; }

            // Optional: Round up to Item order multiple and enforce MOQ
            try
            {
                var itm = org.Retrieve("pdg_inventoryitem", item.Id, new ColumnSet("pdg_minimumorderquantity", "pdg_ordermultiple"));
                var moq = itm.GetAttributeValue<decimal?>("pdg_minimumorderquantity") ?? 0m;
                var mult = itm.GetAttributeValue<decimal?>("pdg_ordermultiple") ?? 0m;

                if (mult > 0m)
                {
                    var ratio = qty / mult;
                    var k = (decimal)Math.Ceiling(ratio);
                    qty = k * mult;
                }
                if (moq > 0m && qty < moq)
                {
                    qty = moq;
                }
            }
            catch (Exception ex)
            {
                trace.Trace("ROP: Could not apply MOQ/multiple rounding: {0}", ex.Message);
            }

            // Resolve header currency from supplier; fallback to item currency
            var supplierCurrency = GetCurrencyFromCustomer(org, supplier);
            var itemCurrency = GetItemCurrency(org, item.Id);
            var headerCurrency = supplierCurrency ?? itemCurrency;
            if (headerCurrency == null)
            {
                trace.Trace("ROP: Could not resolve currency. Aborting PO creation.");
                return;
            }

            // Compute unit price: use item standard cost in header currency
            var unitPrice = GetItemStandardCostInCurrency(org, item.Id, headerCurrency.Id);
            if (unitPrice == null)
            {
                // Last resort, set zero and let users adjust
                unitPrice = new Money(0m);
            }

            // Create PO header
            var po = new Entity("pdg_purchaseorder");
            po["pdg_supplier"] = supplier;
            po["pdg_warehouse"] = wh; // PO header field is pdg_warehouse
            po["pdg_deliverydate"] = DateTime.UtcNow;
            po["transactioncurrencyid"] = headerCurrency;
            po["pdg_orderstatus"] = new OptionSetValue(890590000); // Draft
            var poId = org.Create(po);

            // Create line
            var pol = new Entity("pdg_purchaseorderline");
            pol["pdg_purchaseorderid"] = new EntityReference("pdg_purchaseorder", poId);
            pol["pdg_item"] = item; // item is pdg_inventoryitem
            pol["pdg_quantity"] = qty;
            pol["pdg_unitprice"] = unitPrice;
            pol["pdg_purchaseorderline1"] = "1"; // simple first line number
            org.Create(pol);

            // Update ROP last order date for traceability
            var ropUpdate = new Entity("pdg_reorderpoint", rop.Id);
            ropUpdate["pdg_lastorderdate"] = DateTime.UtcNow;
            org.Update(ropUpdate);

            // Optional: write back PO link if ROP has a lookup attribute (e.g., pdg_purchaseorder)
            TrySetReorderPointPOLink(org, trace, rop.Id, new EntityReference("pdg_purchaseorder", poId));

            trace.Trace("ROP: Created PO {0} for item {1} qty {2}", poId, item.Id, qty);
        }

        private static decimal GetOpenPOQuantity(IOrganizationService org, Guid itemId, Guid warehouseId)
        {
            // Sum quantities from PO lines for same item where parent PO warehouse matches and status is open
            var openStatuses = new[] { 890590000, 890590001, 890590002, 890590003 }; // Draft, Submitted, Approved, Partially Received

            var qe = new QueryExpression("pdg_purchaseorderline")
            {
                ColumnSet = new ColumnSet("pdg_quantity"),
                NoLock = true
            };
            var link = qe.AddLink("pdg_purchaseorder", "pdg_purchaseorderid", "pdg_purchaseorderid");
            link.Columns = new ColumnSet("pdg_warehouse", "pdg_orderstatus");
            link.EntityAlias = "po";
            link.LinkCriteria.AddCondition("pdg_warehouse", ConditionOperator.Equal, warehouseId);
            var statusFilter = new FilterExpression(LogicalOperator.Or);
            foreach (var s in openStatuses) statusFilter.AddCondition("pdg_orderstatus", ConditionOperator.Equal, s);
            link.LinkCriteria.Filters.Add(statusFilter);

            qe.Criteria.AddCondition("pdg_item", ConditionOperator.Equal, itemId);
            qe.Criteria.AddCondition("statecode", ConditionOperator.Equal, 0);

            var res = org.RetrieveMultiple(qe);
            decimal sum = 0m;
            foreach (var e in res.Entities)
            {
                var q = e.GetAttributeValue<decimal?>("pdg_quantity") ?? 0m;
                sum += q;
            }
            return sum;
        }

        private static void TrySetReorderPointPOLink(IOrganizationService org, ITracingService trace, Guid ropId, EntityReference poRef)
        {
            try
            {
                // Check whether pdg_reorderpoint has a lookup attribute named 'pdg_purchaseorder'
                var req = new RetrieveEntityRequest
                {
                    LogicalName = "pdg_reorderpoint",
                    EntityFilters = EntityFilters.Attributes
                };
                var resp = (RetrieveEntityResponse)org.Execute(req);
                var hasAttr = resp.EntityMetadata.Attributes.Any(a => string.Equals(a.LogicalName, "pdg_purchaseorder", StringComparison.OrdinalIgnoreCase));
                if (!hasAttr) return;

                var e = new Entity("pdg_reorderpoint", ropId);
                e["pdg_purchaseorder"] = poRef;
                org.Update(e);
            }
            catch (Exception ex)
            {
                trace.Trace("ROP: Could not set PO link on ROP: {0}", ex.Message);
            }
        }

        private static EntityReference? GetCurrencyFromCustomer(IOrganizationService org, EntityReference customer)
        {
            try
            {
                var acc = org.Retrieve(customer.LogicalName, customer.Id, new ColumnSet("transactioncurrencyid"));
                var cur = acc.GetAttributeValue<EntityReference>("transactioncurrencyid");
                return cur;
            }
            catch { return null; }
        }

        private static EntityReference? GetItemCurrency(IOrganizationService org, Guid itemId)
        {
            try
            {
                var itm = org.Retrieve("pdg_inventoryitem", itemId, new ColumnSet("transactioncurrencyid"));
                return itm.GetAttributeValue<EntityReference>("transactioncurrencyid");
            }
            catch { return null; }
        }

        private static Money? GetItemStandardCostInCurrency(IOrganizationService org, Guid itemId, Guid targetCurrencyId)
        {
            // Retrieve item standard cost and its base; convert via target currency exchange rate
            var itm = org.Retrieve("pdg_inventoryitem", itemId, new ColumnSet("pdg_standardcost_base"));
            var baseMoney = itm.GetAttributeValue<Money>("pdg_standardcost_base");
            if (baseMoney == null) return null;

            var targetCurrency = org.Retrieve("transactioncurrency", targetCurrencyId, new ColumnSet("exchangerate"));
            var rate = targetCurrency.GetAttributeValue<decimal?>("exchangerate") ?? 1m;
            // amount = base * rate
            var amount = (baseMoney.Value) * rate;
            return new Money(amount);
        }

        private static Entity? GetImage(IPluginExecutionContext ctx, string name)
        {
            if (ctx.PostEntityImages != null && ctx.PostEntityImages.Contains(name)) return ctx.PostEntityImages[name];
            if (ctx.PreEntityImages != null && ctx.PreEntityImages.Contains(name)) return ctx.PreEntityImages[name];
            return null;
        }
        private static decimal? GetDecimal(Entity e, string attr) => e.Contains(attr) ? e.GetAttributeValue<decimal?>(attr) : null;
    }
}
